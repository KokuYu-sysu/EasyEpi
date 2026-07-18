import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { DEFAULT_PREFERENCES, type PreferencesV1 } from '@shared/preferences-contract'
import {
  createPreferencesStore,
  nodePreferencesFileSystem,
  PreferencesTemporaryFileCreatedError,
  type PreferencesFileSystem
} from '../../../src/main/preferences-store'

const directory = path.join('virtual', 'user-data')
const preferencesPath = path.join(directory, 'preferences.json')
const validPreferences: PreferencesV1 = {
  schemaVersion: 1,
  theme: 'dark',
  largeText: true,
  sidebarCollapsed: true
}

function fileError(code: string): Error & { code: string } {
  return Object.assign(new Error('filesystem details must stay private'), { code })
}

class MemoryFileSystem implements PreferencesFileSystem {
  readonly files = new Map<string, string>()
  readonly calls: string[] = []
  readError: unknown
  failOperation: 'write' | 'sync' | 'rename' | undefined
  failWriteAfterCreate = false
  tempReadError: unknown
  corruptTempRead = false
  invalidTempRead = false
  replacementTempContents: string | undefined
  listError: unknown
  removeError: unknown
  beforeWrite?: (filePath: string) => Promise<void>
  beforeSync?: (filePath: string) => Promise<void>
  removeInFlight = 0
  maxRemoveInFlight = 0

  async readFile(filePath: string): Promise<string> {
    this.calls.push(`read:${filePath}`)
    if (filePath === preferencesPath && this.readError !== undefined) {
      throw this.readError
    }
    if (filePath.endsWith('.tmp') && this.tempReadError !== undefined) {
      throw this.tempReadError
    }
    if (filePath.endsWith('.tmp') && this.corruptTempRead) {
      return '{broken'
    }
    if (filePath.endsWith('.tmp') && this.invalidTempRead) {
      return JSON.stringify({ ...validPreferences, theme: 'blue' })
    }
    if (filePath.endsWith('.tmp') && this.replacementTempContents !== undefined) {
      this.files.set(filePath, this.replacementTempContents)
      return this.replacementTempContents
    }
    const contents = this.files.get(filePath)
    if (contents === undefined) {
      throw fileError('ENOENT')
    }
    return contents
  }

  async writeFile(filePath: string, data: string): Promise<void> {
    this.calls.push(`write:${filePath}:${data}`)
    await this.beforeWrite?.(filePath)
    if (this.failOperation === 'write') {
      throw new Error('write details')
    }
    if (this.files.has(filePath)) {
      throw fileError('EEXIST')
    }
    this.files.set(filePath, data)
    if (this.failWriteAfterCreate) {
      throw new PreferencesTemporaryFileCreatedError()
    }
  }

  async syncFile(filePath: string): Promise<void> {
    this.calls.push(`sync:${filePath}`)
    await this.beforeSync?.(filePath)
    if (this.failOperation === 'sync') {
      throw new Error('sync details')
    }
  }

  async rename(from: string, to: string): Promise<void> {
    this.calls.push(`rename:${from}:${to}`)
    if (this.failOperation === 'rename') {
      throw new Error('rename details')
    }
    const contents = this.files.get(from)
    if (contents === undefined) {
      throw new Error('missing rename source')
    }
    this.files.set(to, contents)
    this.files.delete(from)
  }

  async list(listDirectory: string): Promise<string[]> {
    this.calls.push(`list:${listDirectory}`)
    if (this.listError !== undefined) {
      throw this.listError
    }
    return [...this.files.keys()]
      .filter((filePath) => path.dirname(filePath) === listDirectory)
      .map((filePath) => path.basename(filePath))
  }

  async remove(filePath: string): Promise<void> {
    this.calls.push(`remove:${filePath}`)
    this.removeInFlight += 1
    this.maxRemoveInFlight = Math.max(this.maxRemoveInFlight, this.removeInFlight)
    try {
      await Promise.resolve()
      if (this.removeError !== undefined) {
        throw this.removeError
      }
      this.files.delete(filePath)
    } finally {
      this.removeInFlight -= 1
    }
  }
}

