import { useState } from 'react'
import { RouterProvider, type RouterProviderProps } from 'react-router-dom'

import { AppBootstrap } from '@renderer/app/AppBootstrap'
import { createAppRouter } from '@renderer/app/routes'
import type { PreferencesAppearance } from '@renderer/stores/preferences-store'
import type { DesktopApi } from '@shared/desktop-api'

export interface AppProps {
  api?: DesktopApi
  appearance?: PreferencesAppearance
  router?: RouterProviderProps['router']
  routerFactory?: AppRouterFactory
}

export type AppRouter = RouterProviderProps['router']
export type AppRouterFactory = () => AppRouter

const defaultRouterFactory: AppRouterFactory = () =>
  createAppRouter({ isDevelopment: import.meta.env.DEV })
const routerCache = new WeakMap<AppRouterFactory, AppRouter>()

function getCachedRouter(factory: AppRouterFactory): AppRouter {
  const cached = routerCache.get(factory)
  if (cached !== undefined) {
    return cached
  }
  const router = factory()
  routerCache.set(factory, router)
  return router
}

interface RoutedAppProps {
  router?: AppRouter
  routerFactory: AppRouterFactory
}

function RoutedApp({ router, routerFactory }: RoutedAppProps) {
  const [activeRouter] = useState(() => router ?? getCachedRouter(routerFactory))
  return <RouterProvider router={activeRouter} />
}

export function App({
  api = window.easyEpi,
  appearance,
  router,
  routerFactory = defaultRouterFactory
}: AppProps) {
  return (
    <AppBootstrap api={api.preferences} appearance={appearance}>
      <RoutedApp router={router} routerFactory={routerFactory} />
    </AppBootstrap>
  )
}
