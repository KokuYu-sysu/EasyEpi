import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { isValidElement } from 'react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'

import { createAppRoutes } from '@renderer/app/routes'
import { DesignerPage } from '@renderer/pages/DesignerPage'
import {
  createDesignerDemoStore,
  type DesignerQuestion
} from '@renderer/stores/designer-demo-store'
import { DEMO_QUESTIONS } from '@renderer/demo/demo-data'
import { ToastProvider } from '@renderer/components/ui'

function renderDesigner(store = createDesignerDemoStore()) {
  const router = createMemoryRouter(
    [
      {
        path: '/designer',
        handle: { title: '问卷设计', description: '组织题目、规则与问卷结构。' },
        element: <DesignerPage store={store} />
      }
    ],
    { initialEntries: ['/designer'] }
  )
  render(
    <ToastProvider>
      <RouterProvider router={router} />
    </ToastProvider>
  )
  return { router, store }
}

describe('designer demo store', () => {
  it('isolates immutable seed and reset snapshots from external mutation', () => {
    const source: DesignerQuestion[] = [
      { id: 'question-7', title: '原始题目', type: 'text', isKey: false, hasCondition: false }
    ]
    const store = createDesignerDemoStore(source)

    source[0]!.title = '外部改写'
    expect(store.getState().questions[0]?.title).toBe('原始题目')
    expect(Object.isFrozen(store.getState().questions)).toBe(true)
    expect(Object.isFrozen(store.getState().questions[0])).toBe(true)

    store.getState().updateQuestion('question-7', { title: '内部编辑' })
    store.getState().reset()
    expect(store.getState().questions[0]?.title).toBe('原始题目')
    expect(DEMO_QUESTIONS.every(Object.isFrozen)).toBe(true)
  })

  it('uses deterministic IDs and keeps selection valid through CRUD and reset', () => {
    const store = createDesignerDemoStore([])
    const firstId = store.getState().addQuestion({ title: '第一题', type: 'single', isKey: true, hasCondition: false })
    const secondId = store.getState().addQuestion({ title: '第二题', type: 'multiple', isKey: false, hasCondition: true })

    expect([firstId, secondId]).toEqual(['question-1', 'question-2'])
    expect(store.getState().selectedId).toBe(firstId)
    store.getState().updateQuestion(secondId, { title: '第二题（已编辑）' })
    store.getState().removeQuestion(firstId)
    expect(store.getState().selectedId).toBe(secondId)
    store.getState().removeQuestion(secondId)
    expect(store.getState().selectedId).toBeNull()

    store.getState().reset()
    expect(store.getState().questions).toEqual([])
    expect(store.getState().addQuestion({ title: '重置后', type: 'text', isKey: false, hasCondition: false })).toBe('question-1')
  })
})

