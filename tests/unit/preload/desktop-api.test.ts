import { describe, expect, it, vi } from 'vitest'

import { SYSTEM_PING_CHANNEL } from '@shared/system-contract'
import { createDesktopApi } from '../../../src/preload/desktop-api'

describe('createDesktopApi', () => {
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
  })
})
