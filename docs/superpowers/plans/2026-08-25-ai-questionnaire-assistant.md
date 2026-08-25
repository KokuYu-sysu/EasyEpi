# AI 问卷助手 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在已创建并解锁的 EasyEpi 项目中提供可跨重启续接的多 Session AI 问卷助手，通过 OpenAI 兼容 API 从零生成或精细化问卷，并由本地 Harness 安全生成、校验和应用正式问卷。

**Architecture:** 全局 API 配置由主进程安全存储；项目内的对话、状态、缓存、artifacts 与临时运行通过 `session://` 虚拟存储映射到加密项目载荷。无状态 OpenAI Client 每轮优先调用一次，Orchestrator 只在解析或校验失败时进行最多两次修复；Harness 是模型输出进入正式问卷的唯一通道。

**Tech Stack:** Electron 43 `safeStorage`、Node 24 `fetch`/`AbortController`/`crypto`、React 18、React Router 7、Zustand 5、TypeScript 5.9、Vitest 4、Playwright 1.61；不增加第三方 AI SDK。

## Global Constraints

- AI 入口仅在项目已创建并解锁时显示和可用，不要求管理员验证。
- 全局配置固定为 Base URL、API Key、模型名称；API Key 不进入项目、日志、缓存或渲染进程持久化。
- 首次发送前必须接受隐私提示版本 1；只有对话和用户明确加入的当前问卷可进入请求上下文。
- 不读取或发送答卷、衍生变量、管理员数据、密码、恢复密钥和真实文件路径。
- `session_id` 由 EasyEpi 本地生成；服务商不保存 EasyEpi Session 状态。
- 正常轮次调用 LLM 1 次；结构解析或 Harness 校验失败时最多额外修复 2 次。
- Prompt、Harness、问卷 Schema 均记录版本；历史 Session 固定 Prompt 主版本。
- AI 只生成问卷元数据、题目、选项、约束、Key、排序和条件规则；拒绝衍生变量和数据操作。
- 模型结果先成为加密草稿；应用前必须通过校验、创建快照并由用户确认。
- 远程 Base URL 必须为 HTTPS；只有 `localhost`、`127.0.0.1`、`::1` 允许 HTTP。

---

## File Structure

| File/Directory | Responsibility |
|----------------|----------------|
| `src/shared/types/ai.ts` | Session、消息、状态、缓存、artifact、diff 与运行类型 |
| `src/shared/ai-contract.ts` | 固定 IPC channels、请求/响应与边界解析 |
| `src/main/services/ai/ai-config.store.ts` | 全局配置与 `safeStorage` API Key 持久化 |
| `src/main/services/atomic-file.service.ts` | 项目、答卷、备份共享的原子文件替换 |
| `src/main/services/ai/virtual-session.repository.ts` | `session://` 解析、分区隔离与事务持久化 |
| `src/main/services/ai/prompt-registry.ts` | Prompt 版本注册、哈希与兼容关系 |
| `src/main/services/ai/prompts/questionnaire-v1.ts` | 首版系统 Prompt 和响应 Schema |
| `src/main/services/ai/context-builder.ts` | 单 Session 上下文、滚动摘要与预算控制 |
| `src/main/services/ai/questionnaire-harness.ts` | 候选操作解析、规范化、校验和 diff |
| `src/main/services/ai/artifact.service.ts` | 当前问卷显式加入、快照、幂等应用和回滚 |
| `src/main/services/ai/openai-client.ts` | OpenAI Chat Completions、能力探测和安全错误 |
| `src/main/services/ai/ai-orchestrator.ts` | 单轮运行、最多两次修复、取消与 temp 生命周期 |
| `src/main/ipc/ai.ipc.ts` | AI IPC handlers 与服务装配 |
| `src/renderer/stores/project-access-store.tsx` | 项目解锁状态镜像 |
| `src/renderer/stores/ai-assistant.store.ts` | AI 页面状态和用户动作 |
| `src/renderer/pages/AiQuestionnairePage.tsx` | Session、对话、草稿、diff 与应用页面 |
| `src/renderer/components/ai/` | 配置、隐私确认、Session 列表、对话和草稿组件 |

---

### Task 1: Shared AI Domain Types and IPC Contract

**Files:**
- Create: `src/shared/types/ai.ts`
- Create: `src/shared/ai-contract.ts`
- Modify: `src/shared/types/project.ts`
- Create: `tests/unit/shared/ai-contract.test.ts`

**Interfaces:**
- Consumes: `QuestionnaireDef` from `src/shared/types/qnaire.ts`。
- Produces: all AI types and validated public request parsers used by later tasks.

- [ ] **Step 1: Write failing parser tests**

```ts
it('normalizes a message without accepting virtual paths or extra fields', () => {
  expect(parseAiSendMessageRequest({ sessionId: 'session-1', message: '  建立队列研究问卷  ' }))
    .toEqual({ sessionId: 'session-1', message: '建立队列研究问卷' })
  expect(() => parseAiSendMessageRequest({
    sessionId: 'session-1', message: 'x', virtualPath: 'session://other/state/x'
  })).toThrow('INVALID_AI_SEND_REQUEST')
})

it('rejects oversized messages and unsafe configuration URLs', () => {
  expect(() => parseAiSendMessageRequest({ sessionId: 's', message: 'x'.repeat(32_001) }))
    .toThrow('INVALID_AI_SEND_REQUEST')
  expect(() => parseAiConfigUpdateRequest({ baseUrl: 'http://remote.example/v1', model: 'm' }))
    .toThrow('INSECURE_AI_BASE_URL')
})
```

- [ ] **Step 2: Run the contract test and confirm failure**

Run: `pnpm vitest run tests/unit/shared/ai-contract.test.ts`

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Define the canonical types**

```ts
export type AiMessageRole = 'user' | 'assistant' | 'system'
export type AiMessageKind = 'text' | 'questionnaire_snapshot' | 'repair'

export interface AiMessage {
  id: string
  role: AiMessageRole
  kind: AiMessageKind
  content: string
  createdAt: string
}

export interface AiVersionStamp {
  promptId: string
  promptVersion: string
  promptHash: string
  harnessVersion: string
  schemaVersion: string
}

export interface QuestionnaireDiff {
  added: string[]
  removed: string[]
  modified: Array<{ variableName: string; fields: string[] }>
  orderChanged: boolean
  rulesChanged: boolean
}

export interface AiArtifact {
  artifactId: string
  sourceRunId: string
  createdAt: string
  status: 'ready' | 'applied'
  baseQuestionnaireHash: string
  questionnaire: QuestionnaireDef
  diff: QuestionnaireDiff
  versions: AiVersionStamp
  appliedAt?: string
}

export interface AiSessionRecord {
  sessionId: string
  title: string
  createdAt: string
  updatedAt: string
  conversation: AiMessage[]
  state: {
    turn: number
    rollingSummary: string
    activeArtifactId?: string
    versions: AiVersionStamp
  }
  cache: Record<string, { createdAt: string; value: string }>
  artifacts: Record<string, AiArtifact>
  temp: Record<string, { runId: string; status: 'running' | 'cancelled'; rawResponse: string }>
}

export interface AiProjectData {
  schemaVersion: 1
  sessions: Record<string, AiSessionRecord>
}
```

