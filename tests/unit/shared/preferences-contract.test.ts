import { describe, expect, it } from 'vitest'

import {
  DEFAULT_PREFERENCES,
  PREFERENCES_GET_CHANNEL,
  PREFERENCES_UPDATE_CHANNEL,
  parsePreferences,
  parsePreferencesResult,
  parsePreferencesUpdateRequest,
  preferencesEqual
} from '@shared/preferences-contract'

const VALID_PREFERENCES = {
  schemaVersion: 1,
  theme: 'dark',
  largeText: true,
  sidebarCollapsed: false
} as const

describe('preference wire contract', () => {
  it('exports fixed channels and exact immutable defaults', () => {
    expect(PREFERENCES_GET_CHANNEL).toBe('preferences:get')
    expect(PREFERENCES_UPDATE_CHANNEL).toBe('preferences:update')
    expect(DEFAULT_PREFERENCES).toEqual({
      schemaVersion: 1,
      theme: 'system',
      largeText: false,
      sidebarCollapsed: false
    })
    expect(Object.isFrozen(DEFAULT_PREFERENCES)).toBe(true)
  })

  it('normalizes a valid preference object into a fresh object', () => {
    const input = { ...VALID_PREFERENCES }
    const parsed = parsePreferences(input)

    expect(parsed).toEqual(VALID_PREFERENCES)
    expect(parsed).not.toBe(input)
  })

  it('ignores unknown preference keys', () => {
    expect(
      parsePreferences({
        schemaVersion: 1,
        theme: 'dark',
        largeText: true,
        sidebarCollapsed: false,
        injected: 'discard me'
      })
    ).toEqual({
      schemaVersion: 1,
      theme: 'dark',
      largeText: true,
      sidebarCollapsed: false
    })
  })

  it.each([
    null,
    undefined,
    true,
    1,
    'preferences',
    [],
    new Date(),
    Object.create({ ...VALID_PREFERENCES })
  ])('rejects a non-plain preference object: %s', (input) => {
    expect(() => parsePreferences(input)).toThrowError('INVALID_PREFERENCES')
  })

  it.each([
    {
      input: { theme: 'dark', largeText: true, sidebarCollapsed: false },
      reason: 'missing schema'
    },
    { input: { ...VALID_PREFERENCES, schemaVersion: 2 }, reason: 'unknown schema' },
    { input: { ...VALID_PREFERENCES, theme: 'sepia' }, reason: 'invalid theme' },
    { input: { ...VALID_PREFERENCES, largeText: 1 }, reason: 'invalid largeText' },
    {
      input: { ...VALID_PREFERENCES, sidebarCollapsed: 'false' },
      reason: 'invalid sidebarCollapsed'
    },
    {
      input: { schemaVersion: 1, largeText: true, sidebarCollapsed: false },
      reason: 'missing theme'
    },
    {
      input: { schemaVersion: 1, theme: 'dark', sidebarCollapsed: false },
      reason: 'missing largeText'
    },
    {
      input: { schemaVersion: 1, theme: 'dark', largeText: true },
      reason: 'missing sidebarCollapsed'
    }
  ])('rejects $reason', ({ input }) => {
    expect(() => parsePreferences(input)).toThrowError('INVALID_PREFERENCES')
  })

  it('accepts and normalizes a complete update snapshot', () => {
    const input = { ...VALID_PREFERENCES, injected: 'discard me' }
    const parsed = parsePreferencesUpdateRequest(input)

    expect(parsed).toEqual(VALID_PREFERENCES)
    expect(parsed).not.toBe(input)
  })

  it.each([
    null,
    [],
    { theme: 'dark' },
    { ...VALID_PREFERENCES, theme: 'sepia' },
    Object.create({ ...VALID_PREFERENCES })
  ])('rejects an invalid update snapshot without leaking data: %s', (input) => {
    expect(() => parsePreferencesUpdateRequest(input)).toThrowError(
      'INVALID_PREFERENCES_REQUEST'
    )
  })

  it('parses a successful result without warning into fresh objects', () => {
    const input = { ok: true, preferences: { ...VALID_PREFERENCES } }
    const parsed = parsePreferencesResult(input)

    expect(parsed).toEqual(input)
    expect(parsed).not.toBe(input)
    if (parsed.ok) {
      expect(parsed.preferences).not.toBe(input.preferences)
      expect('warning' in parsed).toBe(false)
    }
  })

  it('parses a successful recovered result', () => {
    expect(
      parsePreferencesResult({
        ok: true,
        preferences: VALID_PREFERENCES,
        warning: 'PREFERENCES_RECOVERED'
      })
    ).toEqual({
      ok: true,
      preferences: VALID_PREFERENCES,
      warning: 'PREFERENCES_RECOVERED'
    })
  })

  it.each([
    'INVALID_PREFERENCES_REQUEST',
    'PREFERENCES_READ_FAILED',
    'PREFERENCES_SAVE_FAILED'
  ])('parses the stable failure code %s', (code) => {
    expect(parsePreferencesResult({ ok: false, code })).toEqual({ ok: false, code })
  })

  it.each([
    null,
    [],
    true,
    Object.create({ ok: false, code: 'PREFERENCES_READ_FAILED' }),
    {},
    { ok: true },
    { ok: true, preferences: VALID_PREFERENCES, warning: 'UNKNOWN_WARNING' },
    { ok: true, preferences: VALID_PREFERENCES, code: 'PREFERENCES_READ_FAILED' },
    { ok: true, preferences: VALID_PREFERENCES, extra: true },
    { ok: true, preferences: { ...VALID_PREFERENCES, extra: true } },
    { ok: true, preferences: Object.create({ ...VALID_PREFERENCES }) },
    { ok: false },
    { ok: false, code: 'UNKNOWN_ERROR' },
    { ok: false, code: 'PREFERENCES_READ_FAILED', preferences: VALID_PREFERENCES },
    { ok: false, code: 'PREFERENCES_READ_FAILED', warning: 'PREFERENCES_RECOVERED' },
    { ok: false, code: 'PREFERENCES_READ_FAILED', extra: true }
  ])('rejects a malformed or non-exact result: %s', (input) => {
    expect(() => parsePreferencesResult(input)).toThrowError(
      'INVALID_PREFERENCES_RESPONSE'
    )
  })

  it('compares every schema field', () => {
    expect(preferencesEqual(VALID_PREFERENCES, { ...VALID_PREFERENCES })).toBe(true)
    expect(
      preferencesEqual(VALID_PREFERENCES, { ...VALID_PREFERENCES, theme: 'light' })
    ).toBe(false)
    expect(
      preferencesEqual(VALID_PREFERENCES, { ...VALID_PREFERENCES, largeText: false })
    ).toBe(false)
    expect(
      preferencesEqual(VALID_PREFERENCES, {
        ...VALID_PREFERENCES,
        sidebarCollapsed: true
      })
    ).toBe(false)
  })
})
