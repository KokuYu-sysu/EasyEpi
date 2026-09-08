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
import { Fragment, useCallback, useEffect, useRef, useState } from 'react'

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
import { AIClarificationReplies } from '@renderer/components/ai/AIClarificationReplies'
import { AIRunProgress, type AIRunProgressState } from '@renderer/components/ai/AIRunProgress'
import { AIValidationFailure } from '@renderer/components/ai/AIValidationFailure'
import {
  AI_PRIVACY_NOTICE,
  type AIArtifactPreview,
  type AIPublicFailureDetails,
  type AIPublicFailureRecord,
  type AIPublicAttachmentSummary,
  type AIPublicMessage,
  type AIProgressEvent,
  type AIQuestionnaireArtifactPreviewDto,
  type AIResearchCitation,
  type AIResearchStatus,
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
  historical: boolean
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
  knownFailureRunIds: string[]
  clarificationSelection?: {
    clarificationId: string
    optionId: string
  }
}

interface LiveRunState extends AIRunProgressState {
  requestId: string
  sessionId: string
  runId: string | null
  attemptText: Partial<Record<1 | 2 | 3, string>>
  sequences: Partial<Record<1 | 2 | 3, number>>
}

interface ProgressSubscription {
  requestId: string
  sessionId: string
  generation: number
  recovered: boolean
  unsubscribe: () => void
}

const STATUS_LABELS: Record<AISessionStatus, string> = {
  idle: '空闲',
  running: '处理中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消'
}

const RESEARCH_STATUS_LABELS: Record<AIResearchStatus, string> = {
  searched: '本次已联网检索',
  not_needed: '服务商未执行联网检索',
  disabled: '本次未联网（联网搜索未启用）',
  unsupported: '本次未联网（当前厂商不支持兼容搜索）',
  failed: '本次未联网（联网检索失败，已继续生成）'
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

function mergeFailures(...groups: AIPublicFailureRecord[][]): AIPublicFailureRecord[] {
  const byRunId = new Map<string, AIPublicFailureRecord>()
  for (const group of groups) {
    for (const failure of group) {
      if (!byRunId.has(failure.runId)) byRunId.set(failure.runId, failure)
    }
  }
  return [...byRunId.values()]
}

function isTerminalArtifactError(code: string | undefined): boolean {
  return code === 'AI_ARTIFACT_STALE' || code === 'AI_ARTIFACT_NOT_APPLICABLE' ||
    code === 'AI_ARTIFACT_DERIVED_CONFLICT'
}

function createLiveRun(
  requestId: string,
  sessionId: string,
  startedAt = new Date().toISOString(),
  attempt: 1 | 2 | 3 = 1,
  stage: LiveRunState['stage'] = 'starting',
  runId: string | null = null,
  streamFallback = false
): LiveRunState {
  return {
    requestId,
    sessionId,
    runId,
    stage,
    attempt,
    startedAt,
    updatedAt: startedAt,
    streamFallback,
    responseFormatFallback: false,
    provisionalText: '',
    rejectedAttempts: [],
    attemptText: {},
    sequences: {}
  }
}

function updateLiveRun(previous: LiveRunState, event: AIProgressEvent): LiveRunState {
  if (event.requestId !== previous.requestId || event.sessionId !== previous.sessionId) return previous
  const base = { ...previous, runId: event.runId, updatedAt: event.at }
  switch (event.type) {
    case 'started':
      return { ...base, stage: 'starting' }
    case 'attempt_started':
      return { ...base, stage: event.attempt === 1 ? 'connecting' : 'repairing', attempt: event.attempt, provisionalText: '' }
    case 'model_streaming':
      return { ...base, stage: 'streaming', attempt: event.attempt }
    case 'assistant_delta': {
      const lastSequence = previous.sequences[event.attempt] ?? -1
      if (event.sequence <= lastSequence) return previous
      const text = `${previous.attemptText[event.attempt] ?? ''}${event.delta}`
      return {
        ...base,
        stage: 'streaming',
        attempt: event.attempt,
        attemptText: { ...previous.attemptText, [event.attempt]: text },
        sequences: { ...previous.sequences, [event.attempt]: event.sequence },
        provisionalText: text
      }
    }
    case 'validating':
      return { ...base, stage: 'validating', attempt: event.attempt }
    case 'validation_failed':
      return {
        ...base,
        stage: 'validating',
        attempt: event.attempt,
        provisionalText: '',
        attemptText: { ...previous.attemptText, [event.attempt]: '' },
        rejectedAttempts: [
          ...previous.rejectedAttempts.filter(({ attempt }) => attempt !== event.attempt),
          event.failure
        ].sort((left, right) => left.attempt - right.attempt)
      }
    case 'repairing':
      return { ...base, stage: 'repairing', attempt: event.nextAttempt, provisionalText: '' }
    case 'capability_fallback':
      return {
        ...base,
        attempt: event.attempt,
        streamFallback: previous.streamFallback || event.capability === 'streaming',
        responseFormatFallback: previous.responseFormatFallback || event.capability === 'response_format'
      }
    case 'clarification':
      return { ...base, stage: 'clarification', attempt: event.attempt }
    case 'completed':
      return { ...base, stage: 'completed', attempt: event.attempt }
    case 'failed':
      return { ...base, stage: 'failed', attempt: event.attempt, provisionalText: '' }
    case 'cancelled':
      return { ...base, stage: 'cancelled', attempt: event.attempt, provisionalText: '' }
  }
}

function buildValidationRetryPrompt(details: AIPublicFailureDetails): string | null {
  const summaries = [...new Set(details.attempts.flatMap(({ issues }) => issues.map(({ summary }) => summary)))]
  if (summaries.length === 0) return null
  const prefix = '请根据以下本地校验结果重新生成问卷，并逐项修正：'
  const body = summaries.slice(0, 12).map((summary, index) => `${index + 1}. ${summary}`).join('\n')
  return `${prefix}\n${body}`.slice(0, 1000)
}

function latestActionableClarificationMessageId(messages: AIPublicMessage[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role !== 'assistant' || message.clarification?.status !== 'unresolved') continue
    return messages.slice(index + 1).some(({ role }) => role === 'user') ? null : message.id
  }
  return null
}