Add `aiAssistant?: AiProjectData` to `ProjectData`; absence means an older project with no Sessions.

- [ ] **Step 4: Define fixed channels and exact public APIs**

The contract exposes config get/update/test, privacy accept, Session list/create/get/rename/delete/clear-cache/migrate-prompt, current-questionnaire preview/attach, send/cancel, and artifact apply. Parsers accept no caller-supplied file path or virtual URI. Use `MAX_AI_MESSAGE_LENGTH = 32_000`, `MAX_AI_TITLE_LENGTH = 120`, `MAX_AI_MODEL_LENGTH = 200`, `MAX_AI_BASE_URL_LENGTH = 2_048`.

```ts
export interface AiConfigPublic {
  baseUrl: string
  model: string
  hasApiKey: boolean
  acceptedPrivacyNoticeVersion: number | null
  capabilities: { jsonSchema: boolean } | null
}

export interface AiSendMessageRequest { sessionId: string; message: string }
export interface AiSendMessageResult {
  runId: string
  assistantMessage: AiMessage
  artifact?: AiArtifact
}
```

- [ ] **Step 5: Run tests and typecheck**

Run: `pnpm vitest run tests/unit/shared/ai-contract.test.ts && pnpm typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/shared/types/ai.ts src/shared/ai-contract.ts src/shared/types/project.ts tests/unit/shared/ai-contract.test.ts
git commit -m "feat(ai): define assistant domain contracts"
```

---

### Task 2: Secure Global API Configuration

**Files:**
- Create: `src/main/services/ai/ai-config.store.ts`
- Create: `tests/unit/main/services/ai-config.store.test.ts`

**Interfaces:**
- Consumes: `AiConfigPublic` and parsed update requests from Task 1.
- Produces: `AiConfigStore.getPublic()`, `getSecret()`, `update()`, `acceptPrivacy()`, `setCapabilities()`.

- [ ] **Step 1: Write failing security tests**

```ts
it('persists only safeStorage ciphertext and never plaintext API keys', async () => {
  const safeStorage = fakeSafeStorage('cipher:')
  const store = createAiConfigStore(folder, safeStorage)
  await store.update({ baseUrl: 'https://api.example/v1', model: 'model-a', apiKey: 'secret-key' })
  const raw = await readFile(join(folder, 'ai-config.json'), 'utf8')
  expect(raw).not.toContain('secret-key')
  expect((await store.getPublic()).hasApiKey).toBe(true)
  expect((await store.getSecret()).apiKey).toBe('secret-key')
})

it('refuses to remember a key when OS encryption is unavailable', async () => {
  const store = createAiConfigStore(folder, unavailableSafeStorage)
  await expect(store.update({ baseUrl: 'https://api.example/v1', model: 'm', apiKey: 'secret' }))
    .rejects.toThrow('AI_CREDENTIAL_STORAGE_UNAVAILABLE')
})
```

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `pnpm vitest run tests/unit/main/services/ai-config.store.test.ts`

Expected: FAIL because the store is absent.

- [ ] **Step 3: Implement atomic safeStorage persistence**

```ts
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
}

interface AiConfigFileV1 {
  schemaVersion: 1
  baseUrl: string
  model: string
  encryptedApiKey?: string
  acceptedPrivacyNoticeVersion?: number
  capabilities?: { jsonSchema: boolean }
}
```

Write canonical JSON through `atomicWriteFile`. Preserve the existing encrypted key when an update omits `apiKey`; support explicit `clearApiKey: true`. Never log request bodies or decrypted values. Corrupt ciphertext returns `AI_CREDENTIAL_READ_FAILED` without exposing file paths.

```ts
const next: AiConfigFileV1 = {
  ...current,
  baseUrl: request.baseUrl,
  model: request.model,
  ...(request.apiKey !== undefined
    ? { encryptedApiKey: safeStorage.encryptString(request.apiKey).toString('base64') }
    : {}),
  ...(request.clearApiKey ? { encryptedApiKey: undefined } : {})
}
atomicWriteFile(configPath, Buffer.from(`${JSON.stringify(next)}\n`, 'utf8'))
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run tests/unit/main/services/ai-config.store.test.ts`

Expected: PASS for cross-project reuse, key replacement, key clearing, corrupt-file recovery, and unavailable encryption.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/ai/ai-config.store.ts tests/unit/main/services/ai-config.store.test.ts
git commit -m "feat(ai): store global API credentials securely"
```

---

### Task 3: Encrypted Virtual Session Repository

**Files:**
- Create: `src/main/services/ai/virtual-session.repository.ts`
- Create: `src/main/services/atomic-file.service.ts`
- Create: `src/main/services/project-persistence.service.ts`
- Modify: `src/main/services/project.service.ts`
- Modify: `src/main/services/record.service.ts`
- Modify: `src/main/services/backup.service.ts`
- Create: `tests/unit/main/services/virtual-session.repository.test.ts`
- Create: `tests/unit/main/services/project-persistence.service.test.ts`
- Modify: `tests/unit/main/services/project.service.test.ts`

**Interfaces:**
- Consumes: `ProjectIpcState`, `AiSessionRecord`, `AiProjectData`.
- Produces: transactional project persistence and virtual Session CRUD.

- [ ] **Step 1: Write failing encryption and isolation tests**

```ts
it('stores every session partition inside the encrypted project payload', () => {
  const session = repository.createSession('队列研究')
  repository.appendMessage(session.sessionId, userMessage('敏感问卷描述'))
  const bytes = readFileSync(projectPath)
  expect(bytes.includes(Buffer.from('敏感问卷描述'))).toBe(false)
  expect(decryptProjectData(projectPath, key).aiAssistant?.sessions[session.sessionId]).toBeDefined()
})

