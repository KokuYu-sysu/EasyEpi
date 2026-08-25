import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { registerEpiDataIpcHandlers } from '../../../src/main/ipc/epidata.ipc'
import { createProjectIpcState } from '../../../src/main/ipc/project.ipc'
import { EPIDATA_IMPORT_CHANNEL } from '@shared/epidata-contract'

type Handler = (event: {
  senderFrame?: { url: string } | null
  sender?: { send(channel: string, payload: unknown): void }
}, request?: unknown) => Promise<unknown>

describe('EpiData IPC', () => {
  const directories: string[] = []

  afterEach(() => {
    for (const directory of directories.splice(0)) {
      if (existsSync(directory)) rmSync(directory, { recursive: true, force: true })
    }
  })

  it('rejects untrusted senders and unlocks the imported project for immediate use', async () => {
    const source = mkdtempSync(join(tmpdir(), 'easyepi-ipc-source-'))
    const target = mkdtempSync(join(tmpdir(), 'easyepi-ipc-target-'))
    directories.push(source, target)
    const qesFilePath = join(source, 'people.qes')
    writeFileSync(qesFilePath, 'People\n{name} Participant name ______', 'utf8')

    const handlers = new Map<string, Handler>()
    const ipcMain = {
      handle: vi.fn((channel: string, handler: Handler) => handlers.set(channel, handler)),
      removeHandler: vi.fn()
    }
    const projectState = createProjectIpcState()
    const cancelAIRequests = vi.fn()
    const dispose = registerEpiDataIpcHandlers(
      ipcMain,
      projectState,
      'file:///D:/EasyEpi/out/renderer/index.html',
      undefined,
      () => undefined,
      cancelAIRequests
    )
    const importHandler = handlers.get(EPIDATA_IMPORT_CHANNEL)!
    const request = {
      qesFilePath,
      targetProjectPath: target,
      projectName: 'Imported IPC',
      password: 'secure-password'
    }

    await expect(
      importHandler({ senderFrame: { url: 'https://attacker.invalid' } }, request)
    ).rejects.toThrow('UNTRUSTED_IPC_SENDER')
    await expect(
      importHandler(
        {
          senderFrame: { url: 'file:///D:/EasyEpi/out/renderer/index.html' },
          sender: { send: vi.fn() }
        },
        request
      )
    ).resolves.toMatchObject({ success: true })
    expect(projectState.currentProject?.questionnaire.questions).toHaveLength(1)
    expect(projectState.auth.encryptionKey).not.toBeNull()
    expect(cancelAIRequests).toHaveBeenCalledOnce()

    dispose()
    expect(ipcMain.removeHandler).toHaveBeenCalledWith(EPIDATA_IMPORT_CHANNEL)
  })
})