function ArtifactPreviewCard({
  artifact,
  applying,
  blocked,
  requiresRegeneration,
  onApply
}: {
  artifact: ActiveArtifact
  applying: boolean
  blocked: boolean
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
          <CardTitle>{artifact.historical ? '历史问卷草稿' : 'AI 问卷草稿'}</CardTitle>
          <p className="mb-0 mt-[var(--space-1)] text-[var(--color-text-secondary)]">
            {preview.rollingSummary}
          </p>
        </div>
        <Badge variant={requiresRegeneration ? 'warning' : 'success'}>
          {artifact.historical ? '历史记录 · 需重新生成' : requiresRegeneration ? '需重新生成' : '本地校验通过'}
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
            {artifact.historical
              ? '这是历史记录，仅供查看；需重新生成当前版本草稿后才能应用。'
              : '正式问卷或草稿状态已变化，需重新生成后才能应用。'}
          </p>
        ) : null}
        <div className="flex justify-end">
          <ConfirmDialog
            trigger={<Button loading={applying} disabled={applying || blocked || requiresRegeneration}>应用到正式问卷</Button>}
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
  const [migrating, setMigrating] = useState(false)
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
  const [researchNotice, setResearchNotice] = useState<string | null>(null)
  const [researchCitations, setResearchCitations] = useState<AIResearchCitation[]>([])
  const [liveRun, setLiveRun] = useState<LiveRunState | null>(null)
  const [liveFailure, setLiveFailure] = useState<{
    runId: string | null
    errorCode: string
    details: AIPublicFailureDetails
  } | null>(null)
  const [pendingClarificationId, setPendingClarificationId] = useState<string | null>(null)
  const generationRef = useRef(0)
  const configRequestRef = useRef(0)
  const sessionLoadRequestRef = useRef(0)
  const artifactPreviewRequestRef = useRef(0)
  const artifactPreviewTargetRef = useRef<{
    token: number
    sessionId: string
    artifactId: string
    operationId: string
    historical: boolean
  } | null>(null)
  const activeSessionIdRef = useRef<string | null>(null)
  const activeArtifactRef = useRef<ActiveArtifact | null>(null)
  const mountedRef = useRef(true)
  const pendingSendRef = useRef<PendingSendIntent | null>(null)
  const privacyBusyRef = useRef(false)
  const clearingCacheRef = useRef(false)
  const migratingRef = useRef(false)
  const activeRequestIdRef = useRef<string | null>(null)
  const activeRunIdRef = useRef<string | null>(null)
  const progressSubscriptionRef = useRef<ProgressSubscription | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const toast = useToast()
  const sessionRequiresMigration = sessionPage !== null &&
    sessionPage.manifest.versionStamp.schemaVersion !== 2

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

  const setClearingCacheSynchronized = useCallback((busy: boolean) => {
    clearingCacheRef.current = busy
    setClearingCache(busy)
  }, [])

  const setMigratingSynchronized = useCallback((busy: boolean) => {
    migratingRef.current = busy
    setMigrating(busy)
  }, [])

  const cleanupProgressSubscription = useCallback((requestId?: string) => {
    const subscription = progressSubscriptionRef.current
    if (subscription === null || (requestId !== undefined && subscription.requestId !== requestId)) return
    progressSubscriptionRef.current = null
    subscription.unsubscribe()
  }, [])

  const releasePendingSend = useCallback((intent?: PendingSendIntent) => {
    if (intent !== undefined && pendingSendRef.current?.requestId !== intent.requestId) return
    pendingSendRef.current = null
    setPendingSend(false)
    if (intent?.clarificationSelection !== undefined || intent === undefined) setPendingClarificationId(null)
    setPrivacyBusySynchronized(false)
  }, [setPrivacyBusySynchronized])

  const clearSessionContent = useCallback(() => {
    cleanupProgressSubscription()
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
    setLiveRun(null)
    setLiveFailure(null)
    setResearchNotice(null)
    setResearchCitations([])
    setPendingClarificationId(null)
    activeRequestIdRef.current = null
    activeRunIdRef.current = null
    pendingSendRef.current = null
    privacyBusyRef.current = false
    clearingCacheRef.current = false
    migratingRef.current = false
    setSending(false)
    setPendingSend(false)
    setPrivacyBusy(false)
    setApplying(false)
    setMigrating(false)
    setClearingCache(false)
    setLoadingEarlier(false)
    setPrivacyOpen(false)
    setRenameOpen(false)
    setRenameTitle('')
  }, [cleanupProgressSubscription, commitActiveArtifact, invalidateArtifactPreview, invalidateSessionLoad])

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
    const collectedFailures: AIPublicFailureRecord[] = []
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
      collectedFailures.push(...result.session.failures)
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
      failures: mergeFailures(collectedFailures),
      total: latest.total,
      nextOffset: null
    }
  }, [handleFailure, isCurrent])

  const loadArtifact = useCallback(async (
    sessionId: string,
    artifactId: string,
    operationId: string,
    generation = generationRef.current,
    historical = false
  ) => {
    const token = ++artifactPreviewRequestRef.current
    const target = { token, sessionId, artifactId, operationId, historical }
    artifactPreviewTargetRef.current = target
    if (activeArtifactRef.current?.artifactId !== artifactId) {
      setArtifactApplicability({ artifactId, applicable: !historical })
    }
    const targetIsCurrent = () => {
      const current = artifactPreviewTargetRef.current
      return isCurrent(generation, sessionId) && current?.token === token &&
        current.sessionId === sessionId && current.artifactId === artifactId &&
        current.operationId === operationId && current.historical === historical
    }
    try {
      const result = await window.easyEpi.ai.artifact.preview({ sessionId, artifactId })
      if (!targetIsCurrent()) return
      if (result.ok) {
        commitActiveArtifact({ sessionId, artifactId, operationId, historical, preview: result.preview })
        setArtifactApplicability({ artifactId, applicable: !historical })
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
      const recoveredSubscription = progressSubscriptionRef.current
      if (recoveredSubscription?.recovered === true &&
        recoveredSubscription.sessionId === sessionId &&
        result.activeRun?.requestId !== recoveredSubscription.requestId &&
        pendingSendRef.current === null &&
        activeRequestIdRef.current === recoveredSubscription.requestId) {
        cleanupProgressSubscription(recoveredSubscription.requestId)
        activeRequestIdRef.current = null
        setLiveRun(null)
      }
      if (result.activeArtifactId === null) {
        invalidateArtifactPreview()
        commitActiveArtifact(null)
        setArtifactApplicability(null)
      } else {
        const summary = result.artifacts.find(({ artifactId }) => artifactId === result.activeArtifactId)
        if (summary !== undefined && summary.status === 'completed' && sessionLoadIsCurrent()) {
          void loadArtifact(
            sessionId,
            summary.artifactId,
            summary.operationId,
            generation,
            result.manifest.versionStamp.schemaVersion !== 2
          )
        }
      }
      return result
    } catch {
      if (sessionLoadIsCurrent()) setError('无法读取 AI 对话。')
      return null
    } finally {
      if (sessionLoadIsCurrent()) setLoading(false)
    }
  }, [cleanupProgressSubscription, commitActiveArtifact, fetchSessionRange, handleFailure, invalidateArtifactPreview, isCurrent, loadArtifact])

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

  const subscribeProgress = useCallback((
    requestId: string,
    sessionId: string,
    generation: number,
    recovered = false,
    initialRun?: LiveRunState
  ) => {
    const current = progressSubscriptionRef.current
    if (current?.requestId === requestId && current.sessionId === sessionId &&
      current.generation === generation && current.recovered === recovered) return false
    cleanupProgressSubscription()
    if (initialRun !== undefined) setLiveRun(initialRun)
    const unsubscribe = window.easyEpi.ai.onProgress({ requestId, sessionId }, (event) => {
      const subscription = progressSubscriptionRef.current
      if (subscription?.requestId !== requestId || subscription.sessionId !== sessionId ||
        subscription.generation !== generation || event.requestId !== requestId ||
        event.sessionId !== sessionId || !isCurrent(generation, sessionId)) return
      activeRunIdRef.current = event.runId
      setLiveRun((previous) => previous === null ? previous : updateLiveRun(previous, event))
      if (event.type === 'failed' && event.details !== undefined) {
        setLiveFailure({ runId: event.runId, errorCode: event.errorCode, details: event.details })
      }
      if (event.type === 'clarification' || event.type === 'completed' ||
        event.type === 'failed' || event.type === 'cancelled') {
        cleanupProgressSubscription(requestId)
        if (recovered) {
          activeRequestIdRef.current = null
          void Promise.all([
            loadLatestSession(sessionId, generation),
            loadSessions(sessionId, generation)
          ]).finally(() => {
            if (isCurrent(generation, sessionId)) setLiveRun(null)
          })
        }
      }
    })
    progressSubscriptionRef.current = { requestId, sessionId, generation, recovered, unsubscribe }
    return true
  }, [cleanupProgressSubscription, isCurrent, loadLatestSession, loadSessions])

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
      cleanupProgressSubscription()
      unsubscribeConfig()
      unsubscribe?.()
    }
  }, [cleanupProgressSubscription, clearProjectContent, loadSessions, refreshAIConfig])

  useEffect(() => {
    if (activeSessionId === null) return
    const generation = generationRef.current
    void Promise.resolve().then(() => loadLatestSession(activeSessionId, generation))
  }, [activeSessionId, loadLatestSession])

  useEffect(() => {
    const snapshot = sessionPage?.activeRun
    if (snapshot === null || snapshot === undefined || activeSessionId === null ||
      activeRequestIdRef.current !== null || pendingSendRef.current !== null || sending) return
    const generation = generationRef.current
    activeRequestIdRef.current = snapshot.requestId
    const subscribed = subscribeProgress(
      snapshot.requestId,
      activeSessionId,
      generation,
      true,
      createLiveRun(
        snapshot.requestId,
        activeSessionId,
        snapshot.startedAt,
        snapshot.attempt,
        snapshot.stage,
        snapshot.runId,
        snapshot.streamFallback
      )
    )
    if (subscribed) void loadLatestSession(activeSessionId, generation)
  }, [activeSessionId, loadLatestSession, sending, sessionPage?.activeRun, subscribeProgress])

  const createSession = async () => {
    if (sending || applying || migratingRef.current) return
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
    if (sending || applying || migratingRef.current) return
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
    if (sessionId === null || sending || applying || migratingRef.current) return
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
    if (sessionId === null || sending || activeRequestIdRef.current !== null || applying ||
      clearingCacheRef.current || migratingRef.current || pendingSendRef.current !== null || privacyBusyRef.current) return
    setClearingCacheSynchronized(true)
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
      if (isCurrent(generation, sessionId)) setClearingCacheSynchronized(false)
    }
  }

  const migrateSession = async () => {
    const sessionId = activeSessionIdRef.current
    const generation = generationRef.current
    if (sessionId === null || migratingRef.current || sending || applying ||
      clearingCacheRef.current || pendingSendRef.current !== null || privacyBusyRef.current ||
      activeRequestIdRef.current !== null || sessionPage?.status === 'running') return
    setMigratingSynchronized(true)
    setError(null)
    try {
      const result = await window.easyEpi.ai.session.migrate({ sessionId })
      if (!isCurrent(generation, sessionId)) return
      if (!result.ok) return handleFailure(result.errorCode, '无法迁移当前对话。')
      const message = result.migrated
        ? '当前对话已迁移到最新 AI 协议；历史草稿仅供查看，请重新生成后应用。'
        : '当前对话已是最新 AI 协议，无需迁移。'
      setAnnouncement(message)
      toast.push({
        title: result.migrated ? '对话迁移完成' : '无需迁移',
        description: message,
        tone: 'success'
      })
      await Promise.all([
        loadLatestSession(sessionId, generation),
        loadSessions(sessionId, generation)
      ])
    } catch {
      if (isCurrent(generation, sessionId)) setError('无法迁移当前对话。')
    } finally {
      if (isCurrent(generation, sessionId)) setMigratingSynchronized(false)
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
        failures: mergeFailures(result.failures, current.failures),
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
    if (sessionId === null || sending || applying || clearingCacheRef.current ||
      migratingRef.current || pendingSendRef.current !== null || privacyBusyRef.current) return
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
      historical: false,
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
      activeRequestIdRef.current !== null || clearingCacheRef.current || migratingRef.current) return
    activeRequestIdRef.current = intent.requestId
    setSending(true)
    setPrivacyBusySynchronized(false)
    setError(null)
    setLiveFailure(null)
    activeRunIdRef.current = null
    setAnnouncement('消息已发送，AI 正在处理。')
    try {
      subscribeProgress(
        intent.requestId,
        intent.sessionId,
        intent.generation,
        false,
        createLiveRun(intent.requestId, intent.sessionId)
      )
      const result = await window.easyEpi.ai.send({
        requestId: intent.requestId,
        sessionId: intent.sessionId,
        content: intent.content,
        includeCurrentQuestionnaire: intent.includeCurrentQuestionnaire,
        ...(intent.clarificationSelection === undefined
          ? {}
          : { clarificationSelection: intent.clarificationSelection })
      })
      if (!isCurrent(intent.generation, intent.sessionId) ||
        activeRequestIdRef.current !== intent.requestId ||
        pendingSendRef.current?.requestId !== intent.requestId) return
      if (!result.ok) {
        const [reloadedSession] = await Promise.all([
          loadLatestSession(intent.sessionId, intent.generation),
          loadSessions(intent.sessionId, intent.generation)
        ])
        if (result.details !== undefined) {
          setError(null)
          setLiveFailure({
            runId: activeRunIdRef.current,
            errorCode: result.errorCode,
            details: result.details
          })
          const persistedRunId = reloadedSession?.failures.find(({ runId }) =>
            !intent.knownFailureRunIds.includes(runId))?.runId ?? null
          if (activeRunIdRef.current === null && persistedRunId !== null) {
            setLiveFailure({
              runId: persistedRunId,
              errorCode: result.errorCode,
              details: result.details
            })
          }
        } else {
          handleFailure(result.errorCode, 'AI 生成失败，请重试。')
        }
        setAnnouncement('AI 请求未完成。')
        return
      }
      setDraft('')
      setResearchNotice(RESEARCH_STATUS_LABELS[result.researchStatus ?? 'disabled'])
      setResearchCitations(result.researchStatus === 'searched' ? (result.citations ?? []) : [])
      if (result.outcome === 'clarification') {
        setAnnouncement('AI 提出了一个补充问题。')
        await Promise.all([
          loadLatestSession(intent.sessionId, intent.generation),
          loadSessions(intent.sessionId, intent.generation)
        ])
      } else {
        setAnnouncement('AI 问卷草稿已生成。')
        await refreshAfterSend(intent.sessionId, result.artifact, intent.generation)
      }
    } catch {
      if (isCurrent(intent.generation, intent.sessionId) &&
        activeRequestIdRef.current === intent.requestId &&
        pendingSendRef.current?.requestId === intent.requestId) {
        setError('AI 生成失败，请重试。')
        setAnnouncement('AI 请求未完成。')
      }
    } finally {
      cleanupProgressSubscription(intent.requestId)
      if (activeRequestIdRef.current === intent.requestId &&
        pendingSendRef.current?.requestId === intent.requestId) {
        activeRequestIdRef.current = null
        if (isCurrent(intent.generation, intent.sessionId)) {
          setIncludeCurrentQuestionnaire(false)
          setConfirmedAttachmentFingerprint(null)
          setAttachmentPreview(null)
          setAttachmentNotice(null)
          setSending(false)
          setLiveRun(null)
          activeRunIdRef.current = null
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

  const beginSend = (
    content: string,
    clarificationSelection?: PendingSendIntent['clarificationSelection']
  ) => {
    if (pendingSendRef.current !== null || clearingCacheRef.current || migratingRef.current) return
    const sessionId = activeSessionIdRef.current
    const generation = generationRef.current
    if (sessionId === null || (clarificationSelection === undefined && content.trim().length === 0) ||
      (clarificationSelection !== undefined && content !== '') || sending || applying || configMissing ||
      sessionRequiresMigration || sessionPage?.status === 'running') return
    if (clarificationSelection === undefined && includeCurrentQuestionnaire &&
      confirmedAttachmentFingerprint === null) {
      setError('请先确认当前问卷的发送预览。')
      return
    }
    const intent: PendingSendIntent = {
      requestId: crypto.randomUUID(),
      sessionId,
      generation,
      content,
      includeCurrentQuestionnaire: clarificationSelection === undefined && includeCurrentQuestionnaire,
      attachmentFingerprint: clarificationSelection === undefined && includeCurrentQuestionnaire
        ? confirmedAttachmentFingerprint
        : null,
      knownFailureRunIds: sessionPage?.failures.map(({ runId }) => runId) ?? [],
      ...(clarificationSelection === undefined ? {} : { clarificationSelection })
    }
    pendingSendRef.current = intent
    if (clarificationSelection !== undefined) {
      setPendingClarificationId(clarificationSelection.clarificationId)
    }
    setPendingSend(true)
    setPrivacyBusySynchronized(true)
    void continuePendingSend(intent)
  }

  const startSend = () => beginSend(draft)

  const selectClarification = (clarificationId: string, optionId: string) => {
    if (pendingClarificationId !== null) return
    beginSend('', { clarificationId, optionId })
  }

  const retryValidationFailure = (details: AIPublicFailureDetails) => {
    const prompt = buildValidationRetryPrompt(details)
    if (prompt !== null) beginSend(prompt)
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
      activeArtifact.sessionId !== sessionId || applying || sending || clearingCacheRef.current ||
      migratingRef.current || sessionRequiresMigration || activeArtifact.historical ||
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
  const sessionOperationsLocked = sending || applying || migrating || clearingCache || pendingSend || privacyBusy
  const activeLiveRun = liveRun?.sessionId === activeSessionId ? liveRun : null
  const sessionRunActive = sessionPage?.status === 'running' || activeLiveRun !== null
  const latestUnresolvedClarificationMessageId = latestActionableClarificationMessageId(messages)
  const quickRepliesEnabled = !sessionOperationsLocked && !sessionRunActive && !projectBlocked &&
    !configMissing && !sessionRequiresMigration && pendingClarificationId === null
  const liveFailureIsPersisted = liveFailure?.runId !== null && liveFailure?.runId !== undefined &&
    sessionPage?.failures.some(({ runId }) => runId === liveFailure.runId) === true
  const activeArtifactRequiresRegeneration = activeArtifact?.historical === true ||
    (activeArtifact !== null && artifactApplicability?.artifactId === activeArtifact.artifactId &&
      !artifactApplicability.applicable)
  const canSend = activeSessionId !== null && draft.trim().length > 0 && !sessionOperationsLocked &&
    !projectBlocked && !configMissing && !sessionRequiresMigration && !sessionRunActive

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
      {researchNotice ? (
        <div role="status" className="rounded-[var(--radius-1)] border border-[var(--color-border-default)] bg-[var(--color-surface-sunken)] p-[var(--space-3)]">
          <p className="m-0">{researchNotice}</p>
          {researchCitations.length > 0 ? (
            <ul className="mb-0 mt-[var(--space-2)]">
              {researchCitations.map(({ url, title }) => (
                <li key={url}><a href={url} target="_blank" rel="noreferrer">{title}</a></li>
              ))}
            </ul>
          ) : null}
        </div>
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
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={migrating}
                    disabled={sessionOperationsLocked || sessionRunActive}
                    onClick={() => void migrateSession()}
                  >迁移当前对话</Button>
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
                    {sessionRequiresMigration ? (
                      <div role="alert" className="rounded-[var(--radius-1)] border border-[var(--color-warning)] bg-[var(--color-warning-soft)] p-[var(--space-3)] text-[var(--color-text-secondary)]">
                        <strong>此对话使用旧版 AI 协议。</strong> 请先点击「迁移当前对话」；迁移前不能发送消息或应用草稿，旧草稿仅作历史只读记录。
                      </div>
                    ) : null}
                    {sessionPage?.status === 'running' && activeLiveRun === null ? (
                      <p className="m-0 rounded-[var(--radius-1)] bg-[var(--color-warning-soft)] p-[var(--space-3)] text-[var(--color-text-secondary)]">
                        此对话仍在处理中。正在恢复可用的进度信息，期间不能重复发送。
                      </p>
                    ) : null}
                    {messageOffset > 0 ? <Button variant="ghost" loading={loadingEarlier} onClick={() => void loadEarlier()}>加载更早</Button> : null}
                    {loading && messages.length === 0 ? <p className="m-0 text-[var(--color-text-secondary)]">正在加载对话…</p> : null}
                    {!loading && messages.length === 0 ? <EmptyState title="开始这段对话" description="描述研究目的、目标人群和希望收集的信息。" /> : null}
                    <ol aria-label="对话消息" className="m-0 grid list-none gap-[var(--space-3)] p-0">
                      {messages.map((message) => (
                        <Fragment key={message.id}>
                        <li className={`max-w-[90%] rounded-[var(--radius-2)] p-[var(--space-3)] ${message.role === 'user' ? 'ml-auto bg-[var(--color-brand-soft)]' : 'mr-auto bg-[var(--color-surface-sunken)]'}`}>
                          <div className="mb-[var(--space-1)] flex items-center gap-[var(--space-2)] text-[length:var(--font-size-sm)] font-[var(--font-weight-semibold)]">
                            {message.role === 'user' ? '你' : <><Bot aria-hidden="true" size={16} />AI 助手</>}
                          </div>
                          <p className="m-0 whitespace-pre-wrap break-words">{message.content}</p>
                          {message.role === 'assistant' && message.clarification ? (
                            <AIClarificationReplies
                              clarification={message.clarification}
                              enabled={quickRepliesEnabled && message.id === latestUnresolvedClarificationMessageId}
                              onSelect={selectClarification}
                            />
                          ) : null}
                          {sessionPage?.attachments.some(({ messageId }) => messageId === message.id) ? (
                            <Badge className="mt-[var(--space-2)]" variant="info">本次消息附加了当时的问卷</Badge>
                          ) : null}
                          <time className="mt-[var(--space-2)] block text-[length:var(--font-size-xs)] text-[var(--color-text-muted)]" dateTime={message.createdAt}>{localTime(message.createdAt)}</time>
                        </li>
                        {sessionPage?.failures.filter(({ userMessageId }) => userMessageId === message.id).map((failure) => (
                          <li key={failure.runId} className="list-none">
                            <AIValidationFailure
                              errorCode={failure.errorCode}
                              details={failure.details}
                              busy={sessionOperationsLocked || sessionRunActive}
                              onRetry={retryValidationFailure}
                              onEdit={() => textareaRef.current?.focus({ preventScroll: true })}
                            />
                          </li>
                        ))}
                        </Fragment>
                      ))}
                    </ol>
                    {activeLiveRun !== null ? <AIRunProgress run={activeLiveRun} /> : null}
                    {liveFailure !== null && !liveFailureIsPersisted ? (
                      <AIValidationFailure
                        errorCode={liveFailure.errorCode}
                        details={liveFailure.details}
                        busy={sessionOperationsLocked || sessionRunActive}
                        onRetry={retryValidationFailure}
                        onEdit={() => textareaRef.current?.focus({ preventScroll: true })}
                      />
                    ) : null}
                  </CardContent>
                </Card>

                {activeArtifact?.sessionId === activeSessionId ? (
                  <ArtifactPreviewCard
                    artifact={activeArtifact}
                    applying={applying}
                    blocked={sessionOperationsLocked || sessionRunActive || sessionRequiresMigration}
                    requiresRegeneration={activeArtifactRequiresRegeneration}
                    onApply={() => void applyArtifact()}
                  />
                ) : null}

                {sessionPage?.artifacts.some(({ status }) => status === 'completed') ? (
                  <Card>
                    <CardHeader><CardTitle>生成记录</CardTitle></CardHeader>
                    <CardContent>
                      <ul aria-label="问卷草稿记录" className="m-0 grid list-none gap-[var(--space-2)] p-0">
                        {sessionPage.artifacts.filter(({ status }) => status === 'completed').map((artifact) => {
                          const current = !sessionRequiresMigration &&
                            artifact.artifactId === sessionPage.activeArtifactId
                          const selected = artifact.artifactId === activeArtifact?.artifactId
                          return (
                            <li key={artifact.artifactId}>
                              <Button
                                className="w-full justify-between text-left"
                                variant={selected ? 'secondary' : 'ghost'}
                                aria-pressed={selected}
                                disabled={sessionOperationsLocked}
                                onClick={() => void loadArtifact(
                                  activeSessionId,
                                  artifact.artifactId,
                                  artifact.operationId,
                                  generationRef.current,
                                  sessionRequiresMigration || !current
                                )}
                              >
                                <span>{current ? '当前草稿' : '历史草稿（只读）'}</span>
                                <time dateTime={artifact.updatedAt}>{localTime(artifact.updatedAt)}</time>
                              </Button>
                            </li>
                          )
                        })}
                      </ul>
                    </CardContent>
                  </Card>
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
                      disabled={sessionOperationsLocked || sessionRequiresMigration || sessionPage?.status === 'running'}
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
                      <Button variant="secondary" loading={attachmentLoading} disabled={sending || applying || clearingCache || pendingSend || privacyBusy || includeCurrentQuestionnaire} onClick={() => void previewQuestionnaireAttachment()}><Paperclip aria-hidden="true" size={16} />加入当前问卷</Button>
                      {sending || activeLiveRun !== null ? (
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
