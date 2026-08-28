# AI Assistant Streaming and Clarification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add safe readable streaming, observable validation/repair progress, model clarification quick replies, and actionable validation failures to the encrypted EasyEpi AI questionnaire assistant.

**Architecture:** Keep the Electron main process authoritative: it consumes and validates OpenAI-compatible streaming data, emits a bounded one-way progress event union, and persists only terminal messages and compact run state inside the encrypted project. Extend the versioned Harness with a nullable-superset root envelope and strict branch rules, then render provisional text, progress, clarification options, and sanitized failure details in focused renderer components.

**Tech Stack:** Electron 43, TypeScript 5.9, React 18, OpenAI-compatible Chat Completions/SSE, Vitest, electron-vite, electron-builder.

**Approved specification:** `docs/superpowers/specs/2026-08-28-ai-assistant-streaming-clarification-design.md`

---

## File structure

### Create

- `src/main/services/openai-stream.parser.ts` — incremental UTF-8 SSE framing, strict streamed-choice assembly, and safe root `assistantMessage` extraction.
- `src/main/services/ai-public-validation.ts` — allowlist and sanitization from internal Harness errors to bounded public error DTOs.
- `src/renderer/components/ai/AIRunProgress.tsx` — live stage/attempt/provisional-response presentation.
- `src/renderer/components/ai/AIClarificationReplies.tsx` — single-choice quick replies with resolved/disabled behavior.
- `src/renderer/components/ai/AIValidationFailure.tsx` — Chinese summary, per-attempt grouping, expandable technical details, and retry/edit actions.
- `tests/unit/main/services/openai-compatible.client.test.ts` — focused streaming, fallback, limits, cancellation, and extractor coverage.
- `tests/unit/main/services/ai-session.repository.test.ts` — focused clarification lifecycle, run result/replay, and directed migration coverage.

### Modify

- `src/shared/ai-assistant-contract.ts` — shared persistence/public DTOs, request/result/event unions, exact parsers, and preload-safe validation.
- `src/main/services/openai-compatible.client.ts` — streaming request path, independent capability negotiation, shared completion-choice validation, and progress hooks.
- `src/main/services/ai-questionnaire.harness.ts` — prompt/schema/Harness v2, clarification branch, branch-locked repair support, public validation code source, and directed migration registry.
- `src/main/services/ai-session.repository.ts` — version-aware clarification partition, run progress/failure/result persistence, atomic clarification resolution, and schema-1→2 migration.
- `src/main/services/ai-questionnaire.orchestrator.ts` — progress callback, clarification outcome, per-attempt public errors, replay idempotency, and persisted terminal state.
- `src/main/ipc/ai.ipc.ts` — owner-scoped progress emission, public errors, clarification send semantics, terminal ordering, and success union.
- `src/preload/desktop-api.ts` — fixed progress subscription and exact event/result parsing.
- `src/shared/desktop-api.ts` — renderer-facing typed `ai.onProgress` API.
- `src/main/ipc/types.ts` — extend the injectable IPC/event sender boundary only if owner-liveness tests require it.
- `src/preload/index.ts` or the existing preload entry that calls `createDesktopApi` — pass the fixed `ipcRenderer` subscription dependency if required by the current factory boundary.
- `src/renderer/pages/AIQuestionnairePage.tsx` — subscribe-before-send flow, run recovery, provisional bubbles, clarification selection, specific failures, and refresh behavior.
- `src/renderer/components/ai/ai-errors.ts` — stable Chinese stage/error summaries.
- `tests/unit/main/services/ai-questionnaire.harness.test.ts` — v2 branch, bounds, repair lock, and migration cases.
- `tests/unit/main/services/ai-questionnaire.orchestrator.test.ts` — clarification persistence/resolution, replay, failures, progress ordering, and formal-questionnaire invariants.
- `tests/unit/main/ai-security-boundaries.test.ts` — owner/request/Session isolation and sanitized error/event checks.
- `tests/unit/preload/desktop-api.test.ts` — fixed subscription, exact event validation, filtering, and unsubscribe.
- `tests/unit/renderer/AIQuestionnairePage.test.tsx` — one end-to-end component path for live progress, quick reply, and detailed final failure.
- `docs/AI_ASSISTANT_MANUAL_TEST.md` — streaming/clarification/failure manual checks and the lung-cancer acceptance prompt.
- `docs/PRD.md` — observable streaming, clarification, fallback, and validation-error acceptance requirements.

