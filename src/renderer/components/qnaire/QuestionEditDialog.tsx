import { useState, type FormEvent, type ReactElement } from 'react'

import { Modal, Button, Input, Select, Checkbox } from '@renderer/components/ui'
import {
  QUESTION_TYPE_LABELS,
  CONSTRAINT_TYPE_LABELS,
  type QuestionType,
  type ConstraintType,
  type OptionItem,
  type ConstraintDef,
  type QuestionDef
} from '@shared/types/qnaire'

const TYPE_OPTIONS = Object.entries(QUESTION_TYPE_LABELS).map(([value, label]) => ({ value, label }))
const CONSTRAINT_OPTIONS = Object.entries(CONSTRAINT_TYPE_LABELS).map(([value, label]) => ({
  value,
  label
}))

export interface QuestionFormData {
  content: string
  variableName: string
  type: QuestionType
  options: OptionItem[]
  constraint: ConstraintDef
  defaultValue: string
  isKey: boolean
  allowSkip: boolean
}

export const EMPTY_FORM_DATA: QuestionFormData = {
  content: '',
  variableName: '',
  type: 'single_choice',
  options: [{ value: '1', label: '选项1' }],
  constraint: { type: 'none' },
  defaultValue: '',
  isKey: false,
  allowSkip: false
}

export function validateQuestionFormData(
  form: QuestionFormData,
  existingVariableNames: string[],
  isAdd: boolean,
  initialVariableName?: string
): Record<string, string> {
  const errors: Record<string, string> = {}
  if (!form.content.trim()) errors.content = '请输入题目内容'
  if (!form.variableName.trim()) errors.variableName = '请输入变量名'
  else if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(form.variableName)) {
    errors.variableName = '变量名须以字母开头，仅含字母、数字和下划线'
  } else if (
    existingVariableNames.includes(form.variableName) &&
    (isAdd || initialVariableName !== form.variableName)
  ) {
    errors.variableName = '变量名已存在'
  }

  if (form.type === 'single_choice' || form.type === 'multiple_choice') {
    const values = form.options.map((option) => option.value.trim())
    const hasBlank = form.options.some(
      (option) => !option.value.trim() || !option.label.trim()
    )
    if (form.options.length < 2) {
      errors.options = '选择题至少需要 2 个选项'
    } else if (hasBlank) {
      errors.options = '选项值和标签不能为空'
    } else if (new Set(values).size !== values.length) {
      errors.options = '选项值不能重复'
    }
  }

  if (
    form.type === 'fixed_length' &&
    (form.constraint.fixedLength === undefined || form.constraint.fixedLength < 1)
  ) {
    errors.constraint = '固定长度必须大于 0'
  }
  if (
    form.type === 'numeric_range' &&
    form.constraint.minValue !== undefined &&
    form.constraint.maxValue !== undefined &&
    form.constraint.minValue > form.constraint.maxValue
  ) {
    errors.constraint = '最小值不能大于最大值'
  }
  if (form.constraint.type === 'regex') {
    if (!form.constraint.regexPattern) {
      errors.constraint = '请输入正则表达式'
    } else {
      try {
        new RegExp(form.constraint.regexPattern, form.constraint.regexFlags)
      } catch {
        errors.constraint = '正则表达式无效'
      }
    }
  }
  return errors
}

