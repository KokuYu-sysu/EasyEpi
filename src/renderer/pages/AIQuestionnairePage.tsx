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
import { subscribeAIConfigChanged } from '@renderer/components/ai/ai-config-events'
import {
  AI_PRIVACY_NOTICE,
  type AIArtifactPreview,
  type AIPublicAttachmentSummary,
  type AIPublicMessage,
  type AIQuestionnaireArtifactPreviewDto,
  type AISessionListItem,
  type AISessionPage,
  type AISessionStatus
} from '@shared/ai-assistant-contract'
import {
  CONDITION_OPERATOR_LABELS,
  CONSTRAINT_TYPE_LABELS,
  QUESTION_TYPE_LABELS,
  type QuestionnaireDef
} from '@shared/types/qnaire'

const PAGE_SIZE = 50
const ATTACHMENT_BATCH_SIZE = 20

interface QuestionnaireAttachmentPreview {
  snapshot: Omit<QuestionnaireDef, 'derivedVariables'>
  fingerprint: string
}

interface ActiveArtifact {
  sessionId: string
  artifactId: string
  operationId: string
  preview: AIArtifactPreview
}

interface ArtifactApplicability {
  artifactId: string
  applicable: boolean
}

interface PendingSendIntent {
  requestId: string
  sessionId: string
  generation: number
  content: string
  includeCurrentQuestionnaire: boolean
  attachmentFingerprint: string | null
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

function questionnaireAttachmentSnapshot(
  questionnaire: QuestionnaireDef
): Omit<QuestionnaireDef, 'derivedVariables'> {
  return {
    name: questionnaire.name,
    ...(questionnaire.description === undefined ? {} : { description: questionnaire.description }),
    questions: questionnaire.questions.map((question) => ({
      id: question.id,
      content: question.content,
      variableName: question.variableName,
      type: question.type,
      options: question.options.map(({ value, label }) => ({ value, label })),
      constraint: {
        type: question.constraint.type,
        ...(question.constraint.fixedLength === undefined ? {} : { fixedLength: question.constraint.fixedLength }),
        ...(question.constraint.minValue === undefined ? {} : { minValue: question.constraint.minValue }),
        ...(question.constraint.maxValue === undefined ? {} : { maxValue: question.constraint.maxValue }),
        ...(question.constraint.step === undefined ? {} : { step: question.constraint.step }),
        ...(question.constraint.regexPattern === undefined ? {} : { regexPattern: question.constraint.regexPattern }),
        ...(question.constraint.regexFlags === undefined ? {} : { regexFlags: question.constraint.regexFlags })
      },
      ...(question.defaultValue === undefined ? {} : { defaultValue: question.defaultValue }),
      isKey: question.isKey,
      allowSkip: question.allowSkip,
      ...(question.skipValue === undefined ? {} : { skipValue: question.skipValue }),
      order: question.order
    })),
    conditionRules: questionnaire.conditionRules.map((rule) => ({
      id: rule.id,
      sourceQuestionId: rule.sourceQuestionId,
      conditions: rule.conditions.map(({ questionId, operator, value }) => ({
        questionId,
        operator,
        value
      })),
      logic: rule.logic,
      action: rule.action,
      targetQuestionIds: [...rule.targetQuestionIds]
    })),
    keyQuestionIds: [...questionnaire.keyQuestionIds]
  }
}

function questionnaireFingerprint(snapshot: Omit<QuestionnaireDef, 'derivedVariables'>): string {
  return JSON.stringify(snapshot)
}

function createAttachmentPreview(questionnaire: QuestionnaireDef): QuestionnaireAttachmentPreview {
  const snapshot = questionnaireAttachmentSnapshot(questionnaire)
  return { snapshot, fingerprint: questionnaireFingerprint(snapshot) }
}

function constraintSummary(constraint: QuestionnaireDef['questions'][number]['constraint']): string {
  const details = [
    constraint.fixedLength === undefined ? null : `长度 ${constraint.fixedLength}`,
    constraint.minValue === undefined ? null : `最小 ${constraint.minValue}`,
    constraint.maxValue === undefined ? null : `最大 ${constraint.maxValue}`,
    constraint.step === undefined ? null : `步长 ${constraint.step}`,
    constraint.regexPattern === undefined ? null : `表达式 ${constraint.regexPattern}`,
    constraint.regexFlags === undefined ? null : `标志 ${constraint.regexFlags}`
  ].filter((item): item is string => item !== null)
  return [CONSTRAINT_TYPE_LABELS[constraint.type], ...details].join('；')
}

function mergeMessages(...groups: AIPublicMessage[][]): AIPublicMessage[] {
  const byId = new Map<string, AIPublicMessage>()
  for (const group of groups) {
    for (const message of group) {
      if (!byId.has(message.id)) byId.set(message.id, message)
    }
  }
  return [...byId.values()]
}

function mergeAttachments(...groups: AIPublicAttachmentSummary[][]): AIPublicAttachmentSummary[] {
  const byId = new Map<string, AIPublicAttachmentSummary>()
  for (const group of groups) {
    for (const attachment of group) {
      if (!byId.has(attachment.attachmentId)) byId.set(attachment.attachmentId, attachment)
    }
  }
  return [...byId.values()]
}

function isTerminalArtifactError(code: string | undefined): boolean {
  return code === 'AI_ARTIFACT_STALE' || code === 'AI_ARTIFACT_NOT_APPLICABLE' ||
    code === 'AI_ARTIFACT_DERIVED_CONFLICT'
}

function ArtifactPreviewCard({
  artifact,
  applying,
  requiresRegeneration,
  onApply
}: {
  artifact: ActiveArtifact
  applying: boolean
  requiresRegeneration: boolean
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
        <Badge variant={requiresRegeneration ? 'warning' : 'success'}>
          {requiresRegeneration ? '需重新生成' : '本地校验通过'}
        </Badge>
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
        {requiresRegeneration ? (
          <p role="status" className="m-0 rounded-[var(--radius-1)] bg-[var(--color-warning-soft)] p-[var(--space-3)]">
            正式问卷或草稿状态已变化，需重新生成后才能应用。
          </p>
        ) : null}
        <div className="flex justify-end">
          <ConfirmDialog
            trigger={<Button loading={applying} disabled={applying || requiresRegeneration}>应用到正式问卷</Button>}
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
  const [clearingCache, setClearingCache] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [projectBlocked, setProjectBlocked] = useState(false)
  const [configMissing, setConfigMissing] = useState(true)
  const [privacyAccepted, setPrivacyAccepted] = useState<boolean | null>(null)
  const [privacyBusy, setPrivacyBusy] = useState(false)
  const [pendingSend, setPendingSend] = useState(false)
  const [privacyOpen, setPrivacyOpen] = useState(false)
  const [attachmentOpen, setAttachmentOpen] = useState(false)
  const [attachmentLoading, setAttachmentLoading] = useState(false)
  const [attachmentPreview, setAttachmentPreview] = useState<QuestionnaireAttachmentPreview | null>(null)
  const [attachmentNotice, setAttachmentNotice] = useState<string | null>(null)
  const [includeCurrentQuestionnaire, setIncludeCurrentQuestionnaire] = useState(false)
  const [confirmedAttachmentFingerprint, setConfirmedAttachmentFingerprint] = useState<string | null>(null)
  const [activeArtifact, setActiveArtifact] = useState<ActiveArtifact | null>(null)
  const [artifactApplicability, setArtifactApplicability] = useState<ArtifactApplicability | null>(null)
  const [visibleQuestionCount, setVisibleQuestionCount] = useState(ATTACHMENT_BATCH_SIZE)
  const [visibleRuleCount, setVisibleRuleCount] = useState(ATTACHMENT_BATCH_SIZE)
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameTitle, setRenameTitle] = useState('')
  const [announcement, setAnnouncement] = useState('')
  const generationRef = useRef(0)
  const configRequestRef = useRef(0)
  const sessionLoadRequestRef = useRef(0)
  const artifactPreviewRequestRef = useRef(0)
  const artifactPreviewTargetRef = useRef<{
    token: number
    sessionId: string
    artifactId: string
    operationId: string
  } | null>(null)
  const activeSessionIdRef = useRef<string | null>(null)
  const activeArtifactRef = useRef<ActiveArtifact | null>(null)
  const mountedRef = useRef(true)
  const pendingSendRef = useRef<PendingSendIntent | null>(null)
  const privacyBusyRef = useRef(false)
  const activeRequestIdRef = useRef<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const toast = useToast()

  const refreshAIConfig = useCallback(async () => {
    const request = ++configRequestRef.current
    try {
      const result = await window.easyEpi.ai.config.get()
      if (!mountedRef.current || request !== configRequestRef.current) return
      setConfigMissing(!result.ok || !result.config.baseUrl ||
        !result.config.model || !result.config.hasApiKey)
    } catch {
      if (mountedRef.current && request === configRequestRef.current) setConfigMissing(true)
    }
  }, [])

  const isCurrent = useCallback((generation: number, sessionId?: string) =>
    mountedRef.current && generationRef.current === generation &&
    (sessionId === undefined || activeSessionIdRef.current === sessionId), [])

  const commitActiveArtifact = useCallback((artifact: ActiveArtifact | null) => {
    activeArtifactRef.current = artifact
    setActiveArtifact(artifact)
  }, [])

  const invalidateArtifactPreview = useCallback(() => {
    artifactPreviewRequestRef.current += 1
    artifactPreviewTargetRef.current = null
  }, [])

  const invalidateSessionLoad = useCallback(() => {
    sessionLoadRequestRef.current += 1
  }, [])

  const focusTextarea = useCallback((generation: number, sessionId: string) => {
    void Promise.resolve().then(() => {
      if (isCurrent(generation, sessionId)) textareaRef.current?.focus({ preventScroll: true })
    })
  }, [isCurrent])

  const setPrivacyBusySynchronized = useCallback((busy: boolean) => {
    privacyBusyRef.current = busy
    setPrivacyBusy(busy)
  }, [])

  const releasePendingSend = useCallback((intent?: PendingSendIntent) => {
    if (intent !== undefined && pendingSendRef.current?.requestId !== intent.requestId) return
    pendingSendRef.current = null
    setPendingSend(false)
    setPrivacyBusySynchronized(false)
  }, [setPrivacyBusySynchronized])

  const clearSessionContent = useCallback(() => {
    invalidateSessionLoad()
    setSessionPage(null)
    setMessages([])
    setMessageOffset(0)
    invalidateArtifactPreview()
    commitActiveArtifact(null)
    setArtifactApplicability(null)
    setIncludeCurrentQuestionnaire(false)
    setConfirmedAttachmentFingerprint(null)
    setAttachmentPreview(null)
    setAttachmentNotice(null)
    setVisibleQuestionCount(ATTACHMENT_BATCH_SIZE)
    setVisibleRuleCount(ATTACHMENT_BATCH_SIZE)
    setAttachmentOpen(false)
    setAttachmentLoading(false)
    setDraft('')
    setError(null)
    activeRequestIdRef.current = null
    pendingSendRef.current = null
    privacyBusyRef.current = false
    setSending(false)
    setPendingSend(false)
    setPrivacyBusy(false)
    setApplying(false)
    setClearingCache(false)
    setLoadingEarlier(false)
    setPrivacyOpen(false)
    setRenameOpen(false)
    setRenameTitle('')
  }, [commitActiveArtifact, invalidateArtifactPreview, invalidateSessionLoad])

  const activateSession = useCallback((sessionId: string | null) => {
    if (activeSessionIdRef.current === sessionId) return
    invalidateSessionLoad()
    generationRef.current += 1
    activeSessionIdRef.current = sessionId
    clearSessionContent()
    setActiveSessionId(sessionId)
    setLoading(sessionId !== null)
  }, [clearSessionContent, invalidateSessionLoad])

  const clearProjectContent = useCallback((message?: string) => {
    invalidateSessionLoad()
    generationRef.current += 1
    activeSessionIdRef.current = null
    setSessions([])
    setActiveSessionId(null)
    clearSessionContent()
    setProjectBlocked(true)
    setLoading(false)
    setAnnouncement('')
    setError(message ?? '请先从欢迎页创建或打开项目，并使用项目密码完成解锁。')
  }, [clearSessionContent, invalidateSessionLoad])

  const handleFailure = useCallback((code: string | undefined, fallback: string) => {
    const message = friendlyAIError(code, fallback)
    if (isProjectBoundaryError(code)) clearProjectContent(message)
    else setError(message)
  }, [clearProjectContent])

  const fetchSessionRange = useCallback(async (
    sessionId: string,
    startOffset: number,
    endOffset: number,
    generation: number,
    basis: AISessionPage,
    sessionLoadToken?: number
  ): Promise<AISessionPage | null> => {
    let cursor = startOffset
    const targetEnd = endOffset
    let latest = basis
    const collectedMessages: AIPublicMessage[] = []
    const collectedAttachments: AIPublicAttachmentSummary[] = []
    for (let iteration = 0; cursor < targetEnd && iteration <= PAGE_SIZE; iteration += 1) {
      const result = await window.easyEpi.ai.session.get({
        sessionId,
        offset: cursor,
        limit: Math.min(PAGE_SIZE, targetEnd - cursor)
      })
      if (!isCurrent(generation, sessionId) ||
        (sessionLoadToken !== undefined && sessionLoadRequestRef.current !== sessionLoadToken)) {
        return null
      }
      if (!result.ok) {
        handleFailure(result.errorCode, '无法读取 AI 对话。')
        return null
      }
      latest = result.session
      const returnedCount = result.session.messages.length
      if (returnedCount === 0) throw new Error('AI_SESSION_PAGINATION_STALLED')
      collectedMessages.push(...result.session.messages)
      collectedAttachments.push(...result.session.attachments)
      const expectedNext = cursor + returnedCount
      if (expectedNext >= targetEnd) {
        cursor = expectedNext
        break
      }
      if (result.session.nextOffset === null || result.session.nextOffset !== expectedNext ||
        result.session.nextOffset <= cursor) {
        throw new Error('AI_SESSION_PAGINATION_STALLED')
      }
      cursor = result.session.nextOffset
    }
    if (cursor < targetEnd) throw new Error('AI_SESSION_PAGINATION_STALLED')
    return {
      ...latest,
      messages: mergeMessages(collectedMessages),
      attachments: mergeAttachments(collectedAttachments),
      total: latest.total,
      nextOffset: null
    }
  }, [handleFailure, isCurrent])

  const loadArtifact = useCallback(async (
    sessionId: string,
    artifactId: string,
    operationId: string,
    generation = generationRef.current
  ) => {
    const token = ++artifactPreviewRequestRef.current
    const target = { token, sessionId, artifactId, operationId }
    artifactPreviewTargetRef.current = target
    if (activeArtifactRef.current?.artifactId !== artifactId) {
      setArtifactApplicability({ artifactId, applicable: true })
    }
    const targetIsCurrent = () => {
      const current = artifactPreviewTargetRef.current
      return isCurrent(generation, sessionId) && current?.token === token &&
        current.sessionId === sessionId && current.artifactId === artifactId &&
        current.operationId === operationId
    }
    try {
      const result = await window.easyEpi.ai.artifact.preview({ sessionId, artifactId })
      if (!targetIsCurrent()) return
      if (result.ok) {
        commitActiveArtifact({ sessionId, artifactId, operationId, preview: result.preview })
        setArtifactApplicability({ artifactId, applicable: true })
      } else {
        const current = activeArtifactRef.current
        if (isTerminalArtifactError(result.errorCode) && current?.sessionId === sessionId &&
          current.artifactId === artifactId && current.operationId === operationId) {
          setArtifactApplicability({ artifactId, applicable: false })
        }
        handleFailure(result.errorCode, '无法读取 AI 草稿。')
      }
    } catch {
      if (targetIsCurrent()) setError('无法读取 AI 草稿。')
    }
  }, [commitActiveArtifact, handleFailure, isCurrent])

  const loadLatestSession = useCallback(async (
    sessionId: string,
    generation = generationRef.current
  ) => {
    if (!isCurrent(generation, sessionId)) return
    const sessionLoadToken = ++sessionLoadRequestRef.current
    const sessionLoadIsCurrent = () => isCurrent(generation, sessionId) &&
      sessionLoadRequestRef.current === sessionLoadToken
    setLoading(true)
    setError(null)
    try {
      const probe = await window.easyEpi.ai.session.get({ sessionId, offset: 0, limit: 1 })
      if (!sessionLoadIsCurrent()) return
      if (!probe.ok) {
        handleFailure(probe.errorCode, '无法读取 AI 对话。')
        return
      }
      const offset = Math.max(0, probe.session.total - PAGE_SIZE)
      const result = probe.session.total === 0
        ? { ...probe.session, messages: [], attachments: [], nextOffset: null }
        : await fetchSessionRange(
            sessionId,
            offset,
            probe.session.total,
            generation,
            probe.session,
            sessionLoadToken
          )
      if (result === null || !sessionLoadIsCurrent()) return
      setProjectBlocked(false)
      setSessionPage(result)
      setMessages(result.messages)
      setMessageOffset(offset)
      if (result.activeArtifactId === null) {
        invalidateArtifactPreview()
        commitActiveArtifact(null)
        setArtifactApplicability(null)
      } else {
        const summary = result.artifacts.find(({ artifactId }) => artifactId === result.activeArtifactId)
        if (summary !== undefined && summary.status === 'completed' && sessionLoadIsCurrent()) {
          void loadArtifact(sessionId, summary.artifactId, summary.operationId, generation)
        }
      }
    } catch {
      if (sessionLoadIsCurrent()) setError('无法读取 AI 对话。')
    } finally {
      if (sessionLoadIsCurrent()) setLoading(false)
    }
  }, [commitActiveArtifact, fetchSessionRange, handleFailure, invalidateArtifactPreview, isCurrent, loadArtifact])

  const loadSessions = useCallback(async (
    preferredSessionId?: string,
    generation = generationRef.current
  ) => {
    try {
      const result = await window.easyEpi.ai.session.list()
      if (!isCurrent(generation)) return
      if (!result.ok) {
        handleFailure(result.errorCode, '无法读取 AI 对话列表。')
        return
      }
      setProjectBlocked(false)
      setSessions(result.sessions)
      const preferred = preferredSessionId ?? activeSessionIdRef.current
      const nextSessionId = preferred !== null && preferred !== undefined &&
        result.sessions.some(({ sessionId }) => sessionId === preferred)
        ? preferred
        : (result.sessions[0]?.sessionId ?? null)
      if (activeSessionIdRef.current !== nextSessionId) {
        activateSession(nextSessionId)
      } else if (nextSessionId === null) {
        clearSessionContent()
      }
    } catch {
      if (isCurrent(generation)) setError('无法读取 AI 对话列表。')
    } finally {
      if (isCurrent(generation)) setLoading(false)
    }
  }, [activateSession, clearSessionContent, handleFailure, isCurrent])

  useEffect(() => {
    mountedRef.current = true
    const generation = generationRef.current
    void Promise.resolve().then(() => loadSessions(undefined, generation))
    void Promise.resolve().then(() => refreshAIConfig())
    const unsubscribeConfig = subscribeAIConfigChanged(() => { void refreshAIConfig() })
    const unsubscribe = window.easyEpi.project.onClosed?.(() => clearProjectContent())
    return () => {
      mountedRef.current = false
      generationRef.current += 1
      configRequestRef.current += 1
      activeSessionIdRef.current = null
      unsubscribeConfig()
      unsubscribe?.()
    }
  }, [clearProjectContent, loadSessions, refreshAIConfig])

  useEffect(() => {
    if (activeSessionId === null) return
    const generation = generationRef.current
    void Promise.resolve().then(() => loadLatestSession(activeSessionId, generation))
  }, [activeSessionId, loadLatestSession])

  const createSession = async () => {
    if (sending || applying) return
    const generation = generationRef.current
    setError(null)
    try {
      const result = await window.easyEpi.ai.session.create()
      if (!isCurrent(generation)) return
      if (!result.ok) return handleFailure(result.errorCode, '无法创建 AI 对话。')
      setAnnouncement('新对话已创建。')
      await loadSessions(result.session.sessionId, generation)
    } catch {
      if (isCurrent(generation)) setError('无法创建 AI 对话。')
    }
  }

  const saveRename = async () => {
    const sessionId = activeSessionIdRef.current
    const generation = generationRef.current
    if (sending || applying) return
    if (sessionId === null || renameTitle.trim().length === 0) {
      setError('请输入对话名称。')
      return
    }
    try {
      const result = await window.easyEpi.ai.session.update({
        sessionId,
        title: renameTitle.trim()
      })
      if (!isCurrent(generation, sessionId)) return
      if (!result.ok) return handleFailure(result.errorCode, '无法重命名 AI 对话。')
      setRenameOpen(false)
      setAnnouncement('对话已重命名。')
      await loadSessions(sessionId, generation)
    } catch {
      if (isCurrent(generation, sessionId)) setError('无法重命名 AI 对话。')
    }
  }

  const deleteSession = async () => {
    const sessionId = activeSessionIdRef.current
    const generation = generationRef.current
    if (sessionId === null || sending || applying) return
    try {
      const result = await window.easyEpi.ai.session.delete({ sessionId })
      if (!isCurrent(generation, sessionId)) return
      if (!result.ok) return handleFailure(result.errorCode, '无法删除 AI 对话。')
      setAnnouncement(result.deleted ? '对话已删除。' : '对话已不存在。')
      activateSession(null)
      await loadSessions(undefined, generationRef.current)
    } catch {
      if (isCurrent(generation, sessionId)) setError('无法删除 AI 对话。')
    }
  }

  const clearSessionCache = async () => {
    const sessionId = activeSessionIdRef.current
    const generation = generationRef.current
    if (sessionId === null || sending || applying || clearingCache) return
    setClearingCache(true)
    setError(null)
    try {
      const result = await window.easyEpi.ai.session.clearCache({ sessionId })
      if (!isCurrent(generation, sessionId)) return
      if (!result.ok) return handleFailure(result.errorCode, '无法清除当前对话缓存。')
      const message = result.removed > 0
        ? `已清除 ${result.removed} 项可重建缓存；对话、状态、草稿和正式问卷未改变。`
        : '当前对话没有可清除的可重建缓存；对话、状态、草稿和正式问卷未改变。'
      setAnnouncement(message)
      toast.push({ title: '当前对话缓存已清理', description: message, tone: 'success' })
    } catch {
      if (isCurrent(generation, sessionId)) setError('无法清除当前对话缓存。')
    } finally {
      if (isCurrent(generation, sessionId)) setClearingCache(false)
    }
  }

  const loadEarlier = async () => {
    const sessionId = activeSessionIdRef.current
    const generation = generationRef.current
    if (sessionId === null || sessionPage === null || messageOffset <= 0 || loadingEarlier) return
    const nextOffset = Math.max(0, messageOffset - PAGE_SIZE)
    setLoadingEarlier(true)
    try {
      const result = await fetchSessionRange(
        sessionId,
        nextOffset,
        messageOffset,
        generation,
        sessionPage
      )
      if (!isCurrent(generation, sessionId)) return
      if (result === null) return
      setMessages((current) => mergeMessages(result.messages, current))
      setMessageOffset(nextOffset)
      setSessionPage((current) => current === null ? result : {
        ...current,
        attachments: mergeAttachments(result.attachments, current.attachments),
        total: result.total
      })
    } catch {
      if (isCurrent(generation, sessionId)) setError('无法加载更早的消息。')
    } finally {
      if (isCurrent(generation, sessionId)) setLoadingEarlier(false)
    }
  }

  const previewQuestionnaireAttachment = async () => {
    const sessionId = activeSessionIdRef.current
    const generation = generationRef.current
    if (sessionId === null || sending || applying) return
    setAttachmentLoading(true)
    setError(null)
    try {
      const questionnaire = await window.easyEpi.qnaire.getData()
      if (!isCurrent(generation, sessionId)) return
      setAttachmentPreview(createAttachmentPreview(questionnaire))
      setAttachmentNotice(null)
      setVisibleQuestionCount(ATTACHMENT_BATCH_SIZE)
      setVisibleRuleCount(ATTACHMENT_BATCH_SIZE)
      setConfirmedAttachmentFingerprint(null)
      setIncludeCurrentQuestionnaire(false)
      setAttachmentOpen(true)
    } catch {
      if (isCurrent(generation, sessionId)) {
        setError('无法读取当前问卷。请先创建或打开项目并完成解锁。')
      }
    } finally {
      if (isCurrent(generation, sessionId)) setAttachmentLoading(false)
    }
  }

  const refreshAfterSend = async (
    sessionId: string,
    artifact: AIQuestionnaireArtifactPreviewDto,
    generation: number
  ) => {
    if (!isCurrent(generation, sessionId)) return
    invalidateSessionLoad()
    invalidateArtifactPreview()
    commitActiveArtifact({
      sessionId,
      artifactId: artifact.artifactId,
      operationId: artifact.operationId,
      preview: artifact.value
    })
    setArtifactApplicability({ artifactId: artifact.artifactId, applicable: true })
    await Promise.all([
      loadLatestSession(sessionId, generation),
      loadSessions(sessionId, generation),
      loadArtifact(sessionId, artifact.artifactId, artifact.operationId, generation)
    ])
  }

  const verifyPendingAttachment = async (intent: PendingSendIntent): Promise<boolean> => {
    if (!intent.includeCurrentQuestionnaire) return true
    try {
      const questionnaire = await window.easyEpi.qnaire.getData()
      if (!isCurrent(intent.generation, intent.sessionId) ||
        pendingSendRef.current?.requestId !== intent.requestId) return false
      const currentPreview = createAttachmentPreview(questionnaire)
      if (currentPreview.fingerprint === intent.attachmentFingerprint) return true
      setAttachmentPreview(currentPreview)
      setAttachmentNotice('当前问卷已发生变化，请核对更新后的完整快照并重新确认。')
      setConfirmedAttachmentFingerprint(null)
      setIncludeCurrentQuestionnaire(false)
      setVisibleQuestionCount(ATTACHMENT_BATCH_SIZE)
      setVisibleRuleCount(ATTACHMENT_BATCH_SIZE)
      setAttachmentOpen(true)
      releasePendingSend(intent)
      return false
    } catch {
      if (isCurrent(intent.generation, intent.sessionId) &&
        pendingSendRef.current?.requestId === intent.requestId) {
        setError('无法读取当前问卷。请先创建或打开项目并完成解锁。')
        releasePendingSend(intent)
      }
      return false
    }
  }

  const performSend = async (intent: PendingSendIntent) => {
    if (!isCurrent(intent.generation, intent.sessionId) ||
      pendingSendRef.current?.requestId !== intent.requestId ||
      activeRequestIdRef.current !== null) return
    activeRequestIdRef.current = intent.requestId
    setSending(true)
    setPrivacyBusySynchronized(false)
    setError(null)
    setAnnouncement('消息已发送，AI 正在生成问卷草稿。')
    try {
      const result = await window.easyEpi.ai.send({
        requestId: intent.requestId,
        sessionId: intent.sessionId,
        content: intent.content,
        includeCurrentQuestionnaire: intent.includeCurrentQuestionnaire
      })
      if (!isCurrent(intent.generation, intent.sessionId) ||
        activeRequestIdRef.current !== intent.requestId ||
        pendingSendRef.current?.requestId !== intent.requestId) return
      if (!result.ok) {
        handleFailure(result.errorCode, 'AI 生成失败，请重试。')
        setAnnouncement('AI 请求未完成。')
        return
      }
      setDraft('')
      setAnnouncement('AI 问卷草稿已生成。')
      await refreshAfterSend(intent.sessionId, result.artifact, intent.generation)
    } catch {
      if (isCurrent(intent.generation, intent.sessionId) &&
        activeRequestIdRef.current === intent.requestId &&
        pendingSendRef.current?.requestId === intent.requestId) {
        setError('AI 生成失败，请重试。')
        setAnnouncement('AI 请求未完成。')
      }
    } finally {
      if (activeRequestIdRef.current === intent.requestId &&
        pendingSendRef.current?.requestId === intent.requestId) {
        activeRequestIdRef.current = null
        if (isCurrent(intent.generation, intent.sessionId)) {
          setIncludeCurrentQuestionnaire(false)
          setConfirmedAttachmentFingerprint(null)
          setAttachmentPreview(null)
          setAttachmentNotice(null)
          setSending(false)
          focusTextarea(intent.generation, intent.sessionId)
        }
        releasePendingSend(intent)
      }
    }
  }

  const continuePendingSend = async (intent: PendingSendIntent) => {
    if (!await verifyPendingAttachment(intent)) return
    if (!isCurrent(intent.generation, intent.sessionId) ||
      pendingSendRef.current?.requestId !== intent.requestId) return
    if (privacyAccepted === true) {
      setPrivacyBusySynchronized(false)
      await performSend(intent)
      return
    }
    try {
      const result = await window.easyEpi.ai.privacy.status()
      if (!isCurrent(intent.generation, intent.sessionId) ||
        pendingSendRef.current?.requestId !== intent.requestId) return
      if (!result.ok) {
        handleFailure(result.errorCode, '无法读取 AI 隐私确认状态。')
        releasePendingSend(intent)
        return
      }
      setPrivacyAccepted(result.accepted)
      setPrivacyBusySynchronized(false)
      if (result.accepted) await performSend(intent)
      else setPrivacyOpen(true)
    } catch {
      if (isCurrent(intent.generation, intent.sessionId) &&
        pendingSendRef.current?.requestId === intent.requestId) {
        setError('无法读取 AI 隐私确认状态。')
        releasePendingSend(intent)
      }
    }
  }

  const startSend = () => {
    if (pendingSendRef.current !== null) return
    const sessionId = activeSessionIdRef.current
    const generation = generationRef.current
    const content = draft
    if (sessionId === null || content.trim().length === 0 || sending || applying || configMissing ||
      sessionPage?.status === 'running') return
    if (includeCurrentQuestionnaire && confirmedAttachmentFingerprint === null) {
      setError('请先确认当前问卷的发送预览。')
      return
    }
    const intent: PendingSendIntent = {
      requestId: crypto.randomUUID(),
      sessionId,
      generation,
      content,
      includeCurrentQuestionnaire,
      attachmentFingerprint: includeCurrentQuestionnaire ? confirmedAttachmentFingerprint : null
    }
    pendingSendRef.current = intent
    setPendingSend(true)
    setPrivacyBusySynchronized(true)
    void continuePendingSend(intent)
  }

  const rejectPrivacy = () => {
    const intent = pendingSendRef.current
    setPrivacyOpen(false)
    releasePendingSend()
    if (intent !== null) focusTextarea(intent.generation, intent.sessionId)
  }

  const acceptPrivacyAndSend = async () => {
    const intent = pendingSendRef.current
    if (intent === null || privacyBusyRef.current ||
      !isCurrent(intent.generation, intent.sessionId)) return
    setPrivacyBusySynchronized(true)
    try {
      const result = await window.easyEpi.ai.privacy.accept()
      if (!isCurrent(intent.generation, intent.sessionId) ||
        pendingSendRef.current?.requestId !== intent.requestId) return
      if (!result.ok) {
        handleFailure(result.errorCode, '无法保存 AI 隐私确认。')
        setPrivacyOpen(false)
        releasePendingSend(intent)
        return
      }
      setPrivacyAccepted(true)
      setPrivacyOpen(false)
      setPrivacyBusySynchronized(false)
      await performSend(intent)
    } catch {
      if (isCurrent(intent.generation, intent.sessionId) &&
        pendingSendRef.current?.requestId === intent.requestId) {
        setError('无法保存 AI 隐私确认。')
        setPrivacyOpen(false)
        releasePendingSend(intent)
      }
    }
  }

  const cancelSend = async () => {
    const sessionId = activeSessionIdRef.current
    const generation = generationRef.current
    const pendingRequestId = activeRequestIdRef.current
    if (pendingRequestId === null || sessionId === null) return
    try {
      const result = await window.easyEpi.ai.cancel({ requestId: pendingRequestId })
      if (!isCurrent(generation, sessionId)) return
      setAnnouncement(result.ok && result.cancelled ? '已请求取消 AI 生成。' : '请求已结束，无需取消。')
    } catch {
      if (isCurrent(generation, sessionId)) setError('暂时无法取消 AI 请求。')
    }
  }

  const applyArtifact = async () => {
    const sessionId = activeSessionIdRef.current
    const generation = generationRef.current
    if (sessionId === null || activeArtifact === null ||
      activeArtifact.sessionId !== sessionId || applying || sending ||
      (artifactApplicability?.artifactId === activeArtifact.artifactId &&
        !artifactApplicability.applicable)) return
    const artifact = activeArtifact
    const artifactIdentityIsCurrent = () => {
      const current = activeArtifactRef.current
      return isCurrent(generation, sessionId) && current?.sessionId === sessionId &&
        current.artifactId === artifact.artifactId && current.operationId === artifact.operationId
    }
    setApplying(true)
    setError(null)
    try {
      const result = await window.easyEpi.ai.artifact.apply({
        sessionId,
        artifactId: artifact.artifactId,
        operationId: artifact.operationId
      })
      if (!artifactIdentityIsCurrent()) return
      if (!result.ok) {
        if (isTerminalArtifactError(result.errorCode)) {
          setArtifactApplicability({ artifactId: artifact.artifactId, applicable: false })
        }
        handleFailure(result.errorCode, '无法应用 AI 草稿。')
        return
      }
      commitActiveArtifact({ ...artifact, preview: result.preview })
      toast.push({
        title: result.applied ? 'AI 草稿已应用到正式问卷' : '此草稿已应用',
        description: result.applied ? '应用前备份已保留，衍生变量未被覆盖。' : undefined,
        tone: 'success'
      })
      setAnnouncement(result.applied ? 'AI 草稿已应用。' : '该草稿之前已经应用。')
      await Promise.all([
        loadLatestSession(sessionId, generation),
        loadSessions(sessionId, generation),
        loadArtifact(sessionId, artifact.artifactId, artifact.operationId, generation)
      ])
    } catch {
      if (artifactIdentityIsCurrent()) {
        setError('无法应用 AI 草稿，草稿仍保留供查看。')
      }
    } finally {
      if (isCurrent(generation, sessionId)) setApplying(false)
    }
  }

  const activeSession = sessions.find(({ sessionId }) => sessionId === activeSessionId)
  const sessionOperationsLocked = sending || applying || clearingCache
  const activeArtifactRequiresRegeneration = activeArtifact !== null &&
    artifactApplicability?.artifactId === activeArtifact.artifactId &&
    !artifactApplicability.applicable
  const canSend = activeSessionId !== null && draft.trim().length > 0 && !sending && !applying &&
    !pendingSend && !privacyBusy &&
    !projectBlocked && !configMissing && sessionPage?.status !== 'running'

  return (
    <MilestonePage
      title="AI 问卷助手"
      description="通过多轮对话生成、校验并安全应用问卷草稿。"
      actions={<Button onClick={() => void createSession()} disabled={projectBlocked || sessionOperationsLocked}><MessageSquarePlus aria-hidden="true" size={18} />新建对话</Button>}
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
                  action={<Button onClick={() => void createSession()} disabled={sessionOperationsLocked}>新建第一个对话</Button>}
                />
              ) : (
                <ul aria-label="AI 对话列表" className="m-0 grid list-none gap-[var(--space-2)] p-0">
                  {sessions.map((item) => (
                    <li key={item.sessionId}>
                      <Button
                        className="w-full justify-start text-left"
                        variant={item.sessionId === activeSessionId ? 'secondary' : 'ghost'}
                        aria-pressed={item.sessionId === activeSessionId}
                        disabled={sessionOperationsLocked}
                        onClick={() => {
                          if (!sessionOperationsLocked) activateSession(item.sessionId)
                        }}
                      >
                        <span className="min-w-0 truncate">{item.title}</span>
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              {activeSession ? (
                <div className="flex flex-wrap gap-[var(--space-2)] border-t border-[var(--color-border-default)] pt-[var(--space-3)]">
                  <Button size="sm" variant="ghost" disabled={sessionOperationsLocked} onClick={() => {
                    if (sessionOperationsLocked) return
                    setRenameTitle(activeSession.title)
                    setRenameOpen(true)
                  }} aria-label="重命名当前对话"><Pencil aria-hidden="true" size={16} />重命名</Button>
                  <ConfirmDialog
                    trigger={<Button size="sm" variant="ghost" disabled={sessionOperationsLocked}>清除缓存</Button>}
                    title="清除当前对话缓存"
                    description="只会删除当前对话的可重建缓存；对话、状态、草稿、artifact 和正式问卷均会保留。"
                    confirmLabel="确认清除缓存"
                    onConfirm={() => void clearSessionCache()}
                  />
                  <ConfirmDialog
                    trigger={<Button size="sm" variant="danger" disabled={sessionOperationsLocked}><Trash2 aria-hidden="true" size={16} />删除</Button>}
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
                    {sessionPage?.status === 'running' ? (
                      <p className="m-0 rounded-[var(--radius-1)] bg-[var(--color-warning-soft)] p-[var(--space-3)] text-[var(--color-text-secondary)]">
                        此对话仍在处理中。请等待后使用「刷新」查看最新状态，期间不能重复发送。
                      </p>
                    ) : null}
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

                {activeArtifact?.sessionId === activeSessionId ? (
                  <ArtifactPreviewCard
                    artifact={activeArtifact}
                    applying={applying}
                    requiresRegeneration={activeArtifactRequiresRegeneration}
                    onApply={() => void applyArtifact()}
                  />
                ) : null}

                <Card>
                  <CardContent className="grid gap-[var(--space-3)] pt-[var(--space-5)]">
                    {includeCurrentQuestionnaire && attachmentPreview ? (
                      <div className="flex flex-wrap items-center justify-between gap-[var(--space-2)] rounded-[var(--radius-1)] border border-[var(--color-info)] bg-[var(--color-info-soft)] p-[var(--space-3)]">
                        <span>本次发送将加入当前问卷：{attachmentPreview.snapshot.name}</span>
                        <Button size="sm" variant="ghost" disabled={sessionOperationsLocked} aria-label="移除当前问卷附件" onClick={() => {
                          if (sessionOperationsLocked) return
                          setIncludeCurrentQuestionnaire(false)
                          setConfirmedAttachmentFingerprint(null)
                          setAttachmentPreview(null)
                          setAttachmentNotice(null)
                        }}><X aria-hidden="true" size={16} />移除</Button>
                      </div>
                    ) : null}
                    <Textarea
                      ref={textareaRef}
                      label="给 AI 的消息"
                      value={draft}
                      disabled={sending || applying || privacyBusy}
                      placeholder="例如：为社区高血压筛查设计一份简洁问卷……"
                      hint="Enter 发送，Shift+Enter 换行。只有对话内容和你明确加入的当前问卷会发送。"
                      onChange={(event) => setDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && !event.shiftKey &&
                          !event.nativeEvent.isComposing) {
                          event.preventDefault()
                          void startSend()
                        }
                      }}
                    />
                    <div className="flex flex-wrap justify-between gap-[var(--space-2)]">
                      <Button variant="secondary" loading={attachmentLoading} disabled={sending || applying || pendingSend || privacyBusy || includeCurrentQuestionnaire} onClick={() => void previewQuestionnaireAttachment()}><Paperclip aria-hidden="true" size={16} />加入当前问卷</Button>
                      {sending ? (
                        <Button variant="danger" onClick={() => void cancelSend()}><Square aria-hidden="true" size={14} />取消生成</Button>
                      ) : (
                        <Button onClick={startSend} loading={privacyBusy} disabled={!canSend} aria-label="发送消息"><Send aria-hidden="true" size={16} />发送</Button>
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
        title="AI 隐私确认"
        description={AI_PRIVACY_NOTICE}
        open={privacyOpen}
        restoreFocusRef={textareaRef}
        onOpenChange={(open) => {
          setPrivacyOpen(open)
          if (!open) releasePendingSend()
        }}
      >
        <div className="grid gap-[var(--space-3)] pt-[var(--space-4)]">
          <p className="m-0 text-[var(--color-text-secondary)]">接受后才会发送当前消息；暂不接受将保留输入内容。</p>
          <div className="flex justify-end gap-[var(--space-2)]">
            <Button variant="secondary" disabled={privacyBusy} onClick={rejectPrivacy}>暂不接受</Button>
            <Button loading={privacyBusy} disabled={privacyBusy || !pendingSend} onClick={() => void acceptPrivacyAndSend()}>接受并发送</Button>
          </div>
        </div>
      </Modal>

      <Modal
        title="加入当前问卷"
        description="请确认本次发送将包含的问卷摘要。"
        open={attachmentOpen}
        onOpenChange={setAttachmentOpen}
        restoreFocusRef={textareaRef}
        className="max-h-[calc(100vh-2rem)] overflow-y-auto break-words [overflow-wrap:anywhere]"
      >
        {attachmentPreview ? (
          <div className="grid gap-[var(--space-3)] pt-[var(--space-4)]">
            <dl className="m-0 grid gap-[var(--space-2)]">
              <div><dt className="text-[var(--color-text-secondary)]">问卷名</dt><dd className="m-0">{attachmentPreview.snapshot.name}</dd></div>
              <div><dt className="text-[var(--color-text-secondary)]">说明</dt><dd className="m-0">{attachmentPreview.snapshot.description ?? '无说明'}</dd></div>
              <div><dt className="text-[var(--color-text-secondary)]">题目 / 规则</dt><dd className="m-0">{attachmentPreview.snapshot.questions.length} / {attachmentPreview.snapshot.conditionRules.length}</dd></div>
              <div><dt className="text-[var(--color-text-secondary)]">Key</dt><dd className="m-0">Key：{attachmentPreview.snapshot.keyQuestionIds.join('、') || '无'}</dd></div>
            </dl>
            <section aria-labelledby="attachment-questions-title">
              <h4 id="attachment-questions-title" className="mt-0">题目完整快照</h4>
              {attachmentPreview.snapshot.questions.length === 0 ? (
                <p className="m-0 text-[var(--color-text-secondary)]">无题目</p>
              ) : (
                <ol className="m-0 grid gap-[var(--space-3)] pl-[var(--space-5)]">
                  {attachmentPreview.snapshot.questions.slice(0, visibleQuestionCount).map((question) => (
                    <li key={question.id}>
                      <strong>{question.content}</strong>
                      <p className="mb-0 mt-[var(--space-1)] text-[length:var(--font-size-sm)] text-[var(--color-text-secondary)]">
                        ID：{question.id}；变量：{question.variableName}；类型：{QUESTION_TYPE_LABELS[question.type]}；顺序：{question.order}
                      </p>
                      <p className="mb-0 mt-[var(--space-1)] text-[length:var(--font-size-sm)]">
                        选项：{question.options.length > 0 ? question.options.map(({ value, label }) => `${value}（${label}）`).join('、') : '无'}
                      </p>
                      <p className="mb-0 mt-[var(--space-1)] text-[length:var(--font-size-sm)]">
                        约束：{constraintSummary(question.constraint)}；Key：{question.isKey ? '是' : '否'}；允许跳过：{question.allowSkip ? '是' : '否'}；默认值：{question.defaultValue ?? '无'}；跳过值：{question.skipValue ?? '无'}
                      </p>
                    </li>
                  ))}
                </ol>
              )}
              {visibleQuestionCount < attachmentPreview.snapshot.questions.length ? (
                <Button
                  className="mt-[var(--space-3)]"
                  variant="ghost"
                  onClick={() => setVisibleQuestionCount((current) => current + ATTACHMENT_BATCH_SIZE)}
                >
                  继续显示更多题目（剩余 {attachmentPreview.snapshot.questions.length - visibleQuestionCount}）
                </Button>
              ) : null}
            </section>
            <section aria-labelledby="attachment-rules-title">
              <h4 id="attachment-rules-title" className="mt-0">条件规则完整快照</h4>
              {attachmentPreview.snapshot.conditionRules.length === 0 ? (
                <p className="m-0 text-[var(--color-text-secondary)]">无条件规则</p>
              ) : (
                <ul className="m-0 grid gap-[var(--space-3)] pl-[var(--space-5)]">
                  {attachmentPreview.snapshot.conditionRules.slice(0, visibleRuleCount).map((rule) => (
                    <li key={rule.id}>
                      <strong>规则 {rule.id}</strong>
                      <p className="mb-0 mt-[var(--space-1)] text-[length:var(--font-size-sm)]">
                        来源：{rule.sourceQuestionId}；逻辑：{rule.logic}；动作：{rule.action}；目标：{rule.targetQuestionIds.join('、') || '无'}
                      </p>
                      <p className="mb-0 mt-[var(--space-1)] text-[length:var(--font-size-sm)]">
                        条件：{rule.conditions.length > 0 ? rule.conditions.map(({ questionId, operator, value }) => `${questionId} ${CONDITION_OPERATOR_LABELS[operator]} ${value || '空值'}`).join(` ${rule.logic} `) : '无'}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
              {visibleRuleCount < attachmentPreview.snapshot.conditionRules.length ? (
                <Button
                  className="mt-[var(--space-3)]"
                  variant="ghost"
                  onClick={() => setVisibleRuleCount((current) => current + ATTACHMENT_BATCH_SIZE)}
                >
                  继续显示更多规则（剩余 {attachmentPreview.snapshot.conditionRules.length - visibleRuleCount}）
                </Button>
              ) : null}
            </section>
            {attachmentNotice ? <p role="alert" className="m-0 rounded-[var(--radius-1)] bg-[var(--color-danger-soft)] p-[var(--space-3)] text-[var(--color-danger)]">{attachmentNotice}</p> : null}
            <p className="m-0 rounded-[var(--radius-1)] bg-[var(--color-warning-soft)] p-[var(--space-3)]">衍生变量不会发送。</p>
            <div className="flex justify-end gap-[var(--space-2)]">
              <Button variant="secondary" disabled={sessionOperationsLocked} onClick={() => setAttachmentOpen(false)}>取消</Button>
              <Button disabled={sessionOperationsLocked} onClick={() => { setConfirmedAttachmentFingerprint(attachmentPreview.fingerprint); setIncludeCurrentQuestionnaire(true); setAttachmentNotice(null); setAttachmentOpen(false) }}>确认加入</Button>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        title="重命名 AI 对话"
        description="输入便于识别的对话名称。"
        open={renameOpen}
        onOpenChange={setRenameOpen}
        restoreFocusRef={textareaRef}
      >
        <div className="grid gap-[var(--space-3)] pt-[var(--space-4)]">
          <Input label="对话名称" value={renameTitle} maxLength={120} onChange={(event) => setRenameTitle(event.target.value)} />
          <div className="flex justify-end gap-[var(--space-2)]">
            <Button variant="secondary" onClick={() => setRenameOpen(false)}>取消</Button>
            <Button onClick={() => void saveRename()} disabled={renameTitle.trim().length === 0 || sessionOperationsLocked}>保存名称</Button>
          </div>
        </div>
      </Modal>
    </MilestonePage>
  )
}