describe('preferences store reads', () => {
  it('returns defaults without a warning when preferences.json is missing', async () => {
    const store = createPreferencesStore(directory, new MemoryFileSystem())

    await expect(store.get()).resolves.toEqual({
      ok: true,
      preferences: DEFAULT_PREFERENCES
    })
  })

  it('normalizes valid preferences and discards unknown keys', async () => {
    const fileSystem = new MemoryFileSystem()
    fileSystem.files.set(
      preferencesPath,
      JSON.stringify({ ...validPreferences, futurePreference: 'ignored' })
    )

    const result = await createPreferencesStore(directory, fileSystem).get()

    expect(result).toEqual({ ok: true, preferences: validPreferences })
    expect(result.ok && Object.keys(result.preferences)).toEqual([
      'schemaVersion',
      'theme',
      'largeText',
      'sidebarCollapsed'
    ])
  })

  it.each([
    ['corrupt JSON', '{not-json'],
    ['unknown schema', JSON.stringify({ ...validPreferences, schemaVersion: 2 })],
    ['invalid schemaVersion', JSON.stringify({ ...validPreferences, schemaVersion: '1' })],
    ['invalid theme', JSON.stringify({ ...validPreferences, theme: 'blue' })],
    ['invalid largeText', JSON.stringify({ ...validPreferences, largeText: 1 })],
    ['invalid sidebarCollapsed', JSON.stringify({ ...validPreferences, sidebarCollapsed: null })]
  ])('recovers defaults with a warning for %s', async (_description, contents) => {
    const fileSystem = new MemoryFileSystem()
    fileSystem.files.set(preferencesPath, contents)

    await expect(createPreferencesStore(directory, fileSystem).get()).resolves.toEqual({
      ok: true,
      preferences: DEFAULT_PREFERENCES,
      warning: 'PREFERENCES_RECOVERED'
    })
  })

  it.each(['EACCES', 'EIO'])('returns a path-free read failure for %s', async (code) => {
    const fileSystem = new MemoryFileSystem()
    fileSystem.readError = fileError(code)

    const result = await createPreferencesStore(directory, fileSystem).get()

    expect(result).toEqual({ ok: false, code: 'PREFERENCES_READ_FAILED' })
    expect(JSON.stringify(result)).not.toContain(directory)
    expect(JSON.stringify(result)).not.toContain('filesystem details')
  })
})