## Task 1: Define the v2 shared contract and safe public errors

**Files:**
- Modify: `src/shared/ai-assistant-contract.ts`
- Create: `src/main/services/ai-public-validation.ts`
- Modify: `tests/unit/main/ai-security-boundaries.test.ts`

- [ ] **Step 1: Add focused failing contract cases**

Add cases that require:

- exact public DTO parsing for `AIPublicClarification`, `AIPublicFailureDetails`, `AIPublicRunSnapshot`, `AIProgressEvent`, and the `AISendResult` outcome union;
- `AISendRequest.content === ''` when `clarificationSelection` is present;
- rejection of unsafe `field`, message, ID, option, or event values.

- [ ] **Step 2: Run only the relevant test and confirm failure**

Run: `pnpm vitest run tests/unit/main/ai-security-boundaries.test.ts`

Expected: FAIL because the new public DTO and parser branches do not exist.

- [ ] **Step 3: Implement bounded shared types and exact parsers**

Add the normative types from the approved specification, including:

```ts
export type AIProgressStage =
  | 'starting' | 'connecting' | 'streaming' | 'validating' | 'repairing'
  | 'clarification' | 'completed' | 'failed' | 'cancelled'

export type AISendResult =
  | { ok: true; requestId: string; outcome: 'questionnaire'; artifact: AIQuestionnaireArtifactPreviewDto; attempts: number }
  | { ok: true; requestId: string; outcome: 'clarification'; message: AIPublicMessage; attempts: number }
  | (AIErrorResult & { details?: AIPublicFailureDetails })
```

Extend internal `AIConversationPartition` with version-gated clarification records and `AIRun` with request/operation/user-message/progress/failure/result fields. Extend public messages and Session pages without exposing internal JSON.

- [ ] **Step 4: Implement public validation sanitization**

In `ai-public-validation.ts`, centralize:

- the allowlisted Harness codes;
- Chinese code-to-summary mapping;
- the questionnaire-only `field` grammar;
- 20 issues per attempt and three attempts maximum;
- control-character removal, deduplication, truncation, and unknown-code replacement.

Do not expose raw Harness messages.

- [ ] **Step 5: Run the focused contract test**

Run: `pnpm vitest run tests/unit/main/ai-security-boundaries.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/shared/ai-assistant-contract.ts src/main/services/ai-public-validation.ts tests/unit/main/ai-security-boundaries.test.ts
git commit -m "feat(ai): define streaming clarification contract"
```

## Task 2: Build the bounded streaming transport

**Files:**
- Create: `src/main/services/openai-stream.parser.ts`
- Modify: `src/main/services/openai-compatible.client.ts`
- Create: `tests/unit/main/services/openai-compatible.client.test.ts`

- [ ] **Step 1: Add focused streaming tests**

Cover only the security and compatibility boundaries:

- split UTF-8 and CRLF/LF SSE framing;
- fatal rejection of invalid UTF-8 rather than replacement-character recovery;
- joining multiple `data:` lines in one event before JSON parsing;
- comments, role-only chunks, usage chunks, terminal empty delta, `stop`, and `[DONE]`;
- rejection of multiple choices, tool/refusal content, non-`stop`, duplicate root keys, malformed/unfinished streams, and post-terminal deltas;
- root-only `assistantMessage` extraction with escapes and surrogate pairs, proving nested fields and other strings cannot leak readable text;
- complete JSON returned to `stream:true` is parsed from the same response;
- explicit pre-delta `stream` or `response_format` rejection retries only the named capability;
- no retry after a delta, timeout, generic error, malformed SSE, or empty EOF;
- cancellation and byte/event/character limits.

