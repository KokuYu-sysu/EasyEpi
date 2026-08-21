import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { useCurrentRouteHandle } from '@renderer/app/route-metadata'
import { MilestonePage } from '@renderer/components/common/MilestonePage'
import { Button, EmptyState } from '@renderer/components/ui'
import type { QuestionDef, QuestionnaireDef } from '@shared/types/qnaire'
import type { AnswerValue } from '@shared/types/record'
import type { DoubleEntryComparison } from '@shared/types/double-entry'

function isExpiredAdminSession(error: unknown): boolean {
  return String(error).includes('ADMIN_SESSION_REQUIRED')
}

function choiceValue(question: QuestionDef, secondaryValue: string): string {
  const option = question.options.find(
    (item) => item.label === secondaryValue.trim() || item.value === secondaryValue.trim()
  )
  return option ? option.value : secondaryValue.trim()
}

function toAnswerValue(question: QuestionDef, secondaryValue: string): AnswerValue {
  if (question.type === 'multiple_choice') {
    return secondaryValue
      .split(',')
      .map((item) => choiceValue(question, item))
      .filter(Boolean)
  }
  if (question.type === 'single_choice') {
    return choiceValue(question, secondaryValue)
  }
  return secondaryValue.trim() === '' ? null : secondaryValue
}

