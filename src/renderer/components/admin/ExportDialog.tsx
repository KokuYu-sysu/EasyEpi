import { useState } from 'react'

import type {
  ExportCsvRequest,
  ExportCsvResult,
  ExportEncoding,
  ExportFileEncoding
} from '@shared/export-contract'
import { Button, Input, Modal, Select } from '@renderer/components/ui'
import type { QuestionDef } from '@shared/types/qnaire'

export interface ExportDialogProps {
  selectedIds: string[]
  questions: QuestionDef[]
  onExport: (request: ExportCsvRequest) => Promise<ExportCsvResult>
}

function joinPath(folder: string, name: string): string {
  const separator = folder.includes('\\') ? '\\' : '/'
  return `${folder.replace(/[\\/]$/, '')}${separator}${name}`
}

function questionColumnCount(
  questions: QuestionDef[],
  encoding: ExportEncoding
): number {
  return questions.reduce((total, question) => {
    if (question.type !== 'multiple_choice' || encoding === 'multi_category') return total + 1
    if (question.options.length === 0) return total + 1
    if (encoding === 'one_hot') return total + question.options.length
    return total + Math.max(1, question.options.length - 1)
  }, 0)
}

export function ExportDialog({ selectedIds, questions, onExport }: ExportDialogProps) {
  const [open, setOpen] = useState(false)
  const [encoding, setEncoding] = useState<ExportEncoding>('multi_category')
  const [fileEncoding, setFileEncoding] = useState<ExportFileEncoding>('utf8_bom')
  const [dummyReference, setDummyReference] = useState<'first' | 'last'>('first')
  const [scope, setScope] = useState<'all' | 'selected'>('all')
  const [fileName, setFileName] = useState('easyepi_export.csv')
  const [isExporting, setIsExporting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const estimatedColumnCount = 3 + questionColumnCount(questions, encoding)

  const exportCsv = async () => {
    const normalizedName = fileName.trim().toLowerCase().endsWith('.csv')
      ? fileName.trim()
      : `${fileName.trim()}.csv`
    if (normalizedName === '.csv') {
      setMessage('请输入导出文件名。')
      return
    }
    const folder = await window.easyEpi.dialog.selectFolder()
    if (folder.canceled || folder.filePaths.length === 0) return
    setIsExporting(true)
    setMessage(null)
    try {
      const result = await onExport({
        outputPath: joinPath(folder.filePaths[0]!, normalizedName),
        encoding,
        fileEncoding,
        ...(encoding === 'dummy' ? { dummyReference } : {}),
        scope,
        ...(scope === 'selected' ? { selectedIds } : {})
      })
      if (!result.success) {
        setMessage(`导出失败：${result.error ?? '未知错误'}`)
        return
      }
      setMessage(`已导出 ${result.recordCount ?? 0} 条记录：${result.csvPath}`)
    } catch {
      setMessage('导出失败，请检查管理员会话和目标目录。')
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <Modal
      trigger={<Button>导出 CSV</Button>}
      title="导出调查数据"
      description="选择记录范围和多选题编码方式。系统会同时生成数据字典。"
      open={open}
      onOpenChange={setOpen}
    >
      <div className="grid gap-[var(--space-4)] pt-[var(--space-3)]">
        <Select
          label="记录范围"
          value={scope}
          onValueChange={(value) => setScope(value as 'all' | 'selected')}
          options={[
            { value: 'all', label: '全部记录' },
            {
              value: 'selected',
              label: `选中的记录（${selectedIds.length} 条）`,
              disabled: selectedIds.length === 0
            }
          ]}
        />
        <Select
          label="CSV 文件编码"
          value={fileEncoding}
          onValueChange={(value) => setFileEncoding(value as ExportFileEncoding)}
          options={[
            { value: 'utf8_bom', label: 'UTF-8（含 BOM）' },
            { value: 'gbk', label: 'GBK（兼容旧版 Excel）' }
          ]}
        />
        <Select
          label="多选题编码"
          value={encoding}
          onValueChange={(value) => setEncoding(value as ExportEncoding)}
          options={[
            { value: 'multi_category', label: '多分类（保留原值）' },
            { value: 'one_hot', label: '独热编码（每项一列）' },
            { value: 'dummy', label: '哑变量编码（k-1 列）' }
          ]}
        />
        {encoding === 'dummy' ? (
          <Select
            label="哑变量参考类别"
            value={dummyReference}
            onValueChange={(value) => setDummyReference(value as 'first' | 'last')}
            options={[
              { value: 'first', label: '第一个选项' },
              { value: 'last', label: '最后一个选项' }
            ]}
          />
        ) : null}
        <Input
          label="CSV 文件名"
          value={fileName}
          onChange={(event) => setFileName(event.target.value)}
        />
        <p className="m-0 text-[var(--color-text-secondary)]">
          预计导出列数：{estimatedColumnCount}
        </p>
        {message ? <p className="m-0" role="status" aria-live="polite">{message}</p> : null}
        <div className="flex justify-end gap-[var(--space-2)]">
          <Button variant="secondary" onClick={() => setOpen(false)}>关闭</Button>
          <Button loading={isExporting} onClick={() => void exportCsv()}>选择目录并导出</Button>
        </div>
      </div>
    </Modal>
  )
}
