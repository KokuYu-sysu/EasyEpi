import { describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_PREFERENCES,
  PREFERENCES_GET_CHANNEL,
  PREFERENCES_UPDATE_CHANNEL,
  type PreferencesResult
} from '@shared/preferences-contract'
import type { PreferencesStore } from '../../../src/main/preferences-store'
import { registerPreferencesIpc } from '../../../src/main/preferences-ipc'

const packagedRendererUrl = 'file:///D:/EasyEpi/out/renderer/index.html'
const trustedEvent = { senderFrame: { url: packagedRendererUrl } }
const validPreferences = { ...DEFAULT_PREFERENCES, theme: 'dark' as const }

type Handler = (
  event: { senderFrame?: { url: string } | null },
  request?: unknown
) => Promise<PreferencesResult>

function setup(store: PreferencesStore) {
  const handlers = new Map<string, Handler>()
  const ipcMain = {
    handle: vi.fn((channel: string, handler: Handler) => handlers.set(channel, handler)),
    removeHandler: vi.fn()
  }
  const dispose = registerPreferencesIpc(ipcMain, store, packagedRendererUrl)
  return { dispose, handlers, ipcMain }
}

function createStore(): PreferencesStore {
  return {
    get: vi.fn().mockResolvedValue({ ok: true, preferences: DEFAULT_PREFERENCES }),
    update: vi.fn().mockResolvedValue({ ok: true, preferences: validPreferences })
  }
}

describe('registerPreferencesIpc', () => {
  it('registers only the two fixed preference channels', () => {
    const { ipcMain } = setup(createStore())

    expect(ipcMain.handle.mock.calls.map(([channel]) => channel)).toEqual([
      PREFERENCES_GET_CHANNEL,
      PREFERENCES_UPDATE_CHANNEL
    ])
  })

  it('reads preferences only after validating the exact trusted sender policy', async () => {
    const store = createStore()
    const { handlers } = setup(store)

    await expect(
      handlers.get(PREFERENCES_GET_CHANNEL)!({
        senderFrame: { url: 'file:///C:/Users/Public/untrusted.html' }
      })
    ).rejects.toThrow('UNTRUSTED_IPC_SENDER')
    expect(store.get).not.toHaveBeenCalled()

    await expect(handlers.get(PREFERENCES_GET_CHANNEL)!(trustedEvent)).resolves.toEqual({
      ok: true,
      preferences: DEFAULT_PREFERENCES
    })
  })

  it('validates sender trust before parsing an update or calling the store', async () => {
    const store = createStore()
    const { handlers } = setup(store)

    await expect(
      handlers.get(PREFERENCES_UPDATE_CHANNEL)!(
        { senderFrame: { url: 'https://example.com' } },
        { theme: 'invalid' }
      )
    ).rejects.toThrow('UNTRUSTED_IPC_SENDER')
    expect(store.update).not.toHaveBeenCalled()
  })

  it('rejects missing sender frames before any store work', async () => {
    const store = createStore()
    const { handlers } = setup(store)

    await expect(
      handlers.get(PREFERENCES_GET_CHANNEL)!({ senderFrame: undefined })
    ).rejects.toThrow('MISSING_IPC_SENDER_FRAME')
    expect(store.get).not.toHaveBeenCalled()
  })

  it('normalizes a valid update again at handler entry', async () => {
    const store = createStore()
    const { handlers } = setup(store)

    await handlers.get(PREFERENCES_UPDATE_CHANNEL)!(trustedEvent, {
      ...validPreferences,
      rendererOnly: 'discarded'
    })

    expect(store.update).toHaveBeenCalledWith(validPreferences)
  })

  it('returns INVALID_PREFERENCES_REQUEST without calling the store for invalid updates', async () => {
    const store = createStore()
    const { handlers } = setup(store)

    await expect(
      handlers.get(PREFERENCES_UPDATE_CHANNEL)!(trustedEvent, {
        ...validPreferences,
        theme: 'blue'
      })
    ).resolves.toEqual({ ok: false, code: 'INVALID_PREFERENCES_REQUEST' })
    expect(store.update).not.toHaveBeenCalled()
  })

  it('maps unexpected read exceptions to a stable path-free result', async () => {
    const store = createStore()
    vi.mocked(store.get).mockRejectedValue(new Error('C:\\Users\\secret\\preferences.json'))
    const { handlers } = setup(store)

    const result = await handlers.get(PREFERENCES_GET_CHANNEL)!(trustedEvent)

    expect(result).toEqual({ ok: false, code: 'PREFERENCES_READ_FAILED' })
    expect(JSON.stringify(result)).not.toContain('secret')
  })

  it('maps malformed resolved read results to the stable read failure', async () => {
    const store = createStore()
    vi.mocked(store.get).mockResolvedValue({
      ok: false,
      code: 'EACCES at C:\\Users\\secret\\preferences.json'
    } as never)
    const { handlers } = setup(store)

    await expect(handlers.get(PREFERENCES_GET_CHANNEL)!(trustedEvent)).resolves.toEqual({
      ok: false,
      code: 'PREFERENCES_READ_FAILED'
    })
  })

  it('maps unexpected update exceptions to a stable path-free result', async () => {
    const store = createStore()
    vi.mocked(store.update).mockRejectedValue(new Error('save failed at D:\\private'))
    const { handlers } = setup(store)

    const result = await handlers.get(PREFERENCES_UPDATE_CHANNEL)!(trustedEvent, validPreferences)

    expect(result).toEqual({ ok: false, code: 'PREFERENCES_SAVE_FAILED' })
    expect(JSON.stringify(result)).not.toContain('private')
  })

  it('maps malformed resolved update results to the stable save failure', async () => {
    const store = createStore()
    vi.mocked(store.update).mockResolvedValue({ ok: true, preferences: null } as never)
    const { handlers } = setup(store)

    await expect(
      handlers.get(PREFERENCES_UPDATE_CHANNEL)!(trustedEvent, validPreferences)
    ).resolves.toEqual({ ok: false, code: 'PREFERENCES_SAVE_FAILED' })
  })

  it('removes both preference handlers without touching the system handler', () => {
    const { dispose, ipcMain } = setup(createStore())

    dispose()
    dispose()

    expect(ipcMain.removeHandler.mock.calls.map(([channel]) => channel)).toEqual([
      PREFERENCES_GET_CHANNEL,
      PREFERENCES_UPDATE_CHANNEL
    ])
    expect(ipcMain.removeHandler).not.toHaveBeenCalledWith('system:ping')
  })
})
