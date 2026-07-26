import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { EntryPage } from '@renderer/pages/EntryPage'

describe('EntryPage keyboard workflow', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'easyEpi', {
      configurable: true,
      value: {
        qnaire: {
          getData: vi.fn().mockResolvedValue({
            name: 'Keyboard Test',
            questions: [
              {
                id: 'q1',
                content: '现场备注',
                variableName: 'notes',
                type: 'free_text',
                options: [],
                constraint: { type: 'none' },
                isKey: false,
                allowSkip: false,
                order: 0
              }
            ],
            conditionRules: [],
            keyQuestionIds: []
          })
        },
        record: {
          getProgress: vi.fn().mockResolvedValue({
            ok: true,
            hasDraft: false,
            currentIndex: 0,
            batchCount: 0,
            batchStartTime: 123456,
            currentAnswers: {}
          }),
          saveProgress: vi.fn().mockResolvedValue({ ok: true }),
          submit: vi.fn()
        }
      }
    })
  })

  afterEach(() => {
    Reflect.deleteProperty(window, 'easyEpi')
  })

  it('ends work with Escape while a text input is focused', async () => {
    const user = userEvent.setup()
    const router = createMemoryRouter(
      [
        {
          path: '/entry',
          handle: { title: '单题录入' },
          element: <EntryPage />
        },
        { path: '/', element: <h1>欢迎页</h1> }
      ],
      { initialEntries: ['/entry'] }
    )
    render(<RouterProvider router={router} />)

    expect(await screen.findByRole('heading', { level: 1, name: '单题录入' })).toBeVisible()
    await user.click(await screen.findByRole('button', { name: '开始录入' }))
    const notes = screen.getByRole('textbox', { name: '现场备注' })
    await user.click(notes)
    await user.type(notes, 'draft')
    await user.keyboard('{Escape}')

    expect(router.state.location.pathname).toBe('/')
    expect(window.easyEpi.record.saveProgress).toHaveBeenLastCalledWith(
      expect.objectContaining({
        hasDraft: true,
        currentIndex: 0,
        currentAnswers: { q1: 'draft' }
      })
    )
  })
})
