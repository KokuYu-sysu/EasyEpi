import {
  Bot,
  MessageSquarePlus,
  Paperclip,
  Pencil,
  RefreshCw,
  Send,
  Square,
  Trash2,
  X
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { MilestonePage } from '@renderer/components/common/MilestonePage'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  EmptyState,
  Input,
  Modal,
  Textarea,
  useToast
} from '@renderer/components/ui'
import { friendlyAIError, isProjectBoundaryError } from '@renderer/components/ai/ai-errors'
import {
  AI_PRIVACY_NOTICE,
  type AIArtifactPreview,
  type AIPublicMessage,
  type AIQuestionnaireArtifactPreviewDto,
  type AISessionListItem,
  type AISessionPage,
  type AISessionStatus
} from '@shared/ai-assistant-contract'

const PAGE_SIZE = 50

interface QuestionnaireAttachmentPreview {
  name: string
  description: string | null
  questionCount: number
  ruleCount: number
}

interface ActiveArtifact {
  sessionId: string
  artifactId: string
  operationId: string
  preview: AIArtifactPreview
}

const STATUS_LABELS: Record<AISessionStatus, string> = {
  idle: '空闲',
  running: '处理中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消'
}

function statusVariant(status: AISessionStatus): 'neutral' | 'success' | 'warning' | 'danger' {
  if (status === 'completed') return 'success'
  if (status === 'running') return 'warning'
  if (status === 'failed') return 'danger'
  return 'neutral'
}

function localTime(value: string): string {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '时间未知' : parsed.toLocaleString('zh-CN')
}

function ArtifactPreviewCard({
  artifact,
  applying,
  onApply
}: {
  artifact: ActiveArtifact
  applying: boolean
  onApply(): void
}) {
  const { preview } = artifact
  const metadataChanges = Number(preview.diff.metadata.name !== null) +
    Number(preview.diff.metadata.description !== null)
  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between">
        <div>
          <CardTitle>AI 问卷草稿</CardTitle>
          <p className="mb-0 mt-[var(--space-1)] text-[var(--color-text-secondary)]">
            {preview.rollingSummary}
          </p>
        </div>
        <Badge variant="success">本地校验通过</Badge>
      </CardHeader>
      <CardContent className="grid gap-[var(--space-4)]">
        <p className="m-0 rounded-[var(--radius-1)] bg-[var(--color-brand-soft)] p-[var(--space-3)]">
          {preview.assistantMessage}
        </p>
        <section aria-labelledby="draft-summary-title">
          <h4 id="draft-summary-title" className="mt-0">完整草稿摘要</h4>
          <dl className="m-0 grid gap-[var(--space-2)] sm:grid-cols-2">
            <div><dt className="text-[var(--color-text-secondary)]">名称</dt><dd className="m-0">{preview.draft.name || '未命名问卷'}</dd></div>
            <div><dt className="text-[var(--color-text-secondary)]">说明</dt><dd className="m-0">{preview.draft.description || '无说明'}</dd></div>
            <div><dt className="text-[var(--color-text-secondary)]">题目 / 规则</dt><dd className="m-0">{preview.draft.questions.length} / {preview.draft.conditionRules.length}</dd></div>
            <div><dt className="text-[var(--color-text-secondary)]">Key 数量</dt><dd className="m-0">{preview.draft.keyQuestionIds.length}</dd></div>
          </dl>
        </section>
        <section aria-labelledby="draft-diff-title">
          <h4 id="draft-diff-title" className="mt-0">与正式问卷的差异</h4>
          <div className="grid gap-[var(--space-2)] sm:grid-cols-2 lg:grid-cols-4">
            <Badge variant={metadataChanges > 0 ? 'info' : 'neutral'}>元数据变化 {metadataChanges}</Badge>
            <Badge variant="success">新增题目 {preview.diff.questions.added.length}</Badge>
            <Badge variant="danger">删除题目 {preview.diff.questions.removed.length}</Badge>
            <Badge variant="warning">修改题目 {preview.diff.questions.modified.length}</Badge>
          </div>
          <p className="mb-0 text-[length:var(--font-size-sm)] text-[var(--color-text-secondary)]">
            规则：新增 {preview.diff.rules.added.length}、删除 {preview.diff.rules.removed.length}、修改 {preview.diff.rules.modified.length}
          </p>
          {preview.diff.metadata.name ? (
            <p className="mb-0 text-[length:var(--font-size-sm)]">名称：{preview.diff.metadata.name.before || '未命名'} → {preview.diff.metadata.name.after || '未命名'}</p>
          ) : null}
          {preview.diff.metadata.description ? (
            <p className="mb-0 text-[length:var(--font-size-sm)]">说明：{preview.diff.metadata.description.before || '无'} → {preview.diff.metadata.description.after || '无'}</p>
          ) : null}
          {preview.diff.questions.added.length > 0 ? (
            <p className="mb-0 text-[length:var(--font-size-sm)]">新增：{preview.diff.questions.added.map(({ content }) => content).join('、')}</p>
          ) : null}
          {preview.diff.questions.removed.length > 0 ? (
            <p className="mb-0 text-[length:var(--font-size-sm)]">删除：{preview.diff.questions.removed.map(({ content }) => content).join('、')}</p>
          ) : null}
          {preview.diff.questions.modified.length > 0 ? (
            <p className="mb-0 text-[length:var(--font-size-sm)]">修改：{preview.diff.questions.modified.map(({ variableName, fields }) => `${variableName}（${fields.join('、')}）`).join('；')}</p>
          ) : null}
        </section>
        <div className="flex justify-end">
          <ConfirmDialog
            trigger={<Button loading={applying}>应用到正式问卷</Button>}
            title="应用 AI 问卷草稿"
            description="应用前会自动创建项目备份，并保留现有衍生变量。确定将此草稿应用到正式问卷吗？"
            confirmLabel="确认应用"
            onConfirm={onApply}
          />
        </div>
      </CardContent>
    </Card>
  )
}

