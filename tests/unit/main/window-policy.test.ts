import { describe, expect, it } from 'vitest'

import {
  createWindowOptions,
  isTrustedRendererUrl,
  resolveDevelopmentRendererUrl
} from '../../../src/main/window-policy'

describe('createWindowOptions', () => {
  it('enforces renderer isolation and sandboxing', () => {
    const options = createWindowOptions('D:\\EasyEpi\\out\\preload\\index.js')

    expect(options.minWidth).toBe(1024)
    expect(options.minHeight).toBe(700)
    expect(options.webPreferences).toMatchObject({
      preload: 'D:\\EasyEpi\\out\\preload\\index.js',
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    })
  })
})

describe('isTrustedRendererUrl', () => {
  const packagedRendererUrl = 'file:///D:/EasyEpi/out/renderer/index.html'
  const developmentOrigin = 'http://127.0.0.1:5173'

  it('accepts only the exact packaged renderer URL', () => {
    expect(isTrustedRendererUrl(packagedRendererUrl, packagedRendererUrl)).toBe(true)
    expect(
      isTrustedRendererUrl('file:///D:/EasyEpi/out/renderer/other.html', packagedRendererUrl)
    ).toBe(false)
    expect(
      isTrustedRendererUrl('file:///C:/Users/Public/untrusted.html', packagedRendererUrl)
    ).toBe(false)
  })

  it('accepts the exact development origin', () => {
    expect(
      isTrustedRendererUrl(
        'http://127.0.0.1:5173/designer?draft=1',
        packagedRendererUrl,
        developmentOrigin
      )
    ).toBe(true)
  })

  it.each([
    'https://example.com',
    'http://127.0.0.1:5173.evil.example',
    'http://127.0.0.1:5174',
    'not a url'
  ])('rejects untrusted or malformed URL %s', (candidate) => {
    expect(isTrustedRendererUrl(candidate, packagedRendererUrl, developmentOrigin)).toBe(false)
  })
})

describe('resolveDevelopmentRendererUrl', () => {
  it('ignores the development renderer URL in packaged applications', () => {
    expect(resolveDevelopmentRendererUrl(true, 'https://attacker.example')).toBeUndefined()
  })

  it('uses the configured renderer URL only during development', () => {
    expect(resolveDevelopmentRendererUrl(false, 'http://127.0.0.1:5173')).toBe(
      'http://127.0.0.1:5173'
    )
  })
})