- [ ] **Step 2: Run the new test and confirm failure**

Run: `pnpm vitest run tests/unit/main/services/openai-compatible.client.test.ts`

Expected: FAIL because streaming APIs and parser are absent.

- [ ] **Step 3: Implement `openai-stream.parser.ts`**

Expose small stateful units rather than mixing them into the client:

```ts
export interface StreamContentDelta { content: string; sequence: number }
export function createSseChatCompletionParser(limits: StreamLimits): SseChatCompletionParser
export function createAssistantMessageExtractor(limit: number): AssistantMessageExtractor
```

Use `TextDecoder` streaming mode, strict bounded event parsing, one choice at index zero, and reconciliation against the final complete envelope.

- [ ] **Step 4: Integrate streaming and capability negotiation**

Extend the client request with bounded callbacks for content delta, model-stream start, and capability fallback. The client reports independent `streaming` and `response_format` capability outcomes to its caller; it does not own a process-local or global cache. Reuse one strict final-choice validator for streaming, same-response JSON, and ordinary JSON.

- [ ] **Step 5: Run only the transport test**

Run: `pnpm vitest run tests/unit/main/services/openai-compatible.client.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/main/services/openai-stream.parser.ts src/main/services/openai-compatible.client.ts tests/unit/main/services/openai-compatible.client.test.ts
git commit -m "feat(ai): add bounded OpenAI streaming transport"
```

## Task 3: Upgrade the Harness and explicit Session migration

**Files:**
- Modify: `src/main/services/ai-questionnaire.harness.ts`
- Modify: `src/main/services/ai-session.repository.ts`
- Modify: `src/main/services/openai-compatible.client.ts`
- Modify: `tests/unit/main/services/ai-questionnaire.harness.test.ts`
- Create: `tests/unit/main/services/ai-session.repository.test.ts`

- [ ] **Step 1: Add migration and branch-lock failing cases**

Require prompt/Harness v2 and model-envelope schema 2; preserve v1 stamps as historical. Add cases for:

- schema-1→2 directed migration only;
- preservation of messages, attachments, artifacts, rolling summary, run audit, and migration audit;
- initialization of empty clarifications;
- clearing cache/temp/active run/active artifact and returning to idle;
- old artifacts becoming historical and non-applicable;
- questionnaire repair remaining questionnaire and clarification repair remaining clarification once kind is established;
- privacy and regex prohibitions remaining in the v2 prompt.

The Harness cases in this task, not Task 1, own the root-envelope requirements: all five root fields are required, clarification uses `1..5` options plus null questionnaire, and questionnaire uses empty options plus non-null questionnaire.

- [ ] **Step 2: Run the Harness test and confirm failure**

Run: `pnpm vitest run tests/unit/main/services/ai-questionnaire.harness.test.ts tests/unit/main/services/ai-session.repository.test.ts`

Expected: FAIL on schema-v2 registry/migration and clarification behavior.

- [ ] **Step 3: Implement the v2 prompt, provider schema, and Harness result union**

Place `assistantMessage` before the large questionnaire. Use the nullable-superset provider schema and deterministic local cross-field validation. Return a typed Harness union:

```ts
type QuestionnaireHarnessResult =
  | { ok: true; kind: 'clarification'; value: ClarificationHarnessValue }
  | { ok: true; kind: 'questionnaire'; value: QuestionnaireArtifactValue }
  | { ok: false; errors: AIValidationError[]; establishedKind?: 'clarification' | 'questionnaire' }
```

Update the provider JSON schema and the schema-version gate in `openai-compatible.client.ts` from envelope schema 1 to 2 in the same change. The client must obtain or select the schema by the registered schema version rather than leaving an unconditional `schemaVersion === 1` branch.

