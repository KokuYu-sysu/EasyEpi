import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DataTable } from '@renderer/components/admin/DataTable'
import { ExportDialog } from '@renderer/components/admin/ExportDialog'

describe('DataTable', () => {
  const props = {
    columns: [
      { key: 'id', label: '编号', sortable: true },
      { key: 'value', label: '答案' }
    ],
    data: [
      { id: 'r1', value: ['A', 'B'] },
      { id: 'r2', value: null }
    ],
    total: 4,
    page: 1,
    pageSize: 2,
    selectedIds: [] as string[],
    onSelectionChange: vi.fn(),
    onPageChange: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onSearch: vi.fn(),
    onSort: vi.fn()
  }

  beforeEach(() => Object.values(props).forEach((value) => {
    if (typeof value === 'function' && 'mockClear' in value) value.mockClear()
  }))

  it('searches, toggles sort direction, selects rows, edits, and pages', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<DataTable {...props} />)
    expect(screen.getByTitle('A, B')).toHaveTextContent('A, B')
    expect(screen.getByTitle('—')).toBeVisible()

    await user.type(screen.getByLabelText('搜索记录'), '  张三  ')
    await user.click(screen.getByRole('button', { name: '搜索' }))
    expect(props.onSearch).toHaveBeenCalledWith('张三')

    await user.click(screen.getByRole('button', { name: '编号' }))
    await user.click(screen.getByRole('button', { name: /编号 ↑/ }))
    expect(props.onSort).toHaveBeenNthCalledWith(1, 'id', 'asc')
    expect(props.onSort).toHaveBeenNthCalledWith(2, 'id', 'desc')

    await user.click(screen.getByLabelText('选择本页全部记录'))
    expect(props.onSelectionChange).toHaveBeenCalledWith(['r1', 'r2'])
    await user.click(screen.getByLabelText('选择记录 r1'))
    expect(props.onSelectionChange).toHaveBeenLastCalledWith(['r1'])
    await user.click(screen.getAllByRole('button', { name: '编辑' })[0]!)
    expect(props.onEdit).toHaveBeenCalledWith(props.data[0])
    await user.click(screen.getByRole('button', { name: '下一页' }))
    expect(props.onPageChange).toHaveBeenCalledWith(2)

    rerender(<DataTable {...props} page={2} selectedIds={['r1']} />)
    await user.click(screen.getByRole('button', { name: '上一页' }))
    expect(props.onPageChange).toHaveBeenCalledWith(1)
  })

  it('confirms row and bulk deletion and renders empty/loading states', async () => {
    const user = userEvent.setup()
    const view = render(<DataTable {...props} selectedIds={['r1', 'r2']} />)
    await user.click(screen.getAllByRole('button', { name: '删除' })[0]!)
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '确认删除' }))
    expect(props.onDelete).toHaveBeenCalledWith(['r1'])

    await user.click(screen.getByRole('button', { name: /删除选中的 2 条记录/ }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '确认批量删除' }))
    expect(props.onDelete).toHaveBeenCalledWith(['r1', 'r2'])

    view.rerender(<DataTable {...props} data={[]} total={0} loading />)
    expect(screen.getByText('正在读取加密数据…')).toBeVisible()
    view.rerender(<DataTable {...props} data={[]} total={0} loading={false} />)
    expect(screen.getByText('暂无匹配记录')).toBeVisible()
  })

  it('resizes a data column by dragging its resize handle', () => {
    render(<DataTable {...props} />)
    const handle = screen.getByRole('button', { name: '调整编号列宽' })
    const header = handle.closest('th')
    fireEvent.mouseDown(handle, { clientX: 10 })
    fireEvent.mouseMove(window, { clientX: 50 })
    fireEvent.mouseUp(window)
    expect(header).toHaveStyle({ width: '200px' })
  })
})

describe('ExportDialog', () => {
  const onExport = vi.fn()
  const selectFolder = vi.fn()

  beforeEach(() => {
    onExport.mockReset().mockResolvedValue({
      success: true,
      csvPath: 'D:\\out\\easyepi_export.csv',
      dictionaryPath: 'D:\\out\\easyepi_export_dictionary.txt',
      recordCount: 2,
      columnCount: 3
    })
    selectFolder.mockReset().mockResolvedValue({ canceled: false, filePaths: ['D:\\out'] })
    Object.defineProperty(window, 'easyEpi', {
      configurable: true,
      value: { dialog: { selectFolder } }
    })
  })

  afterEach(() => Reflect.deleteProperty(window, 'easyEpi'))

  async function choose(label: string, option: string) {
    const user = userEvent.setup()
    await user.click(screen.getByRole('combobox', { name: label }))
    await user.click(await screen.findByRole('option', { name: option }))
  }

  it('exports selected rows with dummy encoding and the chosen reference', async () => {
    const user = userEvent.setup()
    render(<ExportDialog
      selectedIds={['r1', 'r2']}
      questions={[{
        id: 'multi', variableName: 'multi', content: '多选', type: 'multiple_choice',
        options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }, { value: 'c', label: 'C' }],
        constraint: { type: 'none' }, isKey: false, allowSkip: true, order: 0
      }]}
      onExport={onExport}
    />)
    await user.click(screen.getByRole('button', { name: '导出 CSV' }))
    expect(screen.getByText('预计导出列数：4')).toBeVisible()
    await choose('记录范围', '选中的记录（2 条）')
    await choose('多选题编码', '哑变量编码（k-1 列）')
    expect(screen.getByText('预计导出列数：5')).toBeVisible()
    await choose('CSV 文件编码', 'GBK（兼容旧版 Excel）')
    await choose('哑变量参考类别', '最后一个选项')
    await user.click(screen.getByRole('button', { name: '选择目录并导出' }))

    expect(onExport).toHaveBeenCalledWith({
      outputPath: 'D:\\out\\easyepi_export.csv',
      encoding: 'dummy',
      fileEncoding: 'gbk',
      dummyReference: 'last',
      scope: 'selected',
      selectedIds: ['r1', 'r2']
    })
    expect(await screen.findByRole('status')).toHaveTextContent('已导出 2 条记录')
  })

  it('normalizes extensions, handles cancel, invalid names, failures, and thrown errors', async () => {
    const user = userEvent.setup()
    const view = render(<ExportDialog selectedIds={[]} questions={[]} onExport={onExport} />)
    await user.click(screen.getByRole('button', { name: '导出 CSV' }))
    const name = screen.getByLabelText('CSV 文件名')
    await user.clear(name)
    await user.click(screen.getByRole('button', { name: '选择目录并导出' }))
    expect(screen.getByRole('status')).toHaveTextContent('请输入导出文件名')

    await user.type(name, 'report')
    selectFolder.mockResolvedValueOnce({ canceled: true, filePaths: [] })
    await user.click(screen.getByRole('button', { name: '选择目录并导出' }))
    expect(onExport).not.toHaveBeenCalled()

    onExport.mockResolvedValueOnce({ success: false, error: 'EXPORT_FAILED' })
    await user.click(screen.getByRole('button', { name: '选择目录并导出' }))
    expect(await screen.findByRole('status')).toHaveTextContent('导出失败：EXPORT_FAILED')

    onExport.mockRejectedValueOnce(new Error('offline'))
    await user.click(screen.getByRole('button', { name: '选择目录并导出' }))
    expect(await screen.findByRole('status')).toHaveTextContent('请检查管理员会话和目标目录')

    await user.click(screen.getByRole('button', { name: '关闭' }))
    view.unmount()
  })
})
