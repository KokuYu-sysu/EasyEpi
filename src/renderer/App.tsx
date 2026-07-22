import { RouterProvider, type RouterProviderProps } from 'react-router-dom'

import { AppBootstrap } from '@renderer/app/AppBootstrap'
import { createAppRouter } from '@renderer/app/routes'
import type { PreferencesAppearance } from '@renderer/stores/preferences-store'
import type { DesktopApi } from '@shared/desktop-api'

export interface AppProps {
  api?: DesktopApi
  appearance?: PreferencesAppearance
  router?: RouterProviderProps['router']
}

export function App({
  api = window.easyEpi,
  appearance,
  router = createAppRouter({ isDevelopment: import.meta.env.DEV })
}: AppProps) {
  return (
    <AppBootstrap api={api.preferences} appearance={appearance}>
      <RouterProvider router={router} />
    </AppBootstrap>
  )
}
