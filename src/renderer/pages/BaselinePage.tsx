import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { useCurrentRouteHandle } from '@renderer/app/route-metadata'
import { MilestonePage } from '@renderer/components/common/MilestonePage'
import { Button, Select } from '@renderer/components/ui'
import type { BaselineTable } from '@shared/baseline-contract'
import type { QuestionDef } from '@shared/types/qnaire'

function joinPath(folder: string, name: string): string {
  const separator = folder.includes('\\') ? '\\' : '/'
  return `${folder.replace(/[\\/]$/, '')}${separator}${name}`
}

function isStatisticalQuestion(question: QuestionDef): boolean {
  return ['numeric_range', 'single_choice', 'multiple_choice'].includes(question.type)
}

function isExpiredAdminSession(error: unknown): boolean {
  return String(error).includes('ADMIN_SESSION_REQUIRED')
}

export function BaselinePage() {
  const navigate = useNavigate()
  const handle = useCurrentRouteHandle()
  const [questions, setQuestions] = useState<QuestionDef[]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [groupQuestionId, setGroupQuestionId] = useState('none')
  const [statisticalMethod, setStatisticalMethod] = useState<'auto' | 'manual'>('auto')
  const [continuousTest, setContinuousTest] = useState<'welch_t' | 'none'>('welch_t')
  const [categoricalTest, setCategoricalTest] = useState<'chi_square' | 'none'>('chi_square')
  const [table, setTable] = useState<BaselineTable | null>(null)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<string | null>(null)
  if (handle === null) throw new Error('BASELINE_ROUTE_METADATA_MISSING')

  useEffect(() => {
    let active = true
    void Promise.all([window.easyEpi.admin.checkSession(), window.easyEpi.qnaire.getData()])
      .then(([session, questionnaire]) => {
        if (!active) return
        if (!session.isAuthenticated) {
          navigate('/admin/login', { replace: true })
          return
        }
        const statistical = questionnaire.questions.filter(isStatisticalQuestion)
        setQuestions(questionnaire.questions)
        setSelectedIds(statistical.map((question) => question.id))
        setLoading(false)
      })
      .catch(() => navigate('/admin/login', { replace: true }))
    return () => { active = false }
  }, [navigate])

  const request = {
    ...(selectedIds.length > 0 ? { selectedQuestionIds: selectedIds } : {}),
    ...(groupQuestionId === 'none' ? {} : { groupQuestionId }),
    ...(statisticalMethod === 'auto' ? {} : {
      statisticalMethod,
      continuousTest,
      categoricalTest
    })
  }

  const generate = async () => {
    if (selectedIds.length === 0) {
      setMessage('请至少选择一个统计变量。')
      return
    }
    setLoading(true)
    setMessage(null)
    try {
      const result = await window.easyEpi.baseline.generate(request)
      setTable(result)
      setMessage(`已根据当前加密数据生成 ${result.rows.length} 行统计结果。`)
    } catch (error) {
      if (isExpiredAdminSession(error)) {
        navigate('/admin/login', { replace: true })
        return
      }
      setMessage('基线表生成失败，请重新登录并检查数据。')
    } finally {
      setLoading(false)
    }
  }

  const exportTable = async () => {
    const folder = await window.easyEpi.dialog.selectFolder()
    if (folder.canceled || folder.filePaths.length === 0) return
    try {
      const result = await window.easyEpi.baseline.export({
        ...request,
        outputPath: joinPath(folder.filePaths[0]!, 'easyepi_baseline.csv')
      })
      setMessage(result.success
        ? `基线表已导出：${result.outputPath}`
        : `基线表导出失败：${result.error ?? '未知错误'}`)
    } catch (error) {
      if (isExpiredAdminSession(error)) {
        navigate('/admin/login', { replace: true })
        return
      }
      setMessage('基线表导出失败，请检查目标目录。')
    }
  }

  const candidateQuestions = questions.filter(isStatisticalQuestion)
  const groupQuestions = questions.filter((question) => question.type === 'single_choice')

  return (
    <MilestonePage
      title={handle.title}
      description={handle.description ?? '从当前加密记录生成基线统计表。'}
      actions={<Link className="text-[var(--color-text-link)]" to="/admin/data">返回数据管理</Link>}
    >
      <section className="grid gap-[var(--space-4)] rounded-[var(--radius-2)] border border-[var(--color-border-default)] p-[var(--space-4)]">
        <h2 className="m-0">基线表设置</h2>
        <Select
          label="分组变量"
          value={groupQuestionId}
          onValueChange={setGroupQuestionId}
          options={[
            { value: 'none', label: '不分组' },
            ...groupQuestions.map((question) => ({ value: question.id, label: `${question.content} (${question.variableName})` }))
          ]}
        />
        <Select
          label="统计方法"
          value={statisticalMethod}
          onValueChange={(value) => setStatisticalMethod(value as 'auto' | 'manual')}
          options={[
            { value: 'auto', label: '自动选择检验方法' },
            { value: 'manual', label: '手动指定检验方法' }
          ]}
        />
        {statisticalMethod === 'manual' ? (
          <div className="grid gap-[var(--space-3)] md:grid-cols-2">
            <Select
              label="连续变量检验"
              value={continuousTest}
              onValueChange={(value) => setContinuousTest(value as 'welch_t' | 'none')}
              options={[
                { value: 'welch_t', label: 'Welch t 检验' },
                { value: 'none', label: '仅描述统计' }
              ]}
            />
            <Select
              label="分类变量检验"
              value={categoricalTest}
              onValueChange={(value) => setCategoricalTest(value as 'chi_square' | 'none')}
              options={[
                { value: 'chi_square', label: 'Pearson χ² 检验' },
                { value: 'none', label: '仅描述统计' }
              ]}
            />
          </div>
        ) : null}
        <fieldset className="grid gap-[var(--space-2)]">
          <legend>统计变量</legend>
          {candidateQuestions.map((question) => (
            <label key={question.id} className="flex items-center gap-[var(--space-2)]">
              <input
                type="checkbox"
                checked={selectedIds.includes(question.id)}
                disabled={question.id === groupQuestionId}
                onChange={(event) => setSelectedIds((current) =>
                  event.target.checked
                    ? [...new Set([...current, question.id])]
                    : current.filter((id) => id !== question.id)
                )}
              />
              {question.content} ({question.variableName})
            </label>
          ))}
        </fieldset>
        <div className="flex flex-wrap gap-[var(--space-2)]">
          <Button loading={loading} onClick={() => void generate()}>生成基线表</Button>
          <Button variant="secondary" disabled={table === null} onClick={() => void exportTable()}>导出 UTF-8 CSV</Button>
        </div>
        {message ? <p className="m-0" role="status" aria-live="polite">{message}</p> : null}
      </section>

      {table ? (
        <section className="min-w-0 overflow-x-auto rounded-[var(--radius-2)] border border-[var(--color-border-default)]">
          <table className="w-full min-w-[48rem] border-collapse">
            <caption className="p-[var(--space-3)] text-left font-semibold">Table 1. 基线特征</caption>
            <thead className="bg-[var(--color-surface-sunken)]">
              <tr>
                <th className="p-[var(--space-3)] text-left">变量</th>
                {table.headers.map((header) => <th key={header.key} className="p-[var(--space-3)]">{header.label}</th>)}
                {groupQuestionId !== 'none' ? <th className="p-[var(--space-3)]">P 值 / 检验</th> : null}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row) => (
                <tr key={row.variable} className="border-t border-[var(--color-border-default)]">
                  <th className="p-[var(--space-3)] text-left" scope="row">{row.label}</th>
                  <td className="p-[var(--space-3)] text-center">{row.total}</td>
                  {table.headers.slice(1).map((header) => (
                    <td key={header.key} className="p-[var(--space-3)] text-center">{row.groups?.[header.key] ?? '—'}</td>
                  ))}
                  {groupQuestionId !== 'none' ? (
                    <td className="p-[var(--space-3)] text-center">
                      {row.pValue === undefined ? '—' : `${row.pValue.toFixed(4)} (${row.testUsed})`}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </MilestonePage>
  )
}