- [ ] **Step 4: Implement directed repository migration**

Make parsing version-aware, create the clarification partition for v2, and migrate only through registered directed transitions. Keep `AIAssistantProjectData.schemaVersion` at 1 as specified.

Expose validated repository methods so later tasks never mutate raw `state.values` or clarification maps directly:

```ts
addClarification(sessionId, input)
getLatestUnresolvedClarification(sessionId)
resolveLatestClarification(sessionId, input)
updateRunProgress(sessionId, runId, progress)
completeRunWithResult(sessionId, runId, result)
failRun(sessionId, runId, failure)
findRunByOperationId(sessionId, operationId)
```

Repository tests cover option validation, latest-only resolution, selected-option membership, free-text resolution, terminal result/failure persistence, operation lookup, legacy-run readability, and migration invariants.

- [ ] **Step 5: Run the focused Harness test**

Run: `pnpm vitest run tests/unit/main/services/ai-questionnaire.harness.test.ts tests/unit/main/services/ai-session.repository.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/main/services/ai-questionnaire.harness.ts src/main/services/ai-session.repository.ts src/main/services/openai-compatible.client.ts tests/unit/main/services/ai-questionnaire.harness.test.ts tests/unit/main/services/ai-session.repository.test.ts
git commit -m "feat(ai): add clarification harness and v2 migration"
```

## Task 4: Orchestrate progress, clarification, replay, and failures

**Files:**
- Modify: `src/main/services/ai-questionnaire.orchestrator.ts`
- Modify: `tests/unit/main/services/ai-questionnaire.orchestrator.test.ts`

- [ ] **Step 1: Add focused orchestrator failures first**

Add cases for:

- ordered progress and one terminal event;
- provisional assistant deltas being attempt-scoped;
- invalid attempt details being sanitized and retained across at most three attempts;
- clarification completion persisting message/options without an artifact;
- canonical quick-reply content and atomic resolution;
- free text resolving the latest clarification;
- stale/mismatched/already-resolved selections failing before the client runs;
- idempotent replay of questionnaire, clarification, and terminal failure outcomes;
- cancellation and all failure paths preserving the formal questionnaire.

- [ ] **Step 2: Run the orchestrator test and confirm failure**

Run: `pnpm vitest run tests/unit/main/services/ai-questionnaire.orchestrator.test.ts`

Expected: FAIL because the orchestrator only returns artifacts and drops progress/failure detail.

- [ ] **Step 3: Implement progress and branch handling**

Add a progress callback dependency and emit the exact shared union. Persist compact run snapshots only at meaningful stage transitions. Do not persist streamed deltas.

Use branch-locked repair instructions after `establishedKind` exists. Successful clarifications update rolling summary and terminal run references but leave `activeArtifactId` and the formal questionnaire unchanged.

Build both capability cache keys with the existing content-key inputs: project ID, Session ID, prompt hash, schema version, Base URL, and model. Persist client-reported `streaming` and `response_format` outcomes as separate values under `session/.../cache/`; clearing the Session cache removes both. Capability-negotiation rejections do not increment the generation-attempt counter.

- [ ] **Step 4: Implement atomic clarification resolution and replay**

Resolve the latest clarification in the same `mutateAndPersist(..., 'run-started')` mutation that appends the canonical user message and starts the run. Use the repository methods created in Task 3. Resolve completed operation IDs from the persisted run result before making a model request.

- [ ] **Step 5: Run the focused orchestrator test**

Run: `pnpm vitest run tests/unit/main/services/ai-questionnaire.orchestrator.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/main/services/ai-questionnaire.orchestrator.ts tests/unit/main/services/ai-questionnaire.orchestrator.test.ts
git commit -m "feat(ai): orchestrate observable clarification runs"
```

## Task 5: Expose owner-scoped progress through trusted IPC

