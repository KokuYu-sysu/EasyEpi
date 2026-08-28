# AI Questionnaire Assistant Streaming and Clarification Design

Date: 2026-08-28
Status: Approved design, pending implementation plan

## Goal

Make AI questionnaire generation observable and conversational without weakening EasyEpi's local Harness boundary. A user must be able to see generation, validation, and automatic-repair progress; understand why a result failed; and answer a model clarification through either a single-choice quick reply or free text.

The normal successful path remains one LLM call. Local validation may trigger at most two repair calls, for three attempts in total.

## Confirmed product decisions

- Use one OpenAI-compatible streaming Chat Completions request per normal turn.
- Display readable assistant text and application-controlled progress, never raw JSON, prompts, repair instructions, API keys, or questionnaire payloads.
- Allow the model to return either a clarification or a complete questionnaire candidate.
- A clarification may contain at most five single-choice quick replies. Selecting one immediately sends a visible user response; the text input always remains available.
- The model asks at most one core clarification question per response. When requirements are sufficient, it generates directly.
- If streaming is unsupported, fall back to a non-streaming request and explain the fallback in the progress UI.
- Final validation failures show a human-readable summary plus expandable, sanitized technical details for every attempt.
- Runtime progress is recoverable across page navigation. Final messages, clarifications, selections, and failure summaries are encrypted with the project Session.
- Existing Sessions require explicit migration before using the new response protocol.

## Approaches considered

### 1. Single-call streaming with a local event pipeline — selected

The main process consumes OpenAI-compatible SSE, extracts only readable assistant text, and emits validated progress events to the renderer. The complete response is still parsed and validated locally before it changes Session state or creates an artifact.

This preserves the existing single-call priority and Harness security model while improving perceived speed and transparency.

### 2. Two-stage LLM generation

One call would generate conversation and another would generate the questionnaire. This provides a simple natural-language stream but doubles common-path latency, cost, and failure surface. It was rejected.

### 3. Persisted status polling

The renderer would poll Session state without consuming model deltas. This is compatible but does not provide a genuine streaming conversation. It was rejected.

## Response protocol

The versioned model envelope is a root object with a Harness-enforced discriminator. It deliberately does not use a root-level `anyOf`, because OpenAI Structured Outputs requires a root object and requires all declared fields. Every root field is therefore required in the provider schema:

- `kind`: `clarification` or `questionnaire`
- `assistantMessage`: string
- `rollingSummary`: string
- `options`: array
- `questionnaire`: questionnaire object or `null`

The provider schema permits the nullable superset. The local Harness applies the stricter cross-field rules: a clarification requires one to five options and `questionnaire: null`; a questionnaire requires an empty options array and a non-null questionnaire. Duplicate JSON keys are rejected before branch validation.

### Clarification response

```json
{
  "kind": "clarification",
  "assistantMessage": "Which screening age range should be used?",
  "rollingSummary": "The questionnaire targets lung cancer screening...",
  "options": [
    { "id": "age_45_74", "label": "45–74 years" }
  ],
  "questionnaire": null
}
```

Rules:

- `assistantMessage` contains one core clarification question.
- `options` contains one to five unique entries. Zero options is invalid on this branch.
- Option IDs are stable, bounded public identifiers; labels are bounded plain text.
- A clarification contains no questionnaire and creates no questionnaire artifact.

### Questionnaire response

```json
{
  "kind": "questionnaire",
  "assistantMessage": "I created the lung cancer screening questionnaire.",
  "rollingSummary": "The questionnaire includes identity, smoking, anthropometry...",
  "options": [],
  "questionnaire": {}
}
```

The questionnaire schema remains strictly controlled by the Harness. Unknown or forbidden fields are rejected.

The prompt retains the existing privacy prohibitions and regex-immutability rule. It requests `assistantMessage` before the large questionnaire and asks for no more than one core clarification question. The latter is prompt-enforced; the deterministic Harness enforces only the branch shape and option limits.

The prompt, Harness, and model-envelope schema version stamps are advanced together and added to the existing registry. Old Sessions are not silently interpreted under the new protocol; the explicit migration path described below must be used.

## Shared data contracts

The implementation adds the following bounded shared DTOs. Names here are normative; implementation types may be split across files without changing their wire shape.

