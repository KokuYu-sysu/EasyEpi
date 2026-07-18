import type { BrowserWindowConstructorOptions } from 'electron'

export function createWindowOptions(preloadPath: string): BrowserWindowConstructorOptions {
  return {
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    title: 'EasyEpi',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  }
}

export function isTrustedRendererUrl(
  candidate: string,
  packagedRendererUrl: string,
  developmentOrigin?: string
): boolean {
  try {
    const candidateUrl = new URL(candidate)
    const packagedUrl = new URL(packagedRendererUrl)

    if (candidateUrl.href === packagedUrl.href) {
      return true
    }

    if (developmentOrigin === undefined) {
      return false
    }

    return candidateUrl.origin === new URL(developmentOrigin).origin
  } catch {
    return false
  }
}
