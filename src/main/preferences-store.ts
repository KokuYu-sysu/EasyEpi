import { randomInt } from 'node:crypto'
import { open, readFile, readdir, rename, unlink } from 'node:fs/promises'
import path from 'node:path'

import {
  DEFAULT_PREFERENCES,
  parsePreferences,
  parsePreferencesUpdateRequest,
  type PreferencesResult,
  type PreferencesV1
} from '../shared/preferences-contract'

const PREFERENCES_FILE_NAME = 'preferences.json'
const TEMP_FILE_PREFIX = 'EasyEpi-preferences-'
const TEMP_FILE_SUFFIX = '.tmp'
const MAX_TEMP_FILE_ATTEMPTS = 16
const MAX_ABANDONED_TEMP_REMOVALS = 32
let temporaryFileCounter = randomInt(1_000_000, 2_000_000_000)
let globalWriteTail: Promise<void> = Promise.resolve()
const activeTemporaryPaths = new Set<string>()
const abandonedOwnedTemporaryPaths = new Map<string, PreferencesFileSystem>()

export interface PreferencesFileSystem {
  readFile(filePath: string): Promise<string>
  /**
   * Exclusively creates `filePath` and writes `data`. If creation succeeds but
   * writing or closing later fails, reject with
   * `PreferencesTemporaryFileCreatedError` so the store can safely remove only
   * the exact path this adapter proved it created.
   */
  writeFile(filePath: string, data: string): Promise<void>
  syncFile(filePath: string): Promise<void>
  rename(from: string, to: string): Promise<void>
  list(directory: string): Promise<string[]>
  remove(filePath: string): Promise<void>
}

export interface PreferencesLogger {
  warn(code: 'PREFERENCES_TEMP_CLEANUP_FAILED', operation: 'list' | 'remove'): void
}

export interface PreferencesStore {
  get(): Promise<PreferencesResult>
  update(request: unknown): Promise<PreferencesResult>
}

/**
 * Path-free marker for an adapter failure after exclusive temp-file creation.
 * Injected adapters must use this marker when `writeFile` created the requested
 * path before failing; ordinary failures and collisions must use their native
 * error classification instead.
 */
export class PreferencesTemporaryFileCreatedError extends Error {
  constructor() {
    super('PREFERENCES_TEMP_FILE_CREATED')
    this.name = 'PreferencesTemporaryFileCreatedError'
  }
}

const defaultLogger: PreferencesLogger = {
  warn(code, operation) {
    console.warn(`[EasyEpi] ${code}:${operation}`)
  }
}

export const nodePreferencesFileSystem: PreferencesFileSystem = {
  readFile: (filePath) => readFile(filePath, 'utf8'),
  async writeFile(filePath, data) {
    // The userData directory is an app-private trusted directory. `wx` blocks
    // pre-existing files and links; hostile same-user replacement after this
    // handle closes is outside this store's threat model.
    const handle = await open(filePath, 'wx')
    let operationFailed = false
    try {
      await handle.writeFile(data, 'utf8')
    } catch {
      operationFailed = true
    } finally {
      try {
        await handle.close()
      } catch {
        operationFailed = true
      }
    }
    if (operationFailed) {
      throw new PreferencesTemporaryFileCreatedError()
    }
  },
  async syncFile(filePath) {
    const handle = await open(filePath, 'r+')
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
  },
  rename,
  list: readdir,
  remove: unlink
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  )
}

function isExistingFile(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'EEXIST'
  )
}

function recoveredPreferences(): PreferencesResult {
  return {
    ok: true,
    preferences: { ...DEFAULT_PREFERENCES },
    warning: 'PREFERENCES_RECOVERED'
  }
}