```ts
interface AIQuickReplyOption {
  id: string       // public ID pattern, max 128
  label: string    // trimmed plain text, 1..200 characters
}

interface AIPublicClarification {
  clarificationId: string
  options: AIQuickReplyOption[] // 1..5
  status: 'unresolved' | 'resolved'
  selectedOptionId: string | null
  resolvedByMessageId: string | null
}

interface AIPublicValidationIssue {
  code: string     // allowlisted public Harness code or AI_VALIDATION_ERROR
  field: string    // safe questionnaire-field expression, never a filesystem path
  summary: string  // localized, sanitized, max 200 characters
}

interface AIPublicAttemptFailure {
  attempt: 1 | 2 | 3
  issues: AIPublicValidationIssue[] // max 20
  truncated: boolean
}

interface AIPublicFailureDetails {
  attempts: AIPublicAttemptFailure[] // max 3, unique and ordered
}

interface AIPublicRunSnapshot {
  requestId: string
  runId: string
  stage: AIProgressStage
  attempt: 1 | 2 | 3
  startedAt: string
  updatedAt: string
  streamFallback: boolean
}
```

`AIPublicMessage` gains `clarification: AIPublicClarification | null`. `AISessionPage` gains `activeRun: AIPublicRunSnapshot | null` and `failures`, containing bounded failure records only for run IDs represented by the returned message page. Each failure record contains `runId`, `userMessageId`, `completedAt`, `errorCode`, and `details`.

`AISendRequest` gains an optional `clarificationSelection` object containing `clarificationId` and `optionId`. It is present only for a quick-reply click. A free-text response omits it.

`AISendResult` becomes:

```ts
type AISendResult =
  | { ok: true; requestId: string; outcome: 'questionnaire'; artifact: AIQuestionnaireArtifactPreviewDto; attempts: number }
  | { ok: true; requestId: string; outcome: 'clarification'; message: AIPublicMessage; attempts: number }
  | (AIErrorResult & { details?: AIPublicFailureDetails })
```

The preload parsers validate every new field exactly. The validation-field property is named `field`, not `path`, because the existing safe response walker intentionally rejects path-bearing keys.

## Streaming architecture

### OpenAI-compatible client

The client adds a streaming completion path using `stream: true` and consumes standards-compatible SSE records until `[DONE]`. It accumulates the complete content for final parsing while reporting content deltas through a callback.

Streaming uses one incremental UTF-8 `TextDecoder` so split multibyte characters are preserved. The parser accepts CRLF or LF framing, joins multiple `data:` lines in one event with a newline, ignores comments and empty keep-alive events, and recognizes `[DONE]` only as the complete trimmed data value. It accepts only bounded JSON events whose `choices[0].delta.content` is a string. Empty usage chunks are ignored. Tool calls, refusal payloads, multiple content choices, a non-`stop` terminal finish reason, missing `[DONE]`, premature EOF, invalid UTF-8, malformed JSON, or a content delta after a terminal choice fail the stream.

Limits apply to total response bytes, decoded content characters, event count, individual event bytes, buffered partial-event bytes, timeout, and cancellation. The implementation uses conservative constants no larger than the existing complete-response limits.

If a `stream: true` request returns HTTP 200 with a complete `application/json` Chat Completions body, that same body is parsed without issuing a second generation request. A non-streaming retry is allowed only when a bounded 400/422 error positively identifies the `stream` parameter as unsupported and no content delta was accepted. Timeout, network failure, malformed SSE, empty EOF, generic 4xx, and any failure after a content delta do not retry.

Streaming support and `response_format` support are independent capability-cache entries. On an explicit 400/422 rejection, the client disables only the named capability and retries the same generation attempt with the remaining supported capability. For example, a schema rejection retries streaming without `response_format`; a later explicit stream rejection may retry non-streaming without it. Capability-negotiation requests that are rejected before generation do not consume one of the three generation attempts, but every retry is surfaced in progress and cached so later turns return to the one-request common path.

### Safe readable-text extraction

The main process never forwards raw streamed JSON. A tokenizing incremental JSON state machine—not a regular expression or substring search—tracks root-object structure and recognizes only the root-level JSON string assigned to the first and only `assistantMessage` key. It handles chunk boundaries, escapes, Unicode escapes, surrogate pairs, object/array nesting, and duplicate keys. It emits only completed Unicode scalar values and has explicit byte and character limits.

All other streamed fields remain internal. Quick replies are not emitted until the complete envelope has passed strict parsing and validation. At completion, the streamed readable text must exactly equal the fully parsed `assistantMessage`; otherwise the attempt is rejected.

Each repair attempt owns a provisional assistant stream. If validation rejects that attempt, the renderer discards its provisional body and retains only a short attempt record. A later valid attempt becomes the persisted assistant message.

### Main-to-renderer event channel

A fixed, one-way IPC event channel carries validated events scoped by `requestId`, `sessionId`, and `runId`. The preload exposes `onProgress(requestId, callback)`, validates every event, filters the exact request ID, and returns an unsubscribe function. It never exposes generic Electron messaging. The renderer subscribes before invoking `ai.send` so it cannot miss initial events.

The event union is:

