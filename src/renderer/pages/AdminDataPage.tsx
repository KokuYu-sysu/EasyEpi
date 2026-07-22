import { useEffect, useRef, useState, type FormEvent, type ReactElement } from 'react'
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
import type { AdminDemoRecord } from '@renderer/demo/demo-data'
import {
  createAdminDataDemoStore,
  selectAdminDataView,
  type AdminDataDemoStore
} from '@renderer/stores/admin-data-demo-store'

const STATUS_OPTIONS: { value: AdminDemoRecord['status']; label: string }[] = [
  { value: '待复核', label: '待复核' },
  { value: '已复核', label: '已复核' },
  { value: '演示草稿', label: '演示草稿' }
]

interface EditRecordDialogProps {
  record: Readonly<AdminDemoRecord>
  trigger: ReactElement
  onCommit(area: string, status: AdminDemoRecord['status']): void
}

function EditRecordDialog({ record, trigger, onCommit }: EditRecordDialogProps) {
  const [open, setOpen] = useState(false)
  const [area, setArea] = useState(record.area)
  const [status, setStatus] = useState(record.status)
  const [error, setError] = useState<string>()
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const normalized = area.trim()
    if (!normalized) {
      setError('请输入合成区域')
      return
    }
    onCommit(normalized, status)
    setOpen(false)
  }
  return (
    <Modal
      trigger={trigger}
      title="编辑合成记录"
      description="修改只保留在当前页面内存，不会修改真实数据或文件。"
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) {
          setArea(record.area)
          setStatus(record.status)
          setError(undefined)
        }
      }}
    >
      <form className="mt-[var(--space-4)] grid gap-[var(--space-4)]" onSubmit={submit}>
        <Input
          label="合成区域"
          value={area}
          error={error}
          onChange={(event) => {
            setArea(event.target.value)
            setError(undefined)
          }}
        />
        <Select
          label="演示状态"
          options={STATUS_OPTIONS}
          value={status}
          onValueChange={(value) => setStatus(value as AdminDemoRecord['status'])}
        />
        <div className="flex flex-wrap justify-end gap-[var(--space-3)]">
          <Button variant="secondary" onClick={() => setOpen(false)}>
            取消
          </Button>
          <Button type="submit">保存内存修改</Button>
        </div>
      </form>
    </Modal>
  )
}

export interface AdminDataPageProps {
  store?: AdminDataDemoStore
  exportDelayMs?: number
}