describe('questionnaire designer demo page', () => {
  it('shows selection and all required question markers', async () => {
    const user = userEvent.setup()
    renderDesigner()

    expect(screen.getByRole('heading', { level: 1, name: '问卷设计' })).toBeVisible()
    expect(screen.getByText('演示模式，未保存')).toBeVisible()
    expect(screen.getByText('单选题')).toBeVisible()
    expect(screen.getByText('多选题')).toBeVisible()
    expect(screen.getByText('文本题')).toBeVisible()
    expect(screen.getByText('Key')).toBeVisible()
    expect(screen.getByText('条件')).toBeVisible()

    const target = screen.getByRole('button', { name: /选择题目：近期是否出现发热/ })
    await user.click(target)
    expect(target.closest('article')).toHaveAttribute('data-selected', 'true')
  })

  it('adds and edits questions while retaining accessible required validation', async () => {
    const user = userEvent.setup()
    renderDesigner()

    await user.click(screen.getByRole('button', { name: '新增题目' }))
    const addDialog = screen.getByRole('dialog', { name: '新增题目' })
    await user.click(within(addDialog).getByRole('button', { name: '添加题目' }))
    const titleInput = within(addDialog).getByRole('textbox', { name: '题目标题' })
    const error = within(addDialog).getByText('请输入题目标题')
    expect(addDialog).toBeVisible()
    expect(titleInput).toHaveAttribute('aria-invalid', 'true')
    expect(titleInput).toHaveAttribute('aria-describedby', expect.stringContaining(error.id))

    await user.type(titleInput, '家庭成员人数')
    await user.click(within(addDialog).getByRole('button', { name: '添加题目' }))
    expect(screen.queryByRole('dialog', { name: '新增题目' })).not.toBeInTheDocument()
    expect(screen.getByText('家庭成员人数')).toBeVisible()

    await user.click(screen.getByRole('button', { name: '编辑题目：家庭成员人数' }))
    const editDialog = screen.getByRole('dialog', { name: '编辑题目' })
    const editInput = within(editDialog).getByRole('textbox', { name: '题目标题' })
    await user.clear(editInput)
    await user.type(editInput, '家庭常住成员人数')
    await user.click(within(editDialog).getByRole('button', { name: '保存修改' }))
    expect(screen.getByText('家庭常住成员人数')).toBeVisible()
  })

  it('focuses safe cancellation and supports cancel, confirm, and the empty state', async () => {
    const user = userEvent.setup()
    const seed: DesignerQuestion[] = [
      { id: 'question-1', title: '唯一题目', type: 'text', isKey: false, hasCondition: false }
    ]
    renderDesigner(createDesignerDemoStore(seed))

    await user.click(screen.getByRole('button', { name: '删除题目：唯一题目' }))
    const dialog = screen.getByRole('alertdialog')
    const cancel = within(dialog).getByRole('button', { name: '取消' })
    const confirm = within(dialog).getByRole('button', { name: '确认删除' })
    expect(cancel).toHaveFocus()
    expect(confirm).not.toHaveFocus()

    await user.click(cancel)
    expect(screen.getByText('唯一题目')).toBeVisible()
    await user.click(screen.getByRole('button', { name: '删除题目：唯一题目' }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '确认删除' }))
    expect(screen.getByRole('heading', { name: '暂无题目' })).toBeVisible()
  })

  it('reports truthful Save and Preview toasts without any persistence calls', async () => {
    const user = userEvent.setup()
    const originalEasyEpi = Object.getOwnPropertyDescriptor(window, 'easyEpi')
    const storageWrite = vi.spyOn(Storage.prototype, 'setItem')
    const preferencesGet = vi.fn()
    const preferencesUpdate = vi.fn()
    Object.defineProperty(window, 'easyEpi', {
      configurable: true,
      value: { preferences: { get: preferencesGet, update: preferencesUpdate } }
    })
    try {
      renderDesigner()

      await user.click(screen.getByRole('button', { name: '保存问卷' }))
      expect(await screen.findByRole('status')).toHaveTextContent(/未保存|后续里程碑/)
      expect(screen.queryByText(/保存成功/)).not.toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: '预览问卷' }))
      expect(screen.getByText('预览功能尚未保存').closest('[role="status"]')).toHaveTextContent(
        /未保存|后续里程碑/
      )

      expect(storageWrite).not.toHaveBeenCalled()
      expect(preferencesGet).not.toHaveBeenCalled()
      expect(preferencesUpdate).not.toHaveBeenCalled()
    } finally {
      storageWrite.mockRestore()
      if (originalEasyEpi) Object.defineProperty(window, 'easyEpi', originalEasyEpi)
      else Reflect.deleteProperty(window, 'easyEpi')
    }
  })

  it('keeps the designer route implemented at the Task 11 boundary', () => {
    const childRoutes = createAppRoutes({ isDevelopment: false })[0]?.children ?? []
    const designer = childRoutes.find((route) => route.path === '/designer')
    const entry = childRoutes.find((route) => route.path === '/entry')
    const adminData = childRoutes.find((route) => route.path === '/admin/data')

    expect(designer?.handle).not.toHaveProperty('placeholder')
    expect(entry?.handle).not.toHaveProperty('placeholder')
    expect(adminData?.handle).toHaveProperty('placeholder')
    expect(isValidElement(designer?.element) && designer.element.type).toBe(DesignerPage)
  })
})
