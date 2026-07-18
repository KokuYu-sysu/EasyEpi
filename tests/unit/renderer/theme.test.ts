import { applyAppearance, observeSystemTheme, resolveMotion, resolveTheme } from '@renderer/app/theme'

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
    cleanup()

    expect(matchMedia).toHaveBeenCalledWith('(prefers-color-scheme: dark)')
    expect(addEventListener).toHaveBeenCalledWith('change', expect.any(Function))
    expect(removeEventListener).toHaveBeenCalledWith('change', subscribedCallback)
  })
})