it.each([
  'session://id/../state/x',
  'C:/project/session/state/x',
  'session://other-session/conversation/x'
])('rejects virtual path escape %s', (uri) => {
  expect(() => repository.resolveForSession(activeSessionId, uri)).toThrow('AI_VIRTUAL_PATH_FORBIDDEN')
})
```

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `pnpm vitest run tests/unit/main/services/virtual-session.repository.test.ts tests/unit/main/services/project-persistence.service.test.ts`

Expected: FAIL because repository and transactional persistence are absent.

- [ ] **Step 3: Make project writes atomic**

Move the existing `atomicWriteFile()` implementation from `record.service.ts` into focused `atomic-file.service.ts`, then update record and backup imports. Change `saveProject()` to call `atomicWriteFile(filePath, createProjectFileContents(...))` instead of `writeFileSync`. Add `CurrentProjectPersistence.persist(mutator)` that deep-clones the affected `questionnaire`/`aiAssistant` branch, mutates it, saves once, and restores the in-memory branch if saving throws.

```ts
persist<T>(mutator: (project: ProjectData) => T): T {
  const before = structuredClone(this.state.currentProject)
  try {
    const result = mutator(this.requireUnlockedProject())
    this.saveCurrent()
    return result
  } catch (error) {
    this.state.currentProject = before
    throw error
  }
}
```

- [ ] **Step 4: Implement virtual URI parsing and repository operations**

```ts
export type AiPartition = 'conversation' | 'state' | 'cache' | 'artifacts' | 'temp'
export interface ResolvedAiVirtualPath {
  sessionId: string
  partition: AiPartition
  resource: string[]
}

export function parseAiVirtualUri(uri: string): ResolvedAiVirtualPath

export class VirtualSessionRepository {
  resolveForSession(sessionId: string, uri: string): ResolvedAiVirtualPath
  listSessions(): AiSessionRecord[]
  createSession(title: string, versions: AiVersionStamp): AiSessionRecord
  getSession(sessionId: string): AiSessionRecord
  renameSession(sessionId: string, title: string): AiSessionRecord
  deleteSession(sessionId: string): void
  clearCache(sessionId: string): void
  appendMessage(sessionId: string, message: AiMessage): void
  putArtifact(sessionId: string, artifact: AiArtifact): void
  beginRun(sessionId: string, runId: string): void
  cancelRun(sessionId: string, runId: string): void
  finishRun(sessionId: string, runId: string): void
  cleanupInterruptedRuns(): number
}
```

Each mutating method uses `CurrentProjectPersistence.persist`. `clearCache` changes only `cache`; deleting a Session removes all five partitions; interrupted `temp` runs are removed on project open.

```ts
clearCache(sessionId: string): void {
  this.persistence.persist((project) => {
    this.requireSession(project, sessionId).cache = {}
  })
}

deleteSession(sessionId: string): void {
  this.persistence.persist((project) => {
    const sessions = this.requireAiProject(project).sessions
    if (sessions[sessionId] === undefined) throw new Error('AI_SESSION_NOT_FOUND')
    delete sessions[sessionId]
  })
}
```

- [ ] **Step 5: Run repository and project tests**

Run: `pnpm vitest run tests/unit/main/services/virtual-session.repository.test.ts tests/unit/main/services/project-persistence.service.test.ts tests/unit/main/services/project.service.test.ts tests/unit/main/services/record.service.test.ts tests/unit/main/services/backup.service.test.ts`

Expected: PASS, including opening a v1 project with no `aiAssistant` field.

- [ ] **Step 6: Commit**

```bash
git add src/main/services/atomic-file.service.ts src/main/services/ai/virtual-session.repository.ts src/main/services/project-persistence.service.ts src/main/services/project.service.ts src/main/services/record.service.ts src/main/services/backup.service.ts tests/unit/main/services/virtual-session.repository.test.ts tests/unit/main/services/project-persistence.service.test.ts tests/unit/main/services/project.service.test.ts tests/unit/main/services/record.service.test.ts tests/unit/main/services/backup.service.test.ts
git commit -m "feat(ai): add encrypted virtual session storage"
```

---

### Task 4: Versioned Prompt Registry and Context Builder

**Files:**
- Create: `src/main/services/ai/prompts/questionnaire-v1.ts`
- Create: `src/main/services/ai/prompt-registry.ts`
- Create: `src/main/services/ai/context-builder.ts`
- Create: `tests/unit/main/services/ai-prompt-registry.test.ts`
- Create: `tests/unit/main/services/ai-context-builder.test.ts`

**Interfaces:**
- Consumes: Session messages/state from Task 3.
- Produces: `PromptRegistry.latest()`, `get()`, `migrateSessionPrompt()`, and `buildAiContext()`.

- [ ] **Step 1: Write failing version and isolation tests**

```ts
it('pins an existing session while new sessions use the latest stable prompt', () => {
  const registry = createPromptRegistry([promptV1, promptV2])
  expect(registry.get('questionnaire', '1.0.0').hash).toBe(sha256(promptV1.content))
  expect(registry.latest('questionnaire').version).toBe('2.0.0')
})

it('builds context from one session and excludes unrelated project data', () => {
  const context = buildAiContext(sessionA, promptV1, { maxCharacters: 12_000 })
  expect(context.messages.some((m) => m.content.includes('session B secret'))).toBe(false)
  expect(context.messages.some((m) => m.content.includes('record-1'))).toBe(false)
  expect(context.messages.some((m) => m.content.includes('active AI draft'))).toBe(true)
})
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `pnpm vitest run tests/unit/main/services/ai-prompt-registry.test.ts tests/unit/main/services/ai-context-builder.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement immutable Prompt descriptors**

```ts
export interface PromptDescriptor {
  id: 'questionnaire'
  version: string
  content: string
  hash: string
  harnessVersion: '1.0.0'
  schemaVersion: '1.0.0'
  releasedAt: string
  changeNote: string
}
```

The v1 Prompt explicitly permits only `set_metadata`, `upsert_question`, `remove_question`, `reorder_questions`, and `replace_condition_rules`; it requires `message`, `rollingSummary`, and `operations`, and states that variables use stable `ref` values rather than model-generated UUIDs.

- [ ] **Step 4: Implement bounded context assembly**

Always include the pinned system Prompt, stored rolling summary, recent conversation messages, the current user message, and the canonical active AI draft referenced by `state.activeArtifactId`. The draft is derived only from the current Session conversation and excludes `derivedVariables`; label it with its `session://{session_id}/artifacts/{artifact_id}` virtual URI. Use a deterministic character budget; if full history exceeds it, retain the summary, active draft, and newest complete turns. Never call a model solely to summarize—the current response supplies the next rolling summary.

```ts
const required = [
  { role: 'system' as const, content: prompt.content },
  { role: 'system' as const, content: `对话摘要：${session.state.rollingSummary}` },
  ...(activeDraft === undefined
    ? []
    : [{ role: 'system' as const, content: `${artifactUri}\n${canonicalizeAiDraft(activeDraft)}` }]),
  { role: 'user' as const, content: currentMessage }
]
return { messages: fitNewestCompleteTurns(required, session.conversation, maxCharacters) }
```

