export const PREFERENCES_GET_CHANNEL = 'preferences:get' as const
export const PREFERENCES_UPDATE_CHANNEL = 'preferences:update' as const

export interface PreferencesV1 {
  schemaVersion: 1
  theme: 'light' | 'dark' | 'system'
  largeText: boolean
  sidebarCollapsed: boolean
}

export type PreferencesWarning = 'PREFERENCES_RECOVERED'

export type PreferencesErrorCode =
  | 'INVALID_PREFERENCES_REQUEST'
  | 'PREFERENCES_READ_FAILED'
  | 'PREFERENCES_SAVE_FAILED'

export type PreferencesResult =
  | { ok: true; preferences: PreferencesV1; warning?: PreferencesWarning }
  | { ok: false; code: PreferencesErrorCode }

export const DEFAULT_PREFERENCES: Readonly<PreferencesV1> = Object.freeze({
  schemaVersion: 1,
  theme: 'system',
  largeText: false,
  sidebarCollapsed: false
})

const PREFERENCE_KEYS = [
  'schemaVersion',
  'theme',
  'largeText',
  'sidebarCollapsed'
] as const

const PREFERENCE_ERROR_CODES: readonly PreferencesErrorCode[] = [
  'INVALID_PREFERENCES_REQUEST',
  'PREFERENCES_READ_FAILED',
  'PREFERENCES_SAVE_FAILED'
]

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value)
  return keys.length === expected.length && keys.every((key) => expected.includes(key))
}

function normalizePreferences(value: unknown, error: string): PreferencesV1 {
  if (!isPlainObject(value)) {
    throw new Error(error)
  }

  const { schemaVersion, theme, largeText, sidebarCollapsed } = value
  if (
    schemaVersion !== 1 ||
    (theme !== 'light' && theme !== 'dark' && theme !== 'system') ||
    typeof largeText !== 'boolean' ||
    typeof sidebarCollapsed !== 'boolean'
  ) {
    throw new Error(error)
  }

  return { schemaVersion, theme, largeText, sidebarCollapsed }
}

export function parsePreferences(value: unknown): PreferencesV1 {
  return normalizePreferences(value, 'INVALID_PREFERENCES')
}

export function parsePreferencesUpdateRequest(value: unknown): PreferencesV1 {
  return normalizePreferences(value, 'INVALID_PREFERENCES_REQUEST')
}

export function parsePreferencesResult(value: unknown): PreferencesResult {
  const error = 'INVALID_PREFERENCES_RESPONSE'
  if (!isPlainObject(value) || typeof value.ok !== 'boolean') {
    throw new Error(error)
  }

  if (value.ok) {
    const expectedKeys = value.warning === undefined
      ? ['ok', 'preferences']
      : ['ok', 'preferences', 'warning']
    if (
      !hasExactKeys(value, expectedKeys) ||
      !isPlainObject(value.preferences) ||
      !hasExactKeys(value.preferences, PREFERENCE_KEYS) ||
      (value.warning !== undefined && value.warning !== 'PREFERENCES_RECOVERED')
    ) {
      throw new Error(error)
    }

    const preferences = normalizePreferences(value.preferences, error)
    return value.warning === 'PREFERENCES_RECOVERED'
      ? { ok: true, preferences, warning: value.warning }
      : { ok: true, preferences }
  }

  if (
    !hasExactKeys(value, ['ok', 'code']) ||
    typeof value.code !== 'string' ||
    !PREFERENCE_ERROR_CODES.includes(value.code as PreferencesErrorCode)
  ) {
    throw new Error(error)
  }

  return { ok: false, code: value.code as PreferencesErrorCode }
}

export function preferencesEqual(left: PreferencesV1, right: PreferencesV1): boolean {
  return (
    left.schemaVersion === right.schemaVersion &&
    left.theme === right.theme &&
    left.largeText === right.largeText &&
    left.sidebarCollapsed === right.sidebarCollapsed
  )
}