export function AdminDataPage({ store: injectedStore, exportDelayMs = 500 }: AdminDataPageProps) {
  const [store] = useState(() => injectedStore ?? createAdminDataDemoStore())
  const state = useStore(store)
  const view = selectAdminDataView(state)
  const handle = useCurrentRouteHandle()
  const toast = useToast()
  const [tab, setTab] = useState<'records' | 'fields'>('records')
  const [exporting, setExporting] = useState(false)
  const exportTimer = useRef<ReturnType<typeof setTimeout>>()

  useEffect(
    () => () => {
      if (exportTimer.current !== undefined) clearTimeout(exportTimer.current)
    },
    []
  )

  if (handle === null) throw new Error('ADMIN_DATA_ROUTE_METADATA_MISSING')

  const startExport = () => {
    if (exportTimer.current !== undefined) clearTimeout(exportTimer.current)
    setExporting(true)
    exportTimer.current = setTimeout(() => {
      exportTimer.current = undefined
      setExporting(false)
      toast.push({
        title: '演示：未生成文件',
        description: '导出仅展示交互反馈，没有创建、下载或修改任何文件。',
        tone: 'info'
      })
    }, exportDelayMs)
  }
  const cancelExport = () => {
    if (exportTimer.current !== undefined) clearTimeout(exportTimer.current)
    exportTimer.current = undefined
    setExporting(false)
  }
  const pageIds = view.pagedRows.map((record) => record.id)
  const selectedOnPage = pageIds.filter((id) => state.selectedIds.includes(id)).length

  return (
    <MilestonePage
      title={handle.title}
      description={handle.description ?? '查看合成记录与管理操作。'}
      demoMessage="M2 演示：所有记录均为合成、非敏感内容；编辑、删除和导出不会修改真实数据或文件。"
      actions={
        <div className="flex flex-wrap gap-[var(--space-2)]">
          <Button loading={exporting} onClick={startExport}>
            导出演示
          </Button>
          {exporting ? (
            <Button variant="secondary" onClick={cancelExport}>
              取消导出演示
            </Button>
          ) : null}
        </div>
      }
    >
      <div
        role="tablist"
        aria-label="数据管理视图"
        className="flex flex-wrap gap-[var(--space-2)] border-b border-[var(--color-border-default)]"
      >
        <Button
          role="tab"
          aria-selected={tab === 'records'}
          variant={tab === 'records' ? 'primary' : 'ghost'}
          onClick={() => setTab('records')}
        >
          记录管理
        </Button>
        <Button
          role="tab"
          aria-selected={tab === 'fields'}
          variant={tab === 'fields' ? 'primary' : 'ghost'}
          onClick={() => setTab('fields')}
        >
          字段概览
        </Button>
      </div>
      {tab === 'fields' ? (
        <section role="tabpanel" aria-label="字段概览">
          <EmptyState
            title="合成字段概览"
            description="演示字段仅包含编号、合成区域、演示状态和更新时间，不包含个人敏感信息。"
          />
        </section>
      ) : (
        <section
          role="tabpanel"
          aria-label="记录管理"
          className="grid min-w-0 gap-[var(--space-4)]"
        >
          <div className="grid gap-[var(--space-3)] md:grid-cols-[minmax(14rem,1fr)_12rem]">
            <Input
              label="筛选合成记录"
              value={state.filter}
              placeholder="编号、区域、状态或日期"
              onChange={(event) => store.getState().setFilter(event.target.value)}
            />
            <Select
              label="每页记录数"
              value={String(view.pageSize)}
              options={[2, 5, 10].map((value) => ({ value: String(value), label: `${value} 条` }))}
              onValueChange={(value) => store.getState().setPageSize(Number(value))}
            />
          </div>
          {view.totalRows === 0 ? (
            <EmptyState
              title="没有匹配的合成记录"
              description="请调整筛选条件；原始演示种子没有被修改。"
            />
          ) : (
            <div className="min-w-0 overflow-x-auto rounded-[var(--radius-2)] border border-[var(--color-border-default)]">
              <table className="w-full min-w-[52rem] border-collapse text-left">
                <caption className="sr-only">合成、非敏感的管理演示记录</caption>
                <thead className="bg-[var(--color-surface-sunken)]">
                  <tr>
                    <th className="p-[var(--space-3)]" scope="col">
                      <Checkbox
                        label="选择本页记录"
                        checked={
                          selectedOnPage === pageIds.length
                            ? true
                            : selectedOnPage > 0
                              ? 'indeterminate'
                              : false
                        }
                        onCheckedChange={(checked) =>
                          store.getState().setPageSelection(pageIds, checked === true)
                        }
                      />
                    </th>
                    <th className="p-[var(--space-3)]" scope="col">
                      演示编号
                    </th>
                    <th className="p-[var(--space-3)]" scope="col">
                      合成区域
                    </th>
                    <th className="p-[var(--space-3)]" scope="col">
                      状态
                    </th>
                    <th className="p-[var(--space-3)]" scope="col">
                      数据标记
                    </th>
                    <th className="p-[var(--space-3)]" scope="col">
                      操作
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {view.pagedRows.map((record) => (
                    <tr key={record.id} className="border-t border-[var(--color-border-default)]">
                      <td className="p-[var(--space-3)]">
                        <Checkbox
                          label={`选择记录：${record.code}`}
                          checked={state.selectedIds.includes(record.id)}
                          onCheckedChange={(checked) =>
                            store.getState().setSelected(record.id, checked === true)
                          }
                        />
                      </td>
                      <th className="p-[var(--space-3)]" scope="row">
                        {record.code}
                      </th>
                      <td className="p-[var(--space-3)]">{record.area}</td>
                      <td className="p-[var(--space-3)]">
                        <Badge variant="info">{record.status}</Badge>
                      </td>
                      <td className="p-[var(--space-3)]">
                        <div className="flex flex-wrap gap-[var(--space-1)]">
                          <Badge variant="warning">合成数据</Badge>
                          <Badge variant="success">非敏感</Badge>
                        </div>
                      </td>
                      <td className="p-[var(--space-3)]">
                        <div className="flex flex-wrap gap-[var(--space-2)]">
                          <EditRecordDialog
                            record={record}
                            trigger={
                              <Button size="sm" variant="secondary">
                                编辑记录：{record.code}
                              </Button>
                            }
                            onCommit={(area, status) => {
                              store.getState().editRecord(record.id, { area, status })
                              toast.push({
                                title: '已更新内存演示',
                                description: '仅修改当前页面内存，没有修改真实数据或文件。',
                                tone: 'info'
                              })
                            }}
                          />
                          <ConfirmDialog
                            trigger={
                              <Button size="sm" variant="danger">
                                删除记录：{record.code}
                              </Button>
                            }
                            title="删除合成记录"
                            description={`仅从当前页面内存移除 ${record.code}；不会修改真实数据。`}
                            confirmLabel="确认内存删除"
                            onConfirm={() => {
                              store.getState().deleteRecord(record.id)
                              toast.push({
                                title: '已从演示中移除',
                                description: '记录仅从当前页面内存移除，没有修改真实数据或文件。',
                                tone: 'info'
                              })
                            }}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-[var(--space-3)]">
            <p className="m-0" aria-live="polite">
              第 {view.page} 页，共 {view.totalPages} 页；共 {view.totalRows} 条合成记录；已选择{' '}
              {state.selectedIds.length} 条
            </p>
            <div className="flex gap-[var(--space-2)]">
              <Button
                variant="secondary"
                disabled={view.page <= 1}
                onClick={() => store.getState().setPage(view.page - 1)}
              >
                上一页
              </Button>
              <Button
                variant="secondary"
                disabled={view.page >= view.totalPages}
                onClick={() => store.getState().setPage(view.page + 1)}
              >
                下一页
              </Button>
            </div>
          </div>
        </section>
      )}
    </MilestonePage>
  )
}
