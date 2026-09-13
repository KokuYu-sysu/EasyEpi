import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
    promptVersion: '2',
    promptHash: 'hash',
    harnessVersion: '2',
    schemaVersion: 2
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

const legacySession = {
  ...session,
  versionStamp: {
    ...session.versionStamp,
    promptVersion: '1',
    harnessVersion: '1',
    schemaVersion: 1
  }
}

const questionnaire: QuestionnaireDef = {
  name: '基线调查',
  description: '社区调查',
  questions: [
    {
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
    },
    {
      id: 'age-question',
      content: '您的年龄是？',
      variableName: 'age',
      type: 'numeric_range',
      options: [],
      constraint: { type: 'integer', minValue: 0, maxValue: 120 },
      isKey: false,
      allowSkip: false,
      order: 1
    }
  ],
  conditionRules: [{
    id: 'rule-1',
    sourceQuestionId: 'question-1',
    conditions: [{ questionId: 'question-1', operator: 'equals', value: '1' }],
    logic: 'AND',
    action: 'require',
    targetQuestionIds: ['age-question']
  }],
  keyQuestionIds: ['question-1']
}

/**
 * A question order must equal its array index and a rule must never target its own source, so the
 * fixture above is the only shape the shared format validator accepts. Derived variables are not
 * part of a draft at all: the design surface strips them and the validator rejects the field, so
 * they live on a separate fixture used only where the app reads the real questionnaire.
 */
