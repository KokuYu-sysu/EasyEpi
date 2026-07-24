import { act, render, screen } from '@testing-library/react'
import { StrictMode } from 'react'
import { createMemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'

import { App } from '@renderer/App'
import { createAppRoutes } from '@renderer/app/routes'
import type { DesktopApi } from '@shared/desktop-api'
import {
  DEFAULT_PREFERENCES,
  type PreferencesResult,
  type PreferencesV1
} from '@shared/preferences-contract'

const appearance = { apply: vi.fn(), observeSystemTheme: () => () => undefined }

function createApi(): DesktopApi {
  return {
    system: { ping: vi.fn() },
    preferences: {
      get: vi.fn().mockResolvedValue({ ok: true, preferences: DEFAULT_PREFERENCES }),
      update: vi.fn(async (preferences: PreferencesV1) => ({ ok: true as const, preferences }))
    },
    dialog: {
      selectFolder: vi.fn().mockResolvedValue({ canceled: true, filePaths: [] }),
      selectFile: vi.fn().mockResolvedValue({ canceled: true, filePaths: [] })
    },
    project: {
      create: vi.fn(),
      open: vi.fn(),
      save: vi.fn(),
      close: vi.fn()
    },
    qnaire: {
      getData: vi.fn().mockResolvedValue({ questions: [], conditionRules: [], keyQuestionIds: [], name: '' }),
      addQuestion: vi.fn(),
      updateQuestion: vi.fn(),
      deleteQuestion: vi.fn(),
      reorderQuestions: vi.fn(),
      addConditionRule: vi.fn(),
      updateConditionRule: vi.fn(),
      deleteConditionRule: vi.fn(),
      updateMeta: vi.fn()
    }
  }
}

describe('App', () => {
  it('boots preferences before rendering the router shell', async () => {
    const api = createApi()
    const router = createMemoryRouter(createAppRoutes({ isDevelopment: false }), {
      initialEntries: ['/']
    })
    const { unmount } = render(<App api={api} appearance={appearance} router={router} />)

    expect(screen.getByRole('status')).toHaveTextContent('正在加载界面设置')
    expect((await screen.findAllByText('EasyEpi')).length).toBeGreaterThan(0)
    expect(api.preferences.get).toHaveBeenCalledOnce()
    unmount()
    router.dispose()
  })

  it('owns one global toast viewport around routed content', async () => {
    const router = createMemoryRouter(createAppRoutes({ isDevelopment: false }), {
      initialEntries: ['/entry']
    })
    const { unmount } = render(<App api={createApi()} appearance={appearance} router={router} />)

    expect(await screen.findByRole('heading', { name: '单题录入' })).toBeVisible()
    expect(screen.getAllByLabelText('通知')).toHaveLength(1)
    unmount()
    router.dispose()
  })

  it('defers router creation until preferences are ready and preserves it across StrictMode rerenders', async () => {
    let resolvePreferences!: (result: PreferencesResult) => void
    const api = createApi()
    api.preferences.get = vi.fn(
      () => new Promise<PreferencesResult>((resolve) => { resolvePreferences = resolve })
    )
    const routerFactory = vi.fn(() =>
      createMemoryRouter(createAppRoutes({ isDevelopment: false }), {
        initialEntries: ['/entry']
      })
    )

    const { rerender, unmount } = render(
      <StrictMode>
        <App api={api} appearance={appearance} routerFactory={routerFactory} />
      </StrictMode>
    )

    expect(screen.getByRole('status')).toHaveTextContent('正在加载界面设置')
    expect(routerFactory).not.toHaveBeenCalled()
    await act(async () => {
      resolvePreferences({ ok: true, preferences: DEFAULT_PREFERENCES })
    })
    expect(await screen.findByRole('heading', { name: '单题录入' })).toBeVisible()
    expect(routerFactory).toHaveBeenCalledOnce()

    const router = routerFactory.mock.results[0]?.value
    expect(router).toBeDefined()
    await act(async () => { await router?.navigate('/designer') })
    expect(await screen.findByRole('heading', { name: '问卷设计' })).toBeVisible()
    const replacementFactory = vi.fn(() =>
      createMemoryRouter(createAppRoutes({ isDevelopment: false }), {
        initialEntries: ['/']
      })
    )
    rerender(
      <StrictMode>
        <App api={api} appearance={appearance} routerFactory={replacementFactory} />
      </StrictMode>
    )
    expect(screen.getByRole('heading', { name: '问卷设计' })).toBeVisible()
    expect(routerFactory).toHaveBeenCalledOnce()
    expect(replacementFactory).not.toHaveBeenCalled()
    unmount()
    router?.dispose()
  })
})
