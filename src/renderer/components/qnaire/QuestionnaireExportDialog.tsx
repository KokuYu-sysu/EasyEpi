import { useRef, useState } from 'react'
import { Button, Modal } from '@renderer/components/ui'
import type {
  QuestionnaireExportError,
  QuestionnaireExportFormat
} from '@shared/questionnaire-export-contract'

const ERROR_MESSAGES: Record<QuestionnaireExportError, string> = {
  NO_PROJECT_OPEN: '请先创建或打开项目。',
  PROJECT_NOT_UNLOCKED: '请先解锁当前项目。',
  EMPTY_QUESTIONNAIRE: '请先添加题目，再导出问卷。',
  INVALID_QUESTIONNAIRE: '问卷的题目或条件规则不完整，请检查后重试。',
  QUESTIONNAIRE_TOO_LARGE:
    '固定长度题每题最多导出 1000 格，整份问卷最多 10000 格。请调整后重试，内容不会被截断。',
  PROJECT_CHANGED: '项目已切换或关闭，请重新打开问卷导出。',
  EXPORT_IN_PROGRESS: '正在导出问卷，请稍候。',
  EXPORT_FAILED: '导出失败，请检查保存位置是否可写后重试。'
}

export function QuestionnaireExportDialog({ disabled }: { disabled: boolean }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const exportDocument = async (format: QuestionnaireExportFormat) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setMessage('')
    setError('')
    try {
      const result = await window.easyEpi.qnaire.exportDocument({ format })
      if (result.success) setMessage(`问卷已导出：${result.filePath}`)
      else if ('canceled' in result) setMessage('已取消导出。')
      else setError(ERROR_MESSAGES[result.error] ?? ERROR_MESSAGES.EXPORT_FAILED)
    } catch {
      setError(ERROR_MESSAGES.EXPORT_FAILED)
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  return (
    <Modal
      title="问卷导出"
      description="选择 PDF 或可编辑的 Word 文档，随后选择保存位置。"
      trigger={
        <Button variant="secondary" disabled={disabled}>
          问卷导出
        </Button>
      }
      open={open}
      onOpenChange={(next) => {
        if (busyRef.current) return
        setOpen(next)
        if (next) {
          setMessage('')
          setError('')
        }
      }}
    >
      <div className="mt-[var(--space-4)] grid gap-[var(--space-4)]" aria-busy={busy}>
        <p className="m-0 text-[length:var(--font-size-sm)] text-[var(--color-text-secondary)]">
          导出空白问卷，包含填写区、选项和条件说明，Key 题目加粗。
        </p>
        <div className="flex flex-wrap gap-[var(--space-3)]">
          <Button disabled={busy} onClick={() => void exportDocument('pdf')}>
            导出 PDF
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => void exportDocument('docx')}>
            导出 Word
          </Button>
        </div>
        {busy && <p role="status">正在导出，请稍候……</p>}
        {message && (
          <p role="status" className="m-0 break-all text-[length:var(--font-size-sm)]">
            {message}
          </p>
        )}
        {error && (
          <p
            role="alert"
            className="m-0 text-[length:var(--font-size-sm)] text-[var(--color-danger)]"
          >
            {error}
          </p>
        )}
      </div>
    </Modal>
  )
}