- `started`: base fields only
- `attempt_started`: `attempt`
- `model_streaming`: `attempt`
- `assistant_delta`: `attempt`, monotonic `sequence`, and `delta` of at most 4,096 characters
- `validating`: `attempt`
- `validation_failed`: `attempt` and one `AIPublicAttemptFailure`
- `repairing`: rejected `attempt` and `nextAttempt`
- `stream_fallback`: `attempt` and reason `unsupported`
- `clarification`: `attempt`, `messageId`, and validated `AIPublicClarification`
- `completed`: `attempt` and `artifactId`
- `failed`: last `attempt`, stable `errorCode`, and optional `AIPublicFailureDetails`
- `cancelled`: last `attempt` and error code `AI_CANCELLED`

Every event has `requestId`, `sessionId`, `runId`, and `at`; other required fields are listed above, and no unspecified keys are allowed. IDs use existing public-ID/UUID validation, timestamps use the existing timestamp validator, sequence is a bounded safe integer, and attempts are 1 through 3.

The in-flight entry captures the initiating `webContents`. Events are sent only to that live owner while its captured project is still current. Main and preload both validate `requestId + sessionId`; the renderer additionally checks its current generation and active Session before accepting an event.

The main process first atomically persists the terminal Session state, then emits exactly one terminal event, then resolves `ai.send`. The invoke result is authoritative. On page reopen, `AISessionPage.activeRun.requestId` allows the same renderer to resubscribe and cancel. If the app or owning `webContents` has gone away, startup/window recovery cancels or fails the interrupted run rather than trying to reconnect it.

Assistant deltas are batched or throttled before IPC delivery while preserving `sequence`, so token-rate providers cannot flood the renderer.

The terminal result returned by `ai:send` remains authoritative. Events improve observability but cannot create or apply artifacts.

## Orchestrator, clarification lifecycle, and persistence

The orchestrator accepts an optional progress callback. It emits state transitions around model calls, Harness validation, repair setup, completion, cancellation, and failure.

`AIRun` gains `requestId`, `operationId`, `userMessageId`, progress stage/attempt/update fields, fallback state, an optional bounded failure, and an optional terminal result reference. Terminal result references are either `{ kind: 'questionnaire', artifactId }` or `{ kind: 'clarification', messageId, clarificationId }`. This makes both branches replayable without another model call. A repeated completed `operationId` returns its stored branch result; an active duplicate returns `AI_REQUEST_IN_PROGRESS`; a repeated terminal failure returns the stored failure.

Session run state persists this compact progress snapshot. It does not persist every token or write the encrypted project for each delta.

`AIConversationPartition` gains `clarifications: Record<string, AIClarification>`. Each internal clarification stores `clarificationId`, `messageId`, `runId`, options, status, creation time, and optional resolution time, resolving user-message ID, and selected option ID. New Sessions always contain the partition.

Successful questionnaire responses append the final assistant message and create the artifact as today. Successful clarification responses atomically append an assistant message, add the clarification record, update the rolling summary, record the run result, and mark the run completed. They create no artifact and do not change `activeArtifactId`.

Only the latest unresolved clarification may be answered. For a quick reply, the main process verifies that the supplied clarification is latest and unresolved and that the option exists. At run start it atomically appends a visible user message such as `我选择：45–74 岁`, marks the clarification resolved, and records both the resolving message and selected option. A free-text send atomically resolves the latest clarification with no selected option. Stale, already resolved, mismatched, or unknown selection metadata is rejected before a model call. After resolution, quick replies remain visible but disabled.

If a parseable response establishes `kind`, all repair attempts are locked to that branch. A rejected questionnaire cannot repair into a clarification, and invalid clarification options repair as a clarification. If the first response is too malformed to establish a valid kind, the repair may choose either branch from the original user request. Clarification validation never executes questionnaire validation, but it must pass the complete envelope, option, text, and privacy limits.

Final failures are stored on their `AIRun`, not as a synthetic system or assistant message. `AISessionPage.failures` lets the renderer place the failure card after the associated user message. Raw provider output, prompt content, repair instructions, and questionnaire JSON are excluded. All persisted content stays inside the encrypted project data.

## User interface

The active conversation contains a live run card below the message list. It presents plain-language stages such as:

1. Connecting to the model
2. Receiving the response
3. Validating locally
4. Local validation found two issues
5. Starting automatic repair 1 of 2
6. Completed or failed

The provisional assistant bubble grows as readable text arrives. On repair, invalid provisional text is removed and replaced by a compact rejected-attempt entry.

Clarification options appear below the persisted assistant message. There are at most five buttons. Clicking a button immediately sends its label as the next user message and disables all options for that clarification. The normal text composer remains available.

The final failure card has three layers:

- A concise Chinese explanation and suggested action.
- Errors grouped by attempt.
- Expandable technical details containing error code, safe field path, and sanitized message.

