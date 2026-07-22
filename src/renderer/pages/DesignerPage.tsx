import { useState, type FormEvent, type ReactElement } from 'react'
import { useStore } from 'zustand'

import { useCurrentRouteHandle } from '@renderer/app/route-metadata'
import { MilestonePage } from '@renderer/components/common/MilestonePage'
import {
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  EmptyState,
  Input,
  Modal,
  Select,
  useToast
} from '@renderer/components/ui'
import {
  createDesignerDemoStore,
  type DesignerDemoStore,
  type DesignerQuestion,
  type DesignerQuestionDraft,
  type DesignerQuestionType
} from '@renderer/stores/designer-demo-store'

const TYPE_LABELS: Record<DesignerQuestionType, string> = {
  single: '单选题',
  multiple: '多选题',
  text: '文本题'
}

const TYPE_OPTIONS = Object.entries(TYPE_LABELS).map(([value, label]) => ({ value, label }))

const EMPTY_DRAFT: DesignerQuestionDraft = {
  title: '',
  type: 'text',
  isKey: false,
  hasCondition: false
}

interface QuestionDialogProps {
  mode: 'add' | 'edit'
  initial: DesignerQuestionDraft
  trigger: ReactElement
  onCommit(draft: DesignerQuestionDraft): void
}

function QuestionDialog({ mode, initial, trigger, onCommit }: QuestionDialogProps) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(initial)
  const [error, setError] = useState<string>()
  const isAdd = mode === 'add'

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (nextOpen) {
      setDraft({ ...initial })
      setError(undefined)
    }
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const title = draft.title.trim()
    if (!title) {
      setError('请输入题目标题')
      return
    }
    onCommit({ ...draft, title })
    setOpen(false)
  }

  return (
    <Modal
      trigger={trigger}
      title={isAdd ? '新增题目' : '编辑题目'}
      description="所有更改只保存在当前演示内存中。"
      open={open}
      onOpenChange={handleOpenChange}
    >
      <form className="mt-[var(--space-4)] grid gap-[var(--space-4)]" onSubmit={submit}>
        <Input
          label="题目标题"
          aria-required="true"
          value={draft.title}
          error={error}
          onChange={(event) => {
            setDraft((current) => ({ ...current, title: event.target.value }))
            if (error) setError(undefined)
          }}
        />
        <Select
          label="题目类型"
          options={TYPE_OPTIONS}
          value={draft.type}
          onValueChange={(type) =>
            setDraft((current) => ({ ...current, type: type as DesignerQuestionType }))
          }
        />
        <div className="flex flex-wrap gap-[var(--space-4)]">
          <Checkbox
            label="关键题目（Key）"
            checked={draft.isKey}
            onCheckedChange={(checked) =>
              setDraft((current) => ({ ...current, isKey: checked === true }))
            }
          />
          <Checkbox
            label="包含显示条件"
            checked={draft.hasCondition}
            onCheckedChange={(checked) =>
              setDraft((current) => ({ ...current, hasCondition: checked === true }))
            }
          />
        </div>
        <div className="flex flex-wrap justify-end gap-[var(--space-3)]">
          <Button variant="secondary" onClick={() => setOpen(false)}>取消</Button>
          <Button type="submit">{isAdd ? '添加题目' : '保存修改'}</Button>
        </div>
      </form>
    </Modal>
  )
}

interface QuestionCardProps {
  question: Readonly<DesignerQuestion>
  selected: boolean
  onSelect(): void
  onUpdate(draft: DesignerQuestionDraft): void
  onRemove(): void
}

