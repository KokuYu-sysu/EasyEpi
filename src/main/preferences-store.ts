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
const MAX_STALE_TEMP_REMOVALS = 32
const OWN_TEMP_FILE_NAME = new RegExp(
  `^EasyEpi-preferences-${process.pid}-\\d+\\.tmp$`
)
let temporaryFileCounter = randomInt(1_000_000, 2_000_000_000)

interface DirectoryCoordinator {
  tail: Promise<void>
  activeTemporaryNames: Set<string>
}

const directoryCoordinators = new Map<string, DirectoryCoordinator>()

export interface PreferencesFileSystem {
  readFile(filePath: string): Promise<string>
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

function coordinatorKey(directory: string): string {
  const resolved = path.normalize(path.resolve(directory))
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function getDirectoryCoordinator(directory: string): DirectoryCoordinator {
  const key = coordinatorKey(directory)
  const existing = directoryCoordinators.get(key)
  if (existing !== undefined) {
    return existing
  }

  const coordinator: DirectoryCoordinator = {
    tail: Promise.resolve(),
    activeTemporaryNames: new Set<string>()
  }
  directoryCoordinators.set(key, coordinator)
  return coordinator
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
  const coordinator = getDirectoryCoordinator(directory)

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
    } catch {
      logger.warn('PREFERENCES_TEMP_CLEANUP_FAILED', 'remove')
    }
  }

  async function cleanStaleTemporaryFiles(excludedNames: ReadonlySet<string>): Promise<void> {
    let names: string[]
    try {
      names = await fileSystem.list(directory)
    } catch {
      logger.warn('PREFERENCES_TEMP_CLEANUP_FAILED', 'list')
      return
    }

    const removableNames = names
      .filter(
        (name) =>
          OWN_TEMP_FILE_NAME.test(name) &&
          !coordinator.activeTemporaryNames.has(name) &&
          !excludedNames.has(name)
      )
      .slice(0, MAX_STALE_TEMP_REMOVALS)

    for (const name of removableNames) {
      try {
        await fileSystem.remove(path.join(directory, name))
      } catch {
        logger.warn('PREFERENCES_TEMP_CLEANUP_FAILED', 'remove')
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
    const collisionNames = new Set<string>()
    let temporaryPath: string | undefined
    let temporaryName: string | undefined
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
          temporaryName = candidateName
          coordinator.activeTemporaryNames.add(candidateName)
          break
        } catch (error) {
          if (error instanceof PreferencesTemporaryFileCreatedError) {
            temporaryPath = candidatePath
            temporaryName = candidateName
            coordinator.activeTemporaryNames.add(candidateName)
            throw error
          }
          if (!isExistingFile(error)) {
            throw error
          }
          collisionNames.add(candidateName)
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
      }
      if (temporaryName !== undefined) {
        coordinator.activeTemporaryNames.delete(temporaryName)
      }
      return { ok: false, code: 'PREFERENCES_SAVE_FAILED' }
    }

    if (temporaryName !== undefined) {
      coordinator.activeTemporaryNames.delete(temporaryName)
    }
    await cleanStaleTemporaryFiles(collisionNames)
    return { ok: true, preferences: committedPreferences }
  }

  function update(request: unknown): Promise<PreferencesResult> {
    const operation = coordinator.tail.then(
      () => save(request),
      () => save(request)
    )
    coordinator.tail = operation.then(
      () => undefined,
      () => undefined
    )
    return operation
  }

  return { get, update }
}
