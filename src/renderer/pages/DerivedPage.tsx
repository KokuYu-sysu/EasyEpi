import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import 'katex/dist/katex.min.css'

import { useCurrentRouteHandle } from '@renderer/app/route-metadata'
import { MilestonePage } from '@renderer/components/common/MilestonePage'
import { Button, EmptyState } from '@renderer/components/ui'
import { DerivedVariableCard, type LivePreview } from '@renderer/components/derived/DerivedVariableCard'
import { VariableChip } from '@renderer/components/derived/VariableChip'
import type { DerivedVariableDef } from '@shared/types/derived'
import { DERIVED_RESULT_TYPE_LABELS } from '@shared/types/derived'
import type { FormulaError } from '@shared/derived'
import type { QuestionDef } from '@shared/types/qnaire'

function createDraftCard(cards: DerivedVariableDef[]): DerivedVariableDef {
  const nextOrder = cards.reduce((max, card) => Math.max(max, card.order), -1) + 1
  return {
    id: crypto.randomUUID(),
    variableName: '',
    label: '',
    formula: '',
    resultType: 'numeric',
    order: nextOrder
  }
}

export function DerivedPage() {
  const navigate = useNavigate()
  const handle = useCurrentRouteHandle()
  const [questions, setQuestions] = useState<QuestionDef[]>([])
  const [cards, setCards] = useState<DerivedVariableDef[]>([])
  const [originalIds, setOriginalIds] = useState<Set<string>>(new Set())
  const [activeId, setActiveId] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, FormulaError[]>>({})
  const [previews, setPreviews] = useState<Record<string, LivePreview | null>>({})
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const validateTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const pendingDeletes = useRef<Set<string>>(new Set())
  const sampleRef = useRef<Record<string, unknown> | null>(null)
  if (handle === null) throw new Error('DERIVED_ROUTE_METADATA_MISSING')

  const runValidation = useCallback(async (card: DerivedVariableDef) => {
    const validation = await window.easyEpi.derived.validate({ formula: card.formula })
    setErrors((current) => ({
      ...current,
      [card.id]: validation.ok ? [] : (validation.errors ?? [])
    }))
    const currentSample = sampleRef.current
    if (currentSample !== null && card.formula.trim().length > 0) {
      const preview = await window.easyEpi.derived.preview({
        formula: card.formula,
        sampleAnswers: currentSample
      })
      setPreviews((current) => ({ ...current, [card.id]: preview }))
    }
  }, [])

  useEffect(() => {
    let active = true
    void Promise.all([
      window.easyEpi.qnaire.getData(),
      window.easyEpi.derived.getAll(),
      window.easyEpi.record.list(0, 1)
    ])
      .then(([questionnaire, derivedResult, recordResult]) => {
        if (!active) return
        setQuestions(questionnaire.questions)
        const list = derivedResult.ok ? derivedResult.derivedVariables : []
        setCards(list)
        setOriginalIds(new Set(list.map((card) => card.id)))
        setActiveId(list[0]?.id ?? null)
        sampleRef.current = recordResult.records[0]?.answers ?? null
        setLoading(false)
        return list
      })
      .then((list) => {
        if (!list) return
        for (const card of list) {
          void runValidation(card)
        }
      })
      .catch(() => {
        if (active) {
          setLoading(false)
          setMessage('加载衍生变量失败：请确认已打开项目。')
        }
      })
    return () => {
      active = false
      if (validateTimer.current !== undefined) clearTimeout(validateTimer.current)
    }
  }, [runValidation])

  const handleChange = (card: DerivedVariableDef) => {
    setCards((current) => current.map((item) => (item.id === card.id ? card : item)))
    if (validateTimer.current !== undefined) clearTimeout(validateTimer.current)
    validateTimer.current = setTimeout(() => {
      void runValidation(card)
    }, 400)
  }

  const handleInsertVariable = (variableName: string) => {
    let active = cards.find((card) => card.id === activeId)
    if (!active) {
      const draft = createDraftCard(cards)
      setCards((current) => [...current, draft])
      setActiveId(draft.id)
      active = draft
    }
    handleChange({ ...active, formula: `${active.formula}{${variableName}}` })
  }

  const handleAdd = () => {
    const draft = createDraftCard(cards)
    setCards((current) => [...current, draft])
    setActiveId(draft.id)
  }

  const handleDelete = (id: string) => {
    if (originalIds.has(id)) pendingDeletes.current.add(id)
    setCards((current) => current.filter((card) => card.id !== id))
    setActiveId((current) => (current === id ? null : current))
  }

  const handleSave = async () => {
    for (const card of cards) {
      if (card.variableName.trim().length === 0 || card.label.trim().length === 0 || card.formula.trim().length === 0) {
        setMessage('请完整填写每个衍生变量的变量名、标签和公式。')
        return
      }
    }
    setSaving(true)
    setMessage(null)
    try {
      for (const card of cards) {
        if (originalIds.has(card.id)) {
          const result = await window.easyEpi.derived.update(card.id, {
            variableName: card.variableName,
            label: card.label,
            formula: card.formula,
            resultType: card.resultType,
            displayDecimals: card.displayDecimals
          })
          if (!result.ok) throw new Error(result.errors?.[0]?.message ?? '衍生变量校验失败')
        } else {
          const result = await window.easyEpi.derived.add({
            variableName: card.variableName,
            label: card.label,
            formula: card.formula,
            resultType: card.resultType,
            ...(card.displayDecimals === undefined ? {} : { displayDecimals: card.displayDecimals })
          })
          if (!result.ok) throw new Error(result.errors?.[0]?.message ?? '衍生变量校验失败')
        }
      }
      for (const id of pendingDeletes.current) {
        await window.easyEpi.derived.delete(id)
      }

      // Reconcile client card ids with the server-assigned ids, so subsequent
      // saves update (rather than re-add or mis-reorder) the same variables.
      const list = await window.easyEpi.derived.getAll()
      if (!list.ok) throw new Error('读取衍生变量失败')
      const idByVariableName = new Map(
        list.derivedVariables.map((variable) => [variable.variableName, variable.id])
      )
      setCards((current) => current.map((card) => ({
        ...card,
        id: idByVariableName.get(card.variableName) ?? card.id
      })))
      setOriginalIds(new Set(list.derivedVariables.map((variable) => variable.id)))

      const saved = await window.easyEpi.project.save({ folderPath: '' })
      if (!saved.ok) throw new Error(saved.error ?? '保存项目失败')
      pendingDeletes.current = new Set()
      setMessage('衍生变量已保存到项目。')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存失败，请检查输入。')
    } finally {
      setSaving(false)
    }
  }

  const summary =
    cards.length > 0
      ? cards.map((card) => `${card.variableName || '（未命名）'} (${DERIVED_RESULT_TYPE_LABELS[card.resultType]})`).join(', ')
      : ''

  return (
    <MilestonePage
      title={handle.title}
      description={handle.description ?? '基于已有题目通过公式自动计算变量。'}
      actions={
        <div className="flex flex-wrap gap-[var(--space-2)]">
          <Button variant="secondary" onClick={() => navigate('/designer')}>返回设计</Button>
          <Button loading={saving} onClick={() => void handleSave()}>保存并完成</Button>
        </div>
      }
    >
      {message ? <p role="status" aria-live="polite" className="m-0">{message}</p> : null}

      {loading ? (
        <div className="grid gap-[var(--space-3)]">
          {Array.from({ length: 2 }, (_, index) => (
            <div key={index} className="h-32 animate-pulse rounded-[var(--radius-2)] bg-[var(--color-surface-muted)]" />
          ))}
        </div>
      ) : questions.length === 0 ? (
        <EmptyState
          title="尚未创建题目"
          description="请先返回问卷设计页添加题目，再定义衍生变量。"
          action={<Button onClick={() => navigate('/designer')}>返回问卷设计</Button>}
        />
      ) : (
        <div className="grid gap-[var(--space-4)]">
          <section aria-label="可用变量" className="grid gap-[var(--space-2)]">
            <h2 className="m-0 text-[length:var(--font-size-md)]">可用变量（点击插入当前公式）</h2>
            <p className="m-0 text-[length:var(--font-size-xs)] text-[var(--color-text-secondary)]">
              点击变量卡片将 {`{变量名}`} 插入当前公式；若尚未添加衍生变量则自动新建。
            </p>
            <div className="flex flex-wrap gap-[var(--space-2)]">
              {questions.map((question) => (
                <VariableChip
                  key={question.id}
                  question={question}
                  disabled={false}
                  onInsert={handleInsertVariable}
                />
              ))}
            </div>
          </section>

          <section aria-label="已定义衍生变量" className="grid gap-[var(--space-3)]">
            {cards.length === 0 ? (
              <EmptyState
                title="暂无衍生变量"
                description="点击下方按钮添加，例如 BMI = {weight} / ({height}/100)^2。"
                action={<Button onClick={handleAdd}>添加衍生变量</Button>}
              />
            ) : (
              cards.map((card) => (
                <DerivedVariableCard
                  key={card.id}
                  def={card}
                  isActive={activeId === card.id}
                  errors={errors[card.id] ?? []}
                  preview={previews[card.id] ?? null}
                  onActivate={() => setActiveId(card.id)}
                  onChange={handleChange}
                  onDelete={() => handleDelete(card.id)}
                />
              ))
            )}
            <div>
              <Button variant="secondary" onClick={handleAdd}>+ 添加衍生变量</Button>
            </div>
          </section>

          {summary.length > 0 ? (
            <p className="m-0 rounded-[var(--radius-1)] bg-[var(--color-surface-muted)] p-[var(--space-3)] text-[length:var(--font-size-sm)]">
              导出时将新增 {cards.length} 列: {summary}
            </p>
          ) : null}
        </div>
      )}
    </MilestonePage>
  )
}