- [ ] **Step 5: Run tests and commit**

Run: `pnpm vitest run tests/unit/main/services/ai-prompt-registry.test.ts tests/unit/main/services/ai-context-builder.test.ts`

```bash
git add src/main/services/ai/prompts/questionnaire-v1.ts src/main/services/ai/prompt-registry.ts src/main/services/ai/context-builder.ts tests/unit/main/services/ai-prompt-registry.test.ts tests/unit/main/services/ai-context-builder.test.ts
git commit -m "feat(ai): version questionnaire prompts and context"
```

---

### Task 5: Questionnaire Harness

**Files:**
- Create: `src/main/services/ai/questionnaire-harness.ts`
- Create: `tests/unit/main/services/questionnaire-harness.test.ts`

**Interfaces:**
- Consumes: base `QuestionnaireDef`, structured or text model response.
- Produces: `HarnessResult` containing assistant text, rolling summary, normalized questionnaire, diff, and validation errors.

- [ ] **Step 1: Write failing generation and rejection tests**

```ts
it('creates local ids and resolves condition refs without trusting model ids', () => {
  const result = harness.run(emptyQuestionnaire, validCandidate)
  expect(result.ok).toBe(true)
  expect(result.questionnaire?.questions.every((q) => UUID_RE.test(q.id))).toBe(true)
  expect(result.questionnaire?.conditionRules[0]?.targetQuestionIds).toEqual([
    result.questionnaire?.questions.find((q) => q.variableName === 'cigarettes_per_day')?.id
  ])
})

it.each([
  ['duplicate variable', duplicateVariableCandidate, 'DUPLICATE_VARIABLE_NAME'],
  ['missing target', missingConditionTarget, 'UNKNOWN_QUESTION_REF'],
  ['derived operation', derivedVariableCandidate, 'FORBIDDEN_AI_OPERATION'],
  ['invalid numeric range', reversedRangeCandidate, 'INVALID_QUESTION_CONSTRAINT']
])('rejects %s', (_name, candidate, code) => {
  expect(harness.run(emptyQuestionnaire, candidate)).toMatchObject({ ok: false, errors: [{ code }] })
})
```

- [ ] **Step 2: Run the harness test and confirm failure**

Run: `pnpm vitest run tests/unit/main/services/questionnaire-harness.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement exact candidate operations**

```ts
export type CandidateOperation =
  | { op: 'set_metadata'; name: string; description?: string }
  | { op: 'upsert_question'; ref: string; question: Omit<QuestionDef, 'id' | 'order'> }
  | { op: 'remove_question'; ref: string }
  | { op: 'reorder_questions'; refs: string[] }
  | { op: 'replace_condition_rules'; rules: CandidateConditionRule[] }

export interface HarnessResult {
  ok: boolean
  message: string
  rollingSummary: string
  questionnaire?: QuestionnaireDef
  diff?: QuestionnaireDiff
  errors: Array<{ code: string; message: string; ref?: string }>
}
```

Parse direct JSON first, then one fenced `easyepi-json` block for text fallback. Reject trailing executable instructions. Upsert matches existing questions by `ref === variableName`, preserves existing local IDs, generates new IDs with `randomUUID`, and recomputes contiguous order and `keyQuestionIds`.

- [ ] **Step 4: Implement deterministic validation and diff**

Validate variable regex `^[A-Za-z][A-Za-z0-9_]*$`, uniqueness against questions and existing derived variables, supported types, choice option uniqueness, fixed length, numeric min/max/step, valid regex, at least one Key, condition source/target refs, nonempty targets, and `detectConflicts()`. Diff compares canonical fields and rules, not generated IDs.

```ts
const variableNames = new Set<string>()
for (const question of questionnaire.questions) {
  if (!VARIABLE_NAME_RE.test(question.variableName)) {
    errors.push(error('INVALID_VARIABLE_NAME', question.variableName))
  }
  if (variableNames.has(question.variableName) || derivedNames.has(question.variableName)) {
    errors.push(error('DUPLICATE_VARIABLE_NAME', question.variableName))
  }
  variableNames.add(question.variableName)
  errors.push(...validateQuestionDefinition(question))
}
errors.push(...validateConditionReferences(questionnaire), ...detectConflicts(questionnaire).map(conflictError))
```

- [ ] **Step 5: Run tests and commit**

Run: `pnpm vitest run tests/unit/main/services/questionnaire-harness.test.ts tests/unit/main/services/qnaire.service.test.ts`

```bash
git add src/main/services/ai/questionnaire-harness.ts tests/unit/main/services/questionnaire-harness.test.ts
git commit -m "feat(ai): validate model questionnaire operations"
```

---

### Task 6: Explicit Questionnaire Attachment and Artifact Application

**Files:**
- Create: `src/main/services/ai/artifact.service.ts`
- Create: `tests/unit/main/services/ai-artifact.service.test.ts`

**Interfaces:**
- Consumes: repository from Task 3, Harness artifacts from Task 5, `createBackup()`.
- Produces: `previewCurrentQuestionnaire()`, `attachCurrentQuestionnaire()`, `applyArtifact()`.

- [ ] **Step 1: Write failing consent, stale, backup, and idempotency tests**

```ts
it('does not append a questionnaire until the preview hash is confirmed', () => {
  const preview = service.previewCurrentQuestionnaire()
  expect(preview.questionnaire).not.toHaveProperty('derivedVariables')
  expect(session.conversation).toHaveLength(0)
  service.attachCurrentQuestionnaire(session.sessionId, preview.hash)
  expect(repository.getSession(session.sessionId).conversation.at(-1)?.kind)
    .toBe('questionnaire_snapshot')
})

it('creates one backup and applies one artifact exactly once', () => {
  const first = service.applyArtifact(sessionId, artifactId)
  const second = service.applyArtifact(sessionId, artifactId)
  expect(first).toMatchObject({ ok: true, alreadyApplied: false })
  expect(second).toMatchObject({ ok: true, alreadyApplied: true })
  expect(createBackup).toHaveBeenCalledTimes(1)
  expect(project.questionnaire.derivedVariables).toEqual(existingDerivedVariables)
})
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `pnpm vitest run tests/unit/main/services/ai-artifact.service.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement canonical hashing and explicit attach**

Canonicalize question/rule arrays, hash the full formal questionnaire with SHA-256, and return `{ questionnaire, hash }` for local preview. The preview and attached message must omit `derivedVariables`, while the local hash and later application preserve them unchanged. `attachCurrentQuestionnaire(sessionId, expectedHash)` recalculates and rejects `AI_QUESTIONNAIRE_CHANGED` if different, then appends one sanitized `questionnaire_snapshot` message. This method never calls the network.

```ts
const formal = this.requireQuestionnaire()
const hash = hashQuestionnaire(formal)
const { derivedVariables: _privateDerived, ...visible } = formal
return { questionnaire: visible, hash }

