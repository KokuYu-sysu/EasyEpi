import type { DesktopApi } from '@shared/desktop-api'
import {
  parsePreferencesResult,
  parsePreferencesUpdateRequest,
  PREFERENCES_GET_CHANNEL,
  PREFERENCES_UPDATE_CHANNEL,
  type PreferencesResult,
  type PreferencesV1
} from '@shared/preferences-contract'
import type { PingRequest } from '@shared/system-contract'
import { SYSTEM_PING_CHANNEL } from '@shared/system-contract'

type Invoke = (
  channel:
    typeof SYSTEM_PING_CHANNEL | typeof PREFERENCES_GET_CHANNEL | typeof PREFERENCES_UPDATE_CHANNEL,
  request?: unknown
) => Promise<unknown>

function parsePublicPreferencesResult(value: unknown): PreferencesResult {
  try {
    return parsePreferencesResult(value)
  } catch {
    throw new Error('INVALID_PREFERENCES_RESPONSE')
  }
}

export function createDesktopApi(invoke: Invoke): DesktopApi {
  const system = Object.freeze({
    ping: (request: PingRequest) => invoke(SYSTEM_PING_CHANNEL, request)
  })

  const preferences = Object.freeze({
    get: async () => parsePublicPreferencesResult(await invoke(PREFERENCES_GET_CHANNEL)),
    update: async (preferences: PreferencesV1) =>
      parsePublicPreferencesResult(
        await invoke(PREFERENCES_UPDATE_CHANNEL, parsePreferencesUpdateRequest(preferences))
      )
  })

  return Object.freeze({ system, preferences }) as DesktopApi
}
