# DeepSeek-Only Medical Research Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the EasyEpi AI questionnaire agent run a real, single-provider research pipeline — DeepSeek only, DeepSeek Responses `web_search` for web search, PubMed/Europe PMC/bioRxiv/medRxiv for medical literature — and guarantee that every generated questionnaire passes both the main-process harness and an independent renderer-side format check before it can be applied.

**Architecture:** A staged local pipeline (`planning → literature → web_search → extracting → connecting/streaming → validating`) replaces the old free-text research preflight. Each stage is a small service with an injected transport, so the whole pipeline is testable with fixtures and never touches the network in `pnpm test:unit`. Model output is always requested as `response_format: { "type": "json_object" }`; function calling was removed from the questionnaire protocol entirely.

**Tech Stack:** TypeScript 5.9, Electron 43, DeepSeek Chat Completions + Responses APIs, NCBI E-utilities, Europe PMC REST, `api.biorxiv.org`, `saxes@6.0.0`, Vitest 4, pnpm 11.

**Baseline:** `codex/easyepi-0.8.0` (worktree `.worktrees/easyepi-0.8.0`), version 0.8.0.

## Global Constraints

- Exactly one AI provider: DeepSeek. No provider picker, no custom base URL.
- The endpoint is a constant (`https://api.deepseek.com`); a caller-supplied host is coerced, never trusted.
- Every model-produced object uses `response_format: { "type": "json_object" }`. No request carries `tools` or `tool_choice`.
- Medical requests always run literature retrieval before web search; non-medical requests never run literature retrieval.
- PubMed E-utilities stay under 3 requests/second anonymously and send `tool=`/`email=`.
- Retrieved text is untrusted quoted data and can never define source identity.
- The questionnaire schema, derived-variable protection, regex immutability, and apply-time checks stay authoritative and unchanged.
- No live network access in the deterministic unit suite.

---

## File and Responsibility Map

- `src/shared/ai-assistant-contract.ts`: single-provider ids, config DTOs, new progress stages, `stage_changed` event, new research status/mode, bounded response validation.
- `src/shared/ai-provider-profiles.ts`: DeepSeek endpoint, default model, model options, host detection for migration.
- `src/shared/questionnaire-format.ts`: shared strict questionnaire validator used by main and renderer.
- `src/main/services/ai-config.service.ts`: schema v3 storage, total legacy migration, endpoint pinning.
- `src/main/services/ai-provider-policy.ts`: endpoint resolution and candidate fallback, single provider policy.
- `src/main/services/openai-compatible.client.ts`: JSON-output Chat Completions transport, output-token negotiation, no tools.
- `src/main/services/openai-responses.client.ts` + `.parser.ts`: DeepSeek Responses `web_search` transport and tolerant parsing.
- `src/main/services/research/contracts.ts`: stage types and exact-key bounded parsers.
- `src/main/services/research/pubmed.client.ts`: NCBI ESearch/EFetch with bounded SAX parsing and pacing.
- `src/main/services/research/europepmc.client.ts`: preprint keyword search (`SRC:PPR`).
- `src/main/services/research/preprint.client.ts`: bioRxiv/medRxiv DOI metadata verification.
- `src/main/services/research/literature.service.ts`: merge, DOI de-duplication, preprint enrichment.
- `src/main/services/research/web-search.service.ts`: Responses web search plus authority filtering.
- `src/main/services/research/planner.service.ts`: translation, domain classification, English query plan.
- `src/main/services/research/evidence.service.ts`: source-bound evidence extraction.
- `src/main/services/research/pipeline.ts`: stage ordering, evidence composition, no-evidence policy.
- `src/main/services/ai-questionnaire.orchestrator.ts`: stage callbacks, capability cache, research result propagation, dual validation gate.
- `src/main/services/ai-session.repository.ts`: new progress stages and transitions, extended run result.
- `src/main/ipc/ai.ipc.ts`: wiring and new public error messages.
- `src/renderer/components/ai/AIProviderSettings.tsx`: DeepSeek-only settings surface.
- `src/renderer/components/ai/ai-errors.ts`: stage labels, research status labels, new error copy.
- `src/renderer/components/ai/AIRunProgress.tsx`: honest capability messaging.
- `src/renderer/pages/AIQuestionnairePage.tsx`: `stage_changed` handling, renderer format gate.

