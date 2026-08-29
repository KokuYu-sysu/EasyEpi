import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'

import { AIQuestionnairePage } from '@renderer/pages/AIQuestionnairePage'
import { ToastProvider } from '@renderer/components/ui'
import {
  AI_PRIVACY_NOTICE,
  type AIArtifactPreview,
  type AIPublicFailureDetails,
  type AIProgressEvent,
  type AIQuestionnaireArtifactPreviewDto,
  type AISessionPage
} from '@shared/ai-assistant-contract'
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
  activeRun: null,
  failures: [],
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

function artifactPreview(label: string): AIArtifactPreview {
  return {
    draft: { ...questionnaire, name: label },
    diff: {
      metadata: { name: null, description: null },
      questions: { added: [], removed: [], modified: [] },
      rules: { added: [], removed: [], modified: [] }
    },
    assistantMessage: `草稿 ${label}`,
    rollingSummary: `摘要 ${label}`,
    validation: { success: true, errors: [] },
    baseQuestionnaireRevision: 'revision-1',
    baseQuestionnaireHash: 'hash-1',
    baseQuestionnaire: questionnaire
  }
}

function artifactPage(artifactId: string, operationId: string): AISessionPage {
  return {
    ...page,
    activeArtifactId: artifactId,
    artifacts: [{
      artifactId,
      operationId,
      kind: 'questionnaire-draft',
      status: 'completed',
      createdAt: '2026-08-25T01:00:00.000Z',
      updatedAt: '2026-08-25T01:00:00.000Z'
    }]
  }
}

function artifactDto(
  artifactId: string,
  operationId: string,
  preview: AIArtifactPreview
): AIQuestionnaireArtifactPreviewDto {
  return {
    artifactId,
    operationId,
    kind: 'questionnaire-draft',
    status: 'completed',
    createdAt: '2026-08-25T01:00:00.000Z',
    updatedAt: '2026-08-25T01:00:00.000Z',
    value: preview
  }
}

