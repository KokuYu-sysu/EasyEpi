import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { useCurrentRouteHandle } from '@renderer/app/route-metadata'
import { DataTable, type DataColumn } from '@renderer/components/admin/DataTable'
import { ExportDialog } from '@renderer/components/admin/ExportDialog'
import { MilestonePage } from '@renderer/components/common/MilestonePage'
import { Button, Input, Modal } from '@renderer/components/ui'
import type { QuestionDef, QuestionnaireDef } from '@shared/types/qnaire'
import type { RecordData } from '@shared/types/record'

type AdminTab = 'data' | 'baseline' | 'export' | 'settings'

function adminError(error: unknown): string {
  const code = error instanceof Error ? error.message : String(error)
  if (code.includes('ADMIN_SESSION_REQUIRED')) return '管理员会话已过期，请重新登录。'
  if (code.includes('KEY_DUPLICATE')) return '修改后的关键字段与现有记录重复。'
  if (code.includes('RECORD_NOT_FOUND')) return '记录已不存在，请刷新后重试。'
  if (code.includes('ANSWER_CONSTRAINT_VIOLATION')) return '答案不符合问卷约束，请检查必填、范围和选项。'
  return '操作失败，请重试。'
}

function isExpiredAdminSession(error: unknown): boolean {
  return String(error).includes('ADMIN_SESSION_REQUIRED')
}

function passwordError(code: string | undefined): string {
  switch (code) {
    case 'INVALID_OLD_PASSWORD': return '当前项目密码不正确。'
    case 'PASSWORD_UNCHANGED': return '新密码不能与当前密码相同。'
    case 'WEAK_NEW_PASSWORD':
    case 'INVALID_NEW_PASSWORD': return '新密码至少需要 8 个字符。'
    default: return '密码修改失败，原文件未被替换。'
  }
}

function recordToRow(record: RecordData, questions: QuestionDef[]): Record<string, unknown> {
  return {
    __recordId: record.id,
    ...Object.fromEntries(questions.map((question) => [
      `answer:${question.id}`,
      record.answers[question.id]
    ])),
    __createdAt: record.createdAt,
    __updatedAt: record.updatedAt
  }
}

