import { useState } from 'react'
import { Button, Modal, Select } from '@renderer/components/ui'

interface ExportDialogProps {
  onExport: (options: ExportOptions) => void
}

interface ExportOptions {
  encoding: 'multi_category' | 'one_hot' | 'dummy'
  dummyReference?: 'first' | 'last'
}

export function ExportDialog({ onExport }: ExportDialogProps) {
  const [open, setOpen] = useState(false)
  const [encoding, setEncoding] = useState<ExportOptions['encoding']>('multi_category')
  const [dummyReference, setDummyReference] = useState<'first' | 'last'>('first')

  const handleExport = () => {
    onExport({ encoding, dummyReference })
    setOpen(false)
  }

  return (
    <Modal
      trigger={<Button>导出CSV</Button>}
      title="导出CSV"
      description="选择导出选项"
      open={open}
      onOpenChange={setOpen}
    >
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-2">
            多选题编码方式
          </label>
          <div className="space-y-2">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                value="multi_category"
                checked={encoding === 'multi_category'}
                onChange={() => setEncoding('multi_category')}
              />
              <span>多分类变量（默认，保持原始格式）</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                value="one_hot"
                checked={encoding === 'one_hot'}
                onChange={() => setEncoding('one_hot')}
              />
              <span>独热编码 - 每个选项生成独立0/1列</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                value="dummy"
                checked={encoding === 'dummy'}
                onChange={() => setEncoding('dummy')}
              />
              <span>哑变量编码 - 以首个选项为参照</span>
            </label>
          </div>
        </div>

        {encoding === 'dummy' && (
          <div>
            <label className="block text-sm font-medium mb-2">
              参照类别
            </label>
            <Select
              value={dummyReference}
              onValueChange={(v) => setDummyReference(v as 'first' | 'last')}
              options={[
                { value: 'first', label: '第一个选项' },
                { value: 'last', label: '最后一个选项' }
              ]}
            />
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            取消
          </Button>
          <Button onClick={handleExport}>
            导出
          </Button>
        </div>
      </div>
    </Modal>
  )
}