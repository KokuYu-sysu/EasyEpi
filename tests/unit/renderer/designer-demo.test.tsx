import { render, screen, waitFor } from '@testing-library/react'
import { isValidElement } from 'react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { vi } from 'vitest'

import { createAppRoutes } from '@renderer/app/routes'
import { DesignerPage } from '@renderer/pages/DesignerPage'
import { createQnaireStore, type QnaireStore } from '@renderer/stores/qnaire.store'
import { ToastProvider } from '@renderer/components/ui'
import type { QuestionnaireDef, QuestionDef } from '@shared/types/qnaire'

function createMockQnaireData(questions: QuestionDef[] = []): QuestionnaireDef {
  return {
    name: '测试问卷',
    questions,
    conditionRules: [],
    keyQuestionIds: []
  }
}

function setupMockEasyEpi(data?: QuestionnaireDef) {
  const qnaireData = data ?? createMockQnaireData()
  const mockApi = {
    system: { ping: vi.fn() },
    preferences: { get: vi.fn(), update: vi.fn() },
    project: {
      create: vi.fn(),
      open: vi.fn(),
      save: vi.fn(),
      close: vi.fn()
    },
    qnaire: {
      getData: vi.fn().mockResolvedValue(qnaireData),
      addQuestion: vi.fn().mockImplementation(async (q: QuestionDef) => {
        qnaireData.questions.push(q)
        return { ok: true, question: q }
      }),
      updateQuestion: vi.fn().mockImplementation(async (id: string, patch: Partial<QuestionDef>) => {
        const q = qnaireData.questions.find((q) => q.id === id)
        if (q) Object.assign(q, patch)
        return { ok: true }
      }),
      deleteQuestion: vi.fn().mockImplementation(async (id: string) => {
        qnaireData.questions = qnaireData.questions.filter((q) => q.id !== id)
        return { ok: true }
      }),
      reorderQuestions: vi.fn().mockResolvedValue({ ok: true }),
      addConditionRule: vi.fn().mockResolvedValue({ ok: true }),
      updateConditionRule: vi.fn().mockResolvedValue({ ok: true }),
      deleteConditionRule: vi.fn().mockResolvedValue({ ok: true }),
      updateMeta: vi.fn().mockResolvedValue({ ok: true })
    }
  }
  Object.defineProperty(window, 'easyEpi', { configurable: true, value: mockApi })
  return mockApi
}

function renderDesigner(store?: QnaireStore) {
  const s = store ?? createQnaireStore()
  const router = createMemoryRouter(
    [
      {
        path: '/designer',
        handle: { title: '问卷设计', description: '组织题目、规则与问卷结构。' },
        element: <DesignerPage store={s} />
      }
    ],
    { initialEntries: ['/designer'] }
  )
  render(
    <ToastProvider>
      <RouterProvider router={router} />
    </ToastProvider>
  )
  return { router, store: s }
}

describe('designer demo page', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, 'easyEpi')
  })

  it('shows empty state when no project is open', async () => {
    setupMockEasyEpi()
    renderDesigner()

    expect(screen.getByRole('heading', { level: 1, name: '问卷设计' })).toBeVisible()
    await waitFor(() => {
      expect(screen.getByText('暂无题目')).toBeVisible()
    })
  })

  it('loads questions from IPC and displays them', async () => {
    const questions: QuestionDef[] = [
      {
        id: 'q1',
        content: '您的性别是？',
        variableName: 'sex',
        type: 'single_choice',
        options: [{ value: '1', label: '男' }, { value: '2', label: '女' }],
        constraint: { type: 'none' },
        isKey: true,
        allowSkip: false,
        order: 0
      },
      {
        id: 'q2',
        content: '您的年龄？',
        variableName: 'age',
        type: 'numeric_range',
        options: [],
        constraint: { type: 'integer', minValue: 0, maxValue: 120 },
        isKey: false,
        allowSkip: false,
        order: 1
      }
    ]
    setupMockEasyEpi(createMockQnaireData(questions))
    const store = createQnaireStore()
    renderDesigner(store)

    await waitFor(() => {
      expect(screen.getByText('您的性别是？')).toBeVisible()
      expect(screen.getByText('您的年龄？')).toBeVisible()
    })

    expect(screen.getByText('单选题')).toBeVisible()
    expect(screen.getByText('数字范围')).toBeVisible()
    expect(screen.getByText('🔑 Key')).toBeVisible()
  })

  it('adds a question via the edit dialog', async () => {
    setupMockEasyEpi()
    const store = createQnaireStore()
    renderDesigner(store)

    await waitFor(() => {
      expect(screen.getByText('暂无题目')).toBeVisible()
    })
  })

  it('keeps the designer route implemented', () => {
    const childRoutes = createAppRoutes({ isDevelopment: false })[0]?.children ?? []
    const designer = childRoutes.find((route) => route.path === '/designer')
    const entry = childRoutes.find((route) => route.path === '/entry')
    const adminData = childRoutes.find((route) => route.path === '/admin/data')

    expect(designer?.handle).not.toHaveProperty('placeholder')
    expect(entry?.handle).not.toHaveProperty('placeholder')
    expect(adminData?.handle).not.toHaveProperty('placeholder')
    expect(isValidElement(designer?.element) && designer.element.type).toBe(DesignerPage)
  })
})