It offers `根据错误重新生成` and `修改要求`. The first prepares and sends a bounded repair-oriented user instruction using the public error summary; the second focuses the composer without sending.

When the page is reopened during a run, it reads `activeRun`, subscribes with its `requestId`, and shows the persisted current stage and attempt. Missed deltas are not reconstructed. The still-running provisional text may therefore resume from the next delta, while the authoritative complete message arrives through the terminal result and Session reload. No manual refresh is required.

## Error handling and privacy

- Public validation errors are propagated through the orchestrator, IPC result, event protocol, preload parser, persisted run record, and renderer.
- A centralized `PUBLIC_VALIDATION_CODES` allowlist maps known Harness codes to Chinese summaries. Unknown internal codes become `AI_VALIDATION_ERROR`; raw internal messages are never exposed.
- `field` is at most 256 characters and must match a questionnaire-only grammar equivalent to `^\$(?:\.[A-Za-z][A-Za-z0-9]*|\[(?:0|[1-9][0-9]{0,2})\]){0,12}$`. A value outside the grammar becomes `$`. It cannot carry drive letters, slashes, backslashes, URLs, or filesystem paths.
- Each attempt exposes at most 20 unique issues; excess issues set `truncated: true`. At most three ordered attempt records are retained. Codes and localized summaries are each bounded and stripped of control characters.
- Provider error bodies, authorization headers, API keys, prompts, raw completion data, and internal repair messages never cross into renderer events or persisted failure summaries.
- Cancellation stops stream reading, marks the run cancelled, sends a terminal event, and preserves the formal questionnaire.
- A failed, malformed, interrupted, or stale result never creates an applicable artifact and never modifies the formal questionnaire.

## Compatibility and migration

- Increment the prompt and Harness versions for the discriminated response contract.
- Increment `AiVersionStamp.schemaVersion` from model-envelope schema 1 to 2. This is distinct from `AIAssistantProjectData.schemaVersion`, which remains 1 because the project-level partition container is unchanged and the added Session fields are version-gated by each manifest stamp.
- Register the previous version stamps as historical entries and add an explicit directed migration from the supported schema-1 stamp to the supported schema-2 stamp. Replace the current blanket schema-version equality rejection with a registry of allowed directed migrations; unrelated major/schema changes remain rejected.
- The schema-1→2 Session migration preserves messages, questionnaire attachments, rolling summary, artifacts, completed/failed run audit, and version-migration audit. It initializes an empty clarification record, clears all cache and temp values, clears `activeRunId`, normalizes Session status to `idle`, and removes `activeArtifactId` so schema-1 artifacts remain historical but cannot be applied as schema-2 results. It records the from/to stamps and migration time atomically.
- Existing schema-1 run records remain readable as historical records with absent new fields; only schema-2 runs may become active or be replayed through the new result union.
- Use the existing explicit Session migration action; do not silently migrate on read or send.
- Provider capability cache remains partitioned by project, Session, prompt hash, schema version, Base URL, and model. Streaming support is stored separately from JSON-schema support.
- Clearing `session/.../cache/` may remove both capability values and must not affect conversation, state, artifacts, or the questionnaire.

## Focused verification

Implementation verification should stay narrow:

- Streaming client: split UTF-8/SSE assembly, complete-JSON same-response handling, cancellation/limits, capability-specific pre-delta fallback, and no post-delta retry.
- Incremental extractor: root-only field recognition, escapes/surrogates, duplicate keys, reconciliation, and no leakage from other fields.
- Protocol/Harness: nullable-superset schema, clarification cross-field rules, option bounds, branch-locked repairs, questionnaire branch, directed version migration, replay idempotency, and public validation-error sanitization.
- IPC/preload: subscribe-before-send, fixed-channel exact event validation, request/Session/owner isolation, terminal ordering, unsubscribe behavior, and rejection of malformed events.
- TypeScript typecheck and production Electron build.

Manual acceptance uses this primary prompt:

> 现在需要建立一份肺癌筛查问卷，其中需要包括身份证号作为唯一ID识别码，其他因素包括年龄，吸烟，吸烟包年数，身高体重，肺癌家族史，以及职业暴露史，如果吸烟或者曾经吸烟，则需要问吸烟年数，以及每天的吸烟支数。

Expected result:

- The model generates directly when no essential ambiguity remains.
- The identity-card question is the sole Key.
- Age, smoking status, pack-years, height, weight, family history, and occupational exposure are present.
- Smoking years and cigarettes per day use `allowSkip: false` and become visible for current or former smokers through one `show` rule with OR equality conditions. No separate `require` rule is needed, avoiding mixed actions on the same targets.
- The live UI shows model, validation, and any repair stages.
- A valid artifact can be previewed and applied; an invalid result shows specific errors and leaves the formal questionnaire unchanged.