if (hashQuestionnaire(this.requireQuestionnaire()) !== expectedHash) {
  throw new Error('AI_QUESTIONNAIRE_CHANGED')
}
this.repository.appendMessage(sessionId, questionnaireSnapshotMessage(visible))
```

- [ ] **Step 4: Implement transactional application**

Reject artifacts whose `baseQuestionnaireHash` no longer matches the formal questionnaire with `AI_ARTIFACT_STALE`. Create a project/data snapshot, then in one `CurrentProjectPersistence.persist()` mutation replace `project.questionnaire` and mark the artifact applied. Restore the in-memory state when backup or save fails.

```ts
if (artifact.status === 'applied') return { ok: true, alreadyApplied: true }
if (artifact.baseQuestionnaireHash !== hashQuestionnaire(project.questionnaire)) {
  throw new Error('AI_ARTIFACT_STALE')
}
const backupPath = this.createSnapshot()
this.persistence.persist((current) => {
  current.questionnaire = preserveDerivedVariables(artifact.questionnaire, current.questionnaire)
  const stored = this.requireArtifact(current, sessionId, artifactId)
  stored.status = 'applied'
  stored.appliedAt = this.now().toISOString()
})
return { ok: true, alreadyApplied: false, backupPath }
```

- [ ] **Step 5: Run tests and commit**

Run: `pnpm vitest run tests/unit/main/services/ai-artifact.service.test.ts tests/unit/main/services/backup.service.test.ts`

```bash
git add src/main/services/ai/artifact.service.ts tests/unit/main/services/ai-artifact.service.test.ts
git commit -m "feat(ai): preview and apply questionnaire artifacts"
```

---

### Task 7: OpenAI-Compatible Client and Capability Test

**Files:**
- Create: `src/main/services/ai/openai-client.ts`
- Create: `tests/unit/main/services/openai-client.test.ts`

**Interfaces:**
- Consumes: secret config from Task 2 and context messages from Task 4.
- Produces: `OpenAiClient.testConnection()` and `complete()` with stable error codes.

- [ ] **Step 1: Write failing HTTP behavior tests**

```ts
it('uses one chat completion request with stored JSON capability', async () => {
  fetchMock.mockResolvedValue(okCompletion(structuredPayload))
  await client.complete(configWithJsonSchema, messages, abort.signal)
  expect(fetchMock).toHaveBeenCalledTimes(1)
  expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string).response_format.type)
    .toBe('json_schema')
})

it.each([[401, 'AI_AUTH_FAILED'], [429, 'AI_RATE_LIMITED'], [500, 'AI_PROVIDER_FAILED']])(
  'maps HTTP %i without returning provider bodies', async (status, code) => {
    fetchMock.mockResolvedValue(new Response('D:/secret provider detail', { status }))
    await expect(client.complete(config, messages, abort.signal)).rejects.toThrow(code)
  }
)
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `pnpm vitest run tests/unit/main/services/openai-client.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement safe URL and fetch handling**

Normalize a Base URL such as `https://api.openai.com/v1` to `/chat/completions`; reject credentials in URLs and insecure non-loopback HTTP. Send `Authorization: Bearer <key>`, `Content-Type: application/json`, configured model, messages, and a 120-second abort deadline. Cap response body at 4 MiB before JSON parsing.

```ts
export interface OpenAiClient {
  testConnection(config: AiSecretConfig, signal: AbortSignal): Promise<{ jsonSchema: boolean }>
  complete(
    config: AiSecretConfig,
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    signal: AbortSignal
  ): Promise<{ content: string; requestId?: string }>
}

const response = await fetch(resolveChatCompletionsUrl(config.baseUrl), {
  method: 'POST',
  headers: {
    authorization: `Bearer ${config.apiKey}`,
    'content-type': 'application/json'
  },
  body: JSON.stringify(buildCompletionBody(config, messages)),
  signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)])
})
if (!response.ok) throw mapProviderStatus(response.status)
const text = await readLimitedBody(response, 4 * 1024 * 1024)
return parseCompletionResponse(text)
```

`testConnection()` first tries a minimal JSON Schema request; on an explicit unsupported-format 400 response it performs one plain compatibility request and returns `{ jsonSchema: false }`. Normal `complete()` never capability-probes or retries.

- [ ] **Step 4: Run tests and commit**

Run: `pnpm vitest run tests/unit/main/services/openai-client.test.ts`

```bash
git add src/main/services/ai/openai-client.ts tests/unit/main/services/openai-client.test.ts
git commit -m "feat(ai): add OpenAI compatible client"
```

---

### Task 8: One-Call Orchestrator, Repair Loop, and Cancellation

**Files:**
- Create: `src/main/services/ai/ai-orchestrator.ts`
- Create: `tests/unit/main/services/ai-orchestrator.test.ts`

**Interfaces:**
- Consumes: config, repository, Prompt registry/context builder, OpenAI Client, Harness.
- Produces: `sendMessage()` and `cancelRun()`.

- [ ] **Step 1: Write failing call-count and cleanup tests**

```ts
it('uses exactly one provider call for a valid normal turn', async () => {
  client.complete.mockResolvedValue({ content: validCandidateJson })
  const result = await orchestrator.sendMessage({ sessionId, message: '建立吸烟调查' })
  expect(client.complete).toHaveBeenCalledTimes(1)
  expect(result.artifact?.status).toBe('ready')
  expect(repository.getSession(sessionId).temp).toEqual({})
})

it('refines the active session artifact instead of restarting from the formal questionnaire', async () => {
  seedActiveArtifact(sessionId, questionnaireWithAgeQuestion)
  client.complete.mockResolvedValue({ content: addSmokingQuestionCandidate })
  const result = await orchestrator.sendMessage({ sessionId, message: '再增加吸烟问题' })
  expect(result.artifact?.questionnaire.questions.map((q) => q.variableName))
    .toEqual(['age', 'smoking'])
})

it('stops after two repair calls and creates no artifact on final failure', async () => {
  client.complete.mockResolvedValue({ content: invalidCandidateJson })
  await expect(orchestrator.sendMessage({ sessionId, message: '建立问卷' }))
    .rejects.toThrow('AI_OUTPUT_INVALID')
  expect(client.complete).toHaveBeenCalledTimes(3)
  expect(Object.keys(repository.getSession(sessionId).artifacts)).toHaveLength(0)
})
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `pnpm vitest run tests/unit/main/services/ai-orchestrator.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement run ownership and privacy gates**

