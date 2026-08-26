import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'

import { AIQuestionnairePage } from '@renderer/pages/AIQuestionnairePage'
import { ToastProvider } from '@renderer/components/ui'
import { AI_PRIVACY_NOTICE, type AISessionPage } from '@shared/ai-assistant-contract'
import type { QuestionnaireDef } from '@shared/types/qnaire'

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

const questionnaire: QuestionnaireDef = {
  name: '基线调查',
  description: '社区调查',
  questions: [{
    id: 'question-1',
    content: '您的性别是？',
    variableName: 'sex',
    type: 'single_choice',
    options: [{ value: '1', label: '男' }, { value: '2', label: '女' }],
    constraint: { type: 'none' },
    defaultValue: '1',
    isKey: true,
    allowSkip: false,
    order: 0
  }],
  conditionRules: [{
    id: 'rule-1',
    sourceQuestionId: 'question-1',
    conditions: [{ questionId: 'question-1', operator: 'equals', value: '1' }],
    logic: 'AND',
    action: 'require',
    targetQuestionIds: ['question-1']
  }],
  keyQuestionIds: ['question-1'],
  derivedVariables: [{
    id: 'derived-1',
    variableName: 'age_group',
    label: '年龄分组',
    formula: '1',
    resultType: 'numeric',
    order: 0
  }]
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
      getData: vi.fn().mockResolvedValue(questionnaire)
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
    api.ai.session.get.mockImplementation(({
      sessionId,
      offset,
      limit
    }: { sessionId: string; offset: number; limit: number }) => {
      if (sessionId === secondSession.sessionId) return delayedSecond
      const allMessages = [
        { id: 'message-a', role: 'assistant' as const, content: '第一条消息', createdAt: '2026-08-25T01:00:00.000Z' },
        { id: 'message-b', role: 'user' as const, content: '第二条消息', createdAt: '2026-08-25T01:01:00.000Z' },
        { id: 'message-c', role: 'assistant' as const, content: '第三条消息', createdAt: '2026-08-25T01:02:00.000Z' }
      ]
      if (limit === 1) {
        return Promise.resolve({
          ok: true,
          session: { ...page, status: 'running' as const, total: 3, messages: [allMessages[0]!], nextOffset: 1 }
        })
      }
      if (offset === 0) {
        return Promise.resolve({
          ok: true,
          session: { ...page, status: 'running' as const, total: 3, messages: [allMessages[0]!], nextOffset: 1 }
        })
      }
      return Promise.resolve({
        ok: true,
        session: {
          ...page,
          status: 'running' as const,
          total: 3,
          messages: allMessages.slice(1),
          attachments: [{
            attachmentId: 'attachment-b',
            messageId: 'message-b',
            kind: 'questionnaire' as const,
            createdAt: '2026-08-25T01:01:00.000Z'
          }],
          nextOffset: null
        }
      })
    })
    renderPage()

    expect(await screen.findByText('第一条消息')).toBeVisible()
    expect(await screen.findByText('第三条消息')).toBeVisible()
    expect(screen.getByText('本次消息附加了当时的问卷')).toBeVisible()
    const editor = screen.getByRole('textbox', { name: '给 AI 的消息' })
    await userEvent.type(editor, '配置未完成')
    expect(screen.getByRole('button', { name: '发送消息' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: '第二段对话' }))
    expect(screen.queryByText('第一条消息')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '调查问卷讨论' }))
    expect(await screen.findByText('第一条消息')).toBeVisible()
    resolveSecond({
      ok: true,
      session: { ...page, manifest: secondSession, messages: [], total: 0 }
    })
    await Promise.resolve()
    expect(screen.getByText('第一条消息')).toBeVisible()

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

    api.ai.config.get.mockResolvedValue({
      ok: true,
      config: { baseUrl: '', model: '', hasApiKey: false, maskedApiKey: null }
    })
    window.dispatchEvent(new Event('easyepi:ai-config-changed'))
    expect(await screen.findByText('尚未完成 AI 服务配置。')).toBeVisible()
    expect(api.qnaire.getData).not.toHaveBeenCalled()
  })

  it('keeps the draft and does not send when privacy confirmation is rejected', async () => {
    const user = userEvent.setup()
    const api = installApi(false)
    let resolvePrivacy!: (value: Awaited<ReturnType<typeof api.ai.privacy.status>>) => void
    const delayedPrivacy = new Promise<Awaited<ReturnType<typeof api.ai.privacy.status>>>((resolve) => {
      resolvePrivacy = resolve
    })
    api.ai.privacy.status.mockReturnValue(delayedPrivacy)
    renderPage()
    await screen.findByRole('heading', { name: '调查问卷讨论', level: 3 })

    const editor = screen.getByRole('textbox', { name: '给 AI 的消息' })
    await user.type(editor, '帮我设计一份问卷')
    await user.click(screen.getByRole('button', { name: '发送消息' }))
    expect(screen.getByRole('button', { name: '发送消息' })).toBeDisabled()
    await user.keyboard('{Enter}')
    expect(api.ai.privacy.status).toHaveBeenCalledTimes(1)
    resolvePrivacy({
      ok: true,
      accepted: false,
      acceptedAt: null,
      notice: AI_PRIVACY_NOTICE
    })
    expect(await screen.findByText(AI_PRIVACY_NOTICE)).toBeVisible()
    await user.click(screen.getByRole('button', { name: '暂不接受' }))

    expect(api.ai.send).not.toHaveBeenCalled()
    expect(editor).toHaveValue('帮我设计一份问卷')

    let resolveAccept!: (value: Awaited<ReturnType<typeof api.ai.privacy.accept>>) => void
    api.ai.privacy.status.mockResolvedValue({
      ok: true,
      accepted: false,
      acceptedAt: null,
      notice: AI_PRIVACY_NOTICE
    })
    api.ai.privacy.accept.mockReturnValue(new Promise((resolve) => { resolveAccept = resolve }))
    await user.click(screen.getByRole('button', { name: '发送消息' }))
    await user.click(await screen.findByRole('button', { name: '接受并发送' }))
    expect(screen.getByRole('button', { name: '接受并发送' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '接受并发送' }))
    expect(api.ai.privacy.accept).toHaveBeenCalledTimes(1)
    resolveAccept({
      ok: true,
      accepted: true,
      acceptedAt: '2026-08-25T00:00:00.000Z',
      notice: AI_PRIVACY_NOTICE
    })
    await waitFor(() => expect(api.ai.send).toHaveBeenCalledTimes(1))
    expect(api.qnaire.getData).not.toHaveBeenCalled()
  })

  it('sends only the explicit questionnaire boolean after preview confirmation', async () => {
    const user = userEvent.setup()
    const api = installApi(true)
    const changedQuestionnaire: QuestionnaireDef = {
      ...questionnaire,
      questions: questionnaire.questions.map((question) => ({
        ...question,
        content: '您当前的生理性别是？'
      }))
    }
    api.qnaire.getData
      .mockResolvedValueOnce(questionnaire)
      .mockResolvedValueOnce(changedQuestionnaire)
      .mockResolvedValue(changedQuestionnaire)
    renderPage()
    await screen.findByRole('heading', { name: '调查问卷讨论', level: 3 })

    await user.click(screen.getByRole('button', { name: '加入当前问卷' }))
    expect(api.qnaire.getData).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('基线调查')).toBeVisible()
    expect(screen.getByText('您的性别是？')).toBeVisible()
    expect(screen.getByText(/sex/)).toBeVisible()
    expect(screen.getByText(/男/)).toBeVisible()
    expect(screen.getByText(/Key：question-1/)).toBeVisible()
    expect(screen.getByText(/rule-1/)).toBeVisible()
    expect(screen.queryByText('年龄分组')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '确认加入' }))
    await user.type(screen.getByRole('textbox', { name: '给 AI 的消息' }), '完善问卷')
    await user.click(screen.getByRole('button', { name: '发送消息' }))

    expect(await screen.findByText(/当前问卷已发生变化/)).toBeVisible()
    expect(screen.getByText('您当前的生理性别是？')).toBeVisible()
    expect(api.ai.send).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: '确认加入' }))
    await user.click(screen.getByRole('button', { name: '发送消息' }))
    await waitFor(() => expect(api.ai.send).toHaveBeenCalledTimes(1))
    expect(api.qnaire.getData).toHaveBeenCalledTimes(3)
    expect(api.ai.send).toHaveBeenCalledWith({
      requestId: expect.any(String),
      sessionId: session.sessionId,
      content: '完善问卷',
      includeCurrentQuestionnaire: true
    })
  })
})
