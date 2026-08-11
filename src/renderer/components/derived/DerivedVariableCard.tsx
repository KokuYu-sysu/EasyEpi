import { useState } from 'react'

import type { DerivedResultType, DerivedVariableDef } from '@shared/types/derived'
import { DERIVED_RESULT_TYPE_LABELS } from '@shared/types/derived'
import type { FormulaError } from '@shared/derived'

import { Button, Input, Select } from '../ui'
import { FormulaBuilder } from './FormulaBuilder'
import { FormulaTextEditor } from './FormulaTextEditor'

export interface LivePreview {
  value?: string | null
  type?: DerivedResultType
  error?: string
}

export interface DerivedVariableCardProps {
  def: DerivedVariableDef
  isActive: boolean
  errors: FormulaError[]
  preview: LivePreview | null
  onActivate(): void
  onChange(next: DerivedVariableDef): void
  onDelete(): void
}

export function DerivedVariableCard({
  def,
  isActive,
  errors,
  preview,
  onActivate,
  onChange,
  onDelete
}: DerivedVariableCardProps) {
  const [mode, setMode] = useState<'visual' | 'text'>('visual')

  const update = (patch: Partial<DerivedVariableDef>) => onChange({ ...def, ...patch })

  return (
    <article
      data-active={isActive ? 'true' : 'false'}
      className="grid gap-[var(--space-3)] rounded-[var(--radius-2)] border border-[var(--color-border-default)] bg-[var(--color-surface-base)] p-[var(--space-4)] transition-shadow duration-200 data-[active=true]:border-[var(--color-border-focus)] data-[active=true]:shadow-[var(--shadow-z1)]"
    >
      <div className="flex items-center justify-between gap-[var(--space-2)]">
        <h3 className="m-0 text-[length:var(--font-size-md)]">衍生变量 #{def.order + 1}</h3>
        <Button size="sm" variant="danger" onClick={onDelete}>删除</Button>
      </div>

      <div className="grid gap-[var(--space-3)] md:grid-cols-2">
        <Input
          label="变量名"
          value={def.variableName}
          onChange={(event) => update({ variableName: event.target.value })}
        />
        <Input
          label="标签"
          value={def.label}
          onChange={(event) => update({ label: event.target.value })}
        />
      </div>

      <div className="grid gap-[var(--space-3)] md:grid-cols-2">
        <Select
          label="结果类型"
          value={def.resultType}
          onValueChange={(value) => update({ resultType: value as DerivedResultType })}
          options={(Object.keys(DERIVED_RESULT_TYPE_LABELS) as DerivedResultType[]).map((type) => ({
            value: type,
            label: DERIVED_RESULT_TYPE_LABELS[type]
          }))}
        />
        {def.resultType === 'numeric' ? (
          <Select
            label="保留小数位"
            value={String(def.displayDecimals ?? 1)}
            onValueChange={(value) => update({ displayDecimals: Number(value) })}
            options={[
              { value: '0', label: '0 位' },
              { value: '1', label: '1 位' },
              { value: '2', label: '2 位' },
              { value: '3', label: '3 位' }
            ]}
          />
        ) : null}
      </div>

      <div className="grid gap-[var(--space-2)]">
        <div className="flex items-center gap-[var(--space-2)]">
          <span className="text-[length:var(--font-size-sm)] font-medium">编辑模式:</span>
          <Button size="sm" variant={mode === 'visual' ? 'primary' : 'secondary'} onClick={() => setMode('visual')}>
            可视化
          </Button>
          <Button size="sm" variant={mode === 'text' ? 'primary' : 'secondary'} onClick={() => setMode('text')}>
            高级（文本）
          </Button>
        </div>

        {mode === 'visual' ? (
          <FormulaBuilder formula={def.formula} onChange={(formula) => update({ formula })} />
        ) : (
          <FormulaTextEditor formula={def.formula} onChange={(formula) => update({ formula })} />
        )}

        {errors.length > 0 ? (
          <ul className="m-0 grid gap-[var(--space-1)] rounded-[var(--radius-1)] border border-[var(--color-danger)] bg-[var(--color-danger-light)] p-[var(--space-2)] text-[length:var(--font-size-xs)] text-[var(--color-danger)]">
            {errors.map((error) => (
              <li key={error.code}>{error.message}</li>
            ))}
          </ul>
        ) : null}

        {preview !== null ? (
          <p className="m-0 text-[length:var(--font-size-sm)] text-[var(--color-text-secondary)]">
            实时预览: {preview.error ?? (preview.value === null || preview.value === undefined ? '（缺少依赖变量，无法计算）' : `= ${preview.value}`)}
          </p>
        ) : null}
      </div>

      <button type="button" onClick={onActivate} className="sr-only">
        激活此衍生变量的公式编辑
      </button>
    </article>
  )
}