Require an unlocked project, nonempty API config, API key, accepted privacy notice version 1, and a Session belonging to the current project. Create one `runId`, one `AbortController`, and one temp entry. Keep active controllers in a process-memory `Map<runId, { sessionId, controller }>`; `cancelRun` verifies the owning Session before aborting.

```ts
const config = await this.config.getSecret()
if (config.acceptedPrivacyNoticeVersion !== 1) throw new Error('AI_PRIVACY_CONSENT_REQUIRED')
const session = this.repository.getSession(request.sessionId)
const formal = this.artifacts.requireCurrentQuestionnaire()
const activeArtifact = session.state.activeArtifactId === undefined
  ? undefined
  : session.artifacts[session.state.activeArtifactId]
if (activeArtifact !== undefined && activeArtifact.baseQuestionnaireHash !== hashQuestionnaire(formal)) {
  throw new Error('AI_ARTIFACT_STALE')
}
const harnessBase = activeArtifact?.questionnaire ?? formal
const runId = randomUUID()
const controller = new AbortController()
this.activeRuns.set(runId, { sessionId: session.sessionId, controller })
this.repository.beginRun(session.sessionId, runId)
```

- [ ] **Step 4: Implement the bounded repair loop**

Append the user message, build context, and call the model once. On parser/Harness errors append a visible `repair` message containing only stable validation codes and safe messages, then rebuild context and retry. Stop after three total calls. On success append the assistant message, update rolling summary/turn, store one artifact, and clear temp. On cancellation mark then remove temp and return `AI_RUN_CANCELLED`; on all failures clear temp and preserve the last valid artifact/formal questionnaire.

```ts
for (let attempt = 0; attempt < 3; attempt += 1) {
  const completion = await this.client.complete(config, context, controller.signal)
  const result = this.harness.run(harnessBase, completion.content)
  if (result.ok) return this.commitSuccessfulRun(session, runId, result)
  if (attempt === 2) throw new Error('AI_OUTPUT_INVALID')
  this.repository.appendMessage(session.sessionId, repairMessage(result.errors))
  context = this.contextBuilder.build(this.repository.getSession(session.sessionId), request.message)
}
throw new Error('AI_OUTPUT_INVALID')
```

- [ ] **Step 5: Run tests and commit**

Run: `pnpm vitest run tests/unit/main/services/ai-orchestrator.test.ts`

```bash
git add src/main/services/ai/ai-orchestrator.ts tests/unit/main/services/ai-orchestrator.test.ts
git commit -m "feat(ai): orchestrate single-call questionnaire runs"
```

---

### Task 9: Main IPC and Frozen Preload API

**Files:**
- Create: `src/main/ipc/ai.ipc.ts`
- Modify: `src/main/index.ts`
- Modify: `src/shared/desktop-api.ts`
- Modify: `src/preload/desktop-api.ts`
- Create: `tests/unit/main/ai-ipc.test.ts`
- Modify: `tests/unit/preload/desktop-api.test.ts`

**Interfaces:**
- Consumes: all services from Tasks 2–8.
- Produces: frozen `window.easyEpi.ai` namespace with no generic invoke or filesystem access.

- [ ] **Step 1: Write failing channel and preload tests**

```ts
it('checks the trusted sender before parsing every AI request', async () => {
  await expect(handlers.get(AI_SEND_MESSAGE_CHANNEL)!(untrustedEvent, validRequest))
    .rejects.toThrow('UNTRUSTED_IPC_SENDER')
  expect(orchestrator.sendMessage).not.toHaveBeenCalled()
})

it('exposes fixed AI methods without paths or generic channels', () => {
  const api = createDesktopApi(vi.fn())
  expect(Object.isFrozen(api.ai)).toBe(true)
  expect(Object.keys(api.ai)).toEqual([
    'getConfig', 'updateConfig', 'testConnection', 'acceptPrivacy',
    'listSessions', 'createSession', 'getSession', 'renameSession', 'deleteSession',
    'clearCache', 'migratePrompt', 'previewCurrentQuestionnaire',
    'attachCurrentQuestionnaire', 'sendMessage', 'cancelRun', 'applyArtifact'
  ])
})
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `pnpm vitest run tests/unit/main/ai-ipc.test.ts tests/unit/preload/desktop-api.test.ts`

Expected: FAIL.

- [ ] **Step 3: Register validated handlers and compose services**

Instantiate `AiConfigStore` with `app.getPath('userData')` and Electron `safeStorage`; instantiate repository/persistence per current `projectState`; register/dispose all channels in `main/index.ts`. `testConnection` stores detected capabilities. Session/project errors return stable codes and never raw paths/provider bodies.

```ts
const aiServices = createAiServices({
  projectState,
  userDataPath: app.getPath('userData'),
  safeStorage,
  fetch
})
disposeAiIpc = registerAiIpcHandlers(
  ipcMain, aiServices, packagedRendererUrl, developmentUrl
)
```

- [ ] **Step 4: Extend DesktopApi and preload**

Add typed overloads to `DesktopInvoke`, invoke only channel constants, parse config and Session responses in preload, freeze `ai`, and update the exact top-level key test to include `ai`.

```ts
const ai = Object.freeze({
  getConfig: () => invoke(AI_CONFIG_GET_CHANNEL),
  sendMessage: (request: AiSendMessageRequest) =>
    invoke(AI_SEND_MESSAGE_CHANNEL, parseAiSendMessageRequest(request)),
  cancelRun: (request: AiCancelRunRequest) =>
    invoke(AI_CANCEL_RUN_CHANNEL, parseAiCancelRunRequest(request)),
  applyArtifact: (request: AiApplyArtifactRequest) =>
    invoke(AI_APPLY_ARTIFACT_CHANNEL, parseAiApplyArtifactRequest(request))
})
```

- [ ] **Step 5: Run tests and commit**

Run: `pnpm vitest run tests/unit/main/ai-ipc.test.ts tests/unit/preload/desktop-api.test.ts tests/unit/shared/ai-contract.test.ts && pnpm typecheck`

```bash
git add src/main/ipc/ai.ipc.ts src/main/index.ts src/shared/desktop-api.ts src/preload/desktop-api.ts tests/unit/main/ai-ipc.test.ts tests/unit/preload/desktop-api.test.ts
git commit -m "feat(ai): expose assistant through safe IPC"
```

---

### Task 10: Project Access Mirror and Global AI Settings UI

**Files:**
- Modify: `src/shared/qnaire-contract.ts`
- Modify: `src/main/ipc/project.ipc.ts`
- Modify: `src/shared/desktop-api.ts`
- Modify: `src/preload/desktop-api.ts`
- Create: `src/renderer/stores/project-access-store.tsx`
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/app/AppShell.tsx`
- Modify: `src/renderer/pages/WelcomePage.tsx`
- Modify: `src/renderer/components/import/ImportWizard.tsx`
- Create: `src/renderer/components/ai/AiSettingsSection.tsx`
- Modify: `src/renderer/components/common/SettingsDialog.tsx`
- Create: `tests/unit/renderer/ai-settings.test.tsx`
- Create: `tests/unit/renderer/stores/project-access-store.test.tsx`

