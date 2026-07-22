import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { isValidElement } from 'react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'

import { createAppRoutes } from '@renderer/app/routes'
import { ToastProvider } from '@renderer/components/ui'
import { DEMO_ADMIN_RECORDS, type AdminDemoRecord } from '@renderer/demo/demo-data'
import { AdminDataPage } from '@renderer/pages/AdminDataPage'
import {
  createAdminDataDemoStore,
  selectAdminDataView
} from '@renderer/stores/admin-data-demo-store'

function renderAdmin(
  options: {
    store?: ReturnType<typeof createAdminDataDemoStore>
    exportDelayMs?: number
  } = {}
) {
  const router = createMemoryRouter(
    [
      {
        path: '/admin/data',
        handle: { title: '数据管理', description: '查看合成记录与管理操作。' },
        element: <AdminDataPage store={options.store} exportDelayMs={options.exportDelayMs} />
      },
      { path: '/away', element: <p>离开数据管理</p> }
    ],
    { initialEntries: ['/admin/data'] }
  )
  const view = render(
    <ToastProvider>
      <RouterProvider router={router} />
    </ToastProvider>
  )
  return { ...view, router }
}

describe('administration demo data and store', () => {
  it('keeps every seed record immutable, explicitly synthetic, and non-sensitive', () => {
    expect(DEMO_ADMIN_RECORDS.length).toBeGreaterThan(4)
    expect(Object.isFrozen(DEMO_ADMIN_RECORDS)).toBe(true)
    for (const record of DEMO_ADMIN_RECORDS) {
      expect(Object.isFrozen(record)).toBe(true)
      expect(record.synthetic).toBe(true)
      expect(record.sensitivity).toBe('non-sensitive')
      expect(JSON.stringify(record)).not.toMatch(/身份证|手机号|家庭住址|真实姓名/)
    }

    const source: AdminDemoRecord[] = [
      {
        id: 'synthetic-1',
        code: 'SYN-001',
        area: '合成甲区',
        status: '待复核',
        updatedAt: '2026-07-18',
        synthetic: true,
        sensitivity: 'non-sensitive'
      }
    ]
    const store = createAdminDataDemoStore(source)
    source[0]!.area = '外部改写'
    expect(selectAdminDataView(store.getState()).filteredRows[0]?.area).toBe('合成甲区')
    store.getState().editRecord('synthetic-1', { area: '内存编辑区' })
    store.getState().reset()
    expect(selectAdminDataView(store.getState()).filteredRows[0]?.area).toBe('合成甲区')
  })

  it('derives filtering and safe pagination while clamping the page', () => {
    const store = createAdminDataDemoStore(DEMO_ADMIN_RECORDS, { pageSize: 2 })
    expect(selectAdminDataView(store.getState())).toMatchObject({
      page: 1,
      pageSize: 2,
      totalPages: 3
    })
    store.getState().setPage(3)
    expect(selectAdminDataView(store.getState()).pagedRows).toHaveLength(2)
    store.getState().setFilter('北区')
    expect(selectAdminDataView(store.getState())).toMatchObject({ page: 1, totalPages: 1 })
    expect(
      selectAdminDataView(store.getState()).filteredRows.every((row) => row.area.includes('北区'))
    ).toBe(true)

    store.getState().setPageSize(0)
    expect(selectAdminDataView(store.getState()).pageSize).toBe(1)
    store.getState().setPageSize(Number.NaN)
    expect(selectAdminDataView(store.getState()).pageSize).toBe(1)

    const deletionStore = createAdminDataDemoStore(DEMO_ADMIN_RECORDS, { pageSize: 2 })
    deletionStore.getState().setPage(3)
    for (const row of selectAdminDataView(deletionStore.getState()).pagedRows) {
      deletionStore.getState().deleteRecord(row.id)
    }
    expect(selectAdminDataView(deletionStore.getState()).page).toBe(2)
  })

  it('selects only the current page, preserves cross-page selection, and clears deleted IDs', () => {
    const store = createAdminDataDemoStore(DEMO_ADMIN_RECORDS, { pageSize: 2 })
    const firstPage = selectAdminDataView(store.getState()).pagedRows.map((row) => row.id)
    store.getState().setPageSelection(firstPage, true)
    store.getState().setPage(2)
    const secondPage = selectAdminDataView(store.getState()).pagedRows.map((row) => row.id)
    store.getState().setPageSelection(secondPage, true)
    expect(store.getState().selectedIds).toEqual(
      expect.arrayContaining([...firstPage, ...secondPage])
    )
    store.getState().setPageSelection(secondPage, false)
    expect(store.getState().selectedIds).toEqual(firstPage)
    store.getState().deleteRecord(firstPage[0]!)
    expect(store.getState().selectedIds).not.toContain(firstPage[0])
  })
})

