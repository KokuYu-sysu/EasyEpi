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
const SAFE_TEMP_FILE_NAME = /^EasyEpi-preferences-\d+-\d+\.tmp$/
const MAX_TEMP_FILE_ATTEMPTS = 16
let temporaryFileCounter = 0

export interface PreferencesFileSystem {
  readFile(filePath: string): Promise<string>
  writeFile(filePath: string, data: string): Promise<void>
  syncFile(filePath: string): Promise<void>
  rename(from: string, to: string): Promise<void>
  list(directory: string): Promise<string[]>
  remove(filePath: string): Promise<void>
}

export interface PreferencesStore {
  get(): Promise<PreferencesResult>
  update(request: unknown): Promise<PreferencesResult>
}

const nodeFileSystem: PreferencesFileSystem = {
  readFile: (filePath) => readFile(filePath, 'utf8'),
  async writeFile(filePath, data) {
    const handle = await open(filePath, 'wx')
    try {
      await handle.writeFile(data, 'utf8')
    } finally {
      await handle.close()
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
  fileSystem: PreferencesFileSystem = nodeFileSystem
): PreferencesStore {
  const preferencesPath = path.join(directory, PREFERENCES_FILE_NAME)
  let updateTail: Promise<void> = Promise.resolve()

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

  async function cleanStaleTemporaryFiles(excludedNames: ReadonlySet<string>): Promise<void> {
    try {
      const names = await fileSystem.list(directory)
      await Promise.all(
        names
          .filter((name) => SAFE_TEMP_FILE_NAME.test(name) && !excludedNames.has(name))
          .map(async (name) => {
            try {
              await fileSystem.remove(path.join(directory, name))
            } catch {
              // Cleanup is best effort and happens only after the atomic commit.
            }
          })
      )
    } catch {
      // A committed preference update must not fail because directory cleanup did.
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
    let committedPreferences: PreferencesV1

    try {
      for (let attempt = 0; attempt < MAX_TEMP_FILE_ATTEMPTS; attempt += 1) {
        temporaryFileCounter += 1
        const temporaryName =
          `${TEMP_FILE_PREFIX}${process.pid}-${temporaryFileCounter}${TEMP_FILE_SUFFIX}`
        const candidatePath = path.join(directory, temporaryName)
        try {
          await fileSystem.writeFile(candidatePath, canonicalContents)
          temporaryPath = candidatePath
          break
        } catch (error) {
          if (!isExistingFile(error)) {
            throw error
          }
          collisionNames.add(temporaryName)
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
      return { ok: false, code: 'PREFERENCES_SAVE_FAILED' }
    }

    await cleanStaleTemporaryFiles(collisionNames)
    return { ok: true, preferences: committedPreferences }
  }

  function update(request: unknown): Promise<PreferencesResult> {
    const operation = updateTail.then(
      () => save(request),
      () => save(request)
    )
    updateTail = operation.then(
      () => undefined,
      () => undefined
    )
    return operation
  }

  return { get, update }
}