---

### Task 1: Collapse the provider contract to DeepSeek

**Files:**
- Modify: `src/shared/ai-assistant-contract.ts`
- Modify: `src/shared/ai-provider-profiles.ts`
- Modify: `src/main/services/ai-provider-policy.ts`
- Modify: `src/main/services/ai-config.service.ts`

**Interfaces:**
- Produces: `AI_PROVIDER_IDS = ['deepseek']`, `DEEPSEEK_BASE_URL`, `DEEPSEEK_DEFAULT_MODEL`, `AIProviderConfigUpdate = { baseUrl, model, apiKey? }`, `detectAIProviderId(baseUrl): AIProviderId | undefined`, `getAIProviderRequestPolicy(baseUrl)`.

- [x] **Step 1: Shrink the id set and the public config DTOs** to the single provider and drop `providerId`/`webSearchEnabled`.
- [x] **Step 2: Replace the nine presets** with one DeepSeek preset, the default model, the model option list, and host detection used only for migration decisions.
- [x] **Step 3: Store schema v3** and migrate v1/v2 totals: non-DeepSeek hosts are replaced, their model id resets, their encrypted key is dropped.
- [x] **Step 4: Pin the endpoint** so `update()` coerces any non-DeepSeek base URL to the official one.

### Task 2: Remove the function-calling protocol and widen the limits

**Files:**
- Modify: `src/main/services/openai-compatible.client.ts`

**Interfaces:**
- Produces: `AIOutputMode`, `AIChatCompletionRequest.outputMode`, `maxOutputTokens`, `completionTokenLimit` option, `AIChatCompletionResult = { content, streamingSupported, responseFormatSupported }`.

- [x] **Step 1: Delete the `submit_questionnaire` tool path** so no request can carry `tools` or `tool_choice`.
- [x] **Step 2: Send `response_format: { type: 'json_object' }`** for `outputMode: 'json_object'` and for questionnaire requests.
- [x] **Step 3: Add output-token negotiation** (`max_completion_tokens` → `max_tokens` → none) with a 65,536 default.
- [x] **Step 4: Keep the streamed `assistantMessage` cross-check only for the questionnaire envelope.**

### Task 3: DeepSeek Responses web search

**Files:**
- Modify: `src/main/services/openai-responses.parser.ts`
- Modify: `src/main/services/openai-responses.client.ts`

**Interfaces:**
- Produces: `parseOpenAIResponsesJson`, `createOpenAIResponsesSseParser`, `createOpenAIResponsesClient`, `AIResponsesUnsupportedError`, `RESPONSES_MIN_OUTPUT_TOKENS`.

- [x] **Step 1: Send `tools: [{ type: 'web_search' }]`, `tool_choice: 'auto'`, `max_output_tokens`** and never `max_completion_tokens` or `filters`.
- [x] **Step 2: Fall back from `/responses` to `/v1/responses`** on 404 and report `responses_endpoint` when both fail.
- [x] **Step 3: Detect a `web_search` refusal** on 400/422 and report `web_search_tool` so the capability can be cached.
- [x] **Step 4: Parse tolerantly** — missing `status`, missing `output`, bare `text` parts, absent annotations, and `failed`/`incomplete` terminal statuses.

### Task 4: Literature retrieval

**Files:**
- Create: `src/main/services/research/contracts.ts`, `pubmed.client.ts`, `europepmc.client.ts`, `preprint.client.ts`, `literature.service.ts`
- Create fixtures under `tests/fixtures/{pubmed,europepmc,biorxiv}/`

**Interfaces:**
- Produces: `createPubMedClient`, `createEuropePmcClient`, `createPreprintClient`, `createAILiteratureService`, `LiteratureSource`, `parseLiteratureSource`.

- [x] **Step 1: NCBI ESearch/EFetch** with `sort=relevance`, `retmax=20`, one batched EFetch, `tool`/`email`, 334 ms pacing, and 429/5xx retry.
- [x] **Step 2: Bounded `saxes` parsing** of structured abstracts, DOI fallbacks, publication types, and canonical PMID URLs; malformed records are skipped.
- [x] **Step 3: Europe PMC preprint keyword search** with `SRC:PPR`, `resultType=core`, and identifier de-duplication.
- [x] **Step 4: bioRxiv/medRxiv DOI verification** with a landing URL taken from the record's own server field.
- [x] **Step 5: Merge and enrich** with DOI-first de-duplication where the indexed publication wins.