describe('data administration demo page', () => {
  it('shows accessible management tabs, synthetic labels, filtering, paging, and page selection', async () => {
    const user = userEvent.setup()
    renderAdmin({ store: createAdminDataDemoStore(DEMO_ADMIN_RECORDS, { pageSize: 2 }) })

    expect(screen.getByRole('heading', { level: 1, name: '数据管理' })).toBeVisible()
    expect(screen.getByRole('tablist', { name: '数据管理视图' })).toBeVisible()
    expect(screen.getByRole('tab', { name: '记录管理' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: '字段概览' })).toBeVisible()
    expect(screen.getAllByText('合成数据').length).toBeGreaterThan(0)
    expect(screen.getAllByText('非敏感').length).toBeGreaterThan(0)
    expect(screen.getByText(/第 1 页，共 3 页/)).toBeVisible()

    await user.click(screen.getByRole('tab', { name: '字段概览' }))
    expect(screen.getByRole('heading', { name: '合成字段概览' })).toBeVisible()
    expect(screen.getByRole('tabpanel', { name: '字段概览' })).toBeVisible()
    await user.click(screen.getByRole('tab', { name: '记录管理' }))

    await user.click(screen.getByRole('checkbox', { name: '选择本页记录' }))
    expect(
      screen
        .getAllByRole('checkbox', { name: /选择记录/ })
        .slice(0, 2)
        .every((box) => (box as HTMLButtonElement).dataset.state === 'checked')
    ).toBe(true)
    await user.click(screen.getByRole('button', { name: '下一页' }))
    expect(screen.getByText(/第 2 页，共 3 页/)).toBeVisible()

    await user.type(screen.getByRole('textbox', { name: '筛选合成记录' }), '南区')
    expect(screen.getByText(/第 1 页，共 1 页/)).toBeVisible()
    expect(screen.getAllByRole('row')).toHaveLength(3)
  })

  it('edits only memory and validates the edit form', async () => {
    const user = userEvent.setup()
    const store = createAdminDataDemoStore()
    renderAdmin({ store })
    const originalCode = selectAdminDataView(store.getState()).pagedRows[0]!.code

    await user.click(screen.getByRole('button', { name: new RegExp(`编辑记录：${originalCode}`) }))
    const dialog = screen.getByRole('dialog', { name: '编辑合成记录' })
    const area = within(dialog).getByRole('textbox', { name: '合成区域' })
    await user.clear(area)
    await user.click(within(dialog).getByRole('button', { name: '保存内存修改' }))
    expect(area).toHaveAttribute('aria-invalid', 'true')
    await user.type(area, '演示新区域')
    await user.click(within(dialog).getByRole('button', { name: '保存内存修改' }))
    expect(screen.getByText('演示新区域')).toBeVisible()
    expect(DEMO_ADMIN_RECORDS.find((record) => record.code === originalCode)?.area).not.toBe(
      '演示新区域'
    )
    expect(await screen.findByRole('status')).toHaveTextContent(
      /仅修改当前页面内存|没有修改真实数据/
    )
  })

  it('focuses cancel and deletes only after confirmation', async () => {
    const user = userEvent.setup()
    const store = createAdminDataDemoStore()
    renderAdmin({ store })
    const first = selectAdminDataView(store.getState()).pagedRows[0]!
    await user.click(screen.getByRole('button', { name: `删除记录：${first.code}` }))
    const dialog = screen.getByRole('alertdialog')
    expect(within(dialog).getByRole('button', { name: '取消' })).toHaveFocus()
    await user.click(within(dialog).getByRole('button', { name: '取消' }))
    expect(screen.getByText(first.code)).toBeVisible()
    await user.click(screen.getByRole('button', { name: `删除记录：${first.code}` }))
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: '确认内存删除' })
    )
    expect(screen.queryByText(first.code)).not.toBeInTheDocument()
    expect(await screen.findByRole('status')).toHaveTextContent(
      /仅从当前页面内存移除|没有修改真实数据/
    )
  })

  it('supports cancellable export loading and truthful completion without writes', async () => {
    const user = userEvent.setup()
    const originalEasyEpi = Object.getOwnPropertyDescriptor(window, 'easyEpi')
    const storageWrite = vi.spyOn(Storage.prototype, 'setItem')
    const createObjectURLDescriptor = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')
    const createObjectURL = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL })
    const blobDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Blob')
    const BlobSpy = vi.fn()
    Object.defineProperty(globalThis, 'Blob', { configurable: true, value: BlobSpy })
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click')
    const preferencesGet = vi.fn()
    const preferencesUpdate = vi.fn()
    const systemPing = vi.fn()
    Object.defineProperty(window, 'easyEpi', {
      configurable: true,
      value: {
        system: { ping: systemPing },
        preferences: { get: preferencesGet, update: preferencesUpdate }
      }
    })
    try {
      const firstView = renderAdmin({ exportDelayMs: 1000 })
      await user.click(screen.getByRole('button', { name: '导出演示' }))
      expect(screen.getByRole('button', { name: '导出演示' })).toHaveAttribute('aria-busy', 'true')
      await user.click(screen.getByRole('button', { name: '取消导出演示' }))
      expect(screen.queryByText(/未生成文件/)).not.toBeInTheDocument()

      firstView.unmount()
      firstView.router.dispose()
      renderAdmin({ exportDelayMs: 10 })
      await user.click(screen.getByRole('button', { name: '导出演示' }))
      expect(await screen.findByText('演示：未生成文件')).toBeVisible()
      expect(createObjectURL).not.toHaveBeenCalled()
      expect(BlobSpy).not.toHaveBeenCalled()
      expect(anchorClick).not.toHaveBeenCalled()
      expect(document.querySelector('[download]')).toBeNull()
      expect(storageWrite).not.toHaveBeenCalled()
      expect(systemPing).not.toHaveBeenCalled()
      expect(preferencesGet).not.toHaveBeenCalled()
      expect(preferencesUpdate).not.toHaveBeenCalled()
    } finally {
      storageWrite.mockRestore()
      anchorClick.mockRestore()
      if (createObjectURLDescriptor)
        Object.defineProperty(URL, 'createObjectURL', createObjectURLDescriptor)
      else Reflect.deleteProperty(URL, 'createObjectURL')
      if (blobDescriptor) Object.defineProperty(globalThis, 'Blob', blobDescriptor)
      else Reflect.deleteProperty(globalThis, 'Blob')
      if (originalEasyEpi) Object.defineProperty(window, 'easyEpi', originalEasyEpi)
      else Reflect.deleteProperty(window, 'easyEpi')
    }
  })

  it('cancels pending export on unmount and creates fresh page state on return', async () => {
    const user = userEvent.setup()
    const view = renderAdmin({ exportDelayMs: 100 })
    await user.type(screen.getByRole('textbox', { name: '筛选合成记录' }), '北区')
    await user.click(screen.getByRole('button', { name: '导出演示' }))
    await act(async () => {
      await view.router.navigate('/away')
    })
    await new Promise((resolve) => setTimeout(resolve, 120))
    expect(screen.queryByText('演示：未生成文件')).not.toBeInTheDocument()
    await act(async () => {
      await view.router.navigate('/admin/data')
    })
    expect(screen.getByRole('textbox', { name: '筛选合成记录' })).toHaveValue('')
    view.router.dispose()
  })

  it('wires every production route to a final page without placeholder metadata', () => {
    const children = createAppRoutes({ isDevelopment: false })[0]?.children ?? []
    const production = children.filter(
      (route) => route.path?.startsWith('/') && route.path !== '/__components'
    )
    expect(production).toHaveLength(9)
    expect(production.every((route) => isValidElement(route.element))).toBe(true)
    expect(production.every((route) => !Object.hasOwn(route.handle as object, 'placeholder'))).toBe(
      true
    )
    const admin = production.find((route) => route.path === '/admin/data')
    expect(isValidElement(admin?.element) && admin.element.type).toBe(AdminDataPage)
  })
})
