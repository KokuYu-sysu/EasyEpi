import { useState, type ReactElement } from 'react'

import { Modal, Button, Input, Select, Checkbox, Badge } from '@renderer/components/ui'
import {
  CONDITION_OPERATOR_LABELS,
  type ConditionRule,
  type ConditionDef,
  type ConditionOperator,
  type ConditionLogic,
  type ConditionAction,
  type QuestionDef
} from '@shared/types/qnaire'

const OPERATOR_OPTIONS = Object.entries(CONDITION_OPERATOR_LABELS).map(([value, label]) => ({
  value,
  label
}))

const LOGIC_OPTIONS = [
  { value: 'AND', label: '且 (AND)' },
  { value: 'OR', label: '或 (OR)' }
]

const ACTION_OPTIONS = [
  { value: 'skip', label: '跳过（隐藏）' },
  { value: 'show', label: '显示' },
  { value: 'require', label: '必填' }
]

interface ConditionRuleEditorProps {
  sourceQuestion: QuestionDef
  allQuestions: readonly Readonly<QuestionDef>[]
  existingRules: readonly Readonly<ConditionRule>[]
  trigger: ReactElement
  onSave(rule: Omit<ConditionRule, 'id'>): void
}

export function ConditionRuleEditor({
  sourceQuestion,
  allQuestions,
  existingRules,
  trigger,
  onSave
}: ConditionRuleEditorProps) {
  const [open, setOpen] = useState(false)
  const [conditions, setConditions] = useState<ConditionDef[]>([
    { questionId: sourceQuestion.id, operator: 'equals', value: '' }
  ])
  const [logic, setLogic] = useState<ConditionLogic>('AND')
  const [action, setAction] = useState<ConditionAction>('skip')
  const [targetIds, setTargetIds] = useState<string[]>([])

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (nextOpen) {
      setConditions([{ questionId: sourceQuestion.id, operator: 'equals', value: '' }])
      setLogic('AND')
      setAction('skip')
      setTargetIds([])
    }
  }

  const addCondition = () => {
    setConditions([...conditions, { questionId: sourceQuestion.id, operator: 'equals', value: '' }])
  }

  const removeCondition = (index: number) => {
    setConditions(conditions.filter((_, i) => i !== index))
  }

  const updateCondition = (index: number, patch: Partial<ConditionDef>) => {
    setConditions(conditions.map((c, i) => (i === index ? { ...c, ...patch } : c)))
  }

  const toggleTarget = (id: string) => {
    setTargetIds((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]))
  }

  const handleSave = () => {
    if (conditions.length === 0 || targetIds.length === 0) return
    onSave({
      sourceQuestionId: sourceQuestion.id,
      conditions,
      logic,
      action,
      targetQuestionIds: targetIds
    })
    setOpen(false)
  }

  const availableTargets = allQuestions.filter(
    (q) => q.id !== sourceQuestion.id && q.order > sourceQuestion.order
  )

  return (
    <Modal
      trigger={trigger}
      title={`条件规则 — ${sourceQuestion.content}`}
      description="设置满足条件时的动作和目标题目。"
      open={open}
      onOpenChange={handleOpenChange}
    >
      <div className="mt-[var(--space-4)] grid max-h-[70vh] gap-[var(--space-4)] overflow-y-auto pr-[var(--space-2)]">
        <section className="grid gap-[var(--space-3)]">
          <h3 className="text-[length:var(--font-size-sm)] font-[var(--font-weight-semibold)] text-[var(--color-text-primary)]">
            触发条件
          </h3>
          {conditions.map((cond, index) => (
            <div key={index} className="grid gap-[var(--space-2)] rounded-[var(--radius-2)] border border-[var(--color-border-default)] p-[var(--space-3)]">
              <div className="flex flex-wrap items-center gap-[var(--space-2)]">
                {index > 0 && (
                  <Select
                    label=""
                    aria-label="逻辑连接"
                    options={LOGIC_OPTIONS}
                    value={logic}
                    onValueChange={(v) => setLogic(v as ConditionLogic)}
                  />
                )}
                <span className="text-[length:var(--font-size-sm)] text-[var(--color-text-secondary)]">
                  当
                </span>
                <Select
                  label=""
                  aria-label="触发题目"
                  options={allQuestions.map((q) => ({ value: q.id, label: `#${q.order + 1} ${q.content}` }))}
                  value={cond.questionId}
                  onValueChange={(v) => updateCondition(index, { questionId: v })}
                />
                <Select
                  label=""
                  aria-label="操作符"
                  options={OPERATOR_OPTIONS}
                  value={cond.operator}
                  onValueChange={(v) => updateCondition(index, { operator: v as ConditionOperator })}
                />
                {cond.operator !== 'is_empty' && cond.operator !== 'is_not_empty' && (
                  <Input
                    label=""
                    aria-label="比较值"
                    className="w-32"
                    value={cond.value}
                    onChange={(e) => updateCondition(index, { value: e.target.value })}
                  />
                )}
                {conditions.length > 1 && (
                  <Button size="sm" variant="danger" onClick={() => removeCondition(index)}>
                    ✕
                  </Button>
                )}
              </div>
            </div>
          ))}
          <Button size="sm" variant="secondary" onClick={addCondition}>
            + 添加条件
          </Button>
        </section>

        <section className="grid gap-[var(--space-3)]">
          <h3 className="text-[length:var(--font-size-sm)] font-[var(--font-weight-semibold)] text-[var(--color-text-primary)]">
            执行动作
          </h3>
          <Select
            label="动作类型"
            options={ACTION_OPTIONS}
            value={action}
            onValueChange={(v) => setAction(v as ConditionAction)}
          />
        </section>

        <section className="grid gap-[var(--space-3)]">
          <h3 className="text-[length:var(--font-size-sm)] font-[var(--font-weight-semibold)] text-[var(--color-text-primary)]">
            目标题目
          </h3>
          {availableTargets.length === 0 ? (
            <p className="text-[length:var(--font-size-sm)] text-[var(--color-text-secondary)]">
              没有可选的目标题目（后续题目）
            </p>
          ) : (
            <div className="grid gap-[var(--space-1)]">
              {availableTargets.map((q) => (
                <label
                  key={q.id}
                  className="flex cursor-pointer items-center gap-[var(--space-2)] rounded-[var(--radius-1)] p-[var(--space-1)] hover:bg-[var(--color-surface-hover)]"
                >
                  <Checkbox
                    label=""
                    checked={targetIds.includes(q.id)}
                    onCheckedChange={() => toggleTarget(q.id)}
                  />
                  <span className="text-[length:var(--font-size-sm)]">
                    #{q.order + 1} {q.content}
                  </span>
                  <Badge variant="info" className="ml-auto">
                    {q.variableName}
                  </Badge>
                </label>
              ))}
            </div>
          )}
        </section>

        {existingRules.length > 0 && (
          <section className="grid gap-[var(--space-2)]">
            <h3 className="text-[length:var(--font-size-sm)] font-[var(--font-weight-semibold)] text-[var(--color-text-primary)]">
              已有规则
            </h3>
            {existingRules.map((rule) => {
              const targets = rule.targetQuestionIds
                .map((id) => allQuestions.find((q) => q.id === id)?.variableName ?? id)
                .join(', ')
              const condText = rule.conditions
                .map((c) => {
                  const q = allQuestions.find((q) => q.id === c.questionId)
                  return `${q?.variableName ?? c.questionId} ${CONDITION_OPERATOR_LABELS[c.operator]} ${c.value}`
                })
                .join(` ${rule.logic} `)
              return (
                <div
                  key={rule.id}
                  className="rounded-[var(--radius-1)] border border-[var(--color-border-default)] p-[var(--space-2)] text-[length:var(--font-size-sm)]"
                >
                  <Badge variant="warning">{rule.action === 'skip' ? '跳过' : rule.action === 'show' ? '显示' : '必填'}</Badge>{' '}
                  IF {condText} → {targets}
                </div>
              )
            })}
          </section>
        )}

        <div className="flex flex-wrap justify-end gap-[var(--space-3)]">
          <Button variant="secondary" onClick={() => setOpen(false)}>
            取消
          </Button>
          <Button onClick={handleSave} disabled={conditions.length === 0 || targetIds.length === 0}>
            保存规则
          </Button>
        </div>
      </div>
    </Modal>
  )
}
