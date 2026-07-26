import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from 'zustand'

import { useCurrentRouteHandle } from '@renderer/app/route-metadata'
import { Button, EmptyState, Progress } from '@renderer/components/ui'
import { QuestionCard } from '@renderer/components/entry/QuestionCard'
import { createEntryStore, type EntryStore } from '@renderer/stores/entry.store'

export interface EntryPageProps {
  store?: EntryStore
}

export function EntryPage({ store: injectedStore }: EntryPageProps) {
  const [store] = useState(() => injectedStore ?? createEntryStore())
  const state = useStore(store)
  const navigate = useNavigate()
  const handle = useCurrentRouteHandle()
  const questionRegionRef = useRef<HTMLDivElement>(null)
  const shouldMoveFocusRef = useRef(false)

  const {
    phase,
    visibleQuestions,
    currentIndex,
    answers,
    validationError,
    batchCount,
    isLoading,
    error,
    lastSubmitError
  } = state

  const questionnaire = state.questionnaire

  // Load questionnaire on mount
  useEffect(() => {
    store.getState().loadQuestionnaire()
  }, [store])

  // Focus management
  useLayoutEffect(() => {
    if (!shouldMoveFocusRef.current) return
    shouldMoveFocusRef.current = false
    questionRegionRef.current
      ?.querySelector<HTMLElement>(
        'input:not(:disabled), [role="radio"]:not([disabled]), textarea'
      )
      ?.focus()
  }, [currentIndex, phase])

  const handleNext = useCallback(() => {
    shouldMoveFocusRef.current = true
    store.getState().goNext()
  }, [store])

  const handlePrev = useCallback(() => {
    shouldMoveFocusRef.current = true
    store.getState().goPrev()
  }, [store])

  const handleSkip = useCallback(() => {
    shouldMoveFocusRef.current = true
    store.getState().skipQuestion()
  }, [store])

  const handleSubmit = useCallback(async () => {
    const success = await store.getState().submitRecord()
    if (success) {
      store.getState().confirmSubmit()
    }
  }, [store])

  const handleStartNext = useCallback(() => {
    shouldMoveFocusRef.current = true
    store.getState().startNextRecord()
  }, [store])

  const handleEndWork = useCallback(() => {
    store.getState().endWork()
    navigate('/')
  }, [store, navigate])

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (phase !== 'entering') return
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault()
          handleNext()
        }
        return
      }

      // Number keys for single choice
      if (e.key >= '1' && e.key <= '9') {
        const question = visibleQuestions[currentIndex]
        if (question?.type === 'single_choice') {
          const optIndex = parseInt(e.key) - 1
          if (optIndex < question.options.length) {
            store.getState().setAnswer(question.id, question.options[optIndex]!.value)
            e.preventDefault()
          }
        }
      }

      if (e.key === 'Enter') {
        e.preventDefault()
        handleNext()
      }
      if (e.key === 'Backspace') {
        e.preventDefault()
        handlePrev()
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        handleEndWork()
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [phase, visibleQuestions, currentIndex, handleNext, handlePrev, handleEndWork, store])

  if (handle === null) throw new Error('ENTRY_ROUTE_METADATA_MISSING')

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-[var(--space-8)]">
        <p className="text-[var(--color-text-secondary)]">加载问卷中...</p>
      </div>
    )
  }

  if (error) {
    return (
      <EmptyState
        title="加载失败"
        description={error}
        action={
          <Button onClick={() => store.getState().loadQuestionnaire()}>重试</Button>
        }
      />
    )
  }

  if (phase === 'idle') {
    if (!questionnaire) {
      return (
        <EmptyState
          title="请先打开项目"
          description="尚未打开任何问卷项目。请先在欢迎页新建或打开一个项目后再进行录入。"
          action={
            <Button onClick={() => navigate('/')}>前往欢迎页</Button>
          }
        />
      )
    }
    return (
      <EmptyState
        title="准备录入"
        description={`已加载问卷「${questionnaire.name}」，共 ${visibleQuestions.length} 题。批次已录入: ${batchCount} 份`}
        action={
          <div className="flex gap-[var(--space-3)]">
            <Button
              onClick={() => {
                shouldMoveFocusRef.current = true
                store.getState().startEntry()
              }}
            >
              开始录入
            </Button>
            <Button variant="secondary" onClick={() => navigate('/')}>
              返回
            </Button>
          </div>
        }
      />
    )
  }

  if (phase === 'confirming') {
    const keyQuestions = state.questionnaire?.questions.filter((q) => q.isKey) ?? []
    return (
      <section
        className="mx-auto grid w-full max-w-3xl gap-[var(--space-5)] rounded-[var(--radius-3)] border border-[var(--color-border-default)] bg-[var(--color-surface-base)] p-[var(--space-5)] shadow-[var(--shadow-z1)]"
        aria-labelledby="confirm-heading"
      >
        <h2 id="confirm-heading" className="m-0 text-[length:var(--font-size-xl)]">
          确认提交
        </h2>
        <p className="m-0 text-[var(--color-text-secondary)]">请核对以下关键信息后再提交：</p>
        <div className="grid gap-[var(--space-2)] rounded-[var(--radius-2)] border border-[var(--color-border-default)] p-[var(--space-4)]">
          {keyQuestions.map((q) => (
            <div key={q.id} className="flex justify-between">
              <span className="text-[var(--color-text-secondary)]">{q.content}</span>
              <span className="font-[var(--font-weight-medium)]">
                {answers[q.id] ?? '-'}
              </span>
            </div>
          ))}
          {keyQuestions.length === 0 ? (
            <p className="m-0 text-[var(--color-text-tertiary)]">未设置 Key 标识符</p>
          ) : null}
        </div>
        {lastSubmitError ? (
          <p
            role="alert"
            className="m-0 text-[length:var(--font-size-sm)] font-[var(--font-weight-medium)] text-[var(--color-danger)]"
          >
            {lastSubmitError === 'KEY_DUPLICATE'
              ? 'Key 标识符重复，请返回修改'
              : `提交失败: ${lastSubmitError}`}
          </p>
        ) : null}
        <div className="flex flex-wrap justify-between gap-[var(--space-3)]">
          <Button variant="secondary" onClick={handlePrev}>
            返回修改
          </Button>
          <Button onClick={handleSubmit}>确认提交</Button>
        </div>
      </section>
    )
  }

  if (phase === 'submitted' || phase === 'work_end') {
    return (
      <EmptyState
        title="记录已保存"
        description={`本次已录入: ${batchCount} 份`}
        action={
          <div className="flex gap-[var(--space-3)]">
            <Button onClick={handleStartNext}>开始下一份</Button>
            <Button variant="secondary" onClick={handleEndWork}>
              结束工作
            </Button>
          </div>
        }
      />
    )
  }

  // Entering phase
  const currentQuestion = visibleQuestions[currentIndex]
  if (!currentQuestion) {
    return <EmptyState title="没有可见题目" description="所有题目均被条件规则跳过。" />
  }

  const progressValue = currentIndex + 1
  const progressMax = visibleQuestions.length

  return (
    <div className="grid gap-[var(--space-4)]">
      <Progress
        label="录入进度"
        max={progressMax}
        value={progressValue}
        valueLabel={`${progressValue} / ${progressMax}`}
        valueText={`第 ${progressValue} 题，共 ${progressMax} 题`}
      />
      <div ref={questionRegionRef}>
        <QuestionCard
          question={currentQuestion}
          questionIndex={currentIndex}
          totalVisible={visibleQuestions.length}
          value={answers[currentQuestion.id] ?? ''}
          onChange={(v) => store.getState().setAnswer(currentQuestion.id, v)}
          error={validationError ?? undefined}
        />
      </div>
      <p className="m-0 text-center text-[length:var(--font-size-sm)] text-[var(--color-text-secondary)]">
        键盘: 1-9 选择选项 | Enter 下一题 | Backspace 上一题 | Esc 结束
      </p>
      <div className="flex flex-wrap justify-between gap-[var(--space-3)]">
        <Button variant="secondary" disabled={currentIndex === 0} onClick={handlePrev}>
          上一题
        </Button>
        <div className="flex gap-[var(--space-2)]">
          {currentQuestion.allowSkip ? (
            <Button variant="ghost" onClick={handleSkip}>
              不想回答
            </Button>
          ) : null}
          <Button onClick={handleNext}>
            {currentIndex >= visibleQuestions.length - 1 ? '完成录入' : '下一题'}
          </Button>
        </div>
      </div>
    </div>
  )
}