**Files:**
- Modify: `src/main/ipc/ai.ipc.ts`
- Modify: `src/preload/desktop-api.ts`
- Modify: `src/shared/desktop-api.ts`
- Modify: `src/shared/ai-assistant-contract.ts`
- Modify: `src/main/ipc/types.ts` if owner-liveness injection requires it
- Modify: `src/preload/index.ts` if required by the existing factory wiring
- Modify: `tests/unit/main/ai-security-boundaries.test.ts`
- Modify: `tests/unit/preload/desktop-api.test.ts`

- [ ] **Step 1: Add IPC/preload boundary failures**

Require:

- subscription filtering by exact request ID and Session ID;
- exact parsing for every progress variant and rejection of extra/unsafe fields;
- subscribe-before-send support and unsubscribe cleanup;
- events sent only to the captured live `webContents` and current project;
- terminal persistence before terminal event before invoke resolution;
- clarification and questionnaire success unions;
- `AIPublicFailureDetails` reaching the renderer while raw Harness messages and forbidden keys do not;
- cancellation after page navigation using `activeRun.requestId`.
- `toPublicSessionPage()` projecting message clarifications, `activeRun`, and failures only for run IDs represented in the returned message page while still enforcing `AI_SESSION_PAGE_MAX_UTF8_BYTES`.

- [ ] **Step 2: Run the two focused boundary tests and confirm failure**

Run: `pnpm vitest run tests/unit/main/ai-security-boundaries.test.ts tests/unit/preload/desktop-api.test.ts`

Expected: FAIL because there is no progress event channel or outcome union.

- [ ] **Step 3: Implement the fixed one-way channel**

Add one exported channel constant. Capture `event.sender` in the in-flight request, batch assistant deltas, and stop sending after ownership/project invalidation or a terminal event. Convert orchestrator errors through `ai-public-validation.ts`.

Update `toPublicSessionPage()` in this task. Filter clarifications to returned assistant messages, filter failure records to visible message run IDs, expose at most one validated active run snapshot, and re-run the existing UTF-8 page budget reduction after adding these fields.

- [ ] **Step 4: Implement the narrow preload subscription**

Expose only:

```ts
onProgress(
  scope: { requestId: string; sessionId: string },
  callback: (event: AIProgressEvent) => void
): () => void
```

Validate scope before subscribing, validate every event before callback, and remove the exact listener on unsubscribe.

Add the method to `src/shared/desktop-api.ts`, put the fixed channel constant in `src/shared/ai-assistant-contract.ts`, and adjust the preload factory/entry wiring. Extend `src/main/ipc/types.ts` only if needed for an injectable `webContents` liveness/sender surface; do not widen it generically.

- [ ] **Step 5: Run focused boundary tests**

Run: `pnpm vitest run tests/unit/main/ai-security-boundaries.test.ts tests/unit/preload/desktop-api.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/main/ipc/ai.ipc.ts src/preload/desktop-api.ts src/shared/desktop-api.ts src/shared/ai-assistant-contract.ts src/main/ipc/types.ts src/preload/index.ts tests/unit/main/ai-security-boundaries.test.ts tests/unit/preload/desktop-api.test.ts
git commit -m "feat(ai): expose trusted streaming progress IPC"
```

If `src/preload/index.ts` does not change, omit it from `git add`.

## Task 6: Render transparent runs, quick replies, and useful failures

**Files:**
- Create: `src/renderer/components/ai/AIRunProgress.tsx`
- Create: `src/renderer/components/ai/AIClarificationReplies.tsx`
- Create: `src/renderer/components/ai/AIValidationFailure.tsx`
- Modify: `src/renderer/components/ai/ai-errors.ts`
- Modify: `src/renderer/pages/AIQuestionnairePage.tsx`
- Modify: `tests/unit/renderer/AIQuestionnairePage.test.tsx`

- [ ] **Step 1: Add one focused renderer scenario**

Use the existing desktop API mocks to cover a single coherent flow:

1. subscribe before send;
2. show stage transitions and growing provisional assistant text;
3. discard invalid provisional text on repair;
4. reload a persisted clarification and render up to five options;
5. click one option, send empty renderer content plus IDs, then show canonical returned user text and disable options;
6. display grouped Chinese failure details and retry/edit actions.

- [ ] **Step 2: Run the page test and confirm failure**

Run: `pnpm vitest run tests/unit/renderer/AIQuestionnairePage.test.tsx`

Expected: FAIL because the page has only a blocking send promise and generic error banner.

- [ ] **Step 3: Implement focused presentation components**

Keep stage labels and error mappings deterministic and local. Use existing Card, Badge, Button, and disclosure patterns; preserve keyboard access and live-region announcements. Never render raw JSON or raw internal messages.

- [ ] **Step 4: Integrate the page state machine**

Subscribe before `ai.send`, filter by current generation/Session, maintain per-attempt provisional text and sequence, resubscribe from `activeRun`, and always treat the invoke result plus Session reload as authoritative.

Quick replies send selection metadata with empty content. The normal composer remains enabled when idle. “根据错误重新生成” builds a bounded user-visible prompt from public summaries; “修改要求” focuses the composer without sending.

- [ ] **Step 5: Run the focused page test**

Run: `pnpm vitest run tests/unit/renderer/AIQuestionnairePage.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/renderer/components/ai/AIRunProgress.tsx src/renderer/components/ai/AIClarificationReplies.tsx src/renderer/components/ai/AIValidationFailure.tsx src/renderer/components/ai/ai-errors.ts src/renderer/pages/AIQuestionnairePage.tsx tests/unit/renderer/AIQuestionnairePage.test.tsx
git commit -m "feat(ai): render streaming clarification workflow"
```

## Task 7: Update product documentation and verify the build

**Files:**
- Modify: `docs/AI_ASSISTANT_MANUAL_TEST.md`
- Modify: `docs/PRD.md`

- [ ] **Step 1: Update PRD acceptance requirements**

Document the exact stream/fallback/clarification/error behavior, the encrypted Session boundary, prompt/schema v2 migration, and the distinction between transient deltas and persisted terminal state.

- [ ] **Step 2: Update the manual test guide**

Add concise manual cases for:

- supported streaming and visible stage transitions;
- provider fallback;
- model clarification and quick reply;
- three invalid attempts with grouped details;
- navigation away/back during a live run;
- cancellation;
- privacy checks;
- old Session migration;
- the approved lung-cancer prompt with one OR `show` rule and `allowSkip: false` target questions.

- [ ] **Step 3: Run the small changed-area suite once**

Run:

```powershell
pnpm vitest run tests/unit/main/services/openai-compatible.client.test.ts tests/unit/main/services/ai-questionnaire.harness.test.ts tests/unit/main/services/ai-questionnaire.orchestrator.test.ts tests/unit/main/ai-security-boundaries.test.ts tests/unit/preload/desktop-api.test.ts tests/unit/renderer/AIQuestionnairePage.test.tsx
```

Expected: PASS once. Do not repeatedly run unrelated tests.

- [ ] **Step 4: Run typecheck**

Run: `pnpm typecheck`

Expected: exit code 0.

- [ ] **Step 5: Build production Electron assets**

Run: `pnpm build`

Expected: exit code 0 and fresh `out/main`, `out/preload`, and `out/renderer` bundles.

- [ ] **Step 6: Commit documentation and final integration fixes**

```powershell
git add docs/AI_ASSISTANT_MANUAL_TEST.md docs/PRD.md
git commit -m "docs(ai): document streaming assistant workflow"
```

- [ ] **Step 7: Record manual verification boundaries**

If no live OpenAI-compatible endpoint is available, report that streaming/fallback/provider compatibility requires manual testing and give the exact lung-cancer prompt and expected UI/condition-rule checks. Do not claim external-model verification without evidence.
