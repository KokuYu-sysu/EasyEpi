import type { SystemDesktopApi } from '@shared/desktop-api'

declare global {
  interface Window {
    easyEpi: SystemDesktopApi
  }
}

export {}
