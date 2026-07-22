import { useId, useLayoutEffect, useRef, useState } from 'react'
import { useStore } from 'zustand'

import { useCurrentRouteHandle } from '@renderer/app/route-metadata'
import { MilestonePage } from '@renderer/components/common/MilestonePage'
import { Button, EmptyState, Input, Progress, Radio } from '@renderer/components/ui'
import {
  createEntryDemoStore,
  type EntryDemoStore
} from '@renderer/stores/entry-demo-store'

export interface EntryPageProps {
  store?: EntryDemoStore
}

export function EntryPage({ store: injectedStore }: EntryPageProps) {
  const [store] = useState(() => injectedStore ?? createEntryDemoStore())
  const questions = useStore(store, (state) => state.questions)
  const index = useStore(store, (state) => state.index)
  const answers = useStore(store, (state) => state.answers)
  const validationError = useStore(store, (state) => state.validationError)
  const completed = useStore(store, (state) => state.completed)
  const handle = useCurrentRouteHandle()
  const generatedId = useId()
  const errorId = `${generatedId}-error`
  const questionRegionRef = useRef<HTMLElement>(null)
  const completionRef = useRef<HTMLElement>(null)
  const shouldMoveFocusRef = useRef(false)

  const question = questions[index]

  useLayoutEffect(() => {
    if (!shouldMoveFocusRef.current) return
    shouldMoveFocusRef.current = false
    if (completed) {
      completionRef.current?.focus()
      return
    }
    questionRegionRef.current
      ?.querySelector<HTMLElement>('input:not(:disabled), [role="radio"]:not([disabled])')
      ?.focus()
  }, [completed, index])

  const moveNext = () => {
    shouldMoveFocusRef.current = store.getState().next()
  }

  const movePrevious = () => {
    shouldMoveFocusRef.current = true
    store.getState().previous()
  }

  const restart = () => {
    shouldMoveFocusRef.current = true
    store.getState().reset()
  }

  if (handle === null) throw new Error('ENTRY_ROUTE_METADATA_MISSING')

  return (
    <MilestonePage
      title={handle.title}
      description={handle.description ?? '以一题一屏方式完成现场录入。'}
      demoMessage="演示内存模式：刷新或离开页面可能丢失答案；内容不会提交或保存。"
    >
      {completed ? (
        <EmptyState
          ref={completionRef}
          role="status"
          aria-live="polite"
          aria-atomic="true"
          tabIndex={-1}
          className="focus:outline focus:outline-[3px] focus:outline-offset-[3px] focus:outline-[var(--color-border-focus)]"
          title="演示完成"
          description="本次答案仅存在于当前页面内存中，未提交、未保存，也未写入任何业务文件。"
          action={
            <div className="flex flex-wrap justify-center gap-[var(--space-3)]">
              <Button variant="secondary" onClick={movePrevious}>
                返回上一题
              </Button>
              <Button onClick={restart}>重新开始</Button>
            </div>
          }
        />
      ) : question ? (
        <section
          ref={questionRegionRef}
          aria-labelledby={`${generatedId}-question`}
          className="mx-auto grid w-full max-w-3xl gap-[var(--space-5)] rounded-[var(--radius-3)] border border-[var(--color-border-default)] bg-[var(--color-surface-base)] p-[var(--space-5)] shadow-[var(--shadow-z1)]"
        >
          <Progress
            label="录入进度"
            max={questions.length}
            value={index + 1}
            valueLabel={`${index + 1} / ${questions.length}`}
            valueText={`第 ${index + 1} 题，共 ${questions.length} 题`}
          />
          <div className="grid gap-[var(--space-3)]">
            <h2 id={`${generatedId}-question`} className="m-0 text-[length:var(--font-size-xl)]">
              {question.title}
              {question.required ? <span aria-hidden="true"> *</span> : null}
            </h2>
            {question.type === 'radio' ? (
              <div className="grid gap-[var(--space-2)]">
                <Radio
                  label={question.title}
                  options={question.options.map((option) => ({
                    ...option,
                    itemProps: {
                      className:
                        'focus:outline focus:outline-[3px] focus:outline-offset-[2px] focus:outline-[var(--color-border-focus)]'
                    }
                  }))}
                  value={answers[question.id] ?? ''}
                  onValueChange={(value) => store.getState().answer(question.id, value)}
                  aria-required={question.required}
                  aria-invalid={validationError ? true : undefined}
                  aria-describedby={validationError ? errorId : undefined}
                />
                {validationError ? (
                  <p
                    id={errorId}
                    role="alert"
                    className="m-0 text-[length:var(--font-size-sm)] font-[var(--font-weight-medium)] text-[var(--color-danger)]"
                  >
                    {validationError}
                  </p>
                ) : null}
              </div>
            ) : (
              <Input
                label={question.title}
                className="focus:outline focus:outline-[3px] focus:outline-offset-[2px] focus:outline-[var(--color-border-focus)]"
                required={question.required}
                hint={question.hint}
                value={answers[question.id] ?? ''}
                error={validationError ?? undefined}
                onChange={(event) => store.getState().answer(question.id, event.target.value)}
              />
            )}
          </div>
          <p className="m-0 text-[length:var(--font-size-sm)] text-[var(--color-text-secondary)]">
            键盘提示：使用 Tab 移动焦点；单选题可用方向键选择；按 Enter 激活按钮。
          </p>
          <div className="flex flex-wrap justify-between gap-[var(--space-3)]">
            <Button
              variant="secondary"
              disabled={index === 0}
              onClick={movePrevious}
            >
              上一题
            </Button>
            <Button onClick={moveNext}>
              {index === questions.length - 1 ? '完成演示' : '下一题'}
            </Button>
          </div>
        </section>
      ) : null}
    </MilestonePage>
  )
}