function installApi(accepted: boolean) {
  const api = {
    ai: {
      onProgress: vi.fn((_scope: { requestId: string; sessionId: string }, _callback: (event: AIProgressEvent) => void) => vi.fn()),
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
        delete: vi.fn(),
        clearCache: vi.fn()
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
  it('streams attempts, resolves clarification, and exposes grouped repair actions without accepting stale progress', async () => {
    const user = userEvent.setup()
    const api = installApi(true)
    const progressCallbacks: Array<(event: AIProgressEvent) => void> = []
    const unsubscribers = [vi.fn(), vi.fn(), vi.fn()]
    api.ai.onProgress.mockImplementation((_scope, callback) => {
      progressCallbacks.push(callback)
      return unsubscribers[progressCallbacks.length - 1] ?? vi.fn()
    })

    let resolveClarification!: (value: {
      ok: true
      requestId: string
      outcome: 'clarification'
      message: AISessionPage['messages'][number]
      attempts: number
    }) => void
    const clarificationSend = new Promise<Parameters<typeof resolveClarification>[0]>((resolve) => {
      resolveClarification = resolve
    })
    let resolveFailure!: (value: {
      ok: false
      errorCode: string
      message: string
      details: AISessionPage['failures'][number]['details']
    }) => void
    const failureSend = new Promise<Parameters<typeof resolveFailure>[0]>((resolve) => {
      resolveFailure = resolve
    })
    api.ai.send
      .mockReturnValueOnce(clarificationSend)
      .mockReturnValueOnce(failureSend)
      .mockReturnValue(new Promise(() => undefined))

    const clarification = {
      clarificationId: 'clarification-age',
      options: [
        { id: 'age-18-39', label: '18–39 岁' },
        { id: 'age-40-64', label: '40–64 岁' }
      ],
      status: 'unresolved' as const,
      selectedOptionId: null,
      resolvedByMessageId: null
    }
    const initialUserMessage = {
      id: 'message-user-initial',
      role: 'user' as const,
      content: '设计筛查问卷',
      createdAt: '2026-08-25T01:01:00.000Z',
      clarification: null
    }
    const assistantClarification = {
      id: 'message-assistant-clarification',
      role: 'assistant' as const,
      content: '请选择筛查年龄范围。',
      createdAt: '2026-08-25T01:02:00.000Z',
      clarification
    }
    const failureDetails: AIPublicFailureDetails = {
      attempts: [{
        attempt: 1 as const,
        issues: [
          { code: 'UNKNOWN_CONDITION_QUESTION', field: '$.conditionRules[0]', summary: '条件引用的题目不存在。' },
          { code: 'DUPLICATE_VARIABLE_NAME', field: '$.questions[1].variableName', summary: '变量名不能重复或与受保护变量冲突。' }
        ],
        truncated: true
      }, {
        attempt: 2 as const,
        issues: [{ code: 'KEY_QUESTION_MISMATCH', field: '$.keyQuestionIds[0]', summary: '关键题目列表与题目标记不一致。' }],
        truncated: false
      }]
    }
    const selectedUserMessage = {
      id: 'message-user-selection',
      role: 'user' as const,
      content: '我选择：40–64 岁',
      createdAt: '2026-08-25T01:03:00.000Z',
      clarification: null
    }
    const resolvedClarificationMessage = {
      ...assistantClarification,
      clarification: {
        ...clarification,
        status: 'resolved' as const,
        selectedOptionId: 'age-40-64',
        resolvedByMessageId: selectedUserMessage.id
      }
    }
    const clarificationPage: AISessionPage = {
      ...page,
      messages: [initialUserMessage, assistantClarification],
      total: 2
    }
    const failurePage: AISessionPage = {
      ...page,
      status: 'failed',
      messages: [initialUserMessage, resolvedClarificationMessage, selectedUserMessage],
      failures: [{
        runId: 'run-selection',
        userMessageId: selectedUserMessage.id,
        completedAt: '2026-08-25T01:04:00.000Z',
        errorCode: 'AI_HARNESS_VALIDATION_FAILED',
        details: failureDetails
      }],
      total: 3
    }
    let loadedPage: AISessionPage = page
    api.ai.session.get.mockImplementation(({ limit }: { limit?: number }) => Promise.resolve({
      ok: true,
      session: limit === 1 && loadedPage.total > 0
        ? { ...loadedPage, messages: [loadedPage.messages[0]!], nextOffset: 1 }
        : loadedPage
    }))

    const view = renderPage()
    await screen.findByRole('heading', { name: '调查问卷讨论', level: 3 })
    await user.type(screen.getByRole('textbox', { name: '给 AI 的消息' }), '设计筛查问卷')
    await user.click(screen.getByRole('button', { name: '发送消息' }))
    await waitFor(() => expect(api.ai.send).toHaveBeenCalledTimes(1))
    expect(api.ai.onProgress).toHaveBeenCalledWith({
      requestId: api.ai.send.mock.calls[0]?.[0].requestId,
      sessionId: session.sessionId
    }, expect.any(Function))
    expect(api.ai.onProgress.mock.invocationCallOrder[0]).toBeLessThan(api.ai.send.mock.invocationCallOrder[0]!)

    const requestId = api.ai.send.mock.calls[0]![0].requestId
    const baseEvent = {
      requestId,
      sessionId: session.sessionId,
      runId: 'run-initial',
      at: '2026-08-25T01:01:01.000Z'
    }
    act(() => {
      progressCallbacks[0]!({ ...baseEvent, type: 'attempt_started', attempt: 1 })
      progressCallbacks[0]!({ ...baseEvent, type: 'model_streaming', attempt: 1 })
      progressCallbacks[0]!({ ...baseEvent, type: 'assistant_delta', attempt: 1, sequence: 1, delta: '这是一段' })
      progressCallbacks[0]!({ ...baseEvent, type: 'assistant_delta', attempt: 1, sequence: 2, delta: '无效回答' })
      progressCallbacks[0]!({ ...baseEvent, type: 'assistant_delta', attempt: 1, sequence: 2, delta: '重复片段' })
      progressCallbacks[0]!({ ...baseEvent, requestId: 'stale-request', type: 'assistant_delta', attempt: 1, sequence: 3, delta: '不应出现' })
    })
    expect(await screen.findByText('这是一段无效回答')).toBeVisible()
    expect(screen.queryByText('不应出现')).not.toBeInTheDocument()
    expect(screen.queryByText(/重复片段/)).not.toBeInTheDocument()
    expect(screen.getByText('正在接收模型回答')).toBeVisible()

    act(() => {
      progressCallbacks[0]!({
        ...baseEvent,
        type: 'validation_failed',
        attempt: 1,
        failure: failureDetails.attempts[0]!
      })
      progressCallbacks[0]!({ ...baseEvent, type: 'repairing', attempt: 1, nextAttempt: 2 })
    })
    expect(screen.queryByText('这是一段无效回答')).not.toBeInTheDocument()
    expect(screen.getByText('第 1 次尝试未通过本地校验')).toBeVisible()
    expect(screen.getByText('正在进行第 1 次自动修复')).toBeVisible()
    act(() => progressCallbacks[0]!({ ...baseEvent, type: 'assistant_delta', attempt: 2, sequence: 1, delta: '请选择筛查年龄范围。' }))
    expect(await screen.findByText('请选择筛查年龄范围。')).toBeVisible()
    act(() => progressCallbacks[0]!({ ...baseEvent, type: 'clarification', attempt: 2, outcome: 'clarification', messageId: assistantClarification.id, clarification }))
    expect(unsubscribers[0]).toHaveBeenCalledTimes(1)
    loadedPage = clarificationPage
    await act(async () => {
      resolveClarification({
        ok: true,
        requestId,
        outcome: 'clarification',
        message: assistantClarification,
        attempts: 2
      })
    })

    const option = await screen.findByRole('button', { name: '40–64 岁' })
    expect(option).toBeEnabled()
    await user.click(option)
    await waitFor(() => expect(api.ai.send).toHaveBeenCalledTimes(2))
    expect(api.ai.send).toHaveBeenNthCalledWith(2, {
      requestId: expect.any(String),
      sessionId: session.sessionId,
      content: '',
      includeCurrentQuestionnaire: false,
      clarificationSelection: {
        clarificationId: 'clarification-age',
        optionId: 'age-40-64'
      }
    })
    expect(option).toBeDisabled()

    loadedPage = failurePage
    await act(async () => {
      resolveFailure({
        ok: false,
        errorCode: 'AI_HARNESS_VALIDATION_FAILED',
        message: 'raw provider detail must stay hidden',
        details: failureDetails
      })
    })
    expect(await screen.findByText('我选择：40–64 岁')).toBeVisible()
    expect(await screen.findByText('第 1 次尝试')).toBeVisible()
    expect(screen.getByText('第 2 次尝试')).toBeVisible()
    expect(screen.getByText('另有错误未显示')).toBeVisible()
    expect(screen.queryByText('raw provider detail must stay hidden')).not.toBeInTheDocument()
    await user.click(screen.getByText('查看技术详情'))
    expect(screen.getByText('UNKNOWN_CONDITION_QUESTION')).toBeVisible()
    expect(screen.getByText('$.conditionRules[0]')).toBeVisible()

    await user.click(screen.getByRole('button', { name: '修改要求' }))
    expect(screen.getByRole('textbox', { name: '给 AI 的消息' })).toHaveFocus()
    await user.click(screen.getByRole('button', { name: '根据错误重新生成' }))
    await waitFor(() => expect(api.ai.send).toHaveBeenCalledTimes(3))
    expect(api.ai.send.mock.calls[2]?.[0]).toMatchObject({
      sessionId: session.sessionId,
      includeCurrentQuestionnaire: false,
      content: expect.stringContaining('条件引用的题目不存在。')
    })
    expect(api.ai.send.mock.calls[2]?.[0].content.length).toBeLessThanOrEqual(1000)

    act(() => {
      progressCallbacks[2]!({
        ...baseEvent,
        requestId: api.ai.send.mock.calls[2]![0].requestId,
        sessionId: secondSession.sessionId,
        type: 'assistant_delta',
        attempt: 1,
        sequence: 1,
        delta: '其他对话的内容'
      })
    })
    expect(screen.queryByText('其他对话的内容')).not.toBeInTheDocument()
    view.unmount()
    expect(unsubscribers[2]).toHaveBeenCalledTimes(1)
  })

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

    const previewA = artifactPreview('草稿 A')
    const previewB = artifactPreview('草稿 B')
    let resolvePreviewA!: (value: { ok: true; preview: AIArtifactPreview }) => void
    api.ai.artifact.preview
      .mockReturnValueOnce(new Promise((resolve) => { resolvePreviewA = resolve }))
      .mockResolvedValue({ ok: true, preview: previewB })
    api.ai.session.get.mockResolvedValue({
      ok: true,
      session: artifactPage('artifact-a', 'operation-a')
    })
    await userEvent.click(screen.getByRole('button', { name: '刷新当前对话' }))
    await waitFor(() => expect(api.ai.artifact.preview).toHaveBeenCalledWith({
      sessionId: session.sessionId,
      artifactId: 'artifact-a'
    }))

    api.ai.session.get.mockResolvedValue({
      ok: true,
      session: artifactPage('artifact-b', 'operation-b')
    })
    await userEvent.click(screen.getByRole('button', { name: '刷新当前对话' }))
    expect(await screen.findByText('草稿 草稿 B')).toBeVisible()
    resolvePreviewA({ ok: true, preview: previewA })
    await Promise.resolve()
    expect(screen.getByText('草稿 草稿 B')).toBeVisible()
    expect(screen.queryByText('草稿 草稿 A')).not.toBeInTheDocument()

    let resolveApply!: (value: {
      ok: true
      applied: boolean
      questionnaire: QuestionnaireDef
      preview: AIArtifactPreview
    }) => void
    api.ai.artifact.apply.mockReturnValue(new Promise((resolve) => { resolveApply = resolve }))
    await userEvent.click(screen.getByRole('button', { name: '应用到正式问卷' }))
    await userEvent.click(screen.getByRole('button', { name: '确认应用' }))
    expect(screen.getByRole('button', { name: '新建对话' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '第二段对话' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '重命名当前对话' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '清除缓存' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '删除' })).toBeDisabled()
    expect(screen.getByRole('textbox', { name: '给 AI 的消息' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '加入当前问卷' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '刷新当前对话' })).toBeEnabled()
    resolveApply({ ok: true, applied: true, questionnaire, preview: previewB })
    await waitFor(() => expect(screen.getByRole('button', { name: '新建对话' })).toBeEnabled())

    api.ai.artifact.preview.mockResolvedValueOnce({
      ok: false,
      errorCode: 'AI_ARTIFACT_STALE',
      message: 'stale'
    })
    await userEvent.click(screen.getByRole('button', { name: '刷新当前对话' }))
    expect(await screen.findByText('需重新生成')).toBeVisible()
    expect(screen.getByRole('button', { name: '应用到正式问卷' })).toBeDisabled()
  })

  it('keeps the draft and does not send when privacy confirmation is rejected', async () => {
    const user = userEvent.setup()
    const api = installApi(false)
    api.ai.session.list.mockResolvedValue({ ok: true, sessions: [session, secondSession] })
    api.ai.cancel.mockResolvedValue({ ok: true, cancelled: true })
    const previewA = artifactPreview('较早草稿 A')
    const previewB = artifactPreview('最新草稿 B')
    let resolveSend!: (value: {
      ok: true
      requestId: string
      outcome: 'questionnaire'
      artifact: AIQuestionnaireArtifactPreviewDto
      attempts: number
    }) => void
    api.ai.send.mockReturnValue(new Promise((resolve) => { resolveSend = resolve }))
    let resolvePrivacy!: (value: Awaited<ReturnType<typeof api.ai.privacy.status>>) => void
    const delayedPrivacy = new Promise<Awaited<ReturnType<typeof api.ai.privacy.status>>>((resolve) => {
      resolvePrivacy = resolve
    })
    api.ai.privacy.status.mockReturnValue(delayedPrivacy)
    renderPage()
    await screen.findByRole('heading', { name: '调查问卷讨论', level: 3 })

    const editor = screen.getByRole('textbox', { name: '给 AI 的消息' })
    await user.type(editor, '帮我设计一份问卷')
    fireEvent.keyDown(editor, { key: 'Enter', isComposing: true })
    expect(api.ai.privacy.status).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: '发送消息' }))
    expect(screen.getByRole('button', { name: '发送消息' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '清除缓存' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '清除缓存' }))
    expect(api.ai.session.clearCache).not.toHaveBeenCalled()
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
    expect(editor).toHaveFocus()

    let resolveOldSessionLoad!: (value: { ok: true; session: AISessionPage }) => void
    api.ai.session.get.mockReturnValueOnce(new Promise((resolve) => {
      resolveOldSessionLoad = resolve
    }))
    await user.click(screen.getByRole('button', { name: '刷新当前对话' }))

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
    expect(screen.getByRole('button', { name: '新建对话' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '第二段对话' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '重命名当前对话' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '清除缓存' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '删除' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '加入当前问卷' })).toBeDisabled()
    expect(editor).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '取消生成' }))
    expect(api.ai.cancel).toHaveBeenCalledWith({
      requestId: api.ai.send.mock.calls[0]?.[0].requestId
    })
    api.ai.session.get.mockResolvedValue({
      ok: true,
      session: artifactPage('artifact-b', 'operation-b')
    })
    api.ai.artifact.preview.mockImplementation(({ artifactId }: { artifactId: string }) =>
      Promise.resolve({ ok: true, preview: artifactId === 'artifact-a' ? previewA : previewB }))
    resolveSend({
      ok: true,
      requestId: api.ai.send.mock.calls[0]?.[0].requestId,
      outcome: 'questionnaire',
      artifact: artifactDto('artifact-b', 'operation-b', previewB),
      attempts: 1
    })
    await waitFor(() => expect(editor).toBeEnabled())
    expect(editor).toHaveFocus()
    expect(screen.getByText('草稿 最新草稿 B')).toBeVisible()
    resolveOldSessionLoad({
      ok: true,
      session: artifactPage('artifact-a', 'operation-a')
    })
    await waitFor(() => expect(screen.getByText('草稿 最新草稿 B')).toBeVisible())
    expect(screen.queryByText('草稿 较早草稿 A')).not.toBeInTheDocument()
    expect(api.qnaire.getData).not.toHaveBeenCalled()
  })

  it('sends only the explicit questionnaire boolean after preview confirmation', async () => {
    const user = userEvent.setup()
    const api = installApi(true)
    const extraQuestions = Array.from({ length: 20 }, (_, index) => ({
      id: `question-${index + 2}`,
      content: `附加题目 ${index + 2}`,
      variableName: `extra_${index + 2}`,
      type: 'free_text' as const,
      options: [],
      constraint: { type: 'none' as const },
      isKey: false,
      allowSkip: true,
      order: index + 1
    }))
    const extraRules = Array.from({ length: 20 }, (_, index) => ({
      id: `rule-${index + 2}`,
      sourceQuestionId: 'question-1',
      conditions: [{ questionId: 'question-1', operator: 'equals' as const, value: '1' }],
      logic: 'AND' as const,
      action: 'show' as const,
      targetQuestionIds: [`question-${index + 2}`]
    }))
    const largeQuestionnaire: QuestionnaireDef = {
      ...questionnaire,
      questions: [...questionnaire.questions, ...extraQuestions],
      conditionRules: [...questionnaire.conditionRules, ...extraRules]
    }
    const changedQuestionnaire: QuestionnaireDef = {
      ...largeQuestionnaire,
      questions: largeQuestionnaire.questions.map((question) => ({
        ...question,
        content: question.id === 'question-1' ? '您当前的生理性别是？' : question.content
      }))
    }
    api.qnaire.getData
      .mockResolvedValueOnce(largeQuestionnaire)
      .mockResolvedValueOnce(changedQuestionnaire)
      .mockResolvedValue(changedQuestionnaire)
    renderPage()
    await screen.findByRole('heading', { name: '调查问卷讨论', level: 3 })

    await user.click(screen.getByRole('button', { name: '加入当前问卷' }))
    expect(api.qnaire.getData).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('基线调查')).toBeVisible()
    expect(screen.getByRole('dialog', { name: '加入当前问卷' })).toHaveClass(
      'max-h-[calc(100vh-2rem)]',
      'overflow-y-auto',
      'break-words',
      '[overflow-wrap:anywhere]'
    )
    expect(screen.getByText('您的性别是？')).toBeVisible()
    expect(screen.getByText(/sex/)).toBeVisible()
    expect(screen.getByText(/男/)).toBeVisible()
    expect(screen.getByText(/Key：question-1/)).toBeVisible()
    expect(screen.getByText('规则 rule-1')).toBeVisible()
    expect(screen.queryByText('附加题目 21')).not.toBeInTheDocument()
    expect(screen.queryByText('规则 rule-21')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /继续显示更多题目/ }))
    await user.click(screen.getByRole('button', { name: /继续显示更多规则/ }))
    expect(screen.getByText('附加题目 21')).toBeVisible()
    expect(screen.getByText('规则 rule-21')).toBeVisible()
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

  it('clears only rebuildable cache while keeping the current conversation and artifact visible', async () => {
    const user = userEvent.setup()
    const api = installApi(true)
    const preview = artifactPreview('保留草稿')
    api.ai.session.get.mockResolvedValue({
      ok: true,
      session: {
        ...artifactPage('artifact-cache', 'operation-cache'),
        messages: [{
          id: 'message-cache',
          role: 'user' as const,
          content: '保留这条对话',
          createdAt: '2026-08-25T01:00:00.000Z'
        }],
        total: 1
      }
    })
    api.ai.artifact.preview.mockResolvedValue({ ok: true, preview })
    let resolveClearCache!: (value: { ok: true; removed: number }) => void
    api.ai.session.clearCache.mockReturnValue(new Promise((resolve) => {
      resolveClearCache = resolve
    }))
    renderPage()

    expect(await screen.findByText('保留这条对话')).toBeVisible()
    expect(await screen.findByText('草稿 保留草稿')).toBeVisible()
    await user.click(screen.getByRole('button', { name: '清除缓存' }))
    await user.click(screen.getByRole('button', { name: '确认清除缓存' }))

    await waitFor(() => expect(api.ai.session.clearCache).toHaveBeenCalledWith({
      sessionId: session.sessionId
    }))
    expect(screen.getByRole('button', { name: '清除缓存' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '发送消息' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '加入当前问卷' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '应用到正式问卷' })).toBeDisabled()
    expect(screen.getByRole('textbox', { name: '给 AI 的消息' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '发送消息' }))
    await user.click(screen.getByRole('button', { name: '应用到正式问卷' }))
    expect(api.ai.send).not.toHaveBeenCalled()
    expect(api.ai.artifact.apply).not.toHaveBeenCalled()
    resolveClearCache({ ok: true, removed: 2 })
    expect(screen.getByText('保留这条对话')).toBeVisible()
    expect(screen.getByText('草稿 保留草稿')).toBeVisible()
    expect((await screen.findAllByText(/已清除 2 项可重建缓存/)).length).toBeGreaterThan(0)
    expect(api.ai.session.get).toHaveBeenCalledTimes(2)
    expect(api.qnaire.getData).not.toHaveBeenCalled()
  })
})