export function AdminDashboard() {
  const navigate = useNavigate()
  const handle = useCurrentRouteHandle()
  const [activeTab, setActiveTab] = useState<AdminTab>('data')
  const [questionnaire, setQuestionnaire] = useState<QuestionnaireDef | null>(null)
  const [records, setRecords] = useState<RecordData[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize] = useState(50)
  const [search, setSearch] = useState<string | undefined>()
  const [sortBy, setSortBy] = useState<string | undefined>()
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc' | undefined>()
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<string | null>(null)
  const [editing, setEditing] = useState<RecordData | null>(null)
  const [answerDraft, setAnswerDraft] = useState<Record<string, string>>({})
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  if (handle === null) throw new Error('ADMIN_DASHBOARD_ROUTE_METADATA_MISSING')

  const loadRecords = useCallback(async () => {
    setLoading(true)
    try {
      const result = await window.easyEpi.admin.getRecords({
        page,
        pageSize,
        ...(search ? { search } : {}),
        ...(sortBy ? { sortBy, sortOrder } : {})
      })
      setRecords(result.records)
      setTotal(result.total)
    } catch (error) {
      setMessage(adminError(error))
      if (isExpiredAdminSession(error)) navigate('/admin/login', { replace: true })
    } finally {
      setLoading(false)
    }
  }, [navigate, page, pageSize, search, sortBy, sortOrder])

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
        void loadRecords()
      })
      .catch(() => { if (active) navigate('/admin/login', { replace: true }) })
    return () => { active = false }
  }, [loadRecords, navigate])

  const questions = useMemo(() => questionnaire?.questions ?? [], [questionnaire])
  const rows = useMemo(() => records.map((record) => recordToRow(record, questions)), [questions, records])
  const columns: DataColumn[] = useMemo(() => [
    { key: '__recordId', label: '记录 ID', sortable: true },
    ...questions.map((question) => ({
      key: `answer:${question.id}`,
      label: `${question.content} (${question.variableName})`,
      sortable: true
    })),
    { key: '__updatedAt', label: '更新时间', sortable: true }
  ], [questions])

  const beginEdit = (row: Record<string, unknown>) => {
    const record = records.find((candidate) => candidate.id === row['__recordId'])
    if (!record) return
    setEditing(record)
    setAnswerDraft(Object.fromEntries(questions.map((question) => {
      const value = record.answers[question.id]
      return [question.id, Array.isArray(value) ? value.join(',') : value == null ? '' : String(value)]
    })))
  }

  const saveEdit = async () => {
    if (!editing) return
    const answers = Object.fromEntries(questions.map((question) => {
      const raw = answerDraft[question.id] ?? ''
      if (question.type === 'multiple_choice') {
        return [question.id, raw.split(',').map((item) => item.trim()).filter(Boolean)]
      }
      if (question.type === 'numeric_range') {
        return [question.id, raw.trim() === '' ? null : Number(raw)]
      }
      return [question.id, raw.trim() === '' ? null : raw]
    }))
    try {
      await window.easyEpi.admin.updateRecord({ id: editing.id, data: { answers } })
      setEditing(null)
      setMessage('记录已写入加密数据文件。')
      await loadRecords()
    } catch (error) {
      setMessage(adminError(error))
      if (isExpiredAdminSession(error)) navigate('/admin/login', { replace: true })
    }
  }

  const deleteRecords = async (ids: string[]) => {
    try {
      await window.easyEpi.admin.deleteRecords({ ids })
      setSelectedIds((current) => current.filter((id) => !ids.includes(id)))
      setMessage(`已从加密数据文件删除 ${ids.length} 条记录。`)
      await loadRecords()
    } catch (error) {
      setMessage(adminError(error))
      if (isExpiredAdminSession(error)) navigate('/admin/login', { replace: true })
    }
  }

  const changePassword = async (event: React.FormEvent) => {
    event.preventDefault()
    if (newPassword.length < 8) {
      setMessage('新密码至少需要 8 个字符。')
      return
    }
    if (newPassword !== confirmPassword) {
      setMessage('两次输入的新密码不一致。')
      return
    }
    try {
      const result = await window.easyEpi.admin.changePassword({ oldPassword, newPassword })
      if (!result.success) {
        setMessage(passwordError(result.error))
        return
      }
      setOldPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setMessage('项目与数据文件已使用新密码重新加密。')
    } catch (error) {
      setMessage(adminError(error))
      if (isExpiredAdminSession(error)) navigate('/admin/login', { replace: true })
    }
  }

  const logout = async () => {
    await window.easyEpi.admin.logout().catch(() => undefined)
    navigate('/admin/login', { replace: true })
  }

  return (
    <MilestonePage
      title={handle.title}
      description={handle.description ?? '管理当前项目的加密调查数据。'}
      actions={<Button variant="secondary" onClick={() => void logout()}>退出管理后台</Button>}
    >
      <div role="tablist" aria-label="数据管理功能" className="flex flex-wrap gap-[var(--space-2)]">
        {([
          ['data', '数据表格'],
          ['baseline', '基线表'],
          ['export', '导出'],
          ['settings', '设置']
        ] as const).map(([value, label]) => (
          <Button
            key={value}
            role="tab"
            aria-selected={activeTab === value}
            variant={activeTab === value ? 'primary' : 'secondary'}
            onClick={() => setActiveTab(value)}
          >{label}</Button>
        ))}
      </div>

      {message ? <p role="status" aria-live="polite">{message}</p> : null}

      {activeTab === 'data' ? (
        <DataTable
          columns={columns}
          data={rows}
          total={total}
          page={page}
          pageSize={pageSize}
          rowIdKey="__recordId"
          loading={loading}
          selectedIds={selectedIds}
          onSelectionChange={setSelectedIds}
          onPageChange={setPage}
          onEdit={beginEdit}
          onDelete={(ids) => void deleteRecords(ids)}
          onSearch={(term) => { setPage(1); setSearch(term || undefined) }}
          onSort={(key, order) => {
            const question = key.startsWith('answer:')
              ? questions.find((candidate) => candidate.id === key.slice('answer:'.length))
              : undefined
            const field = key === '__recordId'
              ? '@record:id'
              : key === '__updatedAt'
                ? '@record:updatedAt'
                : question === undefined
                  ? undefined
                  : `@answer:${question.id}`
            if (!field) return
            setPage(1)
            setSortBy(field)
            setSortOrder(order)
          }}
        />
      ) : null}

      {activeTab === 'baseline' ? (
        <section className="grid gap-[var(--space-3)]">
          <h2>基线统计表</h2>
          <p>从当前加密记录生成可分组的描述统计和统计检验。</p>
          <Button onClick={() => navigate('/admin/baseline')}>打开基线表生成器</Button>
        </section>
      ) : null}

      {activeTab === 'export' ? (
        <section className="grid gap-[var(--space-3)]">
          <h2>导出 CSV 与数据字典</h2>
          <ExportDialog
            selectedIds={selectedIds}
            questions={questions}
            onExport={async (request) => {
              try {
                return await window.easyEpi.exportData.csv(request)
              } catch (error) {
                if (isExpiredAdminSession(error)) navigate('/admin/login', { replace: true })
                throw error
              }
            }}
          />
        </section>
      ) : null}

      {activeTab === 'settings' ? (
        <form className="grid max-w-md gap-[var(--space-3)]" onSubmit={(event) => void changePassword(event)}>
          <h2>修改项目密码</h2>
          <p>成功后，项目文件和数据文件会作为一个可恢复事务重新加密。</p>
          <Input label="当前项目密码" type="password" autoComplete="current-password" value={oldPassword} onChange={(event) => setOldPassword(event.target.value)} />
          <Input label="新项目密码" type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
          <Input label="确认新项目密码" type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
          <Button type="submit">重新加密并修改密码</Button>
        </form>
      ) : null}

      <Modal
        trigger={<Button className="sr-only">打开记录编辑器</Button>}
        title="编辑调查记录"
        description="保存后将直接更新当前项目的加密数据文件。"
        open={editing !== null}
        onOpenChange={(open) => { if (!open) setEditing(null) }}
      >
        <div className="grid max-h-[60vh] gap-[var(--space-3)] overflow-y-auto pt-[var(--space-3)]">
          {questions.map((question) => (
            <Input
              key={question.id}
              label={`${question.content} (${question.variableName})`}
              value={answerDraft[question.id] ?? ''}
              onChange={(event) => setAnswerDraft((current) => ({ ...current, [question.id]: event.target.value }))}
            />
          ))}
          <div className="flex justify-end gap-[var(--space-2)]">
            <Button variant="secondary" onClick={() => setEditing(null)}>取消</Button>
            <Button onClick={() => void saveEdit()}>保存到加密文件</Button>
          </div>
        </div>
      </Modal>
    </MilestonePage>
  )
}
