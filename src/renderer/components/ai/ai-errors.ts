import type { AIProgressStage, AIResearchStatus } from '@shared/ai-assistant-contract'

const ERROR_MESSAGES: Readonly<Record<string, string>> = {
  INVALID_AI_CONFIG: '请填写有效的模型名称与 API Key。',
  AI_CONFIG_READ_FAILED: '无法读取 AI 服务配置，请稍后重试。',
  AI_CONFIG_SAVE_FAILED: '无法保存 AI 服务配置，请稍后重试。',
  AI_SECURE_STORAGE_UNAVAILABLE: '当前系统安全存储不可用，无法保存 API Key。',
  AI_PRIVACY_NOTICE_REQUIRED: '请先确认 AI 隐私说明。',
  AI_PROJECT_REQUIRED: '请先从欢迎页创建或打开项目。',
  AI_PROJECT_LOCKED: '当前项目尚未解锁，请先重新打开并输入项目密码。',
  PROJECT_CHANGED: '项目已切换，请在当前项目中重新选择对话。',
  AI_SESSION_NOT_FOUND: '该对话不存在或已被删除。',
  AI_RUN_ALREADY_ACTIVE: '该对话已有请求正在处理，请等待或刷新状态。',
  AI_REQUEST_IN_PROGRESS: '请求正在处理中，请勿重复发送。',
  AI_RUN_INTERRUPTED: 'AI 请求在恢复期间中断，请重新发送或修改要求。',
  AI_CANCELLED: 'AI 请求已取消。',
  AI_AUTH_ERROR: 'AI 服务认证失败，请检查 API Key。',
  AI_MODEL_NOT_FOUND: '找不到所配置的模型，请检查模型名称。',
  AI_RATE_LIMITED: 'AI 服务当前繁忙，请稍后重试。',
  AI_TIMEOUT: 'AI 服务响应超时，请稍后重试。',
  AI_NETWORK_ERROR: '无法连接 AI 服务，请检查网络。',
  AI_PROVIDER_ERROR: 'AI 服务返回错误，请稍后重试。',
  AI_INVALID_RESPONSE: 'AI 服务返回的内容无法使用。',
  AI_RESPONSE_TOO_LARGE: '模型本次返回的内容超过了应用可接收的上限。请减少题目数量，或分两次生成后合并。',
  AI_RESPONSE_TRUNCATED: '模型回复被截断，请减少题目数量或缩短要求后重试。',
  AI_MODEL_OUTPUT_TRUNCATED: '模型回复被截断，请减少题目数量或缩短要求后重试。',
  AI_HARNESS_VALIDATION_FAILED: '生成的问卷未通过本地校验，请调整要求后重试。',
  AI_VALIDATION_ERROR: '生成内容存在无法使用的字段，请根据校验摘要重新生成。',
  AI_ARTIFACT_STALE: '正式问卷已变更，此草稿已过期，不能应用。',
  AI_ARTIFACT_NOT_APPLICABLE: '此 AI 草稿当前不可应用。',
  AI_ARTIFACT_DERIVED_CONFLICT: '草稿与现有衍生变量冲突，未进行应用。',
  AI_ARTIFACT_APPLY_FAILED: '应用草稿失败，正式问卷保持不变。',
  AI_PERSIST_FAILED: '无法保存 AI 对话，请重试。',
  AI_SESSION_PAGE_TOO_LARGE: '此段对话内容过大，暂时无法显示。',
  AI_VERSION_MIGRATION_REQUIRED: '该对话版本较旧，需要迁移后才能继续。',
  AI_RESEARCH_PLAN_INVALID: '无法把你的要求转换为可检索的研究计划，请把要求写得更具体后重试。',
  AI_PUBMED_UNAVAILABLE: 'PubMed 暂时无法访问，已改用其他来源继续。',
  AI_RESEARCH_NO_EVIDENCE: '本次没有取到任何检索来源，已跳过证据提取。',
  AI_RESEARCH_SOURCE_INVALID: '检索到的来源信息不完整，已丢弃该来源。',
  AI_EVIDENCE_INVALID: '无法从检索结果中提取可核验的证据，请调整要求后重试。',
  AI_RESEARCH_UNSUPPORTED: '当前模型不支持内置联网搜索，请确认账号与模型是否已开通该能力。'
}

export const AI_PROGRESS_STAGE_LABELS: Readonly<Record<AIProgressStage, string>> = {
  starting: '正在准备任务',
  planning: '正在翻译并规划检索',
  literature: '正在检索医学文献',
  web_search: '正在补充权威来源',
  extracting: '正在提取研究证据',
  connecting: '正在连接模型',
  streaming: '正在接收模型回答',
  validating: '正在进行本地校验',
  repairing: '正在自动修复',
  clarification: '已收到补充问题',
  completed: '生成完成',
  failed: '生成失败',
  cancelled: '已取消生成'
}

export const AI_RESEARCH_STATUS_LABELS: Readonly<Record<AIResearchStatus, string>> = {
  literature_and_web: '本次已检索医学文献并补充联网来源',
  literature_only: '本次已检索医学文献（联网检索未返回可用来源）',
  web_only: '本次已检索联网来源',
  none: '本次未检索到外部证据（内容依据模型既有知识，请人工核对）'
}

export function aiProgressStageLabel(stage: AIProgressStage, attempt: 1 | 2 | 3): string {
  if (stage === 'repairing') return `正在进行第 ${Math.max(1, attempt - 1)} 次自动修复`
  return AI_PROGRESS_STAGE_LABELS[stage]
}

export function friendlyAIError(code: string | undefined, fallback: string): string {
  return code === undefined ? fallback : (ERROR_MESSAGES[code] ?? fallback)
}

export function isProjectBoundaryError(code: string | undefined): boolean {
  return code === 'AI_PROJECT_REQUIRED' || code === 'AI_PROJECT_LOCKED' || code === 'PROJECT_CHANGED'
}
