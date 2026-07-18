import type { DesktopApi } from '@shared/desktop-api'
import type { PingRequest, PingResponse } from '@shared/system-contract'
import { SYSTEM_PING_CHANNEL } from '@shared/system-contract'

type Invoke = (
  channel: typeof SYSTEM_PING_CHANNEL,
  request: PingRequest
) => Promise<PingResponse>

export function createDesktopApi(invoke: Invoke): DesktopApi {
  const system = Object.freeze({
    ping: (request: PingRequest) => invoke(SYSTEM_PING_CHANNEL, request)
  })

  return Object.freeze({ system })
}
