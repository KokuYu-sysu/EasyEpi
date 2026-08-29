import { AlertTriangle } from 'lucide-react'

import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@renderer/components/ui'
import { friendlyAIError } from '@renderer/components/ai/ai-errors'
import type { AIPublicFailureDetails } from '@shared/ai-assistant-contract'

interface AIValidationFailureProps {
  errorCode: string
  details: AIPublicFailureDetails
  busy: boolean
  onRetry: (details: AIPublicFailureDetails) => void
  onEdit: () => void
}

export function AIValidationFailure({
  errorCode,
  details,
  busy,
  onRetry,
  onEdit
}: AIValidationFailureProps) {
  return (
    <Card className="border-[var(--color-danger)]">
      <CardHeader>
        <div className="flex items-center gap-[var(--space-2)]">
          <AlertTriangle aria-hidden="true" size={18} />
          <CardTitle className="text-[length:var(--font-size-lg)]">问卷未通过本地校验</CardTitle>
        </div>
        <p className="m-0 text-[var(--color-text-secondary)]">
          {friendlyAIError(errorCode, '生成结果未通过本地校验。请根据下列问题重新生成，或修改你的要求。')}
        </p>
      </CardHeader>
      <CardContent className="grid gap-[var(--space-3)]">
        {details.attempts.map((attempt) => (
          <section key={attempt.attempt} className="grid gap-[var(--space-2)]">
            <div className="flex flex-wrap items-center gap-[var(--space-2)]">
              <h4 className="m-0">第 {attempt.attempt} 次尝试</h4>
              {attempt.truncated ? <Badge variant="warning">另有错误未显示</Badge> : null}
            </div>
            <ul className="m-0 grid gap-[var(--space-1)] pl-[var(--space-5)] text-[var(--color-text-secondary)]">
              {attempt.issues.map((issue, index) => <li key={`${issue.code}-${issue.field}-${index}`}>{issue.summary}</li>)}
            </ul>
          </section>
        ))}
        <details className="rounded-[var(--radius-1)] border border-[var(--color-border-default)] p-[var(--space-3)]">
          <summary className="cursor-pointer font-[var(--font-weight-semibold)]">查看技术详情</summary>
          <div className="mt-[var(--space-3)] grid gap-[var(--space-3)]">
            {details.attempts.map((attempt) => (
              <div key={attempt.attempt}>
                <strong>尝试 {attempt.attempt} 的技术信息</strong>
                <dl className="mb-0 grid gap-[var(--space-2)]">
                  {attempt.issues.map((issue, index) => (
                    <div key={`${issue.code}-${issue.field}-${index}`} className="grid gap-[var(--space-1)]">
                      <dt className="text-[length:var(--font-size-sm)] text-[var(--color-text-secondary)]">错误代码与字段</dt>
                      <dd className="m-0 flex flex-wrap gap-[var(--space-2)] break-words font-mono text-[length:var(--font-size-sm)]">
                        <span>{issue.code}</span><span aria-hidden="true">·</span><span>{issue.field}</span>
                      </dd>
                      <dd className="m-0 text-[var(--color-text-secondary)]">{issue.summary}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
        </details>
        <div className="flex flex-wrap gap-[var(--space-2)]">
          <Button disabled={busy} onClick={() => onRetry(details)}>根据错误重新生成</Button>
          <Button variant="secondary" disabled={busy} onClick={onEdit}>修改要求</Button>
        </div>
      </CardContent>
    </Card>
  )
}
