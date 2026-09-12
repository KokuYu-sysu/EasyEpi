import { Bot } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { Badge, Card, CardContent, CardHeader, CardTitle } from '@renderer/components/ui'
import { aiProgressStageLabel } from '@renderer/components/ai/ai-errors'
import type {
  AIPublicAttemptFailure,
  AIProgressStage
} from '@shared/ai-assistant-contract'

export interface AIRunProgressState {
  stage: AIProgressStage
  attempt: 1 | 2 | 3
  startedAt: string
  updatedAt: string
  streamFallback: boolean
  responseFormatFallback: boolean
  toolCallingFallback: boolean
  provisionalText: string
  rejectedAttempts: AIPublicAttemptFailure[]
}

interface AIRunProgressProps {
  run: AIRunProgressState
}

function elapsedSeconds(startedAt: string, now: number): number {
  const start = Date.parse(startedAt)
  return Number.isFinite(start) ? Math.max(0, Math.floor((now - start) / 1000)) : 0
}

export function AIRunProgress({ run }: AIRunProgressProps) {
  const [now, setNow] = useState(() => Date.now())
  const terminal = run.stage === 'completed' || run.stage === 'failed' || run.stage === 'cancelled' ||
    run.stage === 'clarification'

  useEffect(() => {
    if (terminal) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [terminal])

  const elapsed = useMemo(() => elapsedSeconds(run.startedAt, now), [now, run.startedAt])
  const label = aiProgressStageLabel(run.stage, run.attempt)
  const badgeVariant = run.stage === 'failed'
    ? 'danger'
    : run.stage === 'completed' || run.stage === 'clarification'
      ? 'success'
      : run.stage === 'cancelled' ? 'neutral' : 'info'

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between">
        <CardTitle className="text-[length:var(--font-size-lg)]">生成进度</CardTitle>
        <Badge variant={badgeVariant}>
          {label}
        </Badge>
      </CardHeader>
      <CardContent className="grid gap-[var(--space-3)]">
        <p
          className="m-0 text-[var(--color-text-secondary)]"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {label}
        </p>
        <p className="m-0 text-[var(--color-text-secondary)]">已用时 {elapsed} 秒</p>
        {run.streamFallback ? (
          <p className="m-0 rounded-[var(--radius-1)] bg-[var(--color-info-soft)] p-[var(--space-2)] text-[var(--color-text-secondary)]">
            当前服务不支持流式返回，已自动改用兼容模式；结果仍会在本地校验。
          </p>
        ) : null}
        {run.responseFormatFallback ? (
          <p className="m-0 rounded-[var(--radius-1)] bg-[var(--color-info-soft)] p-[var(--space-2)] text-[var(--color-text-secondary)]">
            当前服务不支持结构化响应格式，已自动改用兼容模式并保留本地校验。
          </p>
        ) : null}
        {run.toolCallingFallback ? (
          <p className="m-0 rounded-[var(--radius-1)] bg-[var(--color-info-soft)] p-[var(--space-2)] text-[var(--color-text-secondary)]">
            当前模型不支持函数调用，已改用兼容的 JSON 响应；结果仍会在本地校验。
          </p>
        ) : null}
        {run.rejectedAttempts.length > 0 ? (
          <ul className="m-0 grid gap-[var(--space-1)] pl-[var(--space-5)] text-[var(--color-text-secondary)]">
            {run.rejectedAttempts.map((failure) => (
              <li key={failure.attempt} className="grid gap-[var(--space-1)]">
                <span>第 {failure.attempt} 次尝试未通过本地校验</span>
                <span className="text-[length:var(--font-size-sm)]">
                  发现 {failure.issues.length} 个问题
                </span>
                {failure.truncated ? (
                  <span className="text-[length:var(--font-size-sm)]">另有问题未显示</span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        {run.provisionalText ? (
          <div className="max-w-[90%] rounded-[var(--radius-2)] bg-[var(--color-surface-sunken)] p-[var(--space-3)]">
            <div className="mb-[var(--space-1)] flex items-center gap-[var(--space-2)] text-[length:var(--font-size-sm)] font-[var(--font-weight-semibold)]">
              <Bot aria-hidden="true" size={16} />AI 助手（生成中）
            </div>
            <p className="m-0 whitespace-pre-wrap break-words">{run.provisionalText}</p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
