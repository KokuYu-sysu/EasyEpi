import { open, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises'
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
  writeFile: (filePath, data) => writeFile(filePath, data, 'utf8'),
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

  async function cleanStaleTemporaryFiles(): Promise<void> {
    try {
      const names = await fileSystem.list(directory)
      await Promise.all(
        names
          .filter((name) => SAFE_TEMP_FILE_NAME.test(name))
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

    temporaryFileCounter += 1
    const temporaryName =
      `${TEMP_FILE_PREFIX}${process.pid}-${temporaryFileCounter}${TEMP_FILE_SUFFIX}`
    const temporaryPath = path.join(directory, temporaryName)
    const canonicalContents = `${JSON.stringify(preferences)}\n`

    try {
      await fileSystem.writeFile(temporaryPath, canonicalContents)
      await fileSystem.syncFile(temporaryPath)
      const writtenContents = await fileSystem.readFile(temporaryPath)
      parsePreferences(JSON.parse(writtenContents))
      await fileSystem.rename(temporaryPath, preferencesPath)
    } catch {
      return { ok: false, code: 'PREFERENCES_SAVE_FAILED' }
    }

    await cleanStaleTemporaryFiles()
    return { ok: true, preferences }
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
