import { createElement, StrictMode, type PropsWithChildren } from 'react'
import { render, renderHook } from '@testing-library/react'

import {
  createPreferencesStore,
  PreferencesProvider,
  usePreferencesStore,
  type PreferencesAppearance
} from '@renderer/stores/preferences-store'
import {
  DEFAULT_PREFERENCES,
  type PreferencesResult,
  type PreferencesV1
} from '@shared/preferences-contract'

interface Deferred<T> {
  promise: Promise<T>
  resolve(value: T): void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

function preferences(patch: Partial<PreferencesV1> = {}): PreferencesV1 {
  return { ...DEFAULT_PREFERENCES, ...patch }
}

function setup() {
  const gets: Deferred<PreferencesResult>[] = []
  const saves: Array<{
    request: PreferencesV1
    deferred: Deferred<PreferencesResult>
  }> = []
  const api = {
    get: vi.fn(() => {
      const next = deferred<PreferencesResult>()
      gets.push(next)
      return next.promise
    }),
    update: vi.fn((request: PreferencesV1) => {
      const next = deferred<PreferencesResult>()
      saves.push({ request, deferred: next })
      return next.promise
    })
  }
  const appearance: PreferencesAppearance = {
    apply: vi.fn(),
    observeSystemTheme: vi.fn(() => vi.fn())
  }
  const store = createPreferencesStore({ api, appearance })

  return { api, appearance, gets, saves, store }
}

describe('preferences store loading', () => {
  it('starts with complete defaults and falls back nonblockingly when loading fails', async () => {
    const { appearance, gets, store } = setup()

    expect(store.getState()).toMatchObject({
      status: 'loading',
      confirmed: DEFAULT_PREFERENCES,
      desired: DEFAULT_PREFERENCES,
      inFlight: null,
      notice: null
    })

    const firstLoad = store.getState().load()
    store.getState().load()
    expect(gets).toHaveLength(1)
    gets[0]!.resolve({ ok: false, code: 'PREFERENCES_READ_FAILED' })
    await firstLoad

    expect(store.getState()).toMatchObject({
      status: 'ready',
      confirmed: DEFAULT_PREFERENCES,
      desired: DEFAULT_PREFERENCES,
      notice: { kind: 'warning', code: 'PREFERENCES_READ_FAILED' }
    })
    expect(appearance.apply).toHaveBeenCalledWith(DEFAULT_PREFERENCES)
  })

  it('loads a normalized snapshot and exposes a consumable recovery warning', async () => {
    const { appearance, gets, store } = setup()
    const loaded = preferences({ theme: 'dark', largeText: true })

    const loading = store.getState().load()
    gets[0]!.resolve({ ok: true, preferences: loaded, warning: 'PREFERENCES_RECOVERED' })
    await loading

    expect(store.getState()).toMatchObject({
      status: 'ready',
      confirmed: loaded,
      desired: loaded,
      notice: { kind: 'warning', code: 'PREFERENCES_RECOVERED' }
    })
    expect(store.getState().consumeNotice()).toEqual({
      kind: 'warning',
      code: 'PREFERENCES_RECOVERED'
    })
    expect(store.getState().notice).toBeNull()
    expect(appearance.apply).toHaveBeenLastCalledWith(loaded)
  })

  it('loads successfully without a notice', async () => {
    const { gets, store } = setup()
    const loaded = preferences({ sidebarCollapsed: true })

    const loading = store.getState().load()
    gets[0]!.resolve({ ok: true, preferences: loaded })
    await loading

    expect(store.getState()).toMatchObject({
      status: 'ready',
      confirmed: loaded,
      desired: loaded,
      notice: null
    })
  })
})

describe('preferences save pump', () => {
  it('saves A and then the newer complete B snapshot without overlap', async () => {
    const { api, saves, store } = setup()
    const A = preferences({ theme: 'dark' })
    const B = preferences({ theme: 'dark', largeText: true })

    store.getState().setPreferences({ theme: 'dark' })
    const firstRequest = saves[0]!.request
    store.getState().setPreferences({ largeText: true })

    expect(store.getState()).toMatchObject({ desired: B, inFlight: A })
    expect(api.update).toHaveBeenCalledTimes(1)
    expect(firstRequest).toEqual(A)
    expect(firstRequest).not.toBe(store.getState().desired)
    expect(Object.isFrozen(firstRequest)).toBe(true)

    saves[0]!.deferred.resolve({ ok: true, preferences: A })
    await flush()

    expect(store.getState()).toMatchObject({ confirmed: A, desired: B, inFlight: B })
    expect(api.update).toHaveBeenCalledTimes(2)
    expect(saves[1]!.request).toEqual(B)

    saves[1]!.deferred.resolve({ ok: true, preferences: B })
    await flush()
    expect(store.getState()).toMatchObject({ confirmed: B, desired: B, inFlight: null })
  })

  it('keeps newer B visible when A fails and immediately retries B', async () => {
    const { saves, store } = setup()
    const A = preferences()
    const B = preferences({ sidebarCollapsed: true })

    store.getState().setPreferences({ theme: 'system' })
    store.getState().setPreferences({ sidebarCollapsed: true })

    expect(store.getState()).toMatchObject({ confirmed: A, desired: B, inFlight: A })
    saves[0]!.deferred.resolve({ ok: false, code: 'PREFERENCES_SAVE_FAILED' })
    await flush()
    expect(store.getState()).toMatchObject({ confirmed: A, desired: B, inFlight: B })
    expect(store.getState().notice).toEqual({
      kind: 'error',
      code: 'PREFERENCES_SAVE_FAILED'
    })
  })

  it('rolls back the latest failed desired snapshot exactly to confirmed', async () => {
    const { appearance, saves, store } = setup()
    const confirmed = store.getState().confirmed

    store.getState().setPreferences({ largeText: true })
    saves[0]!.deferred.resolve({ ok: false, code: 'PREFERENCES_SAVE_FAILED' })
    await flush()

    expect(store.getState()).toMatchObject({ confirmed, desired: confirmed, inFlight: null })
    expect(appearance.apply).toHaveBeenLastCalledWith(confirmed)
    expect(saves).toHaveLength(1)
  })

  it('preserves newer desired fields when a successful response is normalized', async () => {
    const { saves, store } = setup()
    const normalizedA = preferences({ theme: 'dark', sidebarCollapsed: true })
    const desiredB = preferences({ theme: 'dark', largeText: true })

    store.getState().setPreferences({ theme: 'dark' })
    store.getState().setPreferences({ largeText: true })
    saves[0]!.deferred.resolve({ ok: true, preferences: normalizedA })
    await flush()

    expect(store.getState()).toMatchObject({
      confirmed: normalizedA,
      desired: desiredB,
      inFlight: desiredB
    })
    expect(saves[1]!.request).toEqual(desiredB)
  })

  it('coalesces intermediate desired values into one complete next request', async () => {
    const { saves, store } = setup()
    const A = preferences({ theme: 'dark' })
    const latest = preferences({ theme: 'light', largeText: true, sidebarCollapsed: true })

    store.getState().setPreferences({ theme: 'dark' })
    store.getState().setPreferences({ largeText: true })
    store.getState().setPreferences({ sidebarCollapsed: true })
    store.getState().setPreferences({ theme: 'light' })
    expect(saves).toHaveLength(1)

    saves[0]!.deferred.resolve({ ok: true, preferences: A })
    await flush()

    expect(saves).toHaveLength(2)
    expect(saves[1]!.request).toEqual(latest)
    expect(Object.keys(saves[1]!.request).sort()).toEqual(
      ['largeText', 'schemaVersion', 'sidebarCollapsed', 'theme'].sort()
    )
  })

  it('does not overlap a newer save when load replaces state during an update', async () => {
    const { gets, saves, store } = setup()
    const savingA = preferences({ theme: 'dark' })
    const loaded = preferences({ theme: 'light' })
    const desiredB = preferences({ theme: 'light', largeText: true })

    store.getState().setPreferences({ theme: 'dark' })
    const loading = store.getState().load()
    gets[0]!.resolve({ ok: true, preferences: loaded })
    await loading

    expect(store.getState()).toMatchObject({
      confirmed: loaded,
      desired: loaded,
      inFlight: savingA
    })
    store.getState().setPreferences({ largeText: true })
    expect(saves).toHaveLength(1)

    saves[0]!.deferred.resolve({ ok: true, preferences: savingA })
    await flush()

    expect(store.getState()).toMatchObject({
      confirmed: savingA,
      desired: desiredB,
      inFlight: desiredB
    })
    expect(saves).toHaveLength(2)
  })

  it('converges after a save succeeds behind a load with no newer edit', async () => {
    const { gets, saves, store } = setup()
    const saving = preferences({ theme: 'dark' })
    const loaded = preferences({ theme: 'light' })

    store.getState().setPreferences({ theme: 'dark' })
    const loading = store.getState().load()
    gets[0]!.resolve({ ok: true, preferences: loaded })
    await loading
    saves[0]!.deferred.resolve({ ok: true, preferences: saving })
    await flush()

    expect(store.getState()).toMatchObject({
      confirmed: saving,
      desired: loaded,
      inFlight: loaded
    })
    expect(saves).toHaveLength(2)
  })

  it('ignores a stale load that returns after its concurrent save commits', async () => {
    const { gets, saves, store } = setup()
    const saving = preferences({ theme: 'dark' })
    const staleLoaded = preferences({ theme: 'light' })

    store.getState().setPreferences({ theme: 'dark' })
    const loading = store.getState().load()
    saves[0]!.deferred.resolve({ ok: true, preferences: saving })
    await flush()
    gets[0]!.resolve({ ok: true, preferences: staleLoaded })
    await loading

    expect(store.getState()).toMatchObject({
      status: 'ready',
      confirmed: saving,
      desired: saving,
      inFlight: null
    })
    expect(saves).toHaveLength(1)
  })

  it('does not let a stale load erase a newer save failure notice', async () => {
    const { gets, saves, store } = setup()

    store.getState().setPreferences({ theme: 'dark' })
    store.getState().setPreferences({ largeText: true })
    const loading = store.getState().load()
    saves[0]!.deferred.resolve({ ok: true, preferences: preferences({ theme: 'dark' }) })
    await flush()
    saves[1]!.deferred.resolve({ ok: false, code: 'PREFERENCES_SAVE_FAILED' })
    await flush()
    gets[0]!.resolve({ ok: true, preferences: preferences({ theme: 'light' }) })
    await loading

    expect(store.getState().notice).toEqual({
      kind: 'error',
      code: 'PREFERENCES_SAVE_FAILED'
    })
  })

  it.each<[string, PreferencesResult]>([
    [
      'successful read without a warning',
      { ok: true, preferences: preferences({ theme: 'light' }) }
    ],
    ['failed read', { ok: false, code: 'PREFERENCES_READ_FAILED' }]
  ])('preserves a newer save failure after a %s completes', async (_case, loadResult) => {
    const { gets, saves, store } = setup()
    const loading = store.getState().load()

    store.getState().setPreferences({ theme: 'dark' })
    saves[0]!.deferred.resolve({ ok: false, code: 'PREFERENCES_SAVE_FAILED' })
    await flush()
    expect(store.getState().notice).toEqual({
      kind: 'error',
      code: 'PREFERENCES_SAVE_FAILED'
    })

    gets[0]!.resolve(loadResult)
    await loading
    expect(store.getState().notice).toEqual({
      kind: 'error',
      code: 'PREFERENCES_SAVE_FAILED'
    })
  })

  it('does not resurrect a consumed save failure when its older load completes', async () => {
    const { gets, saves, store } = setup()
    const loading = store.getState().load()

    store.getState().setPreferences({ theme: 'dark' })
    saves[0]!.deferred.resolve({ ok: false, code: 'PREFERENCES_SAVE_FAILED' })
    await flush()
    expect(store.getState().consumeNotice()).toEqual({
      kind: 'error',
      code: 'PREFERENCES_SAVE_FAILED'
    })

    gets[0]!.resolve({ ok: false, code: 'PREFERENCES_READ_FAILED' })
    await loading
    expect(store.getState().notice).toBeNull()
  })
})

describe('preferences appearance lifecycle', () => {
  it('subscribes only for system theme, reapplies on change, and cleans up', () => {
    const { appearance, store } = setup()
    const cleanups: ReturnType<typeof vi.fn>[] = []
    vi.mocked(appearance.observeSystemTheme).mockImplementation(() => {
      const cleanup = vi.fn()
      cleanups.push(cleanup)
      return cleanup
    })

    store.getState().setPreferences({ theme: 'system' })
    expect(appearance.observeSystemTheme).toHaveBeenCalledTimes(1)
    const onChange = vi.mocked(appearance.observeSystemTheme).mock.calls[0]![0]
    onChange()
    expect(appearance.apply).toHaveBeenLastCalledWith(store.getState().desired)

    store.getState().setPreferences({ largeText: true })
    expect(appearance.observeSystemTheme).toHaveBeenCalledTimes(1)
    store.getState().setPreferences({ theme: 'dark' })
    expect(cleanups[0]).toHaveBeenCalledTimes(1)

    store.getState().setPreferences({ theme: 'system' })
    expect(appearance.observeSystemTheme).toHaveBeenCalledTimes(2)
    store.getState().destroy()
    expect(cleanups[1]).toHaveBeenCalledTimes(1)
  })

  it('replaces and cleans an existing system subscription when load completes', async () => {
    const { appearance, gets, store } = setup()
    const cleanup = vi.fn()
    vi.mocked(appearance.observeSystemTheme).mockReturnValue(cleanup)

    store.getState().setPreferences({ theme: 'system' })
    const loading = store.getState().load()
    gets[0]!.resolve({ ok: true, preferences: preferences({ theme: 'dark' }) })
    await loading

    expect(cleanup).toHaveBeenCalledTimes(1)
    expect(appearance.observeSystemTheme).toHaveBeenCalledTimes(1)
  })

  it('ignores late completions after destroy', async () => {
    const { gets, saves, store } = setup()
    const initial = store.getState()
    const loading = initial.load()
    initial.setPreferences({ theme: 'dark' })
    initial.destroy()

    gets[0]!.resolve({ ok: true, preferences: preferences({ largeText: true }) })
    saves[0]!.deferred.resolve({ ok: true, preferences: preferences({ theme: 'dark' }) })
    await loading
    await flush()

    expect(store.getState()).toMatchObject({
      status: 'loading',
      confirmed: DEFAULT_PREFERENCES,
      desired: preferences({ theme: 'dark' }),
      inFlight: preferences({ theme: 'dark' })
    })
  })
})

describe('preferences React bindings', () => {
  it('provides an injected store without requiring the window API and destroys it on unmount', () => {
    const { appearance, gets, store } = setup()
    const cleanup = vi.fn()
    vi.mocked(appearance.observeSystemTheme).mockReturnValue(cleanup)
    store.getState().setPreferences({ theme: 'system' })

    const wrapper = ({ children }: PropsWithChildren) =>
      createElement(PreferencesProvider, { store }, children)
    const rendered = renderHook(() => usePreferencesStore((state) => state.status), {
      wrapper
    })

    expect(rendered.result.current).toBe('loading')
    expect(gets).toHaveLength(1)
    rendered.unmount()
    expect(cleanup).toHaveBeenCalledTimes(1)
  })

  it('remains usable through React Strict Mode effect replay', () => {
    const { gets, saves, store } = setup()
    const wrapper = ({ children }: PropsWithChildren) =>
      createElement(
        StrictMode,
        null,
        createElement(PreferencesProvider, { store }, children)
      )

    const rendered = renderHook(() => usePreferencesStore((state) => state.status), {
      wrapper
    })
    expect(gets).toHaveLength(1)

    store.getState().setPreferences({ theme: 'dark' })
    expect(saves).toHaveLength(1)
    rendered.unmount()
  })

  it('keeps a shared injected store alive until its final provider unmounts', () => {
    const { gets, saves, store } = setup()
    const first = render(createElement(PreferencesProvider, { store }))
    const second = render(createElement(PreferencesProvider, { store }))

    expect(gets).toHaveLength(1)
    first.unmount()
    store.getState().setPreferences({ theme: 'dark' })
    expect(saves).toHaveLength(1)

    second.unmount()
  })

  it('permanently finalizes an injected store after its final unmount settles', async () => {
    const { appearance, saves, store } = setup()
    store.getState().setPreferences({ theme: 'system' })

    const first = render(createElement(PreferencesProvider, { store }))
    first.unmount()
    await flush()
    const second = render(createElement(PreferencesProvider, { store }))

    expect(appearance.observeSystemTheme).toHaveBeenCalledTimes(1)
    const finalizedDesired = store.getState().desired
    store.getState().setPreferences({ theme: 'dark' })
    expect(store.getState().desired).toBe(finalizedDesired)
    expect(saves).toHaveLength(1)
    second.unmount()
  })

})