export function AIQuestionnairePage() {
  const [sessions, setSessions] = useState<AISessionListItem[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [sessionPage, setSessionPage] = useState<AISessionPage | null>(null)
  const [messages, setMessages] = useState<AIPublicMessage[]>([])
  const [messageOffset, setMessageOffset] = useState(0)
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadingEarlier, setLoadingEarlier] = useState(false)
  const [sending, setSending] = useState(false)
  const [applying, setApplying] = useState(false)
  const [requestId, setRequestId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [projectBlocked, setProjectBlocked] = useState(false)
  const [configMissing, setConfigMissing] = useState(false)
  const [privacyAccepted, setPrivacyAccepted] = useState<boolean | null>(null)
  const [privacyOpen, setPrivacyOpen] = useState(false)
  const [attachmentOpen, setAttachmentOpen] = useState(false)
  const [attachmentLoading, setAttachmentLoading] = useState(false)
  const [attachmentPreview, setAttachmentPreview] = useState<QuestionnaireAttachmentPreview | null>(null)
  const [includeCurrentQuestionnaire, setIncludeCurrentQuestionnaire] = useState(false)
  const [activeArtifact, setActiveArtifact] = useState<ActiveArtifact | null>(null)
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameTitle, setRenameTitle] = useState('')
  const [announcement, setAnnouncement] = useState('')
  const loadSequence = useRef(0)
  const toast = useToast()

  const clearProjectContent = useCallback((message?: string) => {
    loadSequence.current += 1
    setSessions([])
    setActiveSessionId(null)
    setSessionPage(null)
    setMessages([])
    setMessageOffset(0)
    setActiveArtifact(null)
    setIncludeCurrentQuestionnaire(false)
    setAttachmentPreview(null)
    setProjectBlocked(true)
    setLoading(false)
    setError(message ?? '请先从欢迎页创建或打开项目，并使用项目密码完成解锁。')
  }, [])

  const handleFailure = useCallback((code: string | undefined, fallback: string) => {
    const message = friendlyAIError(code, fallback)
    if (isProjectBoundaryError(code)) clearProjectContent(message)
    else setError(message)
  }, [clearProjectContent])

  const loadArtifact = useCallback(async (sessionId: string, artifactId: string, operationId: string) => {
    try {
      const result = await window.easyEpi.ai.artifact.preview({ sessionId, artifactId })
      if (result.ok) setActiveArtifact({ sessionId, artifactId, operationId, preview: result.preview })
      else handleFailure(result.errorCode, '无法读取 AI 草稿。')
    } catch {
      setError('无法读取 AI 草稿。')
    }
  }, [handleFailure])

  const loadLatestSession = useCallback(async (sessionId: string) => {
    const sequence = ++loadSequence.current
    setLoading(true)
    setError(null)
    try {
      const probe = await window.easyEpi.ai.session.get({ sessionId, offset: 0, limit: 1 })
      if (sequence !== loadSequence.current) return
      if (!probe.ok) {
        handleFailure(probe.errorCode, '无法读取 AI 对话。')
        return
      }
      const offset = Math.max(0, probe.session.total - PAGE_SIZE)
      const result = await window.easyEpi.ai.session.get({ sessionId, offset, limit: PAGE_SIZE })
      if (sequence !== loadSequence.current) return
      if (!result.ok) {
        handleFailure(result.errorCode, '无法读取 AI 对话。')
        return
      }
      setProjectBlocked(false)
      setSessionPage(result.session)
      setMessages(result.session.messages)
      setMessageOffset(offset)
      if (result.session.activeArtifactId === null) {
        setActiveArtifact(null)
      } else {
        const summary = result.session.artifacts.find(({ artifactId }) => artifactId === result.session.activeArtifactId)
        if (summary !== undefined && summary.status === 'completed') {
          void loadArtifact(sessionId, summary.artifactId, summary.operationId)
        }
      }
    } catch {
      if (sequence === loadSequence.current) setError('无法读取 AI 对话。')
    } finally {
      if (sequence === loadSequence.current) setLoading(false)
    }
  }, [handleFailure, loadArtifact])

  const loadSessions = useCallback(async (preferredSessionId?: string) => {
    try {
      const result = await window.easyEpi.ai.session.list()
      if (!result.ok) {
        handleFailure(result.errorCode, '无法读取 AI 对话列表。')
        return
      }
      setProjectBlocked(false)
      setSessions(result.sessions)
      setActiveSessionId((current) => {
        const preferred = preferredSessionId ?? current
        return preferred !== null && preferred !== undefined &&
          result.sessions.some(({ sessionId }) => sessionId === preferred)
          ? preferred
          : (result.sessions[0]?.sessionId ?? null)
      })
      if (result.sessions.length === 0) {
        setSessionPage(null)
        setMessages([])
        setActiveArtifact(null)
      }
    } catch {
      setError('无法读取 AI 对话列表。')
    } finally {
      setLoading(false)
    }
  }, [handleFailure])

  useEffect(() => {
    void Promise.resolve().then(() => loadSessions())
    void window.easyEpi.ai.config.get().then((result) => {
      setConfigMissing(!result.ok || !result.config.baseUrl || !result.config.model || !result.config.hasApiKey)
    }).catch(() => setConfigMissing(true))
    return window.easyEpi.project.onClosed?.(() => clearProjectContent())
  }, [clearProjectContent, loadSessions])

  useEffect(() => {
    if (activeSessionId === null) return
    void Promise.resolve().then(() => loadLatestSession(activeSessionId))
  }, [activeSessionId, loadLatestSession])

  const createSession = async () => {
    setError(null)
    try {
      const result = await window.easyEpi.ai.session.create()
      if (!result.ok) return handleFailure(result.errorCode, '无法创建 AI 对话。')
      setAnnouncement('新对话已创建。')
      await loadSessions(result.session.sessionId)
    } catch {
      setError('无法创建 AI 对话。')
    }
  }

  const saveRename = async () => {
    if (activeSessionId === null || renameTitle.trim().length === 0) {
      setError('请输入对话名称。')
      return
    }
    try {
      const result = await window.easyEpi.ai.session.update({
        sessionId: activeSessionId,
        title: renameTitle.trim()
      })
      if (!result.ok) return handleFailure(result.errorCode, '无法重命名 AI 对话。')
      setRenameOpen(false)
      setAnnouncement('对话已重命名。')
      await loadSessions(activeSessionId)
    } catch {
      setError('无法重命名 AI 对话。')
    }
  }

  const deleteSession = async () => {
    if (activeSessionId === null) return
    try {
      const result = await window.easyEpi.ai.session.delete({ sessionId: activeSessionId })
      if (!result.ok) return handleFailure(result.errorCode, '无法删除 AI 对话。')
      setAnnouncement(result.deleted ? '对话已删除。' : '对话已不存在。')
      setActiveSessionId(null)
      await loadSessions()
    } catch {
      setError('无法删除 AI 对话。')
    }
  }

  const loadEarlier = async () => {
    if (activeSessionId === null || messageOffset <= 0 || loadingEarlier) return
    const nextOffset = Math.max(0, messageOffset - PAGE_SIZE)
    setLoadingEarlier(true)
    try {
      const result = await window.easyEpi.ai.session.get({
        sessionId: activeSessionId,
        offset: nextOffset,
        limit: messageOffset - nextOffset
      })
      if (!result.ok) return handleFailure(result.errorCode, '无法加载更早的消息。')
      setMessages((current) => [...result.session.messages, ...current])
      setMessageOffset(nextOffset)
      setSessionPage((current) => current === null ? result.session : { ...current, total: result.session.total })
    } catch {
      setError('无法加载更早的消息。')
    } finally {
      setLoadingEarlier(false)
    }
  }

  const previewQuestionnaireAttachment = async () => {
    setAttachmentLoading(true)
    setError(null)
    try {
      const questionnaire = await window.easyEpi.qnaire.getData()
      setAttachmentPreview({
        name: questionnaire.name || '未命名问卷',
        description: questionnaire.description?.trim() || null,
        questionCount: questionnaire.questions.length,
        ruleCount: questionnaire.conditionRules.length
      })
      setAttachmentOpen(true)
    } catch {
      setError('无法读取当前问卷。请先创建或打开项目并完成解锁。')
    } finally {
      setAttachmentLoading(false)
    }
  }

  const refreshAfterSend = async (sessionId: string, artifact: AIQuestionnaireArtifactPreviewDto) => {
    setActiveArtifact({
      sessionId,
      artifactId: artifact.artifactId,
      operationId: artifact.operationId,
      preview: artifact.value
    })
    await Promise.all([
      loadLatestSession(sessionId),
      loadSessions(sessionId),
      loadArtifact(sessionId, artifact.artifactId, artifact.operationId)
    ])
  }

  const performSend = async () => {
    if (activeSessionId === null || draft.trim().length === 0 || sending) return
    const currentRequestId = crypto.randomUUID()
    const sessionId = activeSessionId
    setRequestId(currentRequestId)
    setSending(true)
    setError(null)
    setAnnouncement('消息已发送，AI 正在生成问卷草稿。')
    try {
      const result = await window.easyEpi.ai.send({
        requestId: currentRequestId,
        sessionId,
        content: draft,
        includeCurrentQuestionnaire
      })
      if (!result.ok) {
        handleFailure(result.errorCode, 'AI 生成失败，请重试。')
        setAnnouncement('AI 请求未完成。')
        return
      }
      setDraft('')
      setAnnouncement('AI 问卷草稿已生成。')
      await refreshAfterSend(sessionId, result.artifact)
    } catch {
      setError('AI 生成失败，请重试。')
      setAnnouncement('AI 请求未完成。')
    } finally {
      setIncludeCurrentQuestionnaire(false)
      setAttachmentPreview(null)
      setSending(false)
      setRequestId(null)
    }
  }

  const startSend = async () => {
    if (activeSessionId === null || draft.trim().length === 0 || sending) return
    if (privacyAccepted === true) return performSend()
    try {
      const result = await window.easyEpi.ai.privacy.status()
      if (!result.ok) return handleFailure(result.errorCode, '无法读取 AI 隐私确认状态。')
      setPrivacyAccepted(result.accepted)
      if (result.accepted) return performSend()
      setPrivacyOpen(true)
    } catch {
      setError('无法读取 AI 隐私确认状态。')
    }
  }

  const acceptPrivacyAndSend = async () => {
    try {
      const result = await window.easyEpi.ai.privacy.accept()
      if (!result.ok) return handleFailure(result.errorCode, '无法保存 AI 隐私确认。')
      setPrivacyAccepted(true)
      setPrivacyOpen(false)
      await performSend()
    } catch {
      setError('无法保存 AI 隐私确认。')
    }
  }

  const cancelSend = async () => {
    if (requestId === null) return
    try {
      const result = await window.easyEpi.ai.cancel({ requestId })
      setAnnouncement(result.ok && result.cancelled ? '已请求取消 AI 生成。' : '请求已结束，无需取消。')
    } catch {
      setError('暂时无法取消 AI 请求。')
    }
  }

  const applyArtifact = async () => {
    if (activeSessionId === null || activeArtifact === null || applying) return
    setApplying(true)
    setError(null)
    try {
      const result = await window.easyEpi.ai.artifact.apply({
        sessionId: activeSessionId,
        artifactId: activeArtifact.artifactId,
        operationId: activeArtifact.operationId
      })
      if (!result.ok) return handleFailure(result.errorCode, '无法应用 AI 草稿。')
      setActiveArtifact((current) => current === null ? null : { ...current, preview: result.preview })
      toast.push({
        title: result.applied ? 'AI 草稿已应用到正式问卷' : '此草稿已应用',
        description: result.applied ? '应用前备份已保留，衍生变量未被覆盖。' : undefined,
        tone: 'success'
      })
      setAnnouncement(result.applied ? 'AI 草稿已应用。' : '该草稿之前已经应用。')
      await Promise.all([
        loadLatestSession(activeSessionId),
        loadSessions(activeSessionId),
        loadArtifact(activeSessionId, activeArtifact.artifactId, activeArtifact.operationId)
      ])
    } catch {
      setError('无法应用 AI 草稿，草稿仍保留供查看。')
    } finally {
      setApplying(false)
    }
  }

  const activeSession = sessions.find(({ sessionId }) => sessionId === activeSessionId)
  const canSend = activeSessionId !== null && draft.trim().length > 0 && !sending && !projectBlocked

  return (
    <MilestonePage
      title="AI 问卷助手"
      description="通过多轮对话生成、校验并安全应用问卷草稿。"
      actions={<Button onClick={() => void createSession()} disabled={projectBlocked}><MessageSquarePlus aria-hidden="true" size={18} />新建对话</Button>}
    >
      <p className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</p>
      {configMissing ? (
        <Card className="border-[var(--color-warning)] bg-[var(--color-warning-soft)]">
          <CardContent className="pt-[var(--space-5)]">
            <p className="m-0"><strong>尚未完成 AI 服务配置。</strong> 请使用右上角「设置」配置 Base URL、模型名称和 API Key。</p>
          </CardContent>
        </Card>
      ) : null}
      {error ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-[var(--space-2)] rounded-[var(--radius-1)] border border-[var(--color-danger)] bg-[var(--color-danger-soft)] p-[var(--space-3)] text-[var(--color-danger)]">
          <span>{error}</span>
          <Button size="sm" variant="ghost" onClick={() => setError(null)}>关闭</Button>
        </div>
      ) : null}
      {projectBlocked ? (
        <EmptyState
          title="需要已打开且已解锁的项目"
          description="请先返回欢迎页创建或打开项目，并输入项目密码完成解锁，再使用 AI 问卷助手。"
          illustration="empty"
        />
      ) : (
        <div className="grid min-w-0 gap-[var(--space-4)] lg:grid-cols-[18rem_minmax(0,1fr)]">
          <Card className="min-w-0 self-start">
            <CardHeader><CardTitle>对话</CardTitle></CardHeader>
            <CardContent className="grid gap-[var(--space-3)]">
              {sessions.length === 0 && !loading ? (
                <EmptyState
                  title="还没有 AI 对话"
                  description="新建对话后即可开始设计问卷。"
                  action={<Button onClick={() => void createSession()}>新建第一个对话</Button>}
                />
              ) : (
                <ul aria-label="AI 对话列表" className="m-0 grid list-none gap-[var(--space-2)] p-0">
                  {sessions.map((item) => (
                    <li key={item.sessionId}>
                      <Button
                        className="w-full justify-start text-left"
                        variant={item.sessionId === activeSessionId ? 'secondary' : 'ghost'}
                        aria-pressed={item.sessionId === activeSessionId}
                        onClick={() => setActiveSessionId(item.sessionId)}
                      >
                        <span className="min-w-0 truncate">{item.title}</span>
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              {activeSession ? (
                <div className="flex flex-wrap gap-[var(--space-2)] border-t border-[var(--color-border-default)] pt-[var(--space-3)]">
                  <Button size="sm" variant="ghost" onClick={() => { setRenameTitle(activeSession.title); setRenameOpen(true) }} aria-label="重命名当前对话"><Pencil aria-hidden="true" size={16} />重命名</Button>
                  <ConfirmDialog
                    trigger={<Button size="sm" variant="danger"><Trash2 aria-hidden="true" size={16} />删除</Button>}
                    title="删除 AI 对话"
                    description={`确定删除「${activeSession.title}」吗？该对话及其草稿将无法恢复。`}
                    confirmLabel="确认删除"
                    onConfirm={() => void deleteSession()}
                  />
                </div>
              ) : null}
            </CardContent>
          </Card>

          <div className="grid min-w-0 gap-[var(--space-4)]">
            {activeSessionId === null ? (
              <EmptyState title="选择或新建对话" description="对话内容和 AI 草稿将在这里显示。" illustration="no-data" />
            ) : (
              <>
                <Card aria-busy={loading}>
                  <CardHeader className="flex-row flex-wrap items-center justify-between">
                    <div>
                      <CardTitle>{activeSession?.title ?? 'AI 对话'}</CardTitle>
                      {sessionPage ? <Badge className="mt-[var(--space-2)]" variant={statusVariant(sessionPage.status)}>{STATUS_LABELS[sessionPage.status]}</Badge> : null}
                    </div>
                    <Button size="sm" variant="secondary" onClick={() => void loadLatestSession(activeSessionId)} disabled={loading} aria-label="刷新当前对话"><RefreshCw aria-hidden="true" size={16} />刷新</Button>
                  </CardHeader>
                  <CardContent className="grid gap-[var(--space-3)]">
                    {messageOffset > 0 ? <Button variant="ghost" loading={loadingEarlier} onClick={() => void loadEarlier()}>加载更早</Button> : null}
                    {loading && messages.length === 0 ? <p className="m-0 text-[var(--color-text-secondary)]">正在加载对话…</p> : null}
                    {!loading && messages.length === 0 ? <EmptyState title="开始这段对话" description="描述研究目的、目标人群和希望收集的信息。" /> : null}
                    <ol aria-label="对话消息" className="m-0 grid list-none gap-[var(--space-3)] p-0">
                      {messages.map((message) => (
                        <li key={message.id} className={`max-w-[90%] rounded-[var(--radius-2)] p-[var(--space-3)] ${message.role === 'user' ? 'ml-auto bg-[var(--color-brand-soft)]' : 'mr-auto bg-[var(--color-surface-sunken)]'}`}>
                          <div className="mb-[var(--space-1)] flex items-center gap-[var(--space-2)] text-[length:var(--font-size-sm)] font-[var(--font-weight-semibold)]">
                            {message.role === 'user' ? '你' : <><Bot aria-hidden="true" size={16} />AI 助手</>}
                          </div>
                          <p className="m-0 whitespace-pre-wrap break-words">{message.content}</p>
                          {sessionPage?.attachments.some(({ messageId }) => messageId === message.id) ? (
                            <Badge className="mt-[var(--space-2)]" variant="info">本次消息附加了当时的问卷</Badge>
                          ) : null}
                          <time className="mt-[var(--space-2)] block text-[length:var(--font-size-xs)] text-[var(--color-text-muted)]" dateTime={message.createdAt}>{localTime(message.createdAt)}</time>
                        </li>
                      ))}
                    </ol>
                  </CardContent>
                </Card>

                {activeArtifact?.sessionId === activeSessionId ? <ArtifactPreviewCard artifact={activeArtifact} applying={applying} onApply={() => void applyArtifact()} /> : null}

                <Card>
                  <CardContent className="grid gap-[var(--space-3)] pt-[var(--space-5)]">
                    {includeCurrentQuestionnaire && attachmentPreview ? (
                      <div className="flex flex-wrap items-center justify-between gap-[var(--space-2)] rounded-[var(--radius-1)] border border-[var(--color-info)] bg-[var(--color-info-soft)] p-[var(--space-3)]">
                        <span>本次发送将加入当前问卷：{attachmentPreview.name}</span>
                        <Button size="sm" variant="ghost" aria-label="移除当前问卷附件" onClick={() => { setIncludeCurrentQuestionnaire(false); setAttachmentPreview(null) }}><X aria-hidden="true" size={16} />移除</Button>
                      </div>
                    ) : null}
                    <Textarea
                      label="给 AI 的消息"
                      value={draft}
                      disabled={sending}
                      placeholder="例如：为社区高血压筛查设计一份简洁问卷……"
                      hint="Enter 发送，Shift+Enter 换行。只有对话内容和你明确加入的当前问卷会发送。"
                      onChange={(event) => setDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && !event.shiftKey) {
                          event.preventDefault()
                          void startSend()
                        }
                      }}
                    />
                    <div className="flex flex-wrap justify-between gap-[var(--space-2)]">
                      <Button variant="secondary" loading={attachmentLoading} disabled={sending || includeCurrentQuestionnaire} onClick={() => void previewQuestionnaireAttachment()}><Paperclip aria-hidden="true" size={16} />加入当前问卷</Button>
                      {sending ? (
                        <Button variant="danger" onClick={() => void cancelSend()}><Square aria-hidden="true" size={14} />取消生成</Button>
                      ) : (
                        <Button onClick={() => void startSend()} disabled={!canSend} aria-label="发送消息"><Send aria-hidden="true" size={16} />发送</Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </>
            )}
          </div>
        </div>
      )}

      <Modal
        trigger={<Button className="sr-only">隐私确认</Button>}
        title="AI 隐私确认"
        description={AI_PRIVACY_NOTICE}
        open={privacyOpen}
        onOpenChange={setPrivacyOpen}
      >
        <div className="grid gap-[var(--space-3)] pt-[var(--space-4)]">
          <p className="m-0 text-[var(--color-text-secondary)]">接受后才会发送当前消息；暂不接受将保留输入内容。</p>
          <div className="flex justify-end gap-[var(--space-2)]">
            <Button variant="secondary" onClick={() => setPrivacyOpen(false)}>暂不接受</Button>
            <Button onClick={() => void acceptPrivacyAndSend()}>接受并发送</Button>
          </div>
        </div>
      </Modal>

      <Modal
        trigger={<Button className="sr-only">当前问卷发送预览</Button>}
        title="加入当前问卷"
        description="请确认本次发送将包含的问卷摘要。"
        open={attachmentOpen}
        onOpenChange={setAttachmentOpen}
      >
        {attachmentPreview ? (
          <div className="grid gap-[var(--space-3)] pt-[var(--space-4)]">
            <dl className="m-0 grid gap-[var(--space-2)]">
              <div><dt className="text-[var(--color-text-secondary)]">问卷名</dt><dd className="m-0">{attachmentPreview.name}</dd></div>
              <div><dt className="text-[var(--color-text-secondary)]">说明</dt><dd className="m-0">{attachmentPreview.description ?? '无说明'}</dd></div>
              <div><dt className="text-[var(--color-text-secondary)]">题目 / 规则</dt><dd className="m-0">{attachmentPreview.questionCount} / {attachmentPreview.ruleCount}</dd></div>
            </dl>
            <p className="m-0 rounded-[var(--radius-1)] bg-[var(--color-warning-soft)] p-[var(--space-3)]">衍生变量不会发送。</p>
            <div className="flex justify-end gap-[var(--space-2)]">
              <Button variant="secondary" onClick={() => setAttachmentOpen(false)}>取消</Button>
              <Button onClick={() => { setIncludeCurrentQuestionnaire(true); setAttachmentOpen(false) }}>确认加入</Button>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        trigger={<Button className="sr-only">重命名对话</Button>}
        title="重命名 AI 对话"
        description="输入便于识别的对话名称。"
        open={renameOpen}
        onOpenChange={setRenameOpen}
      >
        <div className="grid gap-[var(--space-3)] pt-[var(--space-4)]">
          <Input label="对话名称" value={renameTitle} maxLength={120} onChange={(event) => setRenameTitle(event.target.value)} />
          <div className="flex justify-end gap-[var(--space-2)]">
            <Button variant="secondary" onClick={() => setRenameOpen(false)}>取消</Button>
            <Button onClick={() => void saveRename()} disabled={renameTitle.trim().length === 0}>保存名称</Button>
          </div>
        </div>
      </Modal>
    </MilestonePage>
  )
}
