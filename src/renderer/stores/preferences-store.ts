import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useState,
  type PropsWithChildren,
  type ReactElement
} from 'react'
import { createStore, type StoreApi } from 'zustand/vanilla'
import { useStore } from 'zustand'

import {
  applyAppearance as applyDocumentAppearance,
  observeSystemTheme
} from '@renderer/app/theme'
import type { DesktopApi } from '@shared/desktop-api'
import {
  DEFAULT_PREFERENCES,
  preferencesEqual,
  type PreferencesErrorCode,
  type PreferencesResult,
  type PreferencesV1,
  type PreferencesWarning
} from '@shared/preferences-contract'

export type PreferencesStatus = 'loading' | 'ready'
export type PreferencesNotice = Readonly<{
  kind: 'warning' | 'error'
  code: PreferencesWarning | PreferencesErrorCode
}>
export type PreferencesPatch = Partial<Omit<PreferencesV1, 'schemaVersion'>>

export interface PreferencesApi {
  get(): Promise<PreferencesResult>
  update(preferences: PreferencesV1): Promise<PreferencesResult>
}

export interface PreferencesAppearance {
  apply(preferences: PreferencesV1): void
  observeSystemTheme(onChange: () => void): () => void
}

export interface PreferencesState {
  status: PreferencesStatus
  confirmed: PreferencesV1
  desired: PreferencesV1
  inFlight: PreferencesV1 | null
  notice: PreferencesNotice | null
  load(): Promise<void>
  setPreferences(patch: PreferencesPatch): void
  clearNotice(): void
  consumeNotice(): PreferencesNotice | null
  destroy(): void
}

export interface CreatePreferencesStoreOptions {
  api: PreferencesApi
  appearance: PreferencesAppearance
}

export type PreferencesStore = StoreApi<PreferencesState>

interface PreferencesStoreLifecycle {
  owners: number
  activate(): void
}

const preferencesStoreLifecycles = new WeakMap<
  PreferencesStore,
  PreferencesStoreLifecycle
>()

function snapshot(preferences: PreferencesV1): PreferencesV1 {
  return Object.freeze({ ...preferences })
}

function notice(
  kind: PreferencesNotice['kind'],
  code: PreferencesNotice['code']
): PreferencesNotice {
  return Object.freeze({ kind, code })
}

