import { describe, expect, it, vi } from 'vitest'

import { SYSTEM_PING_CHANNEL } from '@shared/system-contract'
import {
  assertTrustedSender,
  handlePing,
  registerSystemIpc
} from '../../../src/main/system-ipc'

const packagedRendererUrl = 'file:///D:/EasyEpi/out/renderer/index.html'
const appInfo = { version: '0.1.0', platform: 'win32' as const }

describe('handlePing', () => {
  it('echoes a validated nonce with application information', () => {
    expect(handlePing({ nonce: 'renderer-startup' }, appInfo)).toEqual({
      nonce: 'renderer-startup',
      version: '0.1.0',
      platform: 'win32'
    })
  })

  it('rejects invalid requests', () => {
    expect(() => handlePing({ nonce: '' }, appInfo)).toThrow('INVALID_IPC_REQUEST')
  })
})

describe('assertTrustedSender', () => {
  it('accepts the exact packaged renderer', () => {
    expect(() => assertTrustedSender(packagedRendererUrl, packagedRendererUrl)).not.toThrow()
  })

  it('accepts the configured development origin', () => {
    expect(() =>
      assertTrustedSender(
        'http://127.0.0.1:5173/',
        packagedRendererUrl,
        'http://127.0.0.1:5173'
      )
    ).not.toThrow()
  })

  it.each(['file:///C:/Users/Public/untrusted.html', 'https://example.com'])(
    'rejects untrusted sender %s',
    (url) => {
      expect(() => assertTrustedSender(url, packagedRendererUrl)).toThrow(
        'UNTRUSTED_IPC_SENDER'
      )
    }
  )
})

describe('registerSystemIpc', () => {
  it('registers one fixed handler and returns a disposer', async () => {
    type RegisteredHandler = Parameters<Parameters<typeof registerSystemIpc>[0]['handle']>[1]
    let registeredHandler: RegisteredHandler | undefined
    const ipcMain = {
      handle: vi.fn((_channel: string, handler: RegisteredHandler) => {
        registeredHandler = handler
      }),
      removeHandler: vi.fn()
    }

    const dispose = registerSystemIpc(ipcMain, appInfo, packagedRendererUrl)

    expect(ipcMain.handle).toHaveBeenCalledOnce()
    expect(ipcMain.handle).toHaveBeenCalledWith(SYSTEM_PING_CHANNEL, expect.any(Function))
    expect(registeredHandler).toBeDefined()
    await expect(
      registeredHandler!(
        { senderFrame: { url: packagedRendererUrl } },
        { nonce: 'registered-handler' }
      )
    ).resolves.toMatchObject({ nonce: 'registered-handler' })

    dispose()
    expect(ipcMain.removeHandler).toHaveBeenCalledWith(SYSTEM_PING_CHANNEL)
  })

  it('checks sender trust before request parsing', async () => {
    type RegisteredHandler = Parameters<Parameters<typeof registerSystemIpc>[0]['handle']>[1]
    let registeredHandler: RegisteredHandler | undefined
    const ipcMain = {
      handle: (_channel: string, handler: RegisteredHandler) => {
        registeredHandler = handler
      },
      removeHandler: vi.fn()
    }

    registerSystemIpc(ipcMain, appInfo, packagedRendererUrl)

    await expect(
      registeredHandler!(
        { senderFrame: { url: 'file:///C:/Users/Public/untrusted.html' } },
        { nonce: '' }
      )
    ).rejects.toThrow('UNTRUSTED_IPC_SENDER')
  })

  it('rejects an event without a sender frame', async () => {
    type RegisteredHandler = Parameters<Parameters<typeof registerSystemIpc>[0]['handle']>[1]
    let registeredHandler: RegisteredHandler | undefined
    const ipcMain = {
      handle: (_channel: string, handler: RegisteredHandler) => {
        registeredHandler = handler
      },
      removeHandler: vi.fn()
    }

    registerSystemIpc(ipcMain, appInfo, packagedRendererUrl)

    await expect(registeredHandler!({}, { nonce: 'missing-frame' })).rejects.toThrow(
      'MISSING_IPC_SENDER_FRAME'
    )
  })
})