function QuestionCard({ question, selected, onSelect, onUpdate, onRemove }: QuestionCardProps) {
  const draft: DesignerQuestionDraft = {
    title: question.title,
    type: question.type,
    isKey: question.isKey,
    hasCondition: question.hasCondition
  }
  return (
    <article
      data-selected={selected ? 'true' : 'false'}
      className="grid gap-[var(--space-3)] rounded-[var(--radius-2)] border border-[var(--color-border-default)] bg-[var(--color-surface-base)] p-[var(--space-4)] data-[selected=true]:border-[var(--color-border-focus)] data-[selected=true]:shadow-[var(--shadow-z1)]"
    >
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-[var(--space-3)]">
        <div className="min-w-0 flex-1">
          <h2 className="m-0 break-words text-[length:var(--font-size-lg)]">{question.title}</h2>
          <div className="mt-[var(--space-2)] flex flex-wrap gap-[var(--space-2)]">
            <Badge variant="info">{TYPE_LABELS[question.type]}</Badge>
            {question.isKey ? <Badge variant="success">Key</Badge> : null}
            {question.hasCondition ? <Badge variant="warning">条件</Badge> : null}
          </div>
        </div>
        {selected ? <Badge variant="neutral">已选中</Badge> : null}
      </div>
      <div className="flex flex-wrap gap-[var(--space-2)]">
        <Button size="sm" variant="ghost" aria-pressed={selected} onClick={onSelect}>
          选择题目：{question.title}
        </Button>
        <QuestionDialog
          mode="edit"
          initial={draft}
          trigger={<Button size="sm" variant="secondary">编辑题目：{question.title}</Button>}
          onCommit={onUpdate}
        />
        <ConfirmDialog
          trigger={<Button size="sm" variant="danger">删除题目：{question.title}</Button>}
          title="删除题目"
          description={`将从当前内存演示中删除“${question.title}”。`}
          confirmLabel="确认删除"
          onConfirm={onRemove}
        />
      </div>
    </article>
  )
}

export interface DesignerPageProps {
  store?: DesignerDemoStore
}

export function DesignerPage({ store: injectedStore }: DesignerPageProps) {
  const [store] = useState(() => injectedStore ?? createDesignerDemoStore())
  const questions = useStore(store, (state) => state.questions)
  const selectedId = useStore(store, (state) => state.selectedId)
  const handle = useCurrentRouteHandle()
  const toast = useToast()

  if (handle === null) throw new Error('DESIGNER_ROUTE_METADATA_MISSING')

  const notifyNotSaved = (action: '保存' | '预览') => {
    toast.push({
      title: `${action}功能尚未保存`,
      description: `${action}将在后续里程碑实现；当前问卷只存在于本次演示内存中。`,
      tone: 'info'
    })
  }

  return (
    <MilestonePage
      title={handle.title}
      description={handle.description ?? '组织题目、规则与问卷结构。'}
      demoMessage="演示模式，未保存"
      actions={
        <>
          <Button variant="secondary" onClick={() => notifyNotSaved('预览')}>预览问卷</Button>
          <Button onClick={() => notifyNotSaved('保存')}>保存问卷</Button>
          <QuestionDialog
            mode="add"
            initial={EMPTY_DRAFT}
            trigger={<Button variant="secondary">新增题目</Button>}
            onCommit={(draft) => store.getState().addQuestion(draft)}
          />
        </>
      }
    >
      <section aria-label="问卷题目" className="grid min-w-0 gap-[var(--space-3)]">
        {questions.length === 0 ? (
          <EmptyState
            title="暂无题目"
            description="可以新增一道合成题目，所有内容在关闭或刷新页面后重置。"
            action={
              <QuestionDialog
                mode="add"
                initial={EMPTY_DRAFT}
                trigger={<Button>新增第一道题目</Button>}
                onCommit={(draft) => store.getState().addQuestion(draft)}
              />
            }
          />
        ) : (
          questions.map((question) => (
            <QuestionCard
              key={question.id}
              question={question}
              selected={selectedId === question.id}
              onSelect={() => store.getState().selectQuestion(question.id)}
              onUpdate={(draft) => store.getState().updateQuestion(question.id, draft)}
              onRemove={() => store.getState().removeQuestion(question.id)}
            />
          ))
        )}
      </section>
    </MilestonePage>
  )
}