export function createPreferencesStore({
  api,
  appearance
}: CreatePreferencesStoreOptions): PreferencesStore {
  const defaults = snapshot(DEFAULT_PREFERENCES)
  let destroyed = false
  let loadPromise: Promise<void> | null = null
  let saveCommitVersion = 0
  let loadSaveCommitVersion = 0
  let stopObservingSystemTheme: (() => void) | null = null

  const stopObserving = (): void => {
    stopObservingSystemTheme?.()
    stopObservingSystemTheme = null
  }

  const apply = (preferences: PreferencesV1): void => {
    appearance.apply(preferences)

    if (preferences.theme !== 'system') {
      stopObserving()
      return
    }

    if (stopObservingSystemTheme === null) {
      stopObservingSystemTheme = appearance.observeSystemTheme(() => {
        if (!destroyed && store.getState().desired.theme === 'system') {
          appearance.apply(store.getState().desired)
        }
      })
    }
  }

  const finishSave = (request: PreferencesV1, result: PreferencesResult): void => {
    if (destroyed) {
      return
    }

    if (store.getState().inFlight !== request) {
      return
    }

    const current = store.getState()
    const hasNewerDesired = !preferencesEqual(current.desired, request)

    if (result.ok) {
      saveCommitVersion += 1
      const confirmed = snapshot(result.preferences)
      const desired = hasNewerDesired ? current.desired : confirmed
      store.setState({ confirmed, desired, inFlight: null })
      if (!hasNewerDesired) {
        apply(desired)
      }
    } else {
      const desired = hasNewerDesired ? current.desired : snapshot(current.confirmed)
      store.setState({
        desired,
        inFlight: null,
        notice: notice('error', result.code)
      })
      if (!hasNewerDesired) {
        apply(desired)
      }
    }

    pump()
  }

  const pump = (force = false): void => {
    if (destroyed) {
      return
    }

    const state = store.getState()
    if (
      state.inFlight !== null ||
      (!force && preferencesEqual(state.desired, state.confirmed))
    ) {
      return
    }

    const request = snapshot(state.desired)
    store.setState({ inFlight: request })

    try {
      api.update(request).then(
        (result) => finishSave(request, result),
        () => finishSave(request, { ok: false, code: 'PREFERENCES_SAVE_FAILED' })
      )
    } catch {
      finishSave(request, { ok: false, code: 'PREFERENCES_SAVE_FAILED' })
    }
  }

  const completeLoad = (result: PreferencesResult): void => {
    if (destroyed) {
      return
    }

    if (saveCommitVersion !== loadSaveCommitVersion) {
      store.setState({
        status: 'ready',
        notice: result.ok
          ? result.warning === undefined
            ? null
            : notice('warning', result.warning)
          : notice('warning', result.code)
      })
      return
    }

    stopObserving()

    if (result.ok) {
      const loaded = snapshot(result.preferences)
      store.setState({
        status: 'ready',
        confirmed: loaded,
        desired: loaded,
        notice:
          result.warning === undefined ? null : notice('warning', result.warning)
      })
      apply(loaded)
      return
    }

    const fallback = snapshot(DEFAULT_PREFERENCES)
    store.setState({
      status: 'ready',
      confirmed: fallback,
      desired: fallback,
      notice: notice('warning', result.code)
    })
    apply(fallback)
  }

  const store = createStore<PreferencesState>()((set, get) => ({
    status: 'loading',
    confirmed: defaults,
    desired: defaults,
    inFlight: null,
    notice: null,
    load: () => {
      if (loadPromise !== null) {
        return loadPromise
      }

      loadSaveCommitVersion = saveCommitVersion
      try {
        loadPromise = api.get().then(
          (result) => completeLoad(result),
          () => completeLoad({ ok: false, code: 'PREFERENCES_READ_FAILED' })
        )
      } catch {
        completeLoad({ ok: false, code: 'PREFERENCES_READ_FAILED' })
        loadPromise = Promise.resolve()
      }
      return loadPromise
    },
    setPreferences: (patch) => {
      if (destroyed) {
        return
      }

      const desired = snapshot({ ...get().desired, ...patch })
      set({ desired })
      apply(desired)
      pump(true)
    },
    clearNotice: () => set({ notice: null }),
    consumeNotice: () => {
      const currentNotice = get().notice
      set({ notice: null })
      return currentNotice
    },
    destroy: () => {
      if (!destroyed) {
        destroyed = true
        stopObserving()
      }
    }
  }))

  preferencesStoreLifecycles.set(store, {
    owners: 0,
    activate: () => {
      if (destroyed) {
        destroyed = false
        apply(store.getState().desired)
      }
    }
  })

  return store
}

const defaultAppearance: PreferencesAppearance = {
  apply: (preferences) => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    applyDocumentAppearance(document.documentElement, preferences, reducedMotion)
  },
  observeSystemTheme: (onChange) => observeSystemTheme(() => onChange())
}

const PreferencesStoreContext = createContext<PreferencesStore | null>(null)

export interface PreferencesProviderProps extends PropsWithChildren {
  api?: DesktopApi['preferences']
  appearance?: PreferencesAppearance
  store?: PreferencesStore
}

export function PreferencesProvider({
  api,
  appearance = defaultAppearance,
  store: injectedStore,
  children
}: PreferencesProviderProps): ReactElement {
  const [store] = useState(
    () =>
      injectedStore ??
      createPreferencesStore({
        api: api ?? window.easyEpi.preferences,
        appearance
      })
  )

  useEffect(() => {
    const lifecycle = preferencesStoreLifecycles.get(store)
    if (lifecycle !== undefined) {
      lifecycle.activate()
      lifecycle.owners += 1
    }
    void store.getState().load()
    return () => {
      if (lifecycle !== undefined) {
        lifecycle.owners -= 1
        if (lifecycle.owners > 0) {
          return
        }
      }
      store.getState().destroy()
    }
  }, [store])

  return createElement(
    PreferencesStoreContext.Provider,
    { value: store },
    children
  )
}

export function usePreferencesStoreApi(): PreferencesStore {
  const store = useContext(PreferencesStoreContext)
  if (store === null) {
    throw new Error('PreferencesProvider is missing')
  }
  return store
}

export function usePreferencesStore<T>(selector: (state: PreferencesState) => T): T {
  return useStore(usePreferencesStoreApi(), selector)
}
