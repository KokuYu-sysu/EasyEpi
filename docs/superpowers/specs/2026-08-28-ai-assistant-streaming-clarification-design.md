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

The versioned model envelope becomes a strict discriminated union.

### Clarification response

```json
{
  "kind": "clarification",
  "assistantMessage": "Which screening age range should be used?",
  "rollingSummary": "The questionnaire targets lung cancer screening...",
  "options": [
    { "id": "age_45_74", "label": "45–74 years" }
  ]
}
```

Rules:

- `assistantMessage` contains one core clarification question.
- `options` contains one to five unique entries.
- Option IDs are stable, bounded public identifiers; labels are bounded plain text.
- A clarification contains no questionnaire and creates no questionnaire artifact.

### Questionnaire response

```json
{
  "kind": "questionnaire",
  "assistantMessage": "I created the lung cancer screening questionnaire.",
  "rollingSummary": "The questionnaire includes identity, smoking, anthropometry...",
  "questionnaire": {}
}
```

The questionnaire schema remains strictly controlled by the Harness. Unknown or forbidden fields are rejected.

The prompt, Harness, and schema version stamps are advanced together and added to the existing registry. Old Sessions are not silently interpreted under the new protocol; the existing explicit migration path must be used.

## Streaming architecture

### OpenAI-compatible client

The client adds a streaming completion path using `stream: true` and consumes standards-compatible SSE `data:` records until `[DONE]`. It accumulates the complete content for final parsing while reporting content deltas through a callback.

The parser enforces the existing timeout, cancellation, response-size, and error-size limits. It also bounds individual SSE records and malformed-event accumulation.

Fallback is allowed only before a valid content delta has been accepted. A provider that rejects the stream parameter or returns a complete JSON Chat Completions body may use the existing non-streaming path. A stream that breaks after accepted content fails normally rather than causing a duplicate generation request.

### Safe readable-text extraction

The main process never forwards raw streamed JSON. A stateful incremental extractor recognizes only the JSON string assigned to `assistantMessage`, decodes its escapes, and emits newly completed readable characters. It has explicit byte and character limits.

All other streamed fields remain internal. Quick replies are not emitted until the complete envelope has passed strict parsing and validation.

Each repair attempt owns a provisional assistant stream. If validation rejects that attempt, the renderer discards its provisional body and retains only a short attempt record. A later valid attempt becomes the persisted assistant message.

### Main-to-renderer event channel

A fixed, one-way IPC event channel carries validated events scoped by `requestId` and `sessionId`. The preload exposes a narrow subscription method that returns an unsubscribe function. It never exposes generic Electron messaging.

The event union is:

- `started`
- `attempt_started`
- `model_streaming`
- `assistant_delta`
- `validating`
- `validation_failed`
- `repairing`
- `stream_fallback`
- `clarification`
- `completed`
- `failed`
- `cancelled`

Every event has bounded fields, a timestamp, and an attempt number where applicable. Validation errors use a sanitized public DTO. Events are emitted only to the renderer that owns the in-flight request and only while its captured project remains current.

The terminal result returned by `ai:send` remains authoritative. Events improve observability but cannot create or apply artifacts.

## Orchestrator and persistence

The orchestrator accepts an optional progress callback. It emits state transitions around model calls, Harness validation, repair setup, completion, cancellation, and failure.

Session run state persists a compact progress snapshot: stage, attempt number, start/update timestamps, fallback state, and terminal error summary. It does not persist every token or write the encrypted project for each delta.

Successful questionnaire responses append the final assistant message and create the artifact as today. Successful clarification responses append an assistant message with validated quick-reply metadata, update the rolling summary, mark the run completed, and do not change `activeArtifactId`.

Selecting an option sends a normal visible user message such as `我选择：45–74 岁`. Quick replies are active only on the latest unresolved clarification. After a selection or later free-text reply, they become disabled.

Final failures append a local assistant/system-visible failure summary containing only public error information. Raw provider output, prompt content, repair instructions, and questionnaire JSON are excluded. All persisted content stays inside the encrypted project data.

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

When the page is reopened during a run, it reads the persisted run snapshot and subscribes to live events. Missed event details are not reconstructed, but the current stage and attempt are shown automatically without requiring manual refresh.

## Error handling and privacy

- Public validation errors are propagated through the orchestrator, IPC result, event protocol, preload parser, and renderer.
- User-facing error summaries are mapped to Chinese by stable error code. Unknown codes use a generic explanation.
- Technical messages and paths are length-bounded and sanitized. They may identify questionnaire fields but never local filesystem paths.
- Provider error bodies, authorization headers, API keys, prompts, raw completion data, and internal repair messages never cross into renderer events or persisted failure summaries.
- Cancellation stops stream reading, marks the run cancelled, sends a terminal event, and preserves the formal questionnaire.
- A failed, malformed, interrupted, or stale result never creates an applicable artifact and never modifies the formal questionnaire.

## Compatibility and migration

- Increment the prompt and Harness versions for the discriminated response contract.
- Increment the response schema version because the root envelope changes.
- Register the previous version stamps as historical entries.
- Use the existing explicit Session migration action; do not silently migrate on read or send.
- Provider capability cache remains partitioned by project, Session, prompt hash, schema version, Base URL, and model. Streaming support is stored separately from JSON-schema support.
- Clearing `session/.../cache/` may remove both capability values and must not affect conversation, state, artifacts, or the questionnaire.

## Focused verification

Implementation verification should stay narrow:

- Streaming client: valid SSE assembly, cancellation/limits, safe pre-delta fallback, and no post-delta retry.
- Protocol/Harness: clarification union, option bounds, questionnaire branch, version migration, and public validation-error sanitization.
- IPC/preload: fixed-channel validation, request/session isolation, unsubscribe behavior, and rejection of malformed events.
- TypeScript typecheck and production Electron build.

Manual acceptance uses this primary prompt:

> 现在需要建立一份肺癌筛查问卷，其中需要包括身份证号作为唯一ID识别码，其他因素包括年龄，吸烟，吸烟包年数，身高体重，肺癌家族史，以及职业暴露史，如果吸烟或者曾经吸烟，则需要问吸烟年数，以及每天的吸烟支数。

Expected result:

- The model generates directly when no essential ambiguity remains.
- The identity-card question is the sole Key.
- Age, smoking status, pack-years, height, weight, family history, and occupational exposure are present.
- Smoking years and cigarettes per day are required and visible for current or former smokers through valid condition rules.
- The live UI shows model, validation, and any repair stages.
- A valid artifact can be previewed and applied; an invalid result shows specific errors and leaves the formal questionnaire unchanged.

