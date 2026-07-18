import type { PingRequest, PingResponse } from './system-contract'

export interface DesktopApi {
  system: {
    ping(request: PingRequest): Promise<PingResponse>
  }
}