function parseOptionalNumber(value: string): number | undefined {
  if (value.trim() === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function questionToFormData(q: QuestionDef): QuestionFormData {
  return {
    content: q.content,
    variableName: q.variableName,
    type: q.type,
    options: [...q.options],
    constraint: { ...q.constraint },
    defaultValue: q.defaultValue ?? '',
    isKey: q.isKey,
    allowSkip: q.allowSkip
  }
}

interface QuestionEditDialogProps {
  mode: 'add' | 'edit'
  initial: QuestionFormData
  existingVariableNames: string[]
  trigger: ReactElement
  onCommit(data: QuestionFormData): void
}

function generateVariableName(content: string): string {
  const cleaned = content
    .replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '')
    .substring(0, 20)
    .toLowerCase()
  if (/^[a-zA-Z]/.test(cleaned)) return cleaned
  return `q_${cleaned}`
}

function OptionsEditor({
  options,
  onChange
}: {
  options: OptionItem[]
  onChange(options: OptionItem[]): void
}) {
  const addOption = () => {
    const nextValue = String(options.length + 1)
    onChange([...options, { value: nextValue, label: `选项${options.length + 1}` }])
  }

  const removeOption = (index: number) => {
    onChange(options.filter((_, i) => i !== index))
  }

  const updateOption = (index: number, field: keyof OptionItem, value: string) => {
    const updated = options.map((opt, i) => (i === index ? { ...opt, [field]: value } : opt))
    onChange(updated)
  }

  const moveOption = (index: number, direction: -1 | 1) => {
    const newIndex = index + direction
    if (newIndex < 0 || newIndex >= options.length) return
    const updated = [...options]
    const temp = updated[index]!
    updated[index] = updated[newIndex]!
    updated[newIndex] = temp
    onChange(updated)
  }

  return (
    <div className="grid gap-[var(--space-2)]">
      <label className="text-[length:var(--font-size-sm)] font-[var(--font-weight-medium)] text-[var(--color-text-primary)]">
        选项列表
      </label>
      {options.map((opt, index) => (
        <div key={index} className="flex items-center gap-[var(--space-2)]">
          <Input
            label=""
            aria-label={`选项 ${index + 1} 值`}
            className="w-16"
            value={opt.value}
            onChange={(e) => updateOption(index, 'value', e.target.value)}
          />
          <Input
            label=""
            aria-label={`选项 ${index + 1} 标签`}
            className="flex-1"
            value={opt.label}
            onChange={(e) => updateOption(index, 'label', e.target.value)}
          />
          <Button size="sm" variant="ghost" onClick={() => moveOption(index, -1)} disabled={index === 0}>
            ↑
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => moveOption(index, 1)}
            disabled={index === options.length - 1}
          >
            ↓
          </Button>
          <Button
            size="sm"
            variant="danger"
            onClick={() => removeOption(index)}
            disabled={options.length <= 1}
          >
            ✕
          </Button>
        </div>
      ))}
      <Button size="sm" variant="secondary" onClick={addOption}>
        + 添加选项
      </Button>
    </div>
  )
}