export function DoubleEntryPage() {
  const navigate = useNavigate()
  const handle = useCurrentRouteHandle()
  const [questionnaire, setQuestionnaire] = useState<QuestionnaireDef | null>(null)
  const [secondaryFilePath, setSecondaryFilePath] = useState<string | null>(null)
  const [imported, setImported] = useState<{ rowCount: number; encoding: string; headers: string[] } | null>(null)
  const [comparison, setComparison] = useState<DoubleEntryComparison | null>(null)
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  if (handle === null) throw new Error('DOUBLE_ENTRY_ROUTE_METADATA_MISSING')

  useEffect(() => {
    let active = true
    void Promise.all([window.easyEpi.admin.checkSession(), window.easyEpi.qnaire.getData()])
      .then(([session, data]) => {
        if (!active) return
        if (!session.isAuthenticated) {
          navigate('/admin/login', { replace: true })
          return
        }
        setQuestionnaire(data)
        setLoading(false)
      })
      .catch(() => navigate('/admin/login', { replace: true }))
    return () => { active = false }
  }, [navigate])

  const selectFile = async () => {
    const result = await window.easyEpi.dialog.selectFile([{ name: 'CSV', extensions: ['csv'] }])
    if (result.canceled || result.filePaths.length === 0) return
    const filePath = result.filePaths[0]!
    setMessage(null)
    setWorking(true)
    try {
      const importedResult = await window.easyEpi.doubleEntry.import({ filePath })
      if (!importedResult.ok) throw new Error(importedResult.error)
      setSecondaryFilePath(filePath)
      setImported({
        rowCount: importedResult.rowCount ?? 0,
        encoding: importedResult.encoding ?? '',
        headers: importedResult.headers ?? []
      })
      setComparison(null)
    } catch (error) {
      setMessage(`导入失败：${error instanceof Error ? error.message : '无法解析 CSV 文件'}`)
    } finally {
      setWorking(false)
    }
  }

  const runComparison = async () => {
    if (secondaryFilePath === null) return
    setWorking(true)
    setMessage(null)
    try {
      const result = await window.easyEpi.doubleEntry.compare({ secondaryFilePath })
      if (!result.ok) throw new Error(result.error)
      setComparison(result.comparison ?? null)
    } catch (error) {
      setMessage(`比对失败：${error instanceof Error ? error.message : '请检查文件'}`)
    } finally {
      setWorking(false)
    }
  }

  const adoptValue = async (diff: { variableName: string; newValue: unknown }, primaryRecordId: string) => {
    const question = questionnaire?.questions.find((candidate) => candidate.variableName === diff.variableName)
    if (!question || questionnaire === null) return
    setWorking(true)
    setMessage(null)
    try {
      const value = toAnswerValue(question, String(diff.newValue ?? ''))
      await window.easyEpi.admin.updateRecord({
        id: primaryRecordId,
        data: { answers: { [question.variableName]: value } }
      })
      setMessage(`已采纳次录入值：${question.content} = ${String(diff.newValue)}`)
      await runComparison()
    } catch (error) {
      if (isExpiredAdminSession(error)) {
        navigate('/admin/login', { replace: true })
        return
      }
      setMessage('写入次录入值失败，请检查该字段约束。')
    } finally {
      setWorking(false)
    }
  }

  const statCards = comparison === null
    ? []
    : [
        { label: '完全一致', value: String(comparison.matchedIdentical) },
        { label: '存在差异', value: String(comparison.matchedWithDiffs) },
        { label: '仅主录入', value: String(comparison.recordsOnlyInPrimary) },
        { label: '仅次录入', value: String(comparison.recordsOnlyInSecondary) }
      ]

  return (
    <MilestonePage
      title={handle.title}
      description={handle.description ?? '导入次录入 CSV，按 Key 逐字段比对当前加密数据。'}
      actions={<Button variant="secondary" onClick={() => navigate('/admin/data')}>返回数据管理</Button>}
    >
      {message ? <p role="status" aria-live="polite" className="m-0">{message}</p> : null}

      {loading ? (
        <div className="grid gap-[var(--space-3)]">
          {Array.from({ length: 2 }, (_, index) => (
            <div key={index} className="h-24 animate-pulse rounded-[var(--radius-2)] bg-[var(--color-surface-muted)]" />
          ))}
        </div>
      ) : (
        <div className="grid gap-[var(--space-4)]">
          <section className="grid gap-[var(--space-3)] rounded-[var(--radius-2)] border border-[var(--color-border-default)] p-[var(--space-4)]">
            <h2 className="m-0 text-[length:var(--font-size-md)]">1. 选择次录入 CSV</h2>
            <p className="m-0 text-[length:var(--font-size-sm)] text-[var(--color-text-secondary)]">
              选择另一份录入生成的 CSV（通常由导出功能生成），系统将按 Key 字段进行逐字段比对。
            </p>
            <div className="flex flex-wrap gap-[var(--space-2)]">
              <Button loading={working} onClick={() => void selectFile()}>选择 CSV 文件</Button>
              <Button
                variant="secondary"
                disabled={secondaryFilePath === null}
                loading={working}
                onClick={() => void runComparison()}
              >
                开始比对
              </Button>
            </div>
            {imported !== null ? (
              <p className="m-0 text-[length:var(--font-size-sm)]">
                已导入 {imported.rowCount} 行（编码: {imported.encoding}），列: {imported.headers.join('、')}
              </p>
            ) : null}
          </section>

          {comparison !== null ? (
            <>
              <section className="flex flex-wrap gap-[var(--space-3)]">
                {statCards.map((card) => (
                  <div
                    key={card.label}
                    className="grid min-w-28 gap-[var(--space-1)] rounded-[var(--radius-2)] border border-[var(--color-border-default)] bg-[var(--color-surface-base)] p-[var(--space-4)]"
                  >
                    <span className="text-[length:var(--font-size-xs)] text-[var(--color-text-secondary)]">{card.label}</span>
                    <span className="text-[length:var(--font-size-2xl)] font-semibold">{card.value}</span>
                  </div>
                ))}
              </section>

              {comparison.matchedWithDiffs > 0 ? (
                <section aria-label="差异记录" className="grid gap-[var(--space-2)]">
                  <h2 className="m-0 text-[length:var(--font-size-md)]">存在差异的记录</h2>
                  {comparison.matched.filter((entry) => entry.diffs.length > 0).map((entry) => (
                    <article key={entry.primaryRecordId} className="rounded-[var(--radius-2)] border border-[var(--color-warning)] bg-[var(--color-warning-light)] p-[var(--space-3)]">
                      <p className="m-0 mb-[var(--space-2)] font-semibold">
                        记录 {entry.primaryRecordId}（
                        {Object.entries(entry.keyValues).map(([name, value]) => `${name}=${value}`).join(', ')}）
                      </p>
                      <ul className="m-0 grid gap-[var(--space-2)]">
                        {entry.diffs.map((diff) => (
                          <li key={diff.variableName} className="flex flex-wrap items-center gap-[var(--space-2)] text-[length:var(--font-size-sm)]">
                            <span className="min-w-40">{diff.label}（{diff.variableName}）</span>
                            <span className="text-[var(--color-text-secondary)]">
                              主值: {String(diff.oldValue ?? '（空）')}
                            </span>
                            <span>→</span>
                            <span className="font-semibold">次值: {String(diff.newValue ?? '（空）')}</span>
                            <Button
                              size="sm"
                              disabled={working}
                              onClick={() => void adoptValue(diff, entry.primaryRecordId)}
                            >
                              采纳次值
                            </Button>
                          </li>
                        ))}
                      </ul>
                    </article>
                  ))}
                </section>
              ) : (
                <p className="m-0 text-[length:var(--font-size-sm)] text-[var(--color-text-secondary)]">
                  所有匹配记录字段完全一致。
                </p>
              )}

              {comparison.recordsOnlyInPrimary > 0 ? (
                <section aria-label="仅主录入" className="grid gap-[var(--space-2)]">
                  <h2 className="m-0 text-[length:var(--font-size-md)]">仅存在于主录入（{comparison.recordsOnlyInPrimary}）</h2>
                  <ul className="m-0 grid gap-[var(--space-1)] text-[length:var(--font-size-sm)]">
                    {comparison.onlyInPrimary.map((entry, index) => (
                      <li key={entry.primaryRecordId ?? index}>
                        记录 {entry.primaryRecordId ?? '?'}（{Object.entries(entry.keyValues).map(([name, value]) => `${name}=${value}`).join(', ')}）
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {comparison.recordsOnlyInSecondary > 0 ? (
                <section aria-label="仅次录入" className="grid gap-[var(--space-2)]">
                  <h2 className="m-0 text-[length:var(--font-size-md)]">仅存在于次录入（{comparison.recordsOnlyInSecondary}）</h2>
                  <ul className="m-0 grid gap-[var(--space-1)] text-[length:var(--font-size-sm)]">
                    {comparison.onlyInSecondary.map((entry, index) => (
                      <li key={index}>
                        {Object.entries(entry.keyValues).map(([name, value]) => `${name}=${value}`).join(', ')}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </>
          ) : questionnaire?.questions.length === 0 ? (
            <EmptyState title="问卷无题目" description="请先在问卷设计中添加题目，再执行双录入比对。" illustration="no-data" />
          ) : null}
        </div>
      )}
    </MilestonePage>
  )
}
