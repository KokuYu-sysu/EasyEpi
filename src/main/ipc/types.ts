export interface IpcInvokeEventLike {
  senderFrame?: {
    url: string
  } | null
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
  const url = event.senderFrame.url
  if (url !== packagedRendererUrl && url !== developmentOrigin) {
    throw new Error('UNTRUSTED_IPC_SENDER')
  }
}
