import { BrowserWindow } from 'electron'

export async function printQuestionnairePdf(html: string): Promise<Buffer> {
  const window = new BrowserWindow({
    show: false,
    skipTaskbar: true,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      javascript: false
    }
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  try {
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    return await window.webContents.printToPDF({
      pageSize: 'A4',
      preferCSSPageSize: true,
      printBackground: true,
      generateTaggedPDF: true
    })
  } finally {
    if (!window.isDestroyed()) window.destroy()
  }
}