export function createPreferencesStore(
  directory: string,
  fileSystem: PreferencesFileSystem = nodePreferencesFileSystem,
  logger: PreferencesLogger = defaultLogger
): PreferencesStore {
  const preferencesPath = path.join(directory, PREFERENCES_FILE_NAME)

  function safeWarn(operation: 'list' | 'remove'): void {
    try {
      logger.warn('PREFERENCES_TEMP_CLEANUP_FAILED', operation)
    } catch {
      // Diagnostics must never change a stable persistence result.
    }
  }

  async function get(): Promise<PreferencesResult> {
    let contents: string
    try {
      contents = await fileSystem.readFile(preferencesPath)
    } catch (error) {
      return isMissingFile(error)
        ? { ok: true, preferences: { ...DEFAULT_PREFERENCES } }
        : { ok: false, code: 'PREFERENCES_READ_FAILED' }
    }

    try {
      return { ok: true, preferences: parsePreferences(JSON.parse(contents)) }
    } catch {
      return recoveredPreferences()
    }
  }

  async function removeCreatedTemporaryFile(temporaryPath: string): Promise<void> {
    try {
      await fileSystem.remove(temporaryPath)
      abandonedOwnedTemporaryPaths.delete(temporaryPath)
    } catch {
      abandonedOwnedTemporaryPaths.set(temporaryPath, fileSystem)
      safeWarn('remove')
    }
  }

  async function cleanAbandonedOwnedTemporaryFiles(): Promise<void> {
    const entries = [...abandonedOwnedTemporaryPaths.entries()]
      .filter(([temporaryPath]) => !activeTemporaryPaths.has(temporaryPath))
      .slice(0, MAX_ABANDONED_TEMP_REMOVALS)

    for (const [temporaryPath, owningFileSystem] of entries) {
      try {
        await owningFileSystem.remove(temporaryPath)
        abandonedOwnedTemporaryPaths.delete(temporaryPath)
      } catch {
        safeWarn('remove')
      }
    }
  }

  async function save(request: unknown): Promise<PreferencesResult> {
    let preferences: PreferencesV1
    try {
      preferences = parsePreferencesUpdateRequest(request)
    } catch {
      return { ok: false, code: 'INVALID_PREFERENCES_REQUEST' }
    }

    const canonicalContents = `${JSON.stringify(preferences)}\n`
    let temporaryPath: string | undefined
    let committedPreferences: PreferencesV1

    try {
      for (let attempt = 0; attempt < MAX_TEMP_FILE_ATTEMPTS; attempt += 1) {
        const candidateName =
          `${TEMP_FILE_PREFIX}${process.pid}-${temporaryFileCounter}${TEMP_FILE_SUFFIX}`
        temporaryFileCounter += 1
        const candidatePath = path.join(directory, candidateName)
        try {
          await fileSystem.writeFile(candidatePath, canonicalContents)
          temporaryPath = candidatePath
          activeTemporaryPaths.add(candidatePath)
          break
        } catch (error) {
          if (error instanceof PreferencesTemporaryFileCreatedError) {
            temporaryPath = candidatePath
            activeTemporaryPaths.add(candidatePath)
            throw error
          }
          if (!isExistingFile(error)) {
            throw error
          }
        }
      }

      if (temporaryPath === undefined) {
        throw new Error('TEMP_FILE_ATTEMPTS_EXHAUSTED')
      }

      await fileSystem.syncFile(temporaryPath)
      const writtenContents = await fileSystem.readFile(temporaryPath)
      committedPreferences = parsePreferences(JSON.parse(writtenContents))
      await fileSystem.rename(temporaryPath, preferencesPath)
    } catch {
      if (temporaryPath !== undefined) {
        await removeCreatedTemporaryFile(temporaryPath)
        activeTemporaryPaths.delete(temporaryPath)
      }
      return { ok: false, code: 'PREFERENCES_SAVE_FAILED' }
    }

    if (temporaryPath !== undefined) {
      activeTemporaryPaths.delete(temporaryPath)
    }
    await cleanAbandonedOwnedTemporaryFiles()
    return { ok: true, preferences: committedPreferences }
  }

  function update(request: unknown): Promise<PreferencesResult> {
    const operation = globalWriteTail.then(
      () => save(request),
      () => save(request)
    )
    globalWriteTail = operation.then(
      () => undefined,
      () => undefined
    )
    return operation
  }

  return { get, update }
}
