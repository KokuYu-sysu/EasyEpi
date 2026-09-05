import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from 'zustand'

import { useCurrentRouteHandle } from '@renderer/app/route-metadata'
import { MilestonePage } from '@renderer/components/common/MilestonePage'
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  Modal,
  useToast
} from '@renderer/components/ui'
import {
  createQnaireStore,
  type QnaireStore
} from '@renderer/stores/qnaire.store'
import {
  QuestionEditDialog,
  questionToFormData,
  EMPTY_FORM_DATA,
  type QuestionFormData
} from '@renderer/components/qnaire/QuestionEditDialog'
import { ConditionRuleEditor } from '@renderer/components/qnaire/ConditionRuleEditor'
import { QuestionnairePreview } from '@renderer/components/qnaire/QuestionnairePreview'
import {
  QUESTION_TYPE_LABELS,
  type QuestionDef,
  type ConditionRule
} from '@shared/types/qnaire'

function createQuestionFromFormData(data: QuestionFormData, order: number): QuestionDef {
  return {
    id: crypto.randomUUID(),
    content: data.content,
    variableName: data.variableName,
    type: data.type,
    options: data.options.map((o) => ({ ...o })),
    constraint: { ...data.constraint },
    defaultValue: data.defaultValue || undefined,
    isKey: data.isKey,
    allowSkip: data.allowSkip,
    order
  }
}

interface QuestionRowProps {
  question: Readonly<QuestionDef>
  index: number
  total: number
  selected: boolean
  conditionRules: readonly Readonly<ConditionRule>[]
  allQuestions: readonly Readonly<QuestionDef>[]
  onSelect(): void
  onEdit(data: QuestionFormData): void
  onRemove(): void
  onMoveUp(): void
  onMoveDown(): void
  onToggleKey(): void
  onSaveConditionRule(rule: Omit<ConditionRule, 'id'>): void
}

function QuestionRow({
  question,
  index,
  total,
  selected,
  conditionRules,
  allQuestions,
  onSelect,
  onEdit,
  onRemove,
  onMoveUp,
  onMoveDown,
  onToggleKey,
  onSaveConditionRule
}: QuestionRowProps) {
  const questionRules = conditionRules.filter((r) => r.sourceQuestionId === question.id)
  const draft = questionToFormData(question)
  const hasOptions = question.type === 'single_choice' || question.type === 'multiple_choice'

  return (
    <article
      data-selected={selected ? 'true' : 'false'}
      role="button"
      tabIndex={0}
      aria-label={`题目 #${index + 1}: ${question.content}`}
      className="grid gap-[var(--space-3)] rounded-[var(--radius-2)] border border-[var(--color-border-default)] bg-[var(--color-surface-base)] p-[var(--space-4)] cursor-pointer transition-shadow duration-200 hover:shadow-[var(--shadow-z1)] data-[selected=true]:border-[var(--color-border-focus)] data-[selected=true]:shadow-[var(--shadow-z1)]"
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
    >
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-[var(--space-3)]">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-[var(--space-2)]">
            <span className="text-[length:var(--font-size-sm)] font-[var(--font-weight-semibold)] text-[var(--color-text-secondary)]">
              #{index + 1}
            </span>
            <h2 className="m-0 break-words text-[length:var(--font-size-lg)]">{question.content}</h2>
          </div>
          <div className="mt-[var(--space-1)] text-[length:var(--font-size-sm)] text-[var(--color-text-secondary)]">
            <code className="rounded-[var(--radius-1)] bg-[var(--color-surface-muted)] px-[var(--space-1)] py-px font-mono text-[length:var(--font-size-xs)]">
              {question.variableName}
            </code>
            {' · '}
            {QUESTION_TYPE_LABELS[question.type]}
            {hasOptions && question.options.length > 0 && (
              <span> · {question.options.map((o) => o.label).join('/')}</span>
            )}
            {question.constraint.type !== 'none' && (
              <span> · {question.constraint.type}</span>
            )}
          </div>
          <div className="mt-[var(--space-2)] flex flex-wrap gap-[var(--space-2)]">
            <Badge variant="info">{QUESTION_TYPE_LABELS[question.type]}</Badge>
            {question.isKey && <Badge variant="success">🔑 Key</Badge>}
            {questionRules.length > 0 && (
              <Badge variant="warning">🔗 {questionRules.length} 条条件规则</Badge>
            )}
            {question.allowSkip && <Badge variant="neutral">可跳过</Badge>}
          </div>
        </div>
        {selected && <Badge variant="neutral">已选中</Badge>}
      </div>

      {selected && (
        <div className="flex flex-wrap gap-[var(--space-2)] border-t border-[var(--color-border-default)] pt-[var(--space-3)]">
          <QuestionEditDialog
            mode="edit"
            initial={draft}
            existingVariableNames={allQuestions.map((q) => q.variableName).filter((n) => n !== question.variableName)}
            trigger={<Button size="sm" variant="secondary">编辑</Button>}
            onCommit={onEdit}
          />
          <Button size="sm" variant="ghost" onClick={onMoveUp} disabled={index === 0}>
            ↑ 上移
          </Button>
          <Button size="sm" variant="ghost" onClick={onMoveDown} disabled={index === total - 1}>
            ↓ 下移
          </Button>
          <ConditionRuleEditor
            sourceQuestion={question}
            allQuestions={allQuestions}
            existingRules={questionRules}
            trigger={<Button size="sm" variant="secondary">设置条件</Button>}
            onSave={onSaveConditionRule}
          />
          <Button size="sm" variant="ghost" onClick={onToggleKey}>
            {question.isKey ? '取消 Key' : '设为 Key'}
          </Button>
          <ConfirmDialog
            trigger={<Button size="sm" variant="danger">删除</Button>}
            title="删除题目"
            description={`确定删除题目 "${question.content}" 吗？相关条件规则也会被删除。`}
            confirmLabel="确认删除"
            onConfirm={onRemove}
          />
        </div>
      )}
    </article>
  )
}

