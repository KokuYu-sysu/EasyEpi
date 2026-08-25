import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'

import { AIQuestionnairePage } from '@renderer/pages/AIQuestionnairePage'
import { ToastProvider } from '@renderer/components/ui'
import { AI_PRIVACY_NOTICE, type AISessionPage } from '@shared/ai-assistant-contract'

const session = {
  sessionId: '00000000-0000-4000-8000-000000000001',
  title: '调查问卷讨论',
  versionStamp: {
    promptId: 'questionnaire',
    promptVersion: '1',
    promptHash: 'hash',
    harnessVersion: '1',
    schemaVersion: 1
  },
  createdAt: '2026-08-25T01:00:00.000Z',
  updatedAt: '2026-08-25T01:00:00.000Z'
}

const secondSession = {
  ...session,
  sessionId: '00000000-0000-4000-8000-000000000002',
  title: '第二段对话'
}

const page: AISessionPage = {
  manifest: session,
  messages: [],
  attachments: [],
  status: 'idle',
  activeArtifactId: null,
  artifacts: [],
  total: 0,
  nextOffset: null
}

function installApi(accepted: boolean) {
  const api = {
    ai: {
      config: {
        get: vi.fn().mockResolvedValue({
          ok: true,
          config: {
            baseUrl: 'https://example.test/v1',
            model: 'model-a',
            hasApiKey: true,
            maskedApiKey: '••••••••'
          }
        })
      },
      privacy: {
        status: vi.fn().mockResolvedValue({
          ok: true,
          accepted,
          acceptedAt: accepted ? '2026-08-25T00:00:00.000Z' : null,
          notice: AI_PRIVACY_NOTICE
        }),
        accept: vi.fn().mockResolvedValue({
          ok: true,
          accepted: true,
          acceptedAt: '2026-08-25T00:00:00.000Z',
          notice: AI_PRIVACY_NOTICE
        })
      },
      session: {
        list: vi.fn().mockResolvedValue({ ok: true, sessions: [session] }),
        get: vi.fn().mockResolvedValue({ ok: true, session: page }),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn()
      },
      send: vi.fn().mockResolvedValue({ ok: false, errorCode: 'AI_PROVIDER_ERROR', message: 'AI 服务返回错误。' }),
      cancel: vi.fn(),
      artifact: { preview: vi.fn(), apply: vi.fn() }
    },
    qnaire: {
      getData: vi.fn().mockResolvedValue({
        name: '基线调查',
        description: '社区调查',
        questions: [],
        conditionRules: [],
        keyQuestionIds: [],
        derivedVariables: []
      })
    },
    project: { onClosed: vi.fn(() => () => undefined) }
  }
  Object.defineProperty(window, 'easyEpi', { configurable: true, value: api })
  return api
}

function renderPage() {
  return render(
    <ToastProvider>
      <AIQuestionnairePage />
    </ToastProvider>
  )
}

describe('AIQuestionnairePage boundaries', () => {
  it('clears switched session state and ignores its late response', async () => {
    let resolveSecond!: (value: { ok: true; session: AISessionPage }) => void
    let resolveConfig!: (value: {
      ok: true
      config: { baseUrl: string; model: string; hasApiKey: boolean; maskedApiKey: string }
    }) => void
    const delayedSecond = new Promise<{ ok: true; session: AISessionPage }>((resolve) => {
      resolveSecond = resolve
    })
    const delayedConfig = new Promise<{
      ok: true
      config: { baseUrl: string; model: string; hasApiKey: boolean; maskedApiKey: string }
    }>((resolve) => {
      resolveConfig = resolve
    })
    const api = installApi(true)
    api.ai.config.get.mockReturnValue(delayedConfig)
    api.ai.session.list.mockResolvedValue({ ok: true, sessions: [session, secondSession] })
    api.ai.session.get.mockImplementation(({ sessionId }: { sessionId: string }) => {
      if (sessionId === secondSession.sessionId) return delayedSecond
      return Promise.resolve({
        ok: true,
        session: {
          ...page,
          status: 'running' as const,
          total: 1,
          messages: [{
            id: 'message-a',
            role: 'assistant' as const,
            content: '第一段对话的消息',
            createdAt: '2026-08-25T01:00:00.000Z'
          }]
        }
      })
    })
    renderPage()

    expect(await screen.findByText('第一段对话的消息')).toBeVisible()
    const editor = screen.getByRole('textbox', { name: '给 AI 的消息' })
    await userEvent.type(editor, '配置未完成')
    expect(screen.getByRole('button', { name: '发送消息' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: '第二段对话' }))
    expect(screen.queryByText('第一段对话的消息')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '调查问卷讨论' }))
    expect(await screen.findByText('第一段对话的消息')).toBeVisible()
    resolveSecond({
      ok: true,
      session: { ...page, manifest: secondSession, messages: [], total: 0 }
    })
    await Promise.resolve()
    expect(screen.getByText('第一段对话的消息')).toBeVisible()

    resolveConfig({
      ok: true,
      config: {
        baseUrl: 'https://example.test/v1',
        model: 'model-a',
        hasApiKey: true,
        maskedApiKey: '••••••••'
      }
    })
    await waitFor(() => expect(screen.queryByText('尚未完成 AI 服务配置。')).not.toBeInTheDocument())
    await userEvent.type(screen.getByRole('textbox', { name: '给 AI 的消息' }), '正在运行')
    expect(screen.getByRole('button', { name: '发送消息' })).toBeDisabled()
    expect(screen.getByText(/此对话仍在处理中/)).toBeVisible()
    expect(screen.getByRole('button', { name: '刷新当前对话' })).toBeEnabled()
    expect(api.qnaire.getData).not.toHaveBeenCalled()
  })

  it('keeps the draft and does not send when privacy confirmation is rejected', async () => {
    const user = userEvent.setup()
    const api = installApi(false)
    renderPage()
    await screen.findByRole('heading', { name: '调查问卷讨论', level: 3 })

    const editor = screen.getByRole('textbox', { name: '给 AI 的消息' })
    await user.type(editor, '帮我设计一份问卷')
    await user.click(screen.getByRole('button', { name: '发送消息' }))
    expect(await screen.findByText(AI_PRIVACY_NOTICE)).toBeVisible()
    await user.click(screen.getByRole('button', { name: '暂不接受' }))

    expect(api.ai.send).not.toHaveBeenCalled()
    expect(editor).toHaveValue('帮我设计一份问卷')
  })

  it('sends only the explicit questionnaire boolean after preview confirmation', async () => {
    const user = userEvent.setup()
    const api = installApi(true)
    renderPage()
    await screen.findByRole('heading', { name: '调查问卷讨论', level: 3 })

    await user.click(screen.getByRole('button', { name: '加入当前问卷' }))
    expect(api.qnaire.getData).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('基线调查')).toBeVisible()
    await user.click(screen.getByRole('button', { name: '确认加入' }))
    await user.type(screen.getByRole('textbox', { name: '给 AI 的消息' }), '完善问卷')
    await user.click(screen.getByRole('button', { name: '发送消息' }))

    await waitFor(() => expect(api.ai.send).toHaveBeenCalledTimes(1))
    expect(api.ai.send).toHaveBeenCalledWith({
      requestId: expect.any(String),
      sessionId: session.sessionId,
      content: '完善问卷',
      includeCurrentQuestionnaire: true
    })
  })
})