**Interfaces:**
- Consumes: `window.easyEpi.project.getStatus()` and `window.easyEpi.ai` from Task 9.
- Produces: project-aware AI navigation and safe global settings form.

- [ ] **Step 1: Write failing access and settings tests**

```tsx
it('shows AI questionnaire navigation only for an unlocked project', async () => {
  renderShellWithProject({ isUnlocked: false })
  expect(screen.queryByRole('link', { name: 'AI 问卷助手' })).not.toBeInTheDocument()
  projectStore.getState().markUnlocked({ name: 'study' })
  expect(await screen.findByRole('link', { name: 'AI 问卷助手' })).toBeVisible()
})

it('never echoes the stored API key into the settings form', async () => {
  getConfig.mockResolvedValue({ baseUrl: 'https://api.example/v1', model: 'm', hasApiKey: true })
  renderSettings()
  expect(await screen.findByText('已安全保存 API Key')).toBeVisible()
  expect(screen.getByLabelText('API Key')).toHaveValue('')
})
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `pnpm vitest run tests/unit/renderer/ai-settings.test.tsx tests/unit/renderer/stores/project-access-store.test.tsx tests/unit/renderer/AppShell.test.tsx`

Expected: FAIL.

- [ ] **Step 3: Add project status API and Provider**

Add `PROJECT_GET_STATUS_CHANNEL` returning only `{ isUnlocked: boolean; projectName?: string }`. Provider loads status on mount; Welcome create/open and successful EpiData import call `markUnlocked`, and project close calls `markLocked`. AppShell marks the AI nav item `access: 'project'` and filters it separately from admin items.

```ts
ipcMain.handle(PROJECT_GET_STATUS_CHANNEL, async (event) => {
  assertTrustedSender(event, packagedRendererUrl, developmentOrigin)
  return state.currentProject !== null && state.auth.encryptionKey !== null
    ? { isUnlocked: true, projectName: state.currentProject.meta.name }
    : { isUnlocked: false }
})
```

- [ ] **Step 4: Implement settings fields and connection test**

Settings includes Base URL, API Key, model, Save, Clear Key, and Test Connection. Blank API Key preserves a stored key. Clear sensitive component state when the modal closes. Display `jsonSchema` capability after a successful test and map authentication, model, timeout, TLS, and secure-storage errors to fixed Chinese messages.

```tsx
<Input label="Base URL" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} />
<Input label="API Key" type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} />
<Input label="模型名称" value={model} onChange={(event) => setModel(event.target.value)} />
<Button onClick={() => void save({ baseUrl, model, ...(apiKey ? { apiKey } : {}) })}>保存 AI 配置</Button>
<Button variant="secondary" onClick={() => void testConnection()}>测试连接</Button>
```

- [ ] **Step 5: Run tests and commit**

Run: `pnpm vitest run tests/unit/renderer/ai-settings.test.tsx tests/unit/renderer/stores/project-access-store.test.tsx tests/unit/renderer/AppShell.test.tsx tests/unit/main/project-ipc.test.ts tests/unit/preload/desktop-api.test.ts`

```bash
git add src/shared/qnaire-contract.ts src/main/ipc/project.ipc.ts src/shared/desktop-api.ts src/preload/desktop-api.ts src/renderer/stores/project-access-store.tsx src/renderer/App.tsx src/renderer/app/AppShell.tsx src/renderer/pages/WelcomePage.tsx src/renderer/components/import/ImportWizard.tsx src/renderer/components/ai/AiSettingsSection.tsx src/renderer/components/common/SettingsDialog.tsx tests/unit/renderer/ai-settings.test.tsx tests/unit/renderer/stores/project-access-store.test.tsx tests/unit/renderer/AppShell.test.tsx
git commit -m "feat(ai): add project-aware assistant settings"
```

---

### Task 11: Multi-Session Chat, Draft Diff, and Apply UI

**Files:**
- Create: `src/renderer/stores/ai-assistant.store.ts`
- Create: `src/renderer/components/ai/AiSessionList.tsx`
- Create: `src/renderer/components/ai/AiConversation.tsx`
- Create: `src/renderer/components/ai/AiDraftPanel.tsx`
- Create: `src/renderer/components/ai/PrivacyConsentDialog.tsx`
- Create: `src/renderer/components/ai/QuestionnaireSendPreview.tsx`
- Create: `src/renderer/pages/AiQuestionnairePage.tsx`
- Modify: `src/renderer/app/routes.tsx`
- Create: `tests/unit/renderer/stores/ai-assistant.store.test.ts`
- Create: `tests/unit/renderer/ai-questionnaire-page.test.tsx`
- Modify: `tests/unit/renderer/routes.test.tsx`

**Interfaces:**
- Consumes: `window.easyEpi.ai`, project access state, `AiSessionRecord`, `AiArtifact`.
- Produces: `/ai-questionnaire` end-user workflow.

- [ ] **Step 1: Write failing store and page tests**

```tsx
it('creates independent sessions and reloads the selected conversation', async () => {
  await store.getState().createSession('队列研究')
  await store.getState().createSession('病例对照研究')
  expect(listSessions).toHaveBeenCalledTimes(3)
  expect(store.getState().sessions).toHaveLength(2)
})

it('requires privacy consent before the first network send', async () => {
  renderAiPage({ acceptedPrivacyNoticeVersion: null })
  await user.type(screen.getByLabelText('向 AI 描述问卷'), '建立高血压问卷')
  await user.click(screen.getByRole('button', { name: '发送' }))
  expect(screen.getByRole('dialog', { name: 'AI 隐私提示' })).toBeVisible()
  expect(sendMessage).not.toHaveBeenCalled()
})

it('keeps apply disabled when there is no valid active artifact', () => {
  renderAiPage({ activeArtifact: undefined })
  expect(screen.getByRole('button', { name: '应用到问卷' })).toBeDisabled()
})
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `pnpm vitest run tests/unit/renderer/stores/ai-assistant.store.test.ts tests/unit/renderer/ai-questionnaire-page.test.tsx tests/unit/renderer/routes.test.tsx`

