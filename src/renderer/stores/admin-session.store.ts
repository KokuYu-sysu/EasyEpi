import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

import type { DesktopApi } from '@shared/desktop-api'

export interface AdminSessionMirror {
  authenticated: boolean
  expiresAt: number | null
}

const adminSessionStore = createStore<AdminSessionMirror>()(() => ({
  authenticated: false,
  expiresAt: null
}))

let syncId = 0
let syncInFlight: { id: number; promise: Promise<boolean> } | null = null

export function clearAdminSession(): void {
  syncId += 1
  syncInFlight = null
  adminSessionStore.setState({ authenticated: false, expiresAt: null })
}

export function syncAdminSession(
  api: DesktopApi['admin'] = window.easyEpi.admin
): Promise<boolean> {
  if (syncInFlight !== null) return syncInFlight.promise

  const id = ++syncId
  const promise = api.checkSession().then(
    (session) => {
      const authenticated = session.isAuthenticated && session.expiresAt !== undefined
      if (id === syncId) {
        adminSessionStore.setState({
          authenticated,
          expiresAt: authenticated ? session.expiresAt! : null
        })
      }
      return authenticated
    },
    () => {
      if (id === syncId) {
        adminSessionStore.setState({ authenticated: false, expiresAt: null })
      }
      return false
    }
  ).finally(() => {
    if (syncInFlight?.id === id) syncInFlight = null
  })
  syncInFlight = { id, promise }

  return promise
}

export function useAdminSession<T>(selector: (state: AdminSessionMirror) => T): T {
  return useStore(adminSessionStore, selector)
}