const questionnaireWithDerivedVariables: QuestionnaireDef = {
  ...questionnaire,
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
      onProgress: vi.fn((scope: { requestId: string; sessionId: string }, callback: (event: AIProgressEvent) => void) => {
        void scope
        void callback
        return vi.fn()
      }),
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
        clearCache: vi.fn(),
        migrate: vi.fn()
      },
      send: vi.fn().mockResolvedValue({ ok: false, errorCode: 'AI_PROVIDER_ERROR', message: 'AI 服务返回错误。' }),
      cancel: vi.fn(),
      artifact: { preview: vi.fn(), apply: vi.fn() }
    },
    qnaire: {
      getData: vi.fn().mockResolvedValue(questionnaireWithDerivedVariables)
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
  it('migrates the current session, reports both outcomes, and refreshes session data', async () => {
    const user = userEvent.setup()
    const api = installApi(true)
    const legacyArtifactPage: AISessionPage = {
      ...artifactPage('artifact-legacy', 'operation-legacy'),
      manifest: legacySession
    }
    let loadedPage = legacyArtifactPage
    api.ai.session.list.mockResolvedValue({ ok: true, sessions: [legacySession] })
    api.ai.session.get.mockImplementation(() => Promise.resolve({ ok: true, session: loadedPage }))
    api.ai.artifact.preview.mockResolvedValue({ ok: true, preview: artifactPreview('旧协议') })
    api.ai.session.migrate
      .mockImplementationOnce(async () => {
        loadedPage = { ...page, manifest: session }
        return { ok: true, migrated: true, session }
      })
      .mockResolvedValueOnce({ ok: true, migrated: false, session })
    renderPage()
    await screen.findByRole('heading', { name: '调查问卷讨论', level: 3 })
    await waitFor(() => expect(screen.getByRole('textbox', { name: '给 AI 的消息' })).toBeDisabled())
    expect(screen.getByRole('alert')).toHaveTextContent('此对话使用旧版 AI 协议。')
    expect(await screen.findByRole('heading', { name: '历史问卷草稿' })).toBeVisible()
    expect(screen.getByRole('button', { name: '应用到正式问卷' })).toBeDisabled()
    const initialGetCalls = api.ai.session.get.mock.calls.length
    const initialListCalls = api.ai.session.list.mock.calls.length

    await user.click(screen.getByRole('button', { name: '迁移当前对话' }))
    await waitFor(() => expect(api.ai.session.migrate).toHaveBeenCalledWith({
      sessionId: session.sessionId
    }))
    await waitFor(() => {
      expect(api.ai.session.get.mock.calls.length).toBeGreaterThan(initialGetCalls)
      expect(api.ai.session.list.mock.calls.length).toBeGreaterThan(initialListCalls)
    })
    expect(screen.getAllByText(/历史草稿仅供查看，请重新生成后应用/).length).toBeGreaterThan(0)

    await user.click(screen.getByRole('button', { name: '迁移当前对话' }))
    expect((await screen.findAllByText(/已是最新 AI 协议，无需迁移/)).length).toBeGreaterThan(0)
  })

  it('reloads the authoritative Session after a provider failure without validation details', async () => {
    const user = userEvent.setup()
    const api = installApi(true)
    const persistedMessage = {
      id: 'message-provider-failure',
      role: 'user' as const,
      content: '生成肺癌筛查问卷',
      createdAt: '2026-08-25T01:05:00.000Z',
      clarification: null
    }
    let loadedPage: AISessionPage = page
    let resolveSend!: (value: { ok: false; errorCode: string; message: string }) => void
    api.ai.session.get.mockImplementation(() => Promise.resolve({ ok: true, session: loadedPage }))
    api.ai.send.mockReturnValue(new Promise((resolve) => { resolveSend = resolve }))
    renderPage()
    await screen.findByRole('heading', { name: '调查问卷讨论', level: 3 })
    const initialGetCalls = api.ai.session.get.mock.calls.length

    await user.type(screen.getByRole('textbox', { name: '给 AI 的消息' }), persistedMessage.content)
    await user.click(screen.getByRole('button', { name: '发送消息' }))
    loadedPage = { ...page, status: 'failed', messages: [persistedMessage], total: 1 }
    await act(async () => resolveSend({
      ok: false,
      errorCode: 'AI_NETWORK_ERROR',
      message: 'raw provider detail'
    }))

    await waitFor(() => expect(api.ai.session.get.mock.calls.length).toBeGreaterThan(initialGetCalls))
    expect(within(screen.getByRole('list', { name: '对话消息' })).getByText(persistedMessage.content)).toBeVisible()
    expect(screen.getByText('无法连接 AI 服务，请检查网络。')).toBeVisible()
  })

  it('previews completed historical artifacts but never enables their apply action', async () => {
    const user = userEvent.setup()
    const api = installApi(true)
    const currentPreview = artifactPreview('当前版本')
    const historicalPreview = artifactPreview('历史版本')
    api.ai.session.get.mockResolvedValue({
      ok: true,
      session: {
        ...page,
        activeArtifactId: 'artifact-current',
        artifacts: [
          {
            artifactId: 'artifact-current', operationId: 'operation-current',
            kind: 'questionnaire-draft', status: 'completed',
            createdAt: '2026-08-25T02:00:00.000Z', updatedAt: '2026-08-25T02:00:00.000Z'
          },
          {
            artifactId: 'artifact-history', operationId: 'operation-history',
            kind: 'questionnaire-draft', status: 'completed',
            createdAt: '2026-08-25T01:00:00.000Z', updatedAt: '2026-08-25T01:00:00.000Z'
          }
        ]
      }
    })
    api.ai.artifact.preview.mockImplementation(({ artifactId }: { artifactId: string }) =>
      Promise.resolve({
        ok: true,
        preview: artifactId === 'artifact-history' ? historicalPreview : currentPreview
      }))
    renderPage()

    expect(await screen.findByText('草稿 当前版本')).toBeVisible()
    await user.click(screen.getByRole('button', { name: /历史草稿（只读）/ }))
    expect(await screen.findByRole('heading', { name: '历史问卷草稿' })).toBeVisible()
    expect(screen.getByText('草稿 历史版本')).toBeVisible()
    expect(screen.getByText(/这是历史记录，仅供查看/)).toBeVisible()
    const applyButton = screen.getByRole('button', { name: '应用到正式问卷' })
    expect(applyButton).toBeDisabled()
    await user.click(applyButton)
    expect(api.ai.artifact.apply).not.toHaveBeenCalled()
  })

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
    const progressStatus = screen.getByRole('status')
    expect(progressStatus).toHaveTextContent(/^正在接收模型回答$/)
    expect(progressStatus).not.toHaveTextContent('已用时')
    expect(progressStatus).not.toHaveTextContent('这是一段无效回答')
    expect(screen.getByText('这是一段无效回答').closest('[aria-live]')).toBeNull()
    expect(screen.getByText(/已用时/).closest('[aria-live]')).toBeNull()

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
    expect(screen.getByText('发现 2 个问题')).toBeVisible()
    expect(screen.getByText('另有问题未显示')).toBeVisible()
    expect(progressStatus).toHaveTextContent(/^正在进行第 1 次自动修复$/)
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

  it('reconciles a recovered run that completed between the initial read and progress subscription', async () => {
    const user = userEvent.setup()
    const api = installApi(true)
    const unsubscribe = vi.fn()
    api.ai.onProgress.mockReturnValue(unsubscribe)
    const recoveredRun = {
      requestId: 'request-recovered',
      runId: 'run-recovered',
      stage: 'streaming' as const,
      attempt: 1 as const,
      startedAt: '2026-08-25T01:00:00.000Z',
      updatedAt: '2026-08-25T01:00:01.000Z',
      streamFallback: true,
      toolCallingFallback: false
    }
    const userMessage = {
      id: 'message-recovered-user',
      role: 'user' as const,
      content: '生成一份随访问卷',
      createdAt: '2026-08-25T01:00:00.000Z',
      clarification: null
    }
    const terminalDetails: AIPublicFailureDetails = {
      attempts: [{
        attempt: 1,
        issues: [{
          code: 'EMPTY_QUESTION',
          field: '$.questions[0].content',
          summary: '题目内容不能为空。'
        }],
        truncated: false
      }]
    }
    const runningPage: AISessionPage = {
      ...page,
      status: 'running',
      activeRun: recoveredRun
    }
    const terminalPage: AISessionPage = {
      ...page,
      status: 'failed',
      messages: [userMessage],
      failures: [{
        runId: recoveredRun.runId,
        userMessageId: userMessage.id,
        completedAt: '2026-08-25T01:00:02.000Z',
        errorCode: 'AI_HARNESS_VALIDATION_FAILED',
        details: terminalDetails
      }],
      total: 1
    }
    let releaseReconciliation!: () => void
    const reconciliationPending = new Promise<void>((resolve) => { releaseReconciliation = resolve })
    api.ai.session.get
      .mockResolvedValueOnce({ ok: true, session: runningPage })
      .mockImplementationOnce(async () => {
        await reconciliationPending
        return { ok: true, session: terminalPage }
      })
      .mockResolvedValue({ ok: true, session: terminalPage })

    renderPage()

    await waitFor(() => expect(api.ai.onProgress).toHaveBeenCalledWith({
      requestId: recoveredRun.requestId,
      sessionId: session.sessionId
    }, expect.any(Function)))
    expect(await screen.findByText(/当前服务不支持流式返回/)).toBeVisible()
    releaseReconciliation()
    await waitFor(() => expect(api.ai.session.get).toHaveBeenCalledTimes(3))
    expect(api.ai.onProgress.mock.invocationCallOrder[0]).toBeLessThan(api.ai.session.get.mock.invocationCallOrder[1]!)
    expect(unsubscribe).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('生成一份随访问卷')).toBeVisible()
    expect(screen.getAllByText('题目内容不能为空。')[0]).toBeVisible()
    expect(screen.queryByText('正在接收模型回答')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '取消生成' })).not.toBeInTheDocument()

    const editor = screen.getByRole('textbox', { name: '给 AI 的消息' })
    expect(editor).toBeEnabled()
    await user.type(editor, '改为 6 个月随访')
    expect(screen.getByRole('button', { name: '发送消息' })).toBeEnabled()
  })

  it('keeps a current interrupted failure visible beside history without offering an empty retry', async () => {
    const user = userEvent.setup()
    const api = installApi(true)
    let progressCallback!: (event: AIProgressEvent) => void
    api.ai.onProgress.mockImplementation((_scope, callback) => {
      progressCallback = callback
      return vi.fn()
    })
    const historicalDetails: AIPublicFailureDetails = {
      attempts: [{
        attempt: 1,
        issues: [{
          code: 'EMPTY_QUESTION',
          field: '$.questions[0].content',
          summary: '题目内容不能为空。'
        }],
        truncated: false
      }]
    }
    const historicalMessage = {
      id: 'message-historical-failure',
      role: 'user' as const,
      content: '较早的失败请求',
      createdAt: '2026-08-25T00:00:00.000Z',
      clarification: null
    }
    const historicalPage: AISessionPage = {
      ...page,
      status: 'failed',
      messages: [historicalMessage],
      failures: [{
        runId: 'run-historical',
        userMessageId: historicalMessage.id,
        completedAt: '2026-08-25T00:01:00.000Z',
        errorCode: 'AI_HARNESS_VALIDATION_FAILED',
        details: historicalDetails
      }],
      total: 1
    }
    api.ai.session.get.mockResolvedValue({ ok: true, session: historicalPage })
    let resolveSend!: (value: {
      ok: false
      errorCode: string
      message: string
      details: AIPublicFailureDetails
    }) => void
    api.ai.send.mockReturnValue(new Promise((resolve) => { resolveSend = resolve }))

    renderPage()
    await screen.findByText('较早的失败请求')
    const editor = screen.getByRole('textbox', { name: '给 AI 的消息' })
    await user.type(editor, '恢复后继续生成')
    await user.click(screen.getByRole('button', { name: '发送消息' }))
    await waitFor(() => expect(api.ai.send).toHaveBeenCalledTimes(1))
    const requestId = api.ai.send.mock.calls[0]![0].requestId
    act(() => progressCallback({
      requestId,
      sessionId: session.sessionId,
      runId: 'run-current-interrupted',
      at: '2026-08-25T00:02:00.000Z',
      type: 'failed',
      attempt: 1,
      errorCode: 'AI_RUN_INTERRUPTED',
      details: { attempts: [] }
    }))
    await act(async () => resolveSend({
      ok: false,
      errorCode: 'AI_RUN_INTERRUPTED',
      message: 'raw internal interruption',
      details: { attempts: [] }
    }))

    expect(screen.getByRole('heading', { name: 'AI 请求未完成' })).toBeVisible()
    expect(screen.getByText('AI 请求在恢复期间中断，请重新发送或修改要求。')).toBeVisible()
    expect(screen.queryByText('raw internal interruption')).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: '根据错误重新生成' })).toHaveLength(1)
    const editButtons = screen.getAllByRole('button', { name: '修改要求' })
    expect(editButtons).toHaveLength(2)
    await user.click(editButtons[1]!)
    expect(editor).toHaveFocus()
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
      ...questionnaireWithDerivedVariables,
      questions: [...questionnaireWithDerivedVariables.questions, ...extraQuestions],
      conditionRules: [...questionnaireWithDerivedVariables.conditionRules, ...extraRules]
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

  it('narrates the staged research pipeline through stage_changed progress events', async () => {
    const user = userEvent.setup()
    const api = installApi(true)
    let progressCallback!: (event: AIProgressEvent) => void
    api.ai.onProgress.mockImplementation((_scope, callback) => {
      progressCallback = callback
      return vi.fn()
    })
    api.ai.send.mockReturnValue(new Promise(() => undefined))
    renderPage()
    await screen.findByRole('heading', { name: '调查问卷讨论', level: 3 })

    await user.type(screen.getByRole('textbox', { name: '给 AI 的消息' }), '生成肺癌筛查问卷')
    await user.click(screen.getByRole('button', { name: '发送消息' }))
    await waitFor(() => expect(api.ai.send).toHaveBeenCalledTimes(1))

    const requestId = api.ai.send.mock.calls[0]![0].requestId
    const baseEvent = {
      requestId,
      sessionId: session.sessionId,
      runId: 'run-staged',
      at: '2026-08-25T01:00:01.000Z'
    }
    expect(screen.getByRole('status')).toHaveTextContent(/^正在准备任务$/)

    act(() => progressCallback({
      ...baseEvent, type: 'stage_changed', attempt: 1, stage: 'planning'
    }))
    expect(screen.getByRole('status')).toHaveTextContent(/^正在翻译并规划检索$/)
    act(() => progressCallback({
      ...baseEvent, type: 'stage_changed', attempt: 1, stage: 'literature'
    }))
    expect(screen.getByRole('status')).toHaveTextContent(/^正在检索医学文献$/)
    act(() => progressCallback({
      ...baseEvent, type: 'stage_changed', attempt: 1, stage: 'web_search'
    }))
    expect(screen.getByRole('status')).toHaveTextContent(/^正在补充权威来源$/)
    act(() => progressCallback({
      ...baseEvent, type: 'stage_changed', attempt: 1, stage: 'extracting'
    }))
    expect(screen.getByRole('status')).toHaveTextContent(/^正在提取研究证据$/)
    act(() => progressCallback({
      ...baseEvent, type: 'stage_changed', attempt: 1, stage: 'connecting'
    }))
    expect(screen.getByRole('status')).toHaveTextContent(/^正在连接模型$/)
    act(() => progressCallback({
      ...baseEvent, type: 'stage_changed', attempt: 1, stage: 'literature'
    }))
    expect(screen.getByRole('status')).toHaveTextContent(/^正在检索医学文献$/)
  })

  it('reports the evidence composition of a completed run and drops citations when nothing was retrieved', async () => {
    const user = userEvent.setup()
    const api = installApi(true)
    const preview = artifactPreview('带证据草稿')
    api.ai.session.get.mockResolvedValue({
      ok: true,
      session: artifactPage('artifact-research', 'operation-research')
    })
    api.ai.artifact.preview.mockResolvedValue({ ok: true, preview })
    api.ai.send
      .mockResolvedValueOnce({
        ok: true,
        requestId: 'request-literature',
        outcome: 'questionnaire',
        artifact: artifactDto('artifact-research', 'operation-research', preview),
        attempts: 1,
        researchStatus: 'literature_and_web',
        researchMode: 'medical',
        citations: [
          { url: 'https://pubmed.ncbi.nlm.nih.gov/12345678/', title: '肺癌筛查随机对照试验' },
          { url: 'https://www.who.int/health-topics/cancer', title: '世界卫生组织癌症专题' }
        ]
      })
      .mockResolvedValueOnce({
        ok: true,
        requestId: 'request-web-only',
        outcome: 'questionnaire',
        artifact: artifactDto('artifact-research', 'operation-research', preview),
        attempts: 1,
        researchStatus: 'web_only',
        citations: [
          { url: 'https://www.who.int/health-topics/cancer', title: '世界卫生组织癌症专题' }
        ]
      })
      .mockResolvedValueOnce({
        ok: true,
        requestId: 'request-literature-only',
        outcome: 'questionnaire',
        artifact: artifactDto('artifact-research', 'operation-research', preview),
        attempts: 1,
        researchStatus: 'literature_only',
        citations: []
      })
      .mockResolvedValueOnce({
        ok: true,
        requestId: 'request-none',
        outcome: 'questionnaire',
        artifact: artifactDto('artifact-research', 'operation-research', preview),
        attempts: 1,
        researchStatus: 'none',
        citations: []
      })
    renderPage()
    await screen.findByRole('heading', { name: '调查问卷讨论', level: 3 })

    await user.type(screen.getByRole('textbox', { name: '给 AI 的消息' }), '生成肺癌筛查问卷')
    await user.click(screen.getByRole('button', { name: '发送消息' }))
    expect(await screen.findByText('本次已检索医学文献并补充联网来源')).toBeVisible()
    expect(screen.getByRole('link', { name: '肺癌筛查随机对照试验' })).toHaveAttribute(
      'href',
      'https://pubmed.ncbi.nlm.nih.gov/12345678/'
    )
    expect(screen.getByRole('link', { name: '世界卫生组织癌症专题' })).toBeVisible()

    await user.type(screen.getByRole('textbox', { name: '给 AI 的消息' }), '只补充联网来源')
    await user.click(screen.getByRole('button', { name: '发送消息' }))
    expect(await screen.findByText('本次已检索联网来源')).toBeVisible()
    expect(screen.queryByText('本次已检索医学文献并补充联网来源')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '世界卫生组织癌症专题' })).toBeVisible()

    await user.type(screen.getByRole('textbox', { name: '给 AI 的消息' }), '只检索文献')
    await user.click(screen.getByRole('button', { name: '发送消息' }))
    expect(
      await screen.findByText('本次已检索医学文献（联网检索未返回可用来源）')
    ).toBeVisible()
    expect(screen.queryByRole('link', { name: '世界卫生组织癌症专题' })).not.toBeInTheDocument()

    await user.type(screen.getByRole('textbox', { name: '给 AI 的消息' }), '改为非医学问卷')
    await user.click(screen.getByRole('button', { name: '发送消息' }))
    expect(await screen.findByText('本次未检索到外部证据（内容依据模型既有知识，请人工核对）')).toBeVisible()
    expect(screen.queryByText('本次已检索医学文献（联网检索未返回可用来源）')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '肺癌筛查随机对照试验' })).not.toBeInTheDocument()
  })

  it('blocks a draft that fails the local render check and names the offending field path', async () => {
    const user = userEvent.setup()
    const api = installApi(true)
    const brokenPreview: AIArtifactPreview = {
      ...artifactPreview('结构异常草稿'),
      draft: {
        ...questionnaire,
        questions: [{ ...questionnaire.questions[0]!, order: 5 }],
        conditionRules: []
      }
    }
    api.ai.session.get.mockResolvedValue({
      ok: true,
      session: artifactPage('artifact-broken', 'operation-broken')
    })
    api.ai.artifact.preview.mockResolvedValue({ ok: true, preview: brokenPreview })
    renderPage()

    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('本地渲染校验未通过')).toBeVisible()
    expect(within(alert).getByText('$.questions[0].order')).toBeVisible()
    expect(within(alert).getByText(/INVALID_ORDER/)).toBeVisible()
    expect(within(alert).getByText(/此草稿无法被问卷设计器识别/)).toBeVisible()
    expect(screen.getAllByText('本地渲染校验未通过')).toHaveLength(2)

    const applyButton = screen.getByRole('button', { name: '应用到正式问卷' })
    expect(applyButton).toBeDisabled()
    await user.click(applyButton)
    expect(api.ai.artifact.apply).not.toHaveBeenCalled()
  })

  it('lists at most 12 render-check problems and summarizes the remaining ones', async () => {
    const api = installApi(true)
    const brokenQuestions: QuestionnaireDef['questions'] = Array.from(
      { length: 15 },
      (_, index) => ({
        id: `broken-${index + 1}`,
        content: `异常题目 ${index + 1}`,
        variableName: `field_${index + 1}`,
        type: 'free_text' as const,
        options: [],
        constraint: { type: 'none' as const },
        isKey: false,
        allowSkip: true,
        order: 99
      })
    )
    const brokenPreview: AIArtifactPreview = {
      ...artifactPreview('多处异常草稿'),
      draft: {
        name: '多处异常问卷',
        questions: brokenQuestions,
        conditionRules: [],
        keyQuestionIds: []
      }
    }
    api.ai.session.get.mockResolvedValue({
      ok: true,
      session: artifactPage('artifact-many-broken', 'operation-many-broken')
    })
    api.ai.artifact.preview.mockResolvedValue({ ok: true, preview: brokenPreview })
    renderPage()

    const alert = await screen.findByRole('alert')
    expect(within(alert).getAllByText(/INVALID_ORDER/)).toHaveLength(12)
    expect(within(alert).getByText('$.questions[11].order')).toBeVisible()
    expect(within(alert).queryByText('$.questions[12].order')).not.toBeInTheDocument()
    expect(within(alert).getByText('另有 3 个问题未显示')).toBeVisible()
    expect(screen.getByRole('button', { name: '应用到正式问卷' })).toBeDisabled()
  })
})
