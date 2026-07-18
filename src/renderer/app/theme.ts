export type ThemePreference = 'light' | 'dark' | 'system'
export type ResolvedTheme = Exclude<ThemePreference, 'system'>
export type MotionPreference = 'full' | 'reduced'

export interface Appearance {
  theme: ThemePreference
  largeText: boolean
}

const DARK_THEME_QUERY = '(prefers-color-scheme: dark)'

export function resolveTheme(theme: ThemePreference, systemDark: boolean): ResolvedTheme {
  return theme === 'system' ? (systemDark ? 'dark' : 'light') : theme
}

export function resolveMotion(systemReducedMotion: boolean): MotionPreference {
  return systemReducedMotion ? 'reduced' : 'full'
}

export function applyAppearance(
  root: HTMLElement,
  appearance: Appearance,
  systemReducedMotion: boolean
): void {
  const systemDark =
    appearance.theme === 'system' && window.matchMedia(DARK_THEME_QUERY).matches

  root.dataset.theme = resolveTheme(appearance.theme, systemDark)
  root.dataset.fontScale = appearance.largeText ? 'large' : 'normal'
  root.dataset.motion = resolveMotion(systemReducedMotion)
}

export function observeSystemTheme(onChange: (systemDark: boolean) => void): () => void {
  const mediaQuery = window.matchMedia(DARK_THEME_QUERY)
  const listener = (event: MediaQueryListEvent): void => onChange(event.matches)

  mediaQuery.addEventListener('change', listener)

  return () => mediaQuery.removeEventListener('change', listener)
}
