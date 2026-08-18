import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { Button, EmptyState } from '@renderer/components/ui'
import type { QualitySummary } from '@shared/types/quality'

function isExpiredAdminSession(error: unknown): boolean {
  return String(error).includes('ADMIN_SESSION_REQUIRED')
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

export interface QualityDashboardProps {
  onMessage(message: string): void
}

export function QualityDashboard({ onMessage }: QualityDashboardProps) {
  const navigate = useNavigate()
  const [summary, setSummary] = useState<QualitySummary | null>(null)
  const [loading, setLoading] = useState(true)

  const loadSummary = useCallback(async () => {
    try {
      const result = await window.easyEpi.quality.getSummary()
      if (!result.ok) throw new Error(result.error)
      setSummary(result.summary)
    } catch (error) {
      if (isExpiredAdminSession(error)) {
        navigate('/admin/login', { replace: true })
        return
      }
      onMessage('数据质量报告生成失败。')
    } finally {
      setLoading(false)
    }
  }, [navigate, onMessage])

  useEffect(() => {
    void Promise.resolve().then(() => loadSummary())
  }, [loadSummary])

  const refresh = () => {
    setLoading(true)
    void loadSummary()
  }

  if (loading) {
    return (
      <div className="grid gap-[var(--space-3)]">
        {Array.from({ length: 3 }, (_, index) => (
          <div key={index} className="h-20 animate-pulse rounded-[var(--radius-2)] bg-[var(--color-surface-muted)]" />
        ))}
      </div>
    )
  }

  if (summary === null) {
    return <EmptyState title="暂无数据" description="当前项目没有可分析的数据记录。" illustration="no-data" />
  }

  const statCards = [
    { label: '记录数', value: String(summary.records) },
    { label: '整体完整率', value: formatPercent(summary.completeness.overall) },
    { label: '异常值', value: String(summary.outliers.length) },
    { label: '逻辑矛盾', value: String(summary.contradictions.length) },
    { label: '疑似重复', value: String(summary.duplicates.length) }
  ]

  return (
    <div className="grid gap-[var(--space-4)]">
      <div className="flex flex-wrap gap-[var(--space-3)]">
        {statCards.map((card) => (
          <div
            key={card.label}
            className="grid min-w-32 gap-[var(--space-1)] rounded-[var(--radius-2)] border border-[var(--color-border-default)] bg-[var(--color-surface-base)] p-[var(--space-4)]"
          >
            <span className="text-[length:var(--font-size-xs)] text-[var(--color-text-secondary)]">
              {card.label}
            </span>
            <span className="text-[length:var(--font-size-2xl)] font-semibold">{card.value}</span>
          </div>
        ))}
      </div>

      <section aria-label="完整率" className="grid gap-[var(--space-2)]">
        <h2 className="m-0 text-[length:var(--font-size-md)]">各题完整率</h2>
        {summary.completeness.perQuestion.length === 0 ? (
          <p className="m-0 text-[length:var(--font-size-sm)] text-[var(--color-text-secondary)]">
            当前问卷没有题目。
          </p>
        ) : (
          <div className="min-w-0 overflow-x-auto rounded-[var(--radius-2)] border border-[var(--color-border-default)]">
            <table className="w-full min-w-[36rem] border-collapse">
              <thead className="bg-[var(--color-surface-sunken)]">
                <tr>
                  <th className="p-[var(--space-3)] text-left">题目</th>
                  <th className="p-[var(--space-3)] text-left">变量名</th>
                  <th className="p-[var(--space-3)] text-right">已回答</th>
                  <th className="p-[var(--space-3)] text-right">应回答</th>
                  <th className="p-[var(--space-3)] text-right">完整率</th>
                </tr>
              </thead>
              <tbody>
                {summary.completeness.perQuestion.map((item) => (
                  <tr key={item.questionId} className="border-t border-[var(--color-border-default)]">
                    <td className="p-[var(--space-3)]">{item.label}</td>
                    <td className="p-[var(--space-3)] font-mono text-[length:var(--font-size-xs)]">
                      {item.variableName}
                    </td>
                    <td className="p-[var(--space-3)] text-right">{item.answered}</td>
                    <td className="p-[var(--space-3)] text-right">{item.applicable}</td>
                    <td className="p-[var(--space-3)] text-right">{formatPercent(item.rate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-label="异常值" className="grid gap-[var(--space-2)]">
        <h2 className="m-0 text-[length:var(--font-size-md)]">
          异常值（{summary.outliers.length}）
        </h2>
        {summary.outliers.length === 0 ? (
          <p className="m-0 text-[length:var(--font-size-sm)] text-[var(--color-text-secondary)]">
            未发现超出题目约束的值。
          </p>
        ) : (
          <ul className="m-0 grid gap-[var(--space-2)]">
            {summary.outliers.map((item) => (
              <li key={`${item.recordId}-${item.questionId}`} className="rounded-[var(--radius-2)] border border-[var(--color-warning)] bg-[var(--color-warning-light)] p-[var(--space-3)] text-[length:var(--font-size-sm)]">
                {item.label}（{item.variableName}）= {String(item.value ?? '')} — {item.reason}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="逻辑矛盾" className="grid gap-[var(--space-2)]">
        <h2 className="m-0 text-[length:var(--font-size-md)]">
          逻辑矛盾（{summary.contradictions.length}）
        </h2>
        {summary.contradictions.length === 0 ? (
          <p className="m-0 text-[length:var(--font-size-sm)] text-[var(--color-text-secondary)]">
            未发现被条件规则隐藏却仍有答案的题目。
          </p>
        ) : (
          <ul className="m-0 grid gap-[var(--space-2)]">
            {summary.contradictions.map((item) => (
              <li key={`${item.recordId}-${item.questionId}`} className="rounded-[var(--radius-2)] border border-[var(--color-warning)] bg-[var(--color-warning-light)] p-[var(--space-3)] text-[length:var(--font-size-sm)]">
                {item.label}（{item.variableName}）：{item.reason}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="疑似重复" className="grid gap-[var(--space-2)]">
        <h2 className="m-0 text-[length:var(--font-size-md)]">
          疑似重复（{summary.duplicates.length}）
        </h2>
        {summary.duplicates.length === 0 ? (
          <p className="m-0 text-[length:var(--font-size-sm)] text-[var(--color-text-secondary)]">
            未发现重复记录。
          </p>
        ) : (
          <ul className="m-0 grid gap-[var(--space-2)]">
            {summary.duplicates.map((item) => (
              <li key={item.recordId} className="rounded-[var(--radius-2)] border border-[var(--color-warning)] bg-[var(--color-warning-light)] p-[var(--space-3)] text-[length:var(--font-size-sm)]">
                记录 {item.recordId} 与记录 {item.duplicateOf} 疑似重复（{item.matchSummary}
                {item.identicalAnswers ? '，答案完全相同' : ''}）
              </li>
            ))}
          </ul>
        )}
      </section>

      <div>
        <Button variant="secondary" onClick={refresh}>刷新报告</Button>
      </div>
    </div>
  )
}
