import { describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_PREFERENCES,
  PREFERENCES_GET_CHANNEL,
  PREFERENCES_UPDATE_CHANNEL
} from '@shared/preferences-contract'
import { SYSTEM_PING_CHANNEL } from '@shared/system-contract'
import type { DesktopInvoke } from '../../../src/preload/desktop-api'
import { createDesktopApi } from '../../../src/preload/desktop-api'

function assertDesktopInvokeShape(invoke: DesktopInvoke, checkCalls: boolean): void {
  if (checkCalls) {
    void invoke(SYSTEM_PING_CHANNEL, { nonce: 'typed' })
    void invoke(PREFERENCES_GET_CHANNEL)
    void invoke(PREFERENCES_UPDATE_CHANNEL, DEFAULT_PREFERENCES)

    // @ts-expect-error preferences:get never accepts a request payload
    void invoke(PREFERENCES_GET_CHANNEL, DEFAULT_PREFERENCES)
    // @ts-expect-error preferences:update always requires a complete snapshot
    void invoke(PREFERENCES_UPDATE_CHANNEL)
    // @ts-expect-error no caller-selected channels are available
    void invoke('preferences:delete')
  }
}

describe('createDesktopApi', () => {
  it('uses a channel-specific invoke contract', () => {
    expect(assertDesktopInvokeShape).toBeTypeOf('function')
  })
  it('invokes only the fixed system ping channel', async () => {
    const invoke = vi.fn().mockResolvedValue({
      nonce: 'n',
      version: '0.1.0',
      platform: 'win32'
    })

    const api = createDesktopApi(invoke)

    await expect(api.system.ping({ nonce: 'n' })).resolves.toMatchObject({ nonce: 'n' })
    expect(invoke).toHaveBeenCalledWith(SYSTEM_PING_CHANNEL, { nonce: 'n' })
    expect(api).not.toHaveProperty('invoke')
  })

  it('freezes the exposed API surface', () => {
    const api = createDesktopApi(vi.fn())

    expect(Object.isFrozen(api)).toBe(true)
    expect(Object.isFrozen(api.system)).toBe(true)
    expect(Object.isFrozen(api.preferences)).toBe(true)
  })

  it('gets preferences through only the fixed get channel and normalizes the response', async () => {
    const rawResult = { ok: true, preferences: { ...DEFAULT_PREFERENCES } }
    const invoke = vi.fn().mockResolvedValue(rawResult)
    const api = createDesktopApi(invoke)

    const result = await api.preferences.get()

    expect(invoke).toHaveBeenCalledWith(PREFERENCES_GET_CHANNEL)
    expect(result).toEqual(rawResult)
    expect(result).not.toBe(rawResult)
    if (result.ok) {
      expect(result.preferences).not.toBe(rawResult.preferences)
    }
  })

  it('validates and sends a complete normalized update snapshot on the fixed channel', async () => {
    const normalized = { ...DEFAULT_PREFERENCES, theme: 'dark' as const }
    const invoke = vi.fn().mockResolvedValue({ ok: true, preferences: normalized })
    const api = createDesktopApi(invoke)

    await api.preferences.update({ ...normalized, rendererOnly: 'discarded' } as typeof normalized)

    expect(invoke).toHaveBeenCalledWith(PREFERENCES_UPDATE_CHANNEL, normalized)
  })

  it('rejects invalid updates before invoking Electron', async () => {
    const invoke = vi.fn()
    const api = createDesktopApi(invoke)

    await expect(
      api.preferences.update({ ...DEFAULT_PREFERENCES, theme: 'blue' } as never)
    ).rejects.toThrow('INVALID_PREFERENCES_REQUEST')
    expect(invoke).not.toHaveBeenCalled()
  })

  it.each([
    ['get', undefined],
    ['update', DEFAULT_PREFERENCES]
  ] as const)(
    'rejects malformed %s responses with one stable public error',
    async (method, request) => {
      const invoke = vi.fn().mockResolvedValue({
        ok: false,
        code: 'EACCES at C:\\Users\\secret\\preferences.json'
      })
      const api = createDesktopApi(invoke)

      const operation = method === 'get' ? api.preferences.get() : api.preferences.update(request!)

      await expect(operation).rejects.toEqual(new Error('INVALID_PREFERENCES_RESPONSE'))
    }
  )

  it('does not expose raw Electron or filesystem capabilities', () => {
    const api = createDesktopApi(vi.fn())

    expect(Object.keys(api)).toEqual(['system', 'preferences'])
    for (const forbidden of [
      'invoke',
      'channel',
      'path',
      'userData',
      'ipcRenderer',
      'fs',
      'electron'
    ]) {
      expect(api).not.toHaveProperty(forbidden)
      expect(api.preferences).not.toHaveProperty(forbidden)
    }
  })
})