export interface DesignerPageProps {
  store?: QnaireStore
}

export function DesignerPage({ store: injectedStore }: DesignerPageProps) {
  const [store] = useState(() => injectedStore ?? createQnaireStore())
  const navigate = useNavigate()
  const [showCompletionDialog, setShowCompletionDialog] = useState(false)
  const questions = useStore(store, (s) => s.questions)
  const conditionRules = useStore(store, (s) => s.conditionRules)
  const keyQuestionIds = useStore(store, (s) => s.keyQuestionIds)
  const selectedQuestionId = useStore(store, (s) => s.selectedQuestionId)
  const mode = useStore(store, (s) => s.mode)
  const projectName = useStore(store, (s) => s.projectName)
  const isLoading = useStore(store, (s) => s.isLoading)
  const error = useStore(store, (s) => s.error)
  const handle = useCurrentRouteHandle()
  const toast = useToast()

  useEffect(() => {
    if (mode === 'idle') {
      store.getState().loadFromIpc().catch(() => {
        // No project open yet, that's fine
      })
    }
  }, [mode, store])

  if (handle === null) throw new Error('DESIGNER_ROUTE_METADATA_MISSING')

  if (mode === 'previewing') {
    return (
      <QuestionnairePreview
        questionnaire={{
          name: projectName ?? '问卷',
          questions: [...questions],
          conditionRules: [...conditionRules],
          keyQuestionIds: [...keyQuestionIds]
        }}
        onClose={() => store.getState().setMode('designing')}
      />
    )
  }

  const handleAddQuestion = (data: QuestionFormData) => {
    const question = createQuestionFromFormData(data, questions.length)
    store.getState().addQuestion(question)
    toast.push({ title: '题目已添加', tone: 'success' })
  }

  const handleEditQuestion = (id: string, data: QuestionFormData) => {
    store.getState().updateQuestion(id, {
      content: data.content,
      variableName: data.variableName,
      type: data.type,
      options: data.options,
      constraint: data.constraint,
      defaultValue: data.defaultValue || undefined,
      isKey: data.isKey,
      allowSkip: data.allowSkip
    })
    toast.push({ title: '题目已更新', tone: 'success' })
  }

  const handleMoveQuestion = (fromIndex: number, direction: -1 | 1) => {
    store.getState().moveQuestion(fromIndex, fromIndex + direction)
  }

  const handleToggleKey = (questionId: string, isKey: boolean) => {
    store.getState().setKeyQuestion(questionId, !isKey)
    toast.push({ title: isKey ? '已取消 Key 标识' : '已设为 Key 标识', tone: 'info' })
  }

  const handleSaveConditionRule = (rule: Omit<ConditionRule, 'id'>) => {
    const fullRule: ConditionRule = { ...rule, id: crypto.randomUUID() }
    store.getState().addConditionRule(fullRule)
    toast.push({ title: '条件规则已添加', tone: 'success' })
  }

  const handleSave = async () => {
    try {
      await window.easyEpi.project.save({
        folderPath: store.getState().folderPath ?? ''
      })
      toast.push({ title: '问卷已保存', tone: 'success' })
    } catch {
      toast.push({ title: '保存失败', tone: 'danger' })
    }
  }

  const keyCount = keyQuestionIds.length

  return (
    <MilestonePage
      title={handle.title}
      description={handle.description ?? '生成和编辑题目，确定问卷逻辑和结构。'}
      demoMessage={mode === 'idle' ? '未打开项目，请先创建或打开项目。' : undefined}
      actions={
        <div className="flex flex-wrap gap-[var(--space-2)]">
          {mode === 'designing' && (
            <>
              <QuestionEditDialog
                mode="add"
                initial={EMPTY_FORM_DATA}
                existingVariableNames={questions.map((q) => q.variableName)}
                trigger={<Button variant="secondary">新增题目</Button>}
                onCommit={handleAddQuestion}
              />
              <Button
                variant="secondary"
                onClick={() => store.getState().setMode('previewing')}
                disabled={questions.length === 0}
              >
                预览问卷
              </Button>
              <Button onClick={handleSave}>保存问卷</Button>
              <Button
                onClick={() => setShowCompletionDialog(true)}
                disabled={questions.length === 0 || keyCount === 0}
              >
                完成问卷设计
              </Button>
              {keyCount > 0 && (
                <Badge variant="success" className="self-center">
                  🔑 {keyCount} 个 Key
                </Badge>
              )}
            </>
          )}
        </div>
      }
    >
      {error && (
        <div className="rounded-[var(--radius-2)] border border-[var(--color-danger)] bg-[var(--color-danger-light)] p-[var(--space-3)] text-[length:var(--font-size-sm)] text-[var(--color-danger)]">
          {error}
          <Button size="sm" variant="ghost" onClick={() => store.getState().setError(null)}>
            关闭
          </Button>
        </div>
      )}

      {isLoading ? (
        <div className="grid gap-[var(--space-3)]">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-[var(--radius-2)] bg-[var(--color-surface-muted)]" />
          ))}
        </div>
      ) : mode === 'idle' ? (
        <EmptyState
          title="未打开项目"
          description="请先从欢迎页创建或打开一个项目，然后返回此页面设计问卷。"
          illustration="empty"
        />
      ) : (
        <section aria-label="问卷题目" className="grid min-w-0 gap-[var(--space-3)]">
          {questions.length === 0 ? (
            <EmptyState
              title="暂无题目"
              description="点击「新增题目」开始设计问卷。"
              illustration="no-data"
              action={
                <QuestionEditDialog
                  mode="add"
                  initial={EMPTY_FORM_DATA}
                  existingVariableNames={[]}
                  trigger={<Button>新增第一道题目</Button>}
                  onCommit={handleAddQuestion}
                />
              }
            />
          ) : (
            questions.map((question, index) => (
              <QuestionRow
                key={question.id}
                question={question}
                index={index}
                total={questions.length}
                selected={selectedQuestionId === question.id}
                conditionRules={conditionRules}
                allQuestions={questions}
                onSelect={() => store.getState().selectQuestion(question.id)}
                onEdit={(data) => handleEditQuestion(question.id, data)}
                onRemove={() => store.getState().deleteQuestion(question.id)}
                onMoveUp={() => handleMoveQuestion(index, -1)}
                onMoveDown={() => handleMoveQuestion(index, 1)}
                onToggleKey={() => handleToggleKey(question.id, question.isKey)}
                onSaveConditionRule={handleSaveConditionRule}
              />
            ))
          )}
        </section>
      )}

      <Modal
        trigger={<Button className="sr-only">完成问卷设计对话框</Button>}
        title="问卷设计已完成"
        description="设计完成后可定义基于已有题目自动计算的衍生变量（如 BMI、年龄分组）。"
        open={showCompletionDialog}
        onOpenChange={(open) => { if (!open) setShowCompletionDialog(false) }}
      >
        <div className="grid gap-[var(--space-3)] pt-[var(--space-3)]">
          <dl className="m-0 grid gap-[var(--space-2)] rounded-[var(--radius-2)] bg-[var(--color-surface-muted)] p-[var(--space-3)]">
            <div className="flex justify-between">
              <dt>题目总数</dt>
              <dd className="m-0 font-semibold">{questions.length} 题</dd>
            </div>
            <div className="flex justify-between">
              <dt>Key 字段</dt>
              <dd className="m-0 font-semibold">{keyCount} 个</dd>
            </div>
            <div className="flex justify-between">
              <dt>条件规则</dt>
              <dd className="m-0 font-semibold">{conditionRules.length} 条</dd>
            </div>
          </dl>
          <p className="m-0 text-[length:var(--font-size-sm)] text-[var(--color-text-secondary)]">
            衍生变量在录入时自动计算，无需手动填写；导出时作为普通列输出。
          </p>
          <div className="flex justify-end gap-[var(--space-2)]">
            <Button variant="secondary" onClick={() => setShowCompletionDialog(false)}>跳过</Button>
            <Button onClick={() => { setShowCompletionDialog(false); navigate('/derived') }}>定义衍生变量</Button>
          </div>
        </div>
      </Modal>
    </MilestonePage>
  )
}
