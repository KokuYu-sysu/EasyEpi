const ERROR_MESSAGES: Readonly<Record<string, string>> = {
  INVALID_AI_CONFIG: '请填写有效的 AI 服务地址和模型名称。',
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
  AI_CANCELLED: 'AI 请求已取消。',
  AI_AUTH_ERROR: 'AI 服务认证失败，请检查 API Key。',
  AI_MODEL_NOT_FOUND: '找不到所配置的模型，请检查模型名称。',
  AI_RATE_LIMITED: 'AI 服务当前繁忙，请稍后重试。',
  AI_TIMEOUT: 'AI 服务响应超时，请稍后重试。',
  AI_NETWORK_ERROR: '无法连接 AI 服务，请检查服务地址和网络。',
  AI_PROVIDER_ERROR: 'AI 服务返回错误，请稍后重试。',
  AI_INVALID_RESPONSE: 'AI 服务返回的内容无法使用。',
  AI_RESPONSE_TOO_LARGE: 'AI 返回内容过大，请缩短要求后重试。',
  AI_HARNESS_VALIDATION_FAILED: '生成的问卷未通过本地校验，请调整要求后重试。',
  AI_ARTIFACT_STALE: '正式问卷已变更，此草稿已过期，不能应用。',
  AI_ARTIFACT_NOT_APPLICABLE: '此 AI 草稿当前不可应用。',
  AI_ARTIFACT_DERIVED_CONFLICT: '草稿与现有衍生变量冲突，未进行应用。',
  AI_ARTIFACT_APPLY_FAILED: '应用草稿失败，正式问卷保持不变。',
  AI_PERSIST_FAILED: '无法保存 AI 对话，请重试。',
  AI_SESSION_PAGE_TOO_LARGE: '此段对话内容过大，暂时无法显示。',
  AI_VERSION_MIGRATION_REQUIRED: '该对话版本较旧，需要迁移后才能继续。'
}

export function friendlyAIError(code: string | undefined, fallback: string): string {
  return code === undefined ? fallback : (ERROR_MESSAGES[code] ?? fallback)
}

export function isProjectBoundaryError(code: string | undefined): boolean {
  return code === 'AI_PROJECT_REQUIRED' || code === 'AI_PROJECT_LOCKED' || code === 'PROJECT_CHANGED'
}
