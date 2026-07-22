import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

import {
  PRODUCTION_ROUTES,
  createAppRouter
} from '@renderer/app/routes'
import { NotFoundPage } from '@renderer/pages/NotFoundPage'
import { RouteErrorPage } from '@renderer/pages/RouteErrorPage'

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
  })

  it('gates the component gallery behind the development flag', () => {
    expect(flattenPaths(createAppRouter({ isDevelopment: true }).routes)).toContain(
      '/__components'
    )
    expect(flattenPaths(createAppRouter({ isDevelopment: false }).routes)).not.toContain(
      '/__components'
    )
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
