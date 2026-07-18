import { useEffect, useState } from 'react'

import type { DesktopApi } from '@shared/desktop-api'

type ConnectionState = 'connecting' | 'connected' | 'failed'

export interface AppProps {
  api?: DesktopApi
}

export function App({ api = window.easyEpi }: AppProps) {
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting')

  useEffect(() => {
    let active = true

    api.system
      .ping({ nonce: 'renderer-startup' })
      .then(() => {
        if (active) {
          setConnectionState('connected')
        }
      })
      .catch(() => {
        if (active) {
          setConnectionState('failed')
        }
      })

    return () => {
      active = false
    }
  }, [api])

  return (
    <main className="app-shell">
      <section className="welcome-card" aria-labelledby="product-name">
        <span className="product-mark" aria-hidden="true">
          E
        </span>
        <div>
          <p className="eyebrow">现场调查与问卷信息收集</p>
          <h1 id="product-name">EasyEpi</h1>
          {connectionState === 'connecting' && <p role="status">正在连接桌面运行环境…</p>}
          {connectionState === 'connected' && (
            <p className="status-connected" role="status">
              桌面运行环境已连接
            </p>
          )}
          {connectionState === 'failed' && (
            <p className="status-failed" role="alert">
              桌面运行环境连接失败
            </p>
          )}
        </div>
      </section>
    </main>
  )
}
