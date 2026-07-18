import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { applyAppearance, observeSystemTheme, resolveMotion, resolveTheme } from '@renderer/app/theme'

const tokensCss = readFileSync(resolve(process.cwd(), 'src/renderer/styles/tokens.css'), 'utf8')

function getThemeBlock(theme: 'light' | 'dark'): string {
  const selector = `[data-theme='${theme}']`
  const blocks: string[] = []
  let searchFrom = 0
  let selectorIndex = tokensCss.indexOf(selector, searchFrom)

  while (selectorIndex !== -1) {
    const blockStart = tokensCss.indexOf('{', selectorIndex)
    const blockEnd = tokensCss.indexOf('}', blockStart)

    blocks.push(tokensCss.slice(blockStart + 1, blockEnd))
    searchFrom = blockEnd + 1
    selectorIndex = tokensCss.indexOf(selector, searchFrom)
  }

  return blocks.join('\n')
}

function getThemeToken(theme: 'light' | 'dark', token: string): string {
  const match = getThemeBlock(theme).match(new RegExp(`${token}:\\s*(#[0-9a-f]{6})`, 'i'))

  if (match?.[1] === undefined) {
    throw new Error(`Missing ${token} for ${theme} theme`)
  }

  return match[1]
}

function relativeLuminance(hex: string): number {
  const channels = hex
    .slice(1)
    .match(/.{2}/g)!
    .map((channel) => Number.parseInt(channel, 16) / 255)
    .map((channel) =>
      channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
    )

  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!
}

function contrastRatio(first: string, second: string): number {
  const lighter = Math.max(relativeLuminance(first), relativeLuminance(second))
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second))

  return (lighter + 0.05) / (darker + 0.05)
}

describe('theme runtime', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('resolves a system theme from the current color scheme', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })

  it('resolves reduced-motion support', () => {
    expect(resolveMotion(true)).toBe('reduced')
    expect(resolveMotion(false)).toBe('full')
  })

  it('applies the resolved appearance to the document root', () => {
    const root = document.createElement('html')

    applyAppearance(root, { theme: 'dark', largeText: true }, true)

    expect(root.dataset).toMatchObject({
      theme: 'dark',
      fontScale: 'large',
      motion: 'reduced'
    })
  })

  it.each([
    [true, 'dark'],
    [false, 'light']
  ] as const)('applies the %s system color scheme', (systemDark, expectedTheme) => {
    const root = document.createElement('html')
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: systemDark }))

    applyAppearance(root, { theme: 'system', largeText: false }, false)

    expect(root.dataset).toMatchObject({
      theme: expectedTheme,
      fontScale: 'normal',
      motion: 'full'
    })
  })

  it('removes its system-theme listener during cleanup', () => {
    const addEventListener = vi.fn()
    const removeEventListener = vi.fn()
    const mediaQuery = {
      matches: false,
      addEventListener,
      removeEventListener
    } as unknown as MediaQueryList
    const matchMedia = vi.fn().mockReturnValue(mediaQuery)
    vi.stubGlobal('matchMedia', matchMedia)
    const onChange = vi.fn()

    const cleanup = observeSystemTheme(onChange)
    const subscribedCallback = addEventListener.mock.calls[0]?.[1]
    subscribedCallback?.({ matches: true } as MediaQueryListEvent)
    cleanup()

    expect(matchMedia).toHaveBeenCalledWith('(prefers-color-scheme: dark)')
    expect(addEventListener).toHaveBeenCalledWith('change', expect.any(Function))
    expect(onChange).toHaveBeenCalledWith(true)
    expect(removeEventListener).toHaveBeenCalledWith('change', subscribedCallback)
  })
})

describe('theme tokens', () => {
  it.each(['light', 'dark'] as const)('sets the native color scheme for %s mode', (theme) => {
    expect(getThemeBlock(theme)).toContain(`color-scheme: ${theme};`)
  })

  it.each(['light', 'dark'] as const)(
    'keeps muted normal text readable on every %s surface',
    (theme) => {
      const mutedText = getThemeToken(theme, '--color-text-muted')
      const surfaces = [
        '--color-surface-canvas',
        '--color-surface-base',
        '--color-surface-raised',
        '--color-surface-sunken'
      ]

      for (const surface of surfaces) {
        expect(
          contrastRatio(mutedText, getThemeToken(theme, surface)),
          `${theme} ${mutedText} on ${surface}`
        ).toBeGreaterThanOrEqual(4.5)
      }
    }
  )

  it.each(['light', 'dark'] as const)(
    'keeps the focus indicator distinct from every %s surface',
    (theme) => {
      const focus = getThemeToken(theme, '--color-border-focus')
      const surfaces = [
        '--color-surface-canvas',
        '--color-surface-base',
        '--color-surface-raised',
        '--color-surface-sunken'
      ]

      for (const surface of surfaces) {
        expect(
          contrastRatio(focus, getThemeToken(theme, surface)),
          `${theme} ${focus} on ${surface}`
        ).toBeGreaterThanOrEqual(3)
      }
    }
  )
})
