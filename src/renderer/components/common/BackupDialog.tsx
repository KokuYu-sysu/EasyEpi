import { DatabaseBackup } from 'lucide-react'
import { useCallback, useState } from 'react'

import { Button, ConfirmDialog, Modal, useToast } from '@renderer/components/ui'
import type { BackupInfo } from '@shared/qnaire-contract'

export function BackupDialog() {
  const [open, setOpen] = useState(false)
  const [backups, setBackups] = useState<BackupInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const toast = useToast()

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await window.easyEpi.project.listBackups()
      if (!result.ok) {
        setError('无法读取备份列表')
        setBackups([])
      } else {
        setBackups(result.backups)
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '无法读取备份列表')
      setBackups([])
    } finally {
      setLoading(false)
    }
  }, [])

  const createNow = async () => {
    setBusy(true)
    setError(null)
    try {
      const result = await window.easyEpi.project.backup()
      if (!result.ok) {
        setError(result.error ?? '创建备份失败')
        return
      }
      toast.push({ title: '完整项目备份已创建', tone: 'success' })
      await refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '创建备份失败')
    } finally {
      setBusy(false)
    }
  }

  const restore = async (backupPath: string) => {
    setBusy(true)
    setError(null)
    try {
      const result = await window.easyEpi.project.restore({ backupPath })
      if (!result.ok) {
        setError(result.error ?? '恢复备份失败')
        return
      }
      toast.push({ title: '项目已恢复到所选版本', tone: 'success' })
      await refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '恢复备份失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      trigger={
        <Button variant="ghost" aria-label="项目备份与恢复">
          <DatabaseBackup aria-hidden="true" size={20} />
          <span className="hidden xl:inline">备份</span>
        </Button>
      }
      title="项目备份与恢复"
      description="创建完整项目快照，或将问卷和答卷恢复到之前的版本。"
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (nextOpen) void refresh()
      }}
      className="max-h-[min(42rem,calc(100vh-2rem))] overflow-auto"
    >
      <div className="grid gap-[var(--space-4)] py-[var(--space-4)]">
        <Button onClick={() => void createNow()} loading={busy}>
          立即创建备份
        </Button>
        {error ? (
          <p role="alert" className="m-0 text-[var(--color-danger)]">{error}</p>
        ) : null}
        {loading ? <p className="m-0 text-[var(--color-text-secondary)]">正在读取备份…</p> : null}
        {!loading && backups.length === 0 ? (
          <p className="m-0 text-[var(--color-text-secondary)]">
            暂无可恢复版本。请先打开项目并创建备份。
          </p>
        ) : null}
        {backups.length > 0 ? (
          <ul aria-label="可恢复版本" className="m-0 grid list-none gap-[var(--space-3)] p-0">
            {backups.map((backup) => (
              <li
                key={backup.filePath}
                className="flex flex-wrap items-center justify-between gap-[var(--space-3)] rounded-[var(--radius-1)] border border-[var(--color-border-default)] p-[var(--space-3)]"
              >
                <div>
                  <p className="m-0 font-[var(--font-weight-semibold)]">
                    {new Date(backup.timestamp).toLocaleString('zh-CN')}
                  </p>
                  <p className="mb-0 mt-[var(--space-1)] text-[length:var(--font-size-sm)] text-[var(--color-text-secondary)]">
                    {backup.hasData ? '含答卷数据' : '仅问卷（无答卷文件）'} ·{' '}
                    {Math.max(1, Math.ceil(backup.size / 1024))} KB
                  </p>
                </div>
                <ConfirmDialog
                  trigger={<Button variant="secondary" size="sm" disabled={busy}>恢复此版本</Button>}
                  title="确认恢复备份"
                  description="当前问卷和答卷将被所选完整快照替换。恢复前会验证备份，失败时保留当前文件。"
                  confirmLabel="确认恢复"
                  onConfirm={() => void restore(backup.filePath)}
                />
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Modal>
  )
}