describe('preferences store updates', () => {
  it('rejects an invalid update without writing', async () => {
    const fileSystem = new MemoryFileSystem()

    await expect(
      createPreferencesStore(directory, fileSystem).update({ ...validPreferences, theme: 'blue' })
    ).resolves.toEqual({ ok: false, code: 'INVALID_PREFERENCES_REQUEST' })
    expect(fileSystem.calls.some((call) => call.startsWith('write:'))).toBe(false)
  })

  it('writes, syncs, re-reads, validates, then atomically replaces with canonical JSON', async () => {
    const fileSystem = new MemoryFileSystem()
    const request = { ...validPreferences, ignored: 'discarded' }

    const result = await createPreferencesStore(directory, fileSystem).update(request)

    const temporaryPath = fileSystem.calls
      .find((call) => call.startsWith('write:'))!
      .slice('write:'.length)
      .split(':')
      .at(0)!
    expect(path.dirname(temporaryPath)).toBe(directory)
    expect(path.basename(temporaryPath)).toMatch(
      new RegExp(`^EasyEpi-preferences-${process.pid}-\\d+\\.tmp$`)
    )
    expect(fileSystem.calls).toEqual(expect.arrayContaining([
      `sync:${temporaryPath}`,
      `read:${temporaryPath}`,
      `rename:${temporaryPath}:${preferencesPath}`
    ]))
    const syncIndex = fileSystem.calls.indexOf(`sync:${temporaryPath}`)
    const readIndex = fileSystem.calls.indexOf(`read:${temporaryPath}`)
    const renameIndex = fileSystem.calls.indexOf(`rename:${temporaryPath}:${preferencesPath}`)
    expect(syncIndex).toBeGreaterThan(0)
    expect(readIndex).toBeGreaterThan(syncIndex)
    expect(renameIndex).toBeGreaterThan(readIndex)
    expect(fileSystem.files.get(preferencesPath)).toBe(`${JSON.stringify(validPreferences)}\n`)
    expect(result).toEqual({ ok: true, preferences: validPreferences })
  })

  it('returns the normalized snapshot that was re-read and committed', async () => {
    const fileSystem = new MemoryFileSystem()
    const committedPreferences: PreferencesV1 = {
      ...validPreferences,
      theme: 'light',
      largeText: false
    }
    const committedContents = `${JSON.stringify(committedPreferences)}\n`
    fileSystem.replacementTempContents = committedContents

    const result = await createPreferencesStore(directory, fileSystem).update(validPreferences)

    expect(fileSystem.files.get(preferencesPath)).toBe(committedContents)
    expect(result).toEqual({ ok: true, preferences: committedPreferences })
  })

  it.each([
    ['write', { failOperation: 'write' as const }],
    ['write after exclusive create', { failWriteAfterCreate: true }],
    ['sync', { failOperation: 'sync' as const }],
    ['re-read', { tempReadError: new Error('read details') }],
    ['JSON validation', { corruptTempRead: true }],
    ['field validation', { invalidTempRead: true }],
    ['rename', { failOperation: 'rename' as const }]
  ])('preserves prior bytes when %s fails before commit', async (_phase, setup) => {
    const fileSystem = new MemoryFileSystem()
    const priorBytes = '{"keep":"these exact bytes"}\n'
    fileSystem.files.set(preferencesPath, priorBytes)
    Object.assign(fileSystem, setup)

    const result = await createPreferencesStore(directory, fileSystem).update(validPreferences)

    expect(result).toEqual({ ok: false, code: 'PREFERENCES_SAVE_FAILED' })
    expect(fileSystem.files.get(preferencesPath)).toBe(priorBytes)
    expect([...fileSystem.files.keys()].filter((filePath) => filePath.endsWith('.tmp'))).toEqual([])
    expect(JSON.stringify(result)).not.toContain(directory)
  })

  it('uses a unique fixed-format temporary file for every save', async () => {
    const fileSystem = new MemoryFileSystem()
    const store = createPreferencesStore(directory, fileSystem)

    await store.update(validPreferences)
    await store.update({ ...validPreferences, theme: 'light' })

    const temporaryNames = fileSystem.calls
      .filter((call) => call.startsWith('write:'))
      .map((call) => path.basename(call.slice('write:'.length).split(':').at(0)!))
    expect(temporaryNames).toHaveLength(2)
    expect(new Set(temporaryNames).size).toBe(2)
    for (const name of temporaryNames) {
      expect(name).toMatch(new RegExp(`^EasyEpi-preferences-${process.pid}-\\d+\\.tmp$`))
    }
  })

  it('keeps temporary names unique across store instances', async () => {
    const fileSystem = new MemoryFileSystem()

    await createPreferencesStore(directory, fileSystem).update(validPreferences)
    await createPreferencesStore(directory, fileSystem).update(validPreferences)

    const temporaryNames = fileSystem.calls
      .filter((call) => call.startsWith('write:'))
      .map((call) => path.basename(call.slice('write:'.length).split(':').at(0)!))
    expect(new Set(temporaryNames).size).toBe(2)
  })

  it('does not follow or truncate a real symlink collision and advances safely', async () => {
    const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'easyepi-preferences-'))
    const actualPreferencesPath = path.join(temporaryDirectory, 'preferences.json')
    const targetPath = path.join(temporaryDirectory, 'symlink-target')
    const targetMarkerPath = path.join(targetPath, 'marker.txt')
    let collisionPath: string | undefined
    const priorBytes = '{"prior":"bytes"}\n'
    const targetBytes = 'do not truncate or follow'

    try {
      await writeFile(actualPreferencesPath, priorBytes, 'utf8')
      await mkdir(targetPath)
      await writeFile(targetMarkerPath, targetBytes, 'utf8')
      const fileSystem: PreferencesFileSystem = {
        ...nodePreferencesFileSystem,
        async writeFile(filePath, data) {
          if (collisionPath === undefined) {
            collisionPath = filePath
            await symlink(targetPath, collisionPath, 'junction')
          }
          await nodePreferencesFileSystem.writeFile(filePath, data)
        }
      }

      const result = await createPreferencesStore(temporaryDirectory, fileSystem).update(
        validPreferences
      )

      expect(result).toEqual({ ok: true, preferences: validPreferences })
      expect(collisionPath).toBeDefined()
      expect((await lstat(collisionPath!)).isSymbolicLink()).toBe(true)
      await expect(readFile(targetMarkerPath, 'utf8')).resolves.toBe(targetBytes)
      await expect(readFile(actualPreferencesPath, 'utf8')).resolves.toBe(
        `${JSON.stringify(validPreferences)}\n`
      )
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true })
    }
  })

  it('bounds exclusive-create collisions and preserves prior preferences bytes', async () => {
    const fileSystem = new MemoryFileSystem()
    const priorBytes = '{"prior":"must survive"}\n'
    fileSystem.files.set(preferencesPath, priorBytes)
    fileSystem.beforeWrite = async (filePath) => {
      fileSystem.files.set(filePath, 'collision')
    }

    const result = await createPreferencesStore(directory, fileSystem).update(validPreferences)

    const writeCalls = fileSystem.calls.filter((call) => call.startsWith('write:'))
    expect(result).toEqual({ ok: false, code: 'PREFERENCES_SAVE_FAILED' })
    expect(writeCalls.length).toBeGreaterThan(1)
    expect(writeCalls.length).toBeLessThanOrEqual(16)
    expect(fileSystem.files.get(preferencesPath)).toBe(priorBytes)
    expect(fileSystem.calls.some((call) => call.startsWith('remove:'))).toBe(false)
  })

  it('never scans or removes untracked current-PID and foreign lookalikes', async () => {
    const fileSystem = new MemoryFileSystem()
    const lookalikeNames = [
      `EasyEpi-preferences-${process.pid}-3000000000.tmp`,
      'EasyEpi-preferences-123-1.tmp',
      'notes.tmp',
      'EasyEpi-preferences-secret.tmp',
      'EasyEpi-preferences-1-2.tmp.bak',
      'prefix-EasyEpi-preferences-1-2.tmp'
    ]
    for (const name of lookalikeNames) {
      fileSystem.files.set(path.join(directory, name), name)
    }

    await createPreferencesStore(directory, fileSystem).update(validPreferences)

    expect(fileSystem.calls.some((call) => call.startsWith('list:'))).toBe(false)
    expect(fileSystem.calls.some((call) => call.startsWith('remove:'))).toBe(false)
    for (const name of lookalikeNames) {
      expect(fileSystem.files.has(path.join(directory, name))).toBe(true)
    }
  })

  it('quarantines a collision across later successful saves', async () => {
    const fileSystem = new MemoryFileSystem()
    let collisionPath: string | undefined
    fileSystem.beforeWrite = async (filePath) => {
      if (collisionPath === undefined) {
        collisionPath = filePath
        fileSystem.files.set(filePath, 'foreign collision')
      }
    }
    const store = createPreferencesStore(directory, fileSystem)

    await store.update(validPreferences)
    await store.update({ ...validPreferences, theme: 'light' })

    expect(collisionPath).toBeDefined()
    expect(fileSystem.files.get(collisionPath!)).toBe('foreign collision')
    expect(fileSystem.calls).not.toContain(`remove:${collisionPath}`)
  })

  it('retries only an exact abandoned-owned temp after a later save', async () => {
    const fileSystem = new MemoryFileSystem()
    fileSystem.failOperation = 'sync'
    fileSystem.removeError = new Error('first cleanup failure')
    const logger = { warn: vi.fn() }
    const store = createPreferencesStore(directory, fileSystem, logger)

    await expect(store.update(validPreferences)).resolves.toEqual({
      ok: false,
      code: 'PREFERENCES_SAVE_FAILED'
    })
    expect(logger.warn).toHaveBeenCalledWith('PREFERENCES_TEMP_CLEANUP_FAILED', 'remove')
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(directory)
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('first cleanup failure')
    const abandonedPath = [...fileSystem.files.keys()].find((filePath) => filePath.endsWith('.tmp'))!
    fileSystem.failOperation = undefined
    fileSystem.removeError = undefined

    await store.update(validPreferences)

    expect(fileSystem.files.has(abandonedPath)).toBe(false)
    expect(fileSystem.calls.filter((call) => call === `remove:${abandonedPath}`)).toHaveLength(2)
    expect(fileSystem.calls.some((call) => call.startsWith('list:'))).toBe(false)
  })

  it('keeps SAVE_FAILED stable when a precommit cleanup logger throws', async () => {
    const fileSystem = new MemoryFileSystem()
    fileSystem.failOperation = 'sync'
    fileSystem.removeError = new Error('sensitive remove details')
    const logger = { warn: vi.fn(() => { throw new Error('logger details') }) }

    await expect(
      createPreferencesStore(directory, fileSystem, logger).update(validPreferences)
    ).resolves.toEqual({ ok: false, code: 'PREFERENCES_SAVE_FAILED' })
    fileSystem.failOperation = undefined
    fileSystem.removeError = undefined
    await createPreferencesStore(directory, fileSystem, { warn: vi.fn() }).update(validPreferences)
  })

  it('keeps postcommit success stable when abandoned cleanup logging throws', async () => {
    const fileSystem = new MemoryFileSystem()
    fileSystem.failOperation = 'sync'
    fileSystem.removeError = new Error('sensitive remove details')
    const quietLogger = { warn: vi.fn() }
    await createPreferencesStore(directory, fileSystem, quietLogger).update(validPreferences)
    fileSystem.failOperation = undefined
    const throwingLogger = { warn: vi.fn(() => { throw new Error('logger details') }) }

    await expect(
      createPreferencesStore(directory, fileSystem, throwingLogger).update(validPreferences)
    ).resolves.toEqual({ ok: true, preferences: validPreferences })
    fileSystem.removeError = undefined
    await createPreferencesStore(directory, fileSystem, quietLogger).update(validPreferences)
  })

  it('serializes stores across a real directory-junction alias', async () => {
    const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'easyepi-alias-'))
    const physicalDirectory = path.join(temporaryDirectory, 'physical')
    const aliasDirectory = path.join(temporaryDirectory, 'alias')
    await mkdir(physicalDirectory)
    await symlink(physicalDirectory, aliasDirectory, 'junction')
    const fileSystem = new MemoryFileSystem()
    let releaseFirstSync: (() => void) | undefined
    const firstSyncBlocked = new Promise<void>((resolve) => {
      releaseFirstSync = resolve
    })
    let syncs = 0
    fileSystem.beforeSync = async () => {
      syncs += 1
      if (syncs === 1) {
        await firstSyncBlocked
      }
    }
    const quietLogger = { warn: vi.fn() }
    const storeA = createPreferencesStore(physicalDirectory, fileSystem, quietLogger)
    const storeB = createPreferencesStore(aliasDirectory, fileSystem, quietLogger)

    const first = storeA.update(validPreferences)
    await vi.waitFor(() => expect(syncs).toBe(1))
    const second = storeB.update({ ...validPreferences, theme: 'light' })
    await Promise.resolve()

    const writesBeforeRelease = fileSystem.calls.filter((call) => call.startsWith('write:')).length
    const activePath = [...fileSystem.files.keys()].find((filePath) => filePath.endsWith('.tmp'))!
    const activeSurvived = fileSystem.files.has(activePath)

    releaseFirstSync!()
    await Promise.all([first, second])
    expect(writesBeforeRelease).toBe(1)
    expect(activeSurvived).toBe(true)
    expect(fileSystem.calls.filter((call) => call.startsWith('write:'))).toHaveLength(2)
    await rm(temporaryDirectory, { recursive: true, force: true })
  })

  it('serializes concurrent updates in invocation order', async () => {
    const fileSystem = new MemoryFileSystem()
    let releaseFirstWrite: (() => void) | undefined
    const firstWriteBlocked = new Promise<void>((resolve) => {
      releaseFirstWrite = resolve
    })
    let writes = 0
    fileSystem.beforeWrite = async () => {
      writes += 1
      if (writes === 1) {
        await firstWriteBlocked
      }
    }
    const store = createPreferencesStore(directory, fileSystem)
    const completionOrder: string[] = []

    const first = store.update(validPreferences).then(() => completionOrder.push('first'))
    const second = store
      .update({ ...validPreferences, theme: 'light' })
      .then(() => completionOrder.push('second'))
    await vi.waitFor(() => expect(writes).toBe(1))
    expect(writes).toBe(1)
    releaseFirstWrite!()
    await Promise.all([first, second])

    expect(completionOrder).toEqual(['first', 'second'])
    expect(fileSystem.files.get(preferencesPath)).toBe(
      `${JSON.stringify({ ...validPreferences, theme: 'light' })}\n`
    )
  })

  it('continues the promise queue after a failed save', async () => {
    const fileSystem = new MemoryFileSystem()
    fileSystem.failOperation = 'write'
    const store = createPreferencesStore(directory, fileSystem)

    await expect(store.update(validPreferences)).resolves.toEqual({
      ok: false,
      code: 'PREFERENCES_SAVE_FAILED'
    })
    fileSystem.failOperation = undefined

    await expect(store.update({ ...validPreferences, theme: 'light' })).resolves.toEqual({
      ok: true,
      preferences: { ...validPreferences, theme: 'light' }
    })
  })
})
