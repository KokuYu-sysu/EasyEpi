import { render, screen } from '@testing-library/react'
import { createMemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'

import { App } from '@renderer/App'
import { createAppRoutes } from '@renderer/app/routes'
import type { DesktopApi } from '@shared/desktop-api'
import { DEFAULT_PREFERENCES, type PreferencesV1 } from '@shared/preferences-contract'

const appearance = { apply: vi.fn(), observeSystemTheme: () => () => undefined }

function createApi(): DesktopApi {
  return {
    system: { ping: vi.fn() },
    preferences: {
      get: vi.fn().mockResolvedValue({ ok: true, preferences: DEFAULT_PREFERENCES }),
      update: vi.fn(async (preferences: PreferencesV1) => ({ ok: true as const, preferences }))
    }
  }
}

describe('App', () => {
  it('boots preferences before rendering the router shell', async () => {
    const api = createApi()
    const router = createMemoryRouter(createAppRoutes({ isDevelopment: false }), {
      initialEntries: ['/']
    })
    render(<App api={api} appearance={appearance} router={router} />)

    expect(screen.getByRole('status')).toHaveTextContent('正在加载界面设置')
    expect((await screen.findAllByText('EasyEpi')).length).toBeGreaterThan(0)
    expect(api.preferences.get).toHaveBeenCalledOnce()
  })

  it('owns one global toast viewport around routed content', async () => {
    const router = createMemoryRouter(createAppRoutes({ isDevelopment: false }), {
      initialEntries: ['/entry']
    })
    render(<App api={createApi()} appearance={appearance} router={router} />)

    expect(await screen.findByRole('heading', { name: '单题录入' })).toBeVisible()
    expect(screen.getAllByLabelText('通知')).toHaveLength(1)
  })
})
