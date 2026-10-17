import { useState, type MouseEvent as ReactMouseEvent } from 'react'

import { Button, ConfirmDialog, Input } from '@renderer/components/ui'

export interface DataColumn {
  key: string
  label: string
  sortable?: boolean
}

export interface DataTableProps {
  columns: DataColumn[]
  data: Record<string, unknown>[]
  total: number
  page: number
  pageSize: number
  rowIdKey?: string
  loading?: boolean
  selectedIds: string[]
  onSelectionChange: (ids: string[]) => void
  onPageChange: (page: number) => void
  onEdit: (record: Record<string, unknown>) => void
  onDelete: (ids: string[]) => void
  onSearch: (term: string) => void
  onSort: (key: string, order: 'asc' | 'desc') => void
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (Array.isArray(value)) return value.join(', ')
  return String(value)
}

export function DataTable({
  columns,
  data,
  total,
  page,
  pageSize,
  rowIdKey = 'id',
  loading = false,
  selectedIds,
  onSelectionChange,
  onPageChange,
  onEdit,
  onDelete,
  onSearch,
  onSort
}: DataTableProps) {
  const [searchTerm, setSearchTerm] = useState('')
  const [sort, setSort] = useState<{ key: string; order: 'asc' | 'desc' } | null>(null)
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({})
  const tableWidth = 56 + 160 + columns.reduce((width, column) => width + (columnWidths[column.key] ?? 160), 0)
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const pageIds = data.map((record) => String(record[rowIdKey]))
  const selectedOnPage = pageIds.filter((id) => selectedIds.includes(id))

  const toggleSort = (key: string) => {
    const nextOrder = sort?.key === key && sort.order === 'asc' ? 'desc' : 'asc'
    setSort({ key, order: nextOrder })
    onSort(key, nextOrder)
  }

  const startColumnResize = (event: ReactMouseEvent<HTMLButtonElement>, key: string) => {
    event.preventDefault()
    event.stopPropagation()
    const startX = event.clientX
    const measuredWidth = event.currentTarget.parentElement?.getBoundingClientRect().width ?? 0
    const startWidth = columnWidths[key] ?? (measuredWidth > 0 ? measuredWidth : 160)
    const move = (moveEvent: MouseEvent) => {
      setColumnWidths((current) => ({
        ...current,
        [key]: Math.max(96, startWidth + moveEvent.clientX - startX)
      }))
    }
    const stop = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', stop)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', stop)
  }

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-[var(--space-4)]">
      <form
        className="flex items-end gap-[var(--space-2)]"
        onSubmit={(event) => {
          event.preventDefault()
          onSearch(searchTerm.trim())
        }}
      >
        <div className="min-w-0 flex-1">
          <Input
            label="搜索记录"
            value={searchTerm}
            placeholder="搜索记录编号或答案"
            onChange={(event) => setSearchTerm(event.target.value)}
          />
        </div>
        <Button type="submit" disabled={loading}>搜索</Button>
      </form>

      <div className="min-w-0 overflow-x-auto rounded-[var(--radius-2)] border border-[var(--color-border-default)]">
        <table
          className="min-w-full table-fixed border-collapse text-left"
          style={{ width: tableWidth }}
        >
          <caption className="sr-only">项目调查记录</caption>
          <thead className="bg-[var(--color-surface-sunken)]">
            <tr>
              <th className="p-[var(--space-3)]" scope="col" style={{ width: 56 }}>
                <input
                  aria-label="选择本页全部记录"
                  type="checkbox"
                  checked={pageIds.length > 0 && selectedOnPage.length === pageIds.length}
                  onChange={(event) => {
                    const next = new Set(selectedIds)
                    for (const id of pageIds) {
                      if (event.target.checked) next.add(id)
                      else next.delete(id)
                    }
                    onSelectionChange([...next])
                  }}
                />
              </th>
              {columns.map((column) => (
                <th
                  key={column.key}
                  className="relative p-[var(--space-3)]"
                  scope="col"
                  style={{ width: columnWidths[column.key] ?? 160 }}
                  title={column.label}
                >
                  {column.sortable ? (
                    <button
                      type="button"
                      className="block w-full truncate text-left"
                      onClick={() => toggleSort(column.key)}
                    >
                      {column.label}
                      {sort?.key === column.key ? (sort.order === 'asc' ? ' ↑' : ' ↓') : ''}
                    </button>
                  ) : <span className="block truncate">{column.label}</span>}
                  <button
                    type="button"
                    aria-label={`调整${column.label}列宽`}
                    className="absolute inset-y-0 right-0 w-2 cursor-col-resize touch-none border-0 bg-transparent p-0"
                    onMouseDown={(event) => startColumnResize(event, column.key)}
                  />
                </th>
              ))}
              <th className="whitespace-nowrap p-[var(--space-3)]" scope="col" style={{ width: 160 }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {data.length === 0 ? (
              <tr><td className="p-[var(--space-5)] text-center" colSpan={columns.length + 2}>
                {loading ? '正在读取加密数据…' : '暂无匹配记录'}
              </td></tr>
            ) : data.map((record) => {
              const id = String(record[rowIdKey])
              return (
                <tr key={id} className="border-t border-[var(--color-border-default)]">
                  <td className="p-[var(--space-3)]">
                    <input
                      aria-label={`选择记录 ${id}`}
                      type="checkbox"
                      checked={selectedIds.includes(id)}
                      onChange={(event) => onSelectionChange(
                        event.target.checked
                          ? [...new Set([...selectedIds, id])]
                          : selectedIds.filter((selected) => selected !== id)
                      )}
                    />
                  </td>
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className="truncate p-[var(--space-3)]"
                      style={columnWidths[column.key] === undefined ? undefined : { width: columnWidths[column.key] }}
                      title={displayValue(record[column.key])}
                    >
                      {displayValue(record[column.key])}
                    </td>
                  ))}
                  <td className="whitespace-nowrap p-[var(--space-3)]">
                    <div className="flex gap-[var(--space-2)]">
                      <Button size="sm" variant="secondary" onClick={() => onEdit(record)}>编辑</Button>
                      <ConfirmDialog
                        trigger={<Button size="sm" variant="danger">删除</Button>}
                        title="删除调查记录"
                        description={`将从加密数据文件中永久删除记录 ${id}。`}
                        confirmLabel="确认删除"
                        cancelLabel="取消"
                        onConfirm={() => onDelete([id])}
                      />
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-[var(--space-3)]">
        <p className="m-0" aria-live="polite">第 {page} / {totalPages} 页，共 {total} 条记录</p>
        <div className="flex gap-[var(--space-2)]">
          <Button variant="secondary" disabled={loading || page <= 1} onClick={() => onPageChange(page - 1)}>上一页</Button>
          <Button variant="secondary" disabled={loading || page >= totalPages} onClick={() => onPageChange(page + 1)}>下一页</Button>
        </div>
      </div>

      {selectedIds.length > 0 ? (
        <ConfirmDialog
          trigger={<Button variant="danger">删除选中的 {selectedIds.length} 条记录</Button>}
          title="批量删除调查记录"
          description="该操作会修改当前项目的加密数据文件，且无法撤销。"
          confirmLabel="确认批量删除"
          cancelLabel="取消"
          onConfirm={() => onDelete(selectedIds)}
        />
      ) : null}
    </div>
  )
}
