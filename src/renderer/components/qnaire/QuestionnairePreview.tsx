import { useState, useId, useLayoutEffect, useRef } from 'react'

import { Button, Radio, Input, Progress, EmptyState, Badge, Checkbox } from '@renderer/components/ui'
import {
  type QuestionnaireDef,
  QUESTION_TYPE_LABELS,
  getVisibleQuestions
} from '@shared/types/qnaire'

interface QuestionnairePreviewProps {
  questionnaire: QuestionnaireDef
  onClose(): void
}

export function QuestionnairePreview({ questionnaire, onClose }: QuestionnairePreviewProps) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [completed, setCompleted] = useState(false)
  const generatedId = useId()
  const questionRef = useRef<HTMLElement>(null)

  const visibleQuestions = getVisibleQuestions(questionnaire, answers)
  const question = visibleQuestions[currentIndex]

  useLayoutEffect(() => {
    questionRef.current?.querySelector<HTMLElement>('input, [role="radio"]')?.focus()
  }, [currentIndex, completed])

  const setAnswer = (questionId: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [questionId]: value }))
  }

  const goNext = () => {
    if (currentIndex < visibleQuestions.length - 1) {
      setCurrentIndex(currentIndex + 1)
    } else {
      setCompleted(true)
    }
  }

  const goPrev = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1)
    }
  }

  const restart = () => {
    setCurrentIndex(0)
    setAnswers({})
    setCompleted(false)
  }

  if (completed) {
    return (
      <div className="mx-auto grid w-full max-w-3xl gap-[var(--space-5)] rounded-[var(--radius-3)] border border-[var(--color-border-default)] bg-[var(--color-surface-base)] p-[var(--space-5)] shadow-[var(--shadow-z1)]">
        <EmptyState
          role="status"
          aria-live="polite"
          title="预览完成"
          description="所有可见题目已回答完毕。以下是回答摘要。"
          action={
            <div className="flex flex-wrap justify-center gap-[var(--space-3)]">
              <Button variant="secondary" onClick={restart}>
                重新预览
              </Button>
              <Button onClick={onClose}>返回设计</Button>
            </div>
          }
        />
        <section className="grid gap-[var(--space-2)]">
          <h3 className="text-[length:var(--font-size-sm)] font-[var(--font-weight-semibold)]">回答摘要</h3>
          {visibleQuestions.map((q) => (
            <div
              key={q.id}
              className="flex justify-between rounded-[var(--radius-1)] border border-[var(--color-border-default)] p-[var(--space-2)] text-[length:var(--font-size-sm)]"
            >
              <span>{q.content}</span>
              <Badge variant="neutral">{answers[q.id] ?? '—'}</Badge>
            </div>
          ))}
        </section>
      </div>
    )
  }

  if (!question) {
    return (
      <EmptyState
        title="没有可见题目"
        description="问卷中没有可显示的题目。请检查条件规则设置。"
        action={<Button onClick={onClose}>返回设计</Button>}
      />
    )
  }

  return (
    <section
      ref={questionRef}
      aria-labelledby={`${generatedId}-question`}
      className="mx-auto grid w-full max-w-3xl gap-[var(--space-5)] rounded-[var(--radius-3)] border border-[var(--color-border-default)] bg-[var(--color-surface-base)] p-[var(--space-5)] shadow-[var(--shadow-z1)]"
    >
      <Progress
        label="预览进度"
        max={visibleQuestions.length}
        value={currentIndex + 1}
        valueLabel={`${currentIndex + 1} / ${visibleQuestions.length}`}
        valueText={`第 ${currentIndex + 1} 题，共 ${visibleQuestions.length} 题`}
      />
      <div className="grid gap-[var(--space-3)]">
        <div className="flex items-center gap-[var(--space-2)]">
          <h2 id={`${generatedId}-question`} className="m-0 text-[length:var(--font-size-xl)]">
            {question.content}
          </h2>
          {question.isKey && <Badge variant="success">Key</Badge>}
          <Badge variant="info">{QUESTION_TYPE_LABELS[question.type]}</Badge>
        </div>
        {question.type === 'single_choice' ? (
          <Radio
            label={question.content}
            options={question.options.map((opt) => ({ value: opt.value, label: opt.label }))}
            value={answers[question.id] ?? ''}
            onValueChange={(v) => setAnswer(question.id, v)}
          />
        ) : question.type === 'multiple_choice' ? (
          <div className="grid gap-[var(--space-2)]">
            {question.options.map((opt) => {
              const selected = (answers[question.id] ?? '').split(',').includes(opt.value)
              return (
                <label
                  key={opt.value}
                  className="flex cursor-pointer items-center gap-[var(--space-2)]"
                >
                  <Checkbox
                    label=""
                    checked={selected}
                    onCheckedChange={() => {
                      const current = (answers[question.id] ?? '').split(',').filter(Boolean)
                      const updated = selected
                        ? current.filter((v) => v !== opt.value)
                        : [...current, opt.value]
                      setAnswer(question.id, updated.join(','))
                    }}
                  />
                  <span>{opt.label}</span>
                </label>
              )
            })}
          </div>
        ) : (
          <Input
            label={question.content}
            value={answers[question.id] ?? ''}
            onChange={(e) => setAnswer(question.id, e.target.value)}
          />
        )}
      </div>
      <div className="flex flex-wrap justify-between gap-[var(--space-3)]">
        <Button variant="secondary" disabled={currentIndex === 0} onClick={goPrev}>
          上一题
        </Button>
        <div className="flex gap-[var(--space-2)]">
          <Button variant="secondary" onClick={onClose}>
            退出预览
          </Button>
          <Button onClick={goNext}>
            {currentIndex === visibleQuestions.length - 1 ? '完成预览' : '下一题'}
          </Button>
        </div>
      </div>
    </section>
  )
}
