import { isTrustedRendererUrl } from '../window-policy'

export interface IpcInvokeEventLike {
  senderFrame?: {
    url: string
  } | null
  sender?: IpcWebContentsLike
}

export interface IpcWebContentsLike {
  id?: number
  isDestroyed?(): boolean
  send(channel: string, payload: unknown): void
}

export interface IpcMainLike {
  handle(channel: string, handler: (event: IpcInvokeEventLike, ...args: unknown[]) => Promise<unknown>): void
  removeHandler(channel: string): void
}

export function assertTrustedSender(
  event: IpcInvokeEventLike,
  packagedRendererUrl: string,
  developmentOrigin?: string
): void {
  if (event.senderFrame === undefined || event.senderFrame === null) {
    throw new Error('MISSING_IPC_SENDER_FRAME')
  }
  if (!isTrustedRendererUrl(event.senderFrame.url, packagedRendererUrl, developmentOrigin)) {
    throw new Error('UNTRUSTED_IPC_SENDER')
  }
}
