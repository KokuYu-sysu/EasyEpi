import { dialog } from 'electron'

import { isTrustedRendererUrl } from './window-policy'

interface IpcInvokeEventLike {
  senderFrame?: { url: string } | null
}

interface IpcMainLike {
  handle(channel: string, handler: (event: IpcInvokeEventLike, ...args: unknown[]) => Promise<unknown>): void
  removeHandler(channel: string): void
}

export const DIALOG_SELECT_FOLDER = 'dialog:selectFolder' as const
export const DIALOG_SELECT_FILE = 'dialog:selectFile' as const

export function registerDialogIpc(
  ipcMain: IpcMainLike,
  packagedRendererUrl: string,
  developmentOrigin?: string
): () => void {
  ipcMain.handle(DIALOG_SELECT_FOLDER, async (event: IpcInvokeEventLike) => {
    if (!event.senderFrame) throw new Error('MISSING_IPC_SENDER_FRAME')
    if (!isTrustedRendererUrl(event.senderFrame.url, packagedRendererUrl, developmentOrigin)) {
      throw new Error('UNTRUSTED_IPC_SENDER')
    }
    const result = dialog.showOpenDialogSync({
      properties: ['openDirectory', 'createDirectory']
    })
    if (result === undefined) {
      return { canceled: true, filePaths: [] }
    }
    return { canceled: false, filePaths: result }
  })

  ipcMain.handle(DIALOG_SELECT_FILE, async (event: IpcInvokeEventLike, rawFilters: unknown) => {
    if (!event.senderFrame) throw new Error('MISSING_IPC_SENDER_FRAME')
    if (!isTrustedRendererUrl(event.senderFrame.url, packagedRendererUrl, developmentOrigin)) {
      throw new Error('UNTRUSTED_IPC_SENDER')
    }
    const filters = Array.isArray(rawFilters)
      ? (rawFilters as { name: string; extensions: string[] }[])
      : []
    const result = dialog.showOpenDialogSync({
      properties: ['openFile'],
      filters
    })
    if (result === undefined) {
      return { canceled: true, filePaths: [] }
    }
    return { canceled: false, filePaths: result }
  })

  return () => {
    ipcMain.removeHandler(DIALOG_SELECT_FOLDER)
    ipcMain.removeHandler(DIALOG_SELECT_FILE)
  }
}
