import type { DesktopApi } from '@shared/desktop-api'
import {
  parsePreferencesResult,
  parsePreferencesUpdateRequest,
  PREFERENCES_GET_CHANNEL,
  PREFERENCES_UPDATE_CHANNEL,
  type PreferencesResult,
  type PreferencesV1
} from '@shared/preferences-contract'
import type { PingRequest, PingResponse } from '@shared/system-contract'
import { SYSTEM_PING_CHANNEL } from '@shared/system-contract'

export interface DesktopInvoke {
  (channel: typeof SYSTEM_PING_CHANNEL, request: PingRequest): Promise<PingResponse>
  (channel: typeof PREFERENCES_GET_CHANNEL): Promise<unknown>
  (channel: typeof PREFERENCES_UPDATE_CHANNEL, request: PreferencesV1): Promise<unknown>
}

function parsePublicPreferencesResult(value: unknown): PreferencesResult {
  try {
    return parsePreferencesResult(value)
  } catch {
    throw new Error('INVALID_PREFERENCES_RESPONSE')
  }
}

export function createDesktopApi(invoke: DesktopInvoke): DesktopApi {
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

  const desktopApi = { system, preferences } satisfies DesktopApi
  return Object.freeze(desktopApi)
}