export function QuestionEditDialog({
  mode,
  initial,
  existingVariableNames,
  trigger,
  onCommit
}: QuestionEditDialogProps) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<QuestionFormData>(initial)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const isAdd = mode === 'add'

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (nextOpen) {
      setForm({ ...initial, options: initial.options.map((o) => ({ ...o })) })
      setErrors({})
    }
  }

  const validate = (): boolean => {
    const newErrors = validateQuestionFormData(
      form,
      existingVariableNames,
      isAdd,
      initial.variableName
    )
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!validate()) return
    onCommit({ ...form, content: form.content.trim(), variableName: form.variableName.trim() })
    setOpen(false)
  }

  const showOptions = form.type === 'single_choice' || form.type === 'multiple_choice'
  const showLength = form.type === 'fixed_length'
  const showNumeric = form.type === 'numeric_range'

  return (
    <Modal
      trigger={trigger}
      title={isAdd ? '添加新题目' : '编辑题目'}
      description={isAdd ? '填写题目属性后添加到问卷。' : '修改题目属性。'}
      open={open}
      onOpenChange={handleOpenChange}
    >
      <form className="mt-[var(--space-4)] grid max-h-[70vh] gap-[var(--space-4)] overflow-y-auto pr-[var(--space-2)]" onSubmit={submit}>
        <Input
          label="题目内容 *"
          value={form.content}
          error={errors.content}
          onChange={(e) => {
            setForm((f) => ({ ...f, content: e.target.value }))
            if (errors.content) setErrors((err) => ({ ...err, content: '' }))
          }}
        />

        <div className="flex items-end gap-[var(--space-2)]">
          <Input
            label="变量名 *"
            className="flex-1"
            value={form.variableName}
            error={errors.variableName}
            onChange={(e) => {
              setForm((f) => ({ ...f, variableName: e.target.value }))
              if (errors.variableName) setErrors((err) => ({ ...err, variableName: '' }))
            }}
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              const suggested = generateVariableName(form.content)
              setForm((f) => ({ ...f, variableName: suggested }))
            }}
          >
            自动生成
          </Button>
        </div>

        <Select
          label="题型 *"
          options={TYPE_OPTIONS}
          value={form.type}
          onValueChange={(v) => {
            const type = v as QuestionType
            setForm((f) => ({
              ...f,
              type,
              options:
                type === 'single_choice' || type === 'multiple_choice'
                  ? f.options.length > 0
                    ? f.options
                    : [{ value: '1', label: '选项1' }]
                  : [],
              constraint: type === 'numeric_range' ? { type: 'decimal', minValue: 0, maxValue: 100 } : f.constraint
            }))
          }}
        />

        {showOptions && (
          <OptionsEditor
            options={form.options}
            onChange={(options) => {
              setForm((f) => ({ ...f, options }))
              if (errors.options) setErrors((err) => ({ ...err, options: '' }))
            }}
          />
        )}
        {errors.options && (
          <p className="text-[length:var(--font-size-sm)] text-[var(--color-danger)]">{errors.options}</p>
        )}

        {showLength && (
          <div className="grid grid-cols-2 gap-[var(--space-3)]">
            <Input
              label="固定长度"
              type="number"
              min={1}
              value={String(form.constraint.fixedLength ?? '')}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  constraint: {
                    ...f.constraint,
                    fixedLength: parseOptionalNumber(e.target.value)
                  }
                }))
              }
            />
            <Select
              label="约束类型"
              options={CONSTRAINT_OPTIONS}
              value={form.constraint.type}
              onValueChange={(v) =>
                setForm((f) => ({
                  ...f,
                  constraint: { ...f.constraint, type: v as ConstraintType }
                }))
              }
            />
          </div>
        )}

        {showNumeric && (
          <div className="grid grid-cols-3 gap-[var(--space-3)]">
            <Input
              label="最小值"
              type="number"
              value={String(form.constraint.minValue ?? '')}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  constraint: {
                    ...f.constraint,
                    minValue: parseOptionalNumber(e.target.value)
                  }
                }))
              }
            />
            <Input
              label="最大值"
              type="number"
              value={String(form.constraint.maxValue ?? '')}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  constraint: {
                    ...f.constraint,
                    maxValue: parseOptionalNumber(e.target.value)
                  }
                }))
              }
            />
            <Input
              label="步长"
              type="number"
              min={1}
              value={String(form.constraint.step ?? '')}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  constraint: { ...f.constraint, step: parseOptionalNumber(e.target.value) }
                }))
              }
            />
          </div>
        )}

        {!showOptions && !showLength && !showNumeric && (
          <Select
            label="约束类型"
            options={CONSTRAINT_OPTIONS}
            value={form.constraint.type}
            onValueChange={(v) =>
              setForm((f) => ({
                ...f,
                constraint: { ...f.constraint, type: v as ConstraintType }
              }))
            }
          />
        )}

        {form.constraint.type === 'regex' && (
          <Input
            label="正则表达式"
            value={form.constraint.regexPattern ?? ''}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                constraint: { ...f.constraint, regexPattern: e.target.value }
              }))
            }
          />
        )}

        {errors.constraint && (
          <p role="alert" className="m-0 text-[length:var(--font-size-sm)] text-[var(--color-danger)]">
            {errors.constraint}
          </p>
        )}

        <div className="flex flex-wrap gap-[var(--space-4)]">
          <Checkbox
            label="设为 Key 标识符"
            checked={form.isKey}
            onCheckedChange={(checked) => setForm((f) => ({ ...f, isKey: checked === true }))}
          />
          <Checkbox
            label="允许跳过（不回答）"
            checked={form.allowSkip}
            onCheckedChange={(checked) => setForm((f) => ({ ...f, allowSkip: checked === true }))}
          />
        </div>

        <div className="flex flex-wrap justify-end gap-[var(--space-3)]">
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
            取消
          </Button>
          <Button type="submit">{isAdd ? '添加题目' : '保存修改'}</Button>
        </div>
      </form>
    </Modal>
  )
}

export { questionToFormData }
