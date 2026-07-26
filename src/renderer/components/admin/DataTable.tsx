import { useState } from 'react'
import { Button, Input } from '@renderer/components/ui'

interface Column {
  key: string
  label: string
  sortable?: boolean
}

interface DataTableProps {
  columns: Column[]
  data: Record<string, unknown>[]
  total: number
  page: number
  pageSize: number
  onPageChange: (page: number) => void
  onEdit: (id: string) => void
  onDelete: (ids: string[]) => void
  onSearch: (term: string) => void
}

export function DataTable({
  columns,
  data,
  total,
  page,
  pageSize,
  onPageChange,
  onEdit,
  onDelete,
  onSearch
}: DataTableProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const totalPages = Math.ceil(total / pageSize)

  const handleSearch = () => {
    onSearch(searchTerm)
  }

  const handleSelectAll = (checked: boolean) => {
    setSelectedIds(checked ? data.map(r => r.id as string) : [])
  }

  const handleSelectRow = (id: string, checked: boolean) => {
    setSelectedIds(prev =>
      checked ? [...prev, id] : prev.filter(i => i !== id)
    )
  }

  return (
    <div className="space-y-4">
      {/* Search */}
      <div className="flex gap-2">
        <Input
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="搜索..."
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
        />
        <Button onClick={handleSearch}>搜索</Button>
      </div>

      {/* Table */}
      <div className="border rounded-lg overflow-hidden">
        <table className="w-full">
          <thead className="bg-muted">
            <tr>
              <th className="p-2">
                <input
                  type="checkbox"
                  checked={selectedIds.length === data.length && data.length > 0}
                  onChange={(e) => handleSelectAll(e.target.checked)}
                />
              </th>
              {columns.map(col => (
                <th key={col.key} className="p-2 text-left">
                  {col.label}
                </th>
              ))}
              <th className="p-2">操作</th>
            </tr>
          </thead>
          <tbody>
            {data.length === 0 ? (
              <tr>
                <td colSpan={columns.length + 2} className="p-8 text-center text-muted-foreground">
                  暂无数据
                </td>
              </tr>
            ) : (
              data.map(row => (
                <tr key={row.id as string} className="border-t hover:bg-muted/50">
                  <td className="p-2">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(row.id as string)}
                      onChange={(e) => handleSelectRow(row.id as string, e.target.checked)}
                    />
                  </td>
                  {columns.map(col => (
                    <td key={col.key} className="p-2">
                      {String(row[col.key] ?? '')}
                    </td>
                  ))}
                  <td className="p-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onEdit(row.id as string)}
                    >
                      编辑
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex justify-between items-center">
        <span>共 {total} 条</span>
        <div className="flex gap-2 items-center">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            上一页
          </Button>
          <span className="text-sm">{page} / {totalPages || 1}</span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
          >
            下一页
          </Button>
        </div>
      </div>

      {/* Bulk actions */}
      {selectedIds.length > 0 && (
        <div className="flex gap-2">
          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              onDelete(selectedIds)
              setSelectedIds([])
            }}
          >
            删除选中 ({selectedIds.length})
          </Button>
        </div>
      )}
    </div>
  )
}