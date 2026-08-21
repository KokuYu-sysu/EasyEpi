import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { BackupDialog } from '@renderer/components/common/BackupDialog'
import { ToastProvider } from '@renderer/components/ui'
import type { DesktopApi } from '@shared/desktop-api'

function installProjectApi(project: DesktopApi['project']): void {
  Object.defineProperty(window, 'easyEpi', {
    configurable: true,
    value: { project } as Pick<DesktopApi, 'project'>
  })
}

describe('BackupDialog', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, 'easyEpi')
  })

  it('lets a keyboard user create and restore a complete project snapshot', async () => {
    const user = userEvent.setup()
    const backup = vi.fn().mockResolvedValue({ ok: true })
    const restore = vi.fn().mockResolvedValue({ ok: true })
    const listBackups = vi.fn().mockResolvedValue({
      ok: true,
      backups: [
        {
          filePath: 'D:\\study\\.backups\\study.easyepi.1700000000000.bak',
          timestamp: 1_700_000_000_000,
          size: 2048,
          hasData: true
        }
      ]
    })
    installProjectApi({
      create: vi.fn(),
      open: vi.fn(),
      save: vi.fn(),
      close: vi.fn(),
      backup,
      listBackups,
      restore
    })

    render(
      <ToastProvider>
        <BackupDialog />
      </ToastProvider>
    )

    await user.click(screen.getByRole('button', { name: '项目备份与恢复' }))
    expect(await screen.findByText(/含答卷数据/)).toBeVisible()
    const restoreTrigger = screen.getByRole('button', { name: '恢复此版本' })
    restoreTrigger.focus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('alertdialog', { name: '确认恢复备份' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: '确认恢复' }))
    await waitFor(() =>
      expect(restore).toHaveBeenCalledWith({
        backupPath: 'D:\\study\\.backups\\study.easyepi.1700000000000.bak'
      })
    )

    await user.click(screen.getByRole('button', { name: '立即创建备份' }))
    await waitFor(() => expect(backup).toHaveBeenCalledOnce())
    expect(listBackups).toHaveBeenCalledTimes(3)
  })

  it('shows project errors instead of presenting a silent empty rollback list', async () => {
    const user = userEvent.setup()
    installProjectApi({
      create: vi.fn(),
      open: vi.fn(),
      save: vi.fn(),
      close: vi.fn(),
      backup: vi.fn().mockResolvedValue({ ok: false, error: '没有打开的项目' }),
      listBackups: vi.fn().mockResolvedValue({ ok: true, backups: [] }),
      restore: vi.fn()
    })

    render(
      <ToastProvider>
        <BackupDialog />
      </ToastProvider>
    )
    await user.click(screen.getByRole('button', { name: '项目备份与恢复' }))
    await user.click(await screen.findByRole('button', { name: '立即创建备份' }))

    expect(await screen.findByText('没有打开的项目')).toBeVisible()
  })
})
