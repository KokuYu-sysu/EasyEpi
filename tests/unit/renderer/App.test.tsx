import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { DesktopApi } from '@shared/desktop-api'
import { App } from '@renderer/App'

function createApi(ping: DesktopApi['system']['ping']): DesktopApi {
  return { system: { ping } }
}

describe('App', () => {
  it('shows the product heading while connecting', () => {
    const pendingPing: DesktopApi['system']['ping'] = () => new Promise(() => undefined)
    const api = createApi(pendingPing)

    render(<App api={api} />)

    expect(screen.getByRole('heading', { name: 'EasyEpi' })).toBeInTheDocument()
    expect(screen.getByText('正在连接桌面运行环境…')).toBeInTheDocument()
  })

  it('shows a connected status after a successful ping', async () => {
    const api = createApi(
      vi.fn().mockResolvedValue({
        nonce: 'renderer-startup',
        version: '0.1.0',
        platform: 'win32'
      })
    )

    render(<App api={api} />)

    expect(await screen.findByText('桌面运行环境已连接')).toBeInTheDocument()
    expect(api.system.ping).toHaveBeenCalledWith({ nonce: 'renderer-startup' })
  })

  it('shows an accessible error when ping fails', async () => {
    const api = createApi(vi.fn().mockRejectedValue(new Error('offline')))

    render(<App api={api} />)

    expect(await screen.findByRole('alert')).toHaveTextContent('桌面运行环境连接失败')
  })
})