Expected: FAIL.

- [ ] **Step 3: Implement the renderer store**

State includes Sessions, selected Session, loading/sending/applying flags, current draft, diff, safe error code, pending privacy message, and pending questionnaire preview. Actions call only fixed `DesktopApi['ai']` methods. Deleting a Session requires component confirmation; `clearCache` reloads the selected Session without changing messages/artifacts.

```ts
send: async (message) => {
  const sessionId = get().selectedSessionId
  if (sessionId === null) return
  set({ sending: true, error: null })
  try {
    await api.sendMessage({ sessionId, message })
    await get().loadSession(sessionId)
  } catch (error) {
    set({ error: safeAiError(error) })
  } finally {
    set({ sending: false })
  }
}
```

- [ ] **Step 4: Implement page and components**

Use a responsive three-region layout: Session list, labelled conversation/form, and draft/diff/validation panel. New/rename/delete/clear-cache actions remain keyboard accessible. `QuestionnaireSendPreview` shows the exact local snapshot and hash, calls attach only after confirmation, and never triggers `sendMessage` itself.

```tsx
<div className="grid gap-[var(--space-4)] xl:grid-cols-[18rem_minmax(0,1fr)_24rem]">
  <AiSessionList sessions={sessions} selectedId={selectedSessionId} />
  <AiConversation messages={conversation} onSend={send} onCancel={cancel} />
  <AiDraftPanel artifact={activeArtifact} onApply={applyArtifact} />
</div>
```

The privacy dialog uses the exact copy:「只有对话内容会被读取并发送，其余隐私信息均不会被发送和读取。」After acceptance, resume the pending send once. Cancel calls `cancelRun`; cancelled output is not rendered as artifact. Apply asks for confirmation, calls `applyArtifact`, then reloads the Session and formal questionnaire status.

- [ ] **Step 5: Register route and navigation metadata**

Add `/ai-questionnaire` to `PRODUCTION_ROUTES`, route element mapping, and project-scoped navigation with a `Sparkles` icon. Update exact route-count and path-order tests.

```tsx
{ path: '/ai-questionnaire', handle: {
  title: 'AI 问卷助手', description: '通过多轮对话生成并精细化问卷。'
} }

{ path: '/ai-questionnaire', title: 'AI 问卷助手', access: 'project', icon: <Sparkles /> }
```

- [ ] **Step 6: Run tests and accessibility smoke**

Run: `pnpm vitest run tests/unit/renderer/stores/ai-assistant.store.test.ts tests/unit/renderer/ai-questionnaire-page.test.tsx tests/unit/renderer/routes.test.tsx tests/unit/renderer/AppShell.test.tsx`

Expected: PASS with no missing accessible names or duplicate dialog triggers.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/stores/ai-assistant.store.ts src/renderer/components/ai src/renderer/pages/AiQuestionnairePage.tsx src/renderer/app/routes.tsx tests/unit/renderer/stores/ai-assistant.store.test.ts tests/unit/renderer/ai-questionnaire-page.test.tsx tests/unit/renderer/routes.test.tsx tests/unit/renderer/AppShell.test.tsx
git commit -m "feat(ai): add multi-session questionnaire workspace"
```

---

### Task 12: End-to-End Security, Recovery, and Documentation

**Files:**
- Create: `tests/e2e/ai-questionnaire.spec.ts`
- Modify: `package.json`
- Modify: `docs/PROJECT_DECISIONS.md`
- Modify: `docs/TECH_STACK.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: complete feature from Tasks 1–11.
- Produces: release-level regression coverage and aligned product documentation.

- [ ] **Step 1: Add a deterministic local OpenAI-compatible test server**

Inside the Playwright test, start a loopback HTTP server on an ephemeral port. It accepts only `/v1/chat/completions`, records request bodies, returns a valid first artifact, an invalid-then-repaired sequence, and 401/429 responses selected by test input. Bind only to `127.0.0.1` and close it in `finally`.

```ts
const requests: unknown[] = []
const server = createServer(async (request, response) => {
  if (request.url !== '/v1/chat/completions') {
    response.writeHead(404).end()
    return
  }
  const body = await readJsonBody(request)
  requests.push(body)
  response.setHeader('content-type', 'application/json')
  response.end(JSON.stringify(completionFor(body)))
})
await listen(server, '127.0.0.1', 0)
```

- [ ] **Step 2: Implement the E2E workflow**

Cover: configure once; create project; accept privacy; create two Sessions; generate from zero; verify one request; attach an existing questionnaire through preview; repair invalid output in at most three requests; apply after backup; restart app and continue the encrypted Session; clear cache without losing artifacts; cancel a delayed request; switch projects and verify Session isolation.

Inspect raw `.easyepi` bytes and assert they do not contain conversation text or generated question content. Inspect `ai-config.json` and assert it does not contain the plaintext API Key. Inspect captured HTTP bodies and assert they do not contain record IDs, answers, project password, recovery key, or Windows absolute paths.

```ts
expect((await readFile(projectFile)).includes(Buffer.from('高血压敏感描述'))).toBe(false)
expect(await readFile(aiConfigPath, 'utf8')).not.toContain('e2e-secret-key')
const transmitted = JSON.stringify(requests)
for (const forbidden of ['record-1', 'project-password', 'recovery-key', 'D:\\']) {
  expect(transmitted).not.toContain(forbidden)
}
```

- [ ] **Step 3: Add the E2E file to the script and run it**

Update `test:e2e` to include `tests/e2e/ai-questionnaire.spec.ts`.

Run: `pnpm build && pnpm playwright test tests/e2e/ai-questionnaire.spec.ts tests/e2e/admin.spec.ts`

Expected: PASS.

- [ ] **Step 4: Align documentation**

Update `PROJECT_DECISIONS.md` to replace the absolute offline statement with “核心工作流离线，AI 助手按用户请求联网”，record the global credential/session boundaries, and link the approved design. Update `TECH_STACK.md` with `safeStorage`, virtual Session layout, Prompt registry, Harness and OpenAI Client. Update README setup/privacy wording without documenting real credentials.

- [ ] **Step 5: Run release verification**

Run: `pnpm lint && pnpm typecheck && pnpm test:coverage && pnpm build`

Expected: all commands exit 0; coverage includes config security, virtual path isolation, Harness, repair limits, cancellation, artifact application and administrator guards.

- [ ] **Step 6: Commit**

```bash
git add tests/e2e/ai-questionnaire.spec.ts package.json docs/PROJECT_DECISIONS.md docs/TECH_STACK.md README.md
git commit -m "test(ai): verify assistant security and recovery"
```