### Task 5: Planning, web search, and evidence stages

**Files:**
- Create: `src/main/services/research/planner.service.ts`, `web-search.service.ts`, `evidence.service.ts`, `pipeline.ts`

**Interfaces:**
- Produces: `createAIResearchPlanner`, `createAIWebSearchService`, `createAIEvidenceService`, `createAIResearchPipeline`, `ResearchPipelineResult`, `researchContextMessage`, `researchDisclosure`, `noEvidenceDisclaimer`.

- [x] **Step 1: Planner** returns the versioned `ResearchPlan` with an English-only research question and a `medical`/`non_medical` domain; one bounded repair.
- [x] **Step 2: Web search** builds the query from the plan plus a literature gap inventory and filters citations to authority hosts for medical runs.
- [x] **Step 3: Evidence extraction** requires immutable source identity and rejects unknown ids, mutated titles/urls, and source-free claims.
- [x] **Step 4: Pipeline ordering and policy** — literature only for medical, one stage callback per stage, stop with `AI_RESEARCH_NO_EVIDENCE` for medical when nothing was found, degrade to the honest disclaimer for non-medical.

### Task 6: Orchestrator, repository, and IPC

**Files:**
- Modify: `src/main/services/ai-questionnaire.orchestrator.ts`
- Modify: `src/main/services/ai-session.repository.ts`
- Modify: `src/main/ipc/ai.ipc.ts`
- Delete: `src/main/services/ai-research.service.ts`

**Interfaces:**
- Produces: `AIQuestionnaireOrchestratorDependencies.researchPipeline`, `stage_changed` progress emission, `cap-web-search-<hash>` capability slot, `researchMode` on send results.

- [x] **Step 1: Replace the research preflight** with the pipeline, emitting `stage_changed` and persisting the run stage per callback.
- [x] **Step 2: Move the third capability slot** from function calling to web search.
- [x] **Step 3: Add truncation recovery** — `AI_RESPONSE_TRUNCATED` becomes a bounded compactness repair instead of a terminal failure.
- [x] **Step 4: Add the shared-format second gate** before the artifact is persisted.
- [x] **Step 5: Extend the repository** with the new stages, transitions, and run-result keys.

### Task 7: Renderer truthfulness and the renderer format gate

**Files:**
- Modify: `src/renderer/components/ai/AIProviderSettings.tsx`, `ai-errors.ts`, `AIRunProgress.tsx`
- Modify: `src/renderer/pages/AIQuestionnairePage.tsx`

**Interfaces:**
- Produces: `AI_RESEARCH_STATUS_LABELS`, updated `AI_PROGRESS_STAGE_LABELS`, `ArtifactPreviewCard.formatIssues`.

- [x] **Step 1: DeepSeek-only settings** with a read-only endpoint, a model field, and an API key field.
- [x] **Step 2: Stage labels** for the five new stages plus the four evidence compositions.
- [x] **Step 3: Handle `stage_changed`** in the live-run reducer.
- [x] **Step 4: Run the shared validator on `preview.draft`** and block apply with the offending field paths when it fails.

### Task 8: Verification and release

- [x] **Step 1: Deterministic unit suite** across contracts, retrieval clients, pipeline, services, orchestrator, repository, and renderer.
- [x] **Step 2: `pnpm lint && pnpm typecheck && pnpm test:coverage && pnpm build`** — all green; 99 files / 1347 tests; coverage 86.14% statements and 80.84% branches against an 80% threshold.
- [x] **Step 3: `pnpm build:win`** producing `EasyEpi-0.8.0-setup-x64.exe`, `EasyEpi-0.8.0-portable-x64.exe`, and the setup blockmap, plus packaged smoke runs of the portable and unpacked executables.
- [x] **Step 4: Copy the verified artifacts to `D:\EasyEpi\release`** and record their SHA-256 hashes (see the design document's Verification section).
