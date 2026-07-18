import type { DesktopPlatform, PingResponse } from '@shared/system-contract'
import { parsePingRequest, SYSTEM_PING_CHANNEL } from '@shared/system-contract'

import { isTrustedRendererUrl } from './window-policy'

export interface AppInfo {
  version: string
  platform: DesktopPlatform
}

interface IpcInvokeEventLike {
  senderFrame?: {
    url: string
  } | null
}

interface IpcMainLike {
  handle(
    channel: string,
    handler: (event: IpcInvokeEventLike, request: unknown) => Promise<PingResponse>
  ): void
  removeHandler(channel: string): void
}

export function handlePing(rawRequest: unknown, appInfo: AppInfo): PingResponse {
  const request = parsePingRequest(rawRequest)
  return {
    nonce: request.nonce,
    version: appInfo.version,
    platform: appInfo.platform
  }
}

export function assertTrustedSender(
  candidateUrl: string,
  packagedRendererUrl: string,
  developmentOrigin?: string
): void {
  if (!isTrustedRendererUrl(candidateUrl, packagedRendererUrl, developmentOrigin)) {
    throw new Error('UNTRUSTED_IPC_SENDER')
  }
}

export function registerSystemIpc(
  ipcMain: IpcMainLike,
  appInfo: AppInfo,
  packagedRendererUrl: string,
  developmentOrigin?: string
): () => void {
  ipcMain.handle(SYSTEM_PING_CHANNEL, async (event, rawRequest) => {
    if (event.senderFrame === undefined || event.senderFrame === null) {
      throw new Error('MISSING_IPC_SENDER_FRAME')
    }

    assertTrustedSender(event.senderFrame.url, packagedRendererUrl, developmentOrigin)
    return handlePing(rawRequest, appInfo)
  })

  return () => {
    ipcMain.removeHandler(SYSTEM_PING_CHANNEL)
  }
}
