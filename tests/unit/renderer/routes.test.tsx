import { render, screen } from '@testing-library/react'
import { createMemoryRouter, MemoryRouter, RouterProvider } from 'react-router-dom'

import {
  PRODUCTION_ROUTES,
  createAppRouter
} from '@renderer/app/routes'
import { NotFoundPage } from '@renderer/pages/NotFoundPage'
import { RouteErrorPage } from '@renderer/pages/RouteErrorPage'
import { RoutePlaceholderPage } from '@renderer/pages/RoutePlaceholderPage'
import { ToastProvider } from '@renderer/components/ui'
import {
  createPreferencesStore,
  PreferencesProvider,
  type PreferencesAppearance
} from '@renderer/stores/preferences-store'
import { DEFAULT_PREFERENCES, type PreferencesV1 } from '@shared/preferences-contract'

function renderDataRouter(router: ReturnType<typeof createMemoryRouter> | ReturnType<typeof createAppRouter>) {
  const appearance: PreferencesAppearance = {
    apply: () => undefined,
    observeSystemTheme: () => () => undefined
  }
  const store = createPreferencesStore({
    api: {
      get: () => new Promise(() => undefined),
      update: async (preferences: PreferencesV1) => ({ ok: true, preferences })
    },
    appearance
  })
  store.setState({ status: 'ready', confirmed: DEFAULT_PREFERENCES, desired: DEFAULT_PREFERENCES })
  render(
    <PreferencesProvider store={store}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </PreferencesProvider>
  )
}

function flattenPaths(routes: ReturnType<typeof createAppRouter>['routes']): string[] {
  return routes.flatMap((route) => [
    route.path ?? '',
    ...flattenPaths(route.children ?? [])
  ])
}

describe('application routes', () => {
  it('registers exactly the nine production destinations', () => {
    expect(PRODUCTION_ROUTES.map(({ path }) => path)).toEqual([
      '/',
      '/designer',
      '/import',
      '/entry',
      '/work-session',
      '/admin/login',
      '/admin/data',
      '/admin/baseline',
      '/derived'
    ])

    const paths = flattenPaths(createAppRouter({ isDevelopment: false }).routes)
    expect(paths.filter((path) => path.startsWith('/') && path !== '*')).toEqual(
      PRODUCTION_ROUTES.map(({ path }) => path)
    )
    expect(
      PRODUCTION_ROUTES.every(
        ({ handle }) => handle.placeholder.title === '演示骨架，后续任务替换'
      )
    ).toBe(true)
  })

  it('gates the component gallery behind the development flag', () => {
    expect(flattenPaths(createAppRouter({ isDevelopment: true }).routes)).toContain(
      '/__components'
    )
    expect(flattenPaths(createAppRouter({ isDevelopment: false }).routes)).not.toContain(
      '/__components'
    )
  })

  it('renders production /__components through NotFound with recovery', async () => {
    const router = createAppRouter({ isDevelopment: false })
    await router.navigate('/__components')
    renderDataRouter(router)

    expect(screen.getByRole('heading', { name: '页面未找到' })).toBeVisible()
    expect(screen.getByRole('link', { name: '返回欢迎页' })).toBeVisible()
    expect(screen.queryByRole('heading', { name: '设计系统组件展厅' })).not.toBeInTheDocument()
    router.dispose()
  })

  it('renders placeholder content from the matched route handle', () => {
    const router = createMemoryRouter(
      [
        {
          path: '/metadata',
          handle: {
            title: '元数据页面标题',
            description: '来自路由元数据的页面摘要',
            placeholder: {
              title: '演示骨架，后续任务替换',
              description: '来自路由元数据的占位说明'
            }
          },
          element: <RoutePlaceholderPage />
        }
      ],
      { initialEntries: ['/metadata'] }
    )
    renderDataRouter(router)

    expect(screen.getByRole('heading', { name: '元数据页面标题' })).toBeVisible()
    expect(screen.getByRole('heading', { name: '演示骨架，后续任务替换' })).toBeVisible()
    expect(screen.getByText('来自路由元数据的占位说明')).toBeVisible()
  })

  it('offers a welcome-page recovery action for unknown routes', () => {
    render(
      <MemoryRouter>
        <NotFoundPage />
      </MemoryRouter>
    )
    expect(screen.getByRole('heading', { name: '页面未找到' })).toBeVisible()
    expect(screen.getByRole('link', { name: '返回欢迎页' })).toHaveAttribute('href', '/')
  })

  it('offers a welcome-page recovery action after a route error', () => {
    render(
      <MemoryRouter>
        <RouteErrorPage error={new Error('boom')} />
      </MemoryRouter>
    )
    expect(screen.getByRole('heading', { name: '页面暂时无法显示' })).toBeVisible()
    expect(screen.getByRole('link', { name: '返回欢迎页' })).toHaveAttribute('href', '/')
  })
})
