# Staged Academic Research Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fragile single research/generation path with a resumable Agent pipeline that always searches PubMed first, supplements with provider Web Search, produces direct JSON objects, and locally assembles and validates large questionnaires.

**Architecture:** A staged main-process orchestrator coordinates a JSON research planner, a bounded NCBI E-utilities client, provider-specific supplementary search, evidence extraction, and direct/batched questionnaire generation. Every model stage uses Chat Completions JSON Output, every external result crosses a strict local validator, and completed stages are checkpointed inside the existing encrypted project.

**Tech Stack:** TypeScript 5.9, Electron 43 main/renderer IPC, OpenAI-compatible Chat Completions and Responses transports, NCBI E-utilities HTTPS APIs, `saxes@6.0.0` for bounded PubMed XML parsing, Vitest 4, Playwright 1.61, pnpm 11.

## Global Constraints

- Always execute PubMed before provider Web Search for every AI questionnaire run.
- Translate non-English requests to English before producing PubMed queries, keywords, and MeSH terms; preserve the original language for the questionnaire.
- Use no NCBI API key and initiate no more than three NCBI requests per second.
- Produce one to three PubMed queries, no more than twenty keywords, twenty MeSH terms, and twenty normalized PubMed records.
- Attempt provider Web Search after PubMed; continue with an explicit PubMed-only result when PubMed succeeds and provider search is unsupported or fails.
- Stop without generating a questionnaire when neither PubMed nor provider search yields usable, verifiable evidence.
- Use `response_format: { "type": "json_object" }` for every model-produced plan, evidence object, batch, and final questionnaire.
- Do not send `submit_questionnaire`, custom function tools, or forced function `tool_choice` during questionnaire generation.
- Preserve encrypted project storage. `sessionId` and `runId` are local indexes, not remote conversation handles.
- Persist normalized checkpoints and sanitized metadata only; never persist complete raw provider bodies, prompts, API keys, or authorization headers.
- Keep the existing questionnaire schema, business validation, derived-variable protections, regex restrictions, and apply-time checks authoritative.
- Generate large questionnaires in bounded JSON batches and assemble them deterministically before running the full local harness.
- Follow red-green-refactor for every task and commit after each independently passing deliverable.

---

## File and Responsibility Map

- `src/main/services/ai-agent-contracts.ts`: internal stage types, exact-key validators, size bounds, source identity checks, and sanitized diagnostic types.
- `src/main/services/ai-json-stage.client.ts`: JSON-only model port shared by planner, extractor, and generator; converts compatible-client results into parsed bounded objects.
- `src/main/services/ai-research-planner.service.ts`: translation and English PubMed query planning.
- `src/main/services/pubmed.client.ts`: NCBI ESearch/EFetch transport, anonymous rate limiter, bounded SAX parsing, normalization, and deduplication.
- `src/main/services/ai-provider-research.service.ts`: provider Web Search adapters and capability negotiation; replaces the current mixed-purpose `ai-research.service.ts`.
- `src/main/services/ai-evidence.service.ts`: evidence extraction and citation identity validation.
- `src/main/services/ai-questionnaire-generator.service.ts`: direct JSON generation, size planning, batch generation, assembly, truncation handling, and batch repair.
- `src/main/services/ai-questionnaire.orchestrator.ts`: lifecycle, stage ordering, checkpoints, cancellation, persistence, and final artifact commit only.
- `src/main/services/ai-session.repository.ts`: typed versioned checkpoint read/write and recovery.
- `src/main/services/openai-compatible.client.ts`: direct JSON Output transport and sanitized completion diagnostics; no questionnaire function-call protocol.
- `src/main/services/openai-stream.parser.ts`: direct content streaming evidence and truncation metadata only; remove questionnaire tool-argument assembly.
- `src/main/services/ai-provider-policy.ts`: provider search transports, output-token field, and negotiated capability keys.
- `src/shared/ai-assistant-contract.ts`: public progress stages, research status, error details, config compatibility, and IPC response validation.
- `src/main/services/ai-config.service.ts`: read legacy Web Search toggle but normalize new writes to the mandatory staged policy.
- `src/renderer/components/ai/AIProviderSettings.tsx`: explain mandatory PubMed and provider supplementation; remove the toggle.
- `src/renderer/components/ai/AIRunProgress.tsx`: stage/batch progress.
- `src/renderer/components/ai/ai-errors.ts`: stage-specific user-facing errors.
- `src/renderer/pages/AIQuestionnairePage.tsx`: display evidence mode, citations, diagnostics summary, and recovered stage progress.

---

### Task 1: Define Versioned Internal Agent Contracts

**Files:**
- Create: `src/main/services/ai-agent-contracts.ts`
- Test: `tests/unit/main/services/ai-agent-contracts.test.ts`

**Interfaces:**
- Consumes: existing `AIJsonValue`, `AIProviderId`, `QuestionnaireDef`, URL/ID validation conventions.
- Produces: `ResearchPlan`, `PubMedSource`, `ProviderSource`, `ResearchSource`, `ResearchEvidence`, `AIStageDiagnostic`, internal error codes, `parseResearchPlan()`, `parsePubMedSource()`, `parseProviderSource()`, and `parseResearchEvidence()`.

- [ ] **Step 1: Write failing exact-contract tests**

Create literal valid fixtures and mutation cases that reject extra keys, non-English `englishResearchQuestion`, more than three queries, unknown `sourceId` references, mutable PMID/URL identity, oversized strings/collections, raw headers, and raw response bodies. Evidence validation must receive the immutable normalized source inventory as a separate argument.

```ts
const validPlan = {
  originalLanguage: 'zh',
  englishResearchQuestion: 'Risk factors for hypertension in university students',
  searchQueries: ['hypertension AND university students'],
  keywords: ['hypertension', 'university students'],
  meshTerms: ['Hypertension', 'Students'],
  population: 'university students',
  exposureOrIntervention: 'risk factors',
  outcomes: ['hypertension prevalence']
}

expect(parseResearchPlan(validPlan)).toEqual(validPlan)
expect(() => parseResearchPlan({ ...validPlan, unexpected: true })).toThrow('AI_RESEARCH_PLAN_INVALID')
expect(() => parseResearchEvidence({
  researchQuestion: validPlan.englishResearchQuestion,
  claims: [{ claim: 'Claim', sourceIds: ['pubmed:999'], strength: 'high' }],
  questionnaireRecommendations: [], limitations: [], sources: []
}, [])).toThrow('AI_EVIDENCE_INVALID')
```

- [ ] **Step 2: Run the contract tests and verify RED**

Run: `pnpm test:unit -- tests/unit/main/services/ai-agent-contracts.test.ts`

Expected: FAIL because the internal types and parsers do not exist.

- [ ] **Step 3: Implement bounded internal and public contracts**

Define the exact discriminated unions below and implement iterative node/depth/string/collection bounds using the existing harness validation style.

```ts
export type AIStageName =
  | 'planning' | 'pubmed' | 'provider_search'
  | 'extracting' | 'generating' | 'validating'

export type ResearchSource = PubMedSource | ProviderSource

export interface AIStageDiagnostic {
  stage: AIStageName
  protocol: 'chat' | 'responses' | 'pubmed-esearch' | 'pubmed-efetch'
  providerId?: AIProviderId
  modelId?: string
  status?: number
  contentType?: string
  finishReason?: string
  choiceCount?: number
  hasContent?: boolean
  hasReasoning?: boolean
  hasAnnotations?: boolean
  hasToolCalls?: boolean
  responseBytes?: number
  contentCharacters?: number
  retryCount?: number
  errorCode?: string
  outcome: 'success' | 'unsupported' | 'invalid' | 'truncated' | 'failed'
}
```

Define `parseResearchEvidence(value, availableSources)` so unknown source IDs and mutated source identity fail against the caller-owned source inventory. Reject diagnostic keys outside the declared set. Keep public progress/error unions unchanged until the orchestrator and IPC migrate atomically in Task 8.

- [ ] **Step 4: Run contract tests and typecheck**

Run: `pnpm test:unit -- tests/unit/main/services/ai-agent-contracts.test.ts`

Expected: PASS with all mutation cases rejected.

Run: `pnpm typecheck`

Expected: PASS; this task adds internal contracts without widening public discriminated unions.

- [ ] **Step 5: Commit the contracts**

```bash
git add src/main/services/ai-agent-contracts.ts tests/unit/main/services/ai-agent-contracts.test.ts
git commit -m "feat(ai): define staged research contracts"
```

---

### Task 2: Add a JSON-only Stage Client Beside the Legacy Path

**Files:**
- Create: `src/main/services/ai-json-stage.client.ts`
- Modify: `src/main/services/openai-compatible.client.ts`
- Modify: `src/main/services/openai-stream.parser.ts`
- Modify: `src/main/services/ai-provider-policy.ts`
- Test: `tests/unit/main/services/ai-json-stage.client.test.ts`
- Test: `tests/unit/main/services/openai-compatible.client.test.ts`
- Test: `tests/unit/main/services/ai-provider-policy.test.ts`

**Interfaces:**
- Consumes: `AIStageName`, `AIStageDiagnostic`, provider configuration, existing bounded transport and cancellation.
- Produces: `AIJsonStageClient.completeJson<T>()`, `AIJsonCompletion`, `AI_MODEL_OUTPUT_TRUNCATED`, direct content JSON parsing, and provider-specific output-token request fields.

- [ ] **Step 1: Write failing transport and JSON-stage tests**

Assert that every structured request contains `response_format: { type: 'json_object' }`, contains the word `JSON` in a system/developer message, and contains neither `tools` nor `tool_choice`. Cover ordinary MiMo content with `reasoning_content`, DeepSeek content, streaming JSON, empty content, multiple choices, invalid UTF-8, `finish_reason: "length"`, explicit size limits, and redacted diagnostics.

```ts
const result = await client.completeJson({
  stage: 'planning',
  config,
  messages: [{ role: 'system', content: 'Return one JSON object.' }, { role: 'user', content: '研究高血压' }],
  maxOutputTokens: 4096
})
expect(result.value).toEqual({ originalLanguage: 'zh' })
expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({
  response_format: { type: 'json_object' }
})
expect(String(fetcher.mock.calls[0]?.[1]?.body)).not.toContain('submit_questionnaire')
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `pnpm test:unit -- tests/unit/main/services/ai-json-stage.client.test.ts tests/unit/main/services/openai-compatible.client.test.ts tests/unit/main/services/ai-provider-policy.test.ts`

Expected: FAIL because questionnaire mode still injects forced tools and the generic JSON stage port does not exist.

- [ ] **Step 3: Implement direct JSON Output and sanitized metadata**

Add an optional explicit output mode to the existing transport. Preserve legacy callers temporarily: requests without `outputMode` continue through the existing path until Task 8 migrates the orchestrator, while every call from `AIJsonStageClient` sets `outputMode: 'json_object'`.

```ts
export interface AIChatCompletionRequest {
  providerId?: AIProviderId
  baseUrl: string
  model: string
  apiKey?: string
  messages: AIChatMessage[]
  outputMode?: 'text' | 'json_object'
  maxOutputTokens?: number
  signal?: AbortSignal
}

export interface AIJsonCompletion<T> {
  value: T
  rawJson: string
  diagnostic: AIStageDiagnostic
}
```

For `json_object`, parse only `message.content` or streamed `delta.content`; ignore bounded `reasoning_content` as non-output metadata. Treat `finish_reason` values `length`, `max_tokens`, and provider-equivalent incomplete status as `AI_MODEL_OUTPUT_TRUNCATED`. Preserve byte, event, character, timeout, abort, and one-choice bounds. Ensure the JSON-only branch never enters questionnaire tool extraction or `function_call` fallback, but retain the legacy branch until its final caller migrates in Task 8. Add provider policy `outputTokenField: 'max_tokens' | 'max_completion_tokens'` and emit only the field selected for the official provider; omit it for unknown custom providers unless the user-supplied limit is known compatible.

- [ ] **Step 4: Run JSON transport tests and typecheck the affected clients**

Run: `pnpm test:unit -- tests/unit/main/services/ai-json-stage.client.test.ts tests/unit/main/services/openai-compatible.client.test.ts tests/unit/main/services/ai-provider-policy.test.ts`

Expected: PASS; small explicit bounds still return `AI_RESPONSE_TOO_LARGE`, while truncation returns `AI_MODEL_OUTPUT_TRUNCATED`.

Run: `pnpm typecheck`

Expected: PASS because the new output mode is additive and legacy callers remain compatible.

- [ ] **Step 5: Commit the JSON-only client**

```bash
git add src/main/services/ai-json-stage.client.ts src/main/services/openai-compatible.client.ts src/main/services/openai-stream.parser.ts src/main/services/ai-provider-policy.ts tests/unit/main/services/ai-json-stage.client.test.ts tests/unit/main/services/openai-compatible.client.test.ts tests/unit/main/services/ai-provider-policy.test.ts
git commit -m "refactor(ai): use direct json stage completions"
```

---

### Task 3: Implement Translation and PubMed Query Planning

**Files:**
- Create: `src/main/services/ai-research-planner.service.ts`
- Test: `tests/unit/main/services/ai-research-planner.service.test.ts`

**Interfaces:**
- Consumes: `AIJsonStageClient`, provider config, user text, bounded recent context, `parseResearchPlan()`.
- Produces: `AIResearchPlanner.plan(request): Promise<{ plan: ResearchPlan; diagnostic: AIStageDiagnostic }>`.

- [ ] **Step 1: Write failing planner tests**

Cover Chinese, English, mixed-language, malformed JSON, untranslated Chinese in English fields, excessive terms, cancellation, and one schema-guided repair. Assert that the prompt forbids citations/questionnaire fields and says that translation is only for search.

```ts
await expect(planner.plan({
  userText: '为中国大学生设计高血压危险因素问卷',
  recentContext: [],
  config
})).resolves.toMatchObject({
  plan: {
    originalLanguage: 'zh',
    englishResearchQuestion: 'Risk factors for hypertension among university students in China'
  }
})
```

- [ ] **Step 2: Run the planner test and verify RED**

Run: `pnpm test:unit -- tests/unit/main/services/ai-research-planner.service.test.ts`

Expected: FAIL because the planner service is absent.

- [ ] **Step 3: Implement the planner with one bounded repair**

Use a fixed versioned system prompt and exact JSON example. Include the current date only as ISO `YYYY-MM-DD`. Submit the initial completion through `completeJson`, validate with `parseResearchPlan`, and on rejection send only the bounded validation codes/paths plus the previous JSON. Reject a second invalid response as `AI_RESEARCH_PLAN_INVALID`.

```ts
export interface AIResearchPlanner {
  plan(request: {
    userText: string
    recentContext: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }>
    config: AIMainConfig
    signal?: AbortSignal
  }): Promise<{ plan: ResearchPlan; diagnostic: AIStageDiagnostic }>
}
```

- [ ] **Step 4: Run planner tests**

Run: `pnpm test:unit -- tests/unit/main/services/ai-research-planner.service.test.ts`

Expected: PASS, with exactly one repair call for an invalid first object and no call after cancellation.

- [ ] **Step 5: Commit the planner**

```bash
git add src/main/services/ai-research-planner.service.ts tests/unit/main/services/ai-research-planner.service.test.ts
git commit -m "feat(ai): plan English PubMed searches"
```

---

### Task 4: Add the Anonymous PubMed E-utilities Gateway

**Files:**
- Create: `src/main/services/pubmed.client.ts`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Test: `tests/unit/main/services/pubmed.client.test.ts`
- Test fixture: `tests/fixtures/pubmed/esearch-hypertension.json`
- Test fixture: `tests/fixtures/pubmed/efetch-hypertension.xml`

**Interfaces:**
- Consumes: `ResearchPlan`, `PubMedSource`, injected `fetch`, `now`, and wait function for deterministic rate-limit tests.
- Produces: `PubMedClient.search(plan, signal): Promise<{ sources: PubMedSource[]; diagnostics: AIStageDiagnostic[] }>`.

- [ ] **Step 1: Add literal NCBI fixtures and failing gateway tests**

Fixtures must contain two articles, one duplicate PMID, structured abstracts, escaped entities, publication types, DOI, missing DOI, and a malformed-record case. Tests cover exact ESearch encoding, `sort=relevance`, `retmax=20`, a single comma-separated EFetch batch, three-request-per-second scheduling, 429/5xx retry delays, cancellation during delay/read, HTTPS host enforcement, redirect rejection, response byte limits, XML depth/node/text limits, duplicate PMID removal, and canonical PubMed URLs.

```ts
const result = await client.search(validPlan, controller.signal)
expect(result.sources.map(({ sourceId }) => sourceId)).toEqual([
  'pubmed:12345678',
  'pubmed:87654321'
])
expect(fetcher.mock.calls[0]?.[0]).toContain('db=pubmed')
expect(fetcher.mock.calls[0]?.[0]).toContain('retmax=20')
expect(fetcher.mock.calls[1]?.[0]).toContain('id=12345678%2C87654321')
```

- [ ] **Step 2: Run the gateway test and verify RED**

Run: `pnpm test:unit -- tests/unit/main/services/pubmed.client.test.ts`

Expected: FAIL because `createPubMedClient` and fixtures are not implemented.

- [ ] **Step 3: Add the SAX dependency and implement bounded NCBI transport**

Run: `pnpm add saxes@6.0.0`

Implement `createPubMedClient` with the fixed origins and injectable scheduling dependencies.

```ts
const EUTILS_ORIGIN = 'https://eutils.ncbi.nlm.nih.gov'
const ESEARCH_PATH = '/entrez/eutils/esearch.fcgi'
const EFETCH_PATH = '/entrez/eutils/efetch.fcgi'

export function createPubMedClient(options: {
  fetch?: typeof fetch
  now?: () => number
  wait?: (milliseconds: number, signal?: AbortSignal) => Promise<void>
  maxResponseBytes?: number
} = {}): PubMedClient
```

Use `SaxesParser` callbacks to accumulate only recognized PubMed elements. Reject DTD/entity declarations other than parser-supported predefined XML entities, external references, depth over 32, nodes over 100,000, response bodies over 8 MB, and individual text fields over their contract limits. Initiate requests at least 334 ms apart across a client instance. Retry 429 and 5xx twice at bounded delays of 500 ms then 1,000 ms, honoring `Retry-After` only when it is between 0 and 5 seconds.

- [ ] **Step 4: Run PubMed tests and dependency audit**

Run: `pnpm test:unit -- tests/unit/main/services/pubmed.client.test.ts`

Expected: PASS with no live network access.

Run: `pnpm audit --prod`

Expected: no high or critical production vulnerability introduced by the direct `saxes` dependency.

- [ ] **Step 5: Commit the PubMed gateway**

```bash
git add package.json pnpm-lock.yaml src/main/services/pubmed.client.ts tests/unit/main/services/pubmed.client.test.ts tests/fixtures/pubmed/esearch-hypertension.json tests/fixtures/pubmed/efetch-hypertension.xml
git commit -m "feat(ai): add bounded PubMed retrieval"
```

---

### Task 5: Normalize Provider Web Search as a Supplement

**Files:**
- Create: `src/main/services/ai-provider-research.service.ts`
- Modify: `src/main/services/ai-provider-policy.ts`
- Modify: `src/main/services/openai-responses.client.ts`
- Modify: `src/main/services/openai-responses.parser.ts`
- Test: `tests/unit/main/services/ai-provider-research.service.test.ts`
- Modify: `tests/unit/main/services/openai-responses.client.test.ts`
- Modify: `tests/unit/main/services/openai-responses.parser.test.ts`

**Interfaces:**
- Consumes: `ResearchPlan`, normalized PubMed coverage, provider config, provider policy, Chat/Responses transports.
- Produces: `AIProviderResearchService.search(): Promise<{ status: ProviderResearchStatus; sources: ProviderSource[]; diagnostic: AIStageDiagnostic; capability?: boolean }>`.

- [ ] **Step 1: Write failing provider matrix tests**

Cover OpenAI/xAI Responses annotations, DeepSeek Responses `web_search` success and 400 unsupported negotiation, MiMo Chat search with `tool_choice: "auto"`, plugin-disabled `error_message`, Qwen/GLM annotations, Moonshot built-in tool round trip, Gemini/custom unsupported, malformed URLs, prose without structured citations, cancellation, and bounded failures. Assert PubMed titles/source IDs are sent only as a compact gap inventory, not as mutable provider citations.

```ts
expect(mimoBody).toMatchObject({
  tools: [{ type: 'web_search', max_keyword: 3, force_search: true, limit: 10 }],
  tool_choice: 'auto'
})
expect(mimoBody.tools).not.toContainEqual(expect.objectContaining({ type: 'function' }))
```

- [ ] **Step 2: Run provider-search tests and verify RED**

Run: `pnpm test:unit -- tests/unit/main/services/ai-provider-research.service.test.ts tests/unit/main/services/openai-responses.client.test.ts tests/unit/main/services/openai-responses.parser.test.ts`

Expected: FAIL because results are currently free-text evidence and DeepSeek is statically unsupported.

- [ ] **Step 3: Implement structured provider sources and negotiation**

```ts
export type ProviderResearchStatus =
  | 'searched' | 'no_results' | 'unsupported' | 'plugin_unavailable' | 'failed'

export interface AIProviderResearchService {
  search(request: {
    plan: ResearchPlan
    pubmedSources: readonly PubMedSource[]
    config: AIMainConfig
    signal?: AbortSignal
    cachedCapability?: boolean
  }): Promise<{
    status: ProviderResearchStatus
    sources: ProviderSource[]
    diagnostic: AIStageDiagnostic
    capability?: boolean
  }>
}
```

Normalize only structured annotations/search results that include an HTTPS URL. Construct `sourceId` from the canonical URL hash or canonical URL string, validate title/institution/year/snippet bounds, and discard generated citations embedded only in prose. DeepSeek Responses support is probed per endpoint/model and cached only after explicit success or an explicit unsupported-parameter/status response. Keep the old service as a compatibility path until Task 8 migrates its final caller.

- [ ] **Step 4: Run provider-search and policy tests**

Run: `pnpm test:unit -- tests/unit/main/services/ai-provider-research.service.test.ts tests/unit/main/services/ai-provider-policy.test.ts tests/unit/main/services/openai-responses.client.test.ts tests/unit/main/services/openai-responses.parser.test.ts`

Expected: PASS for every matrix row; malformed or prose-only citations produce no usable source.

- [ ] **Step 5: Commit the provider supplement**

```bash
git add src/main/services/ai-provider-research.service.ts src/main/services/ai-provider-policy.ts src/main/services/openai-responses.client.ts src/main/services/openai-responses.parser.ts tests/unit/main/services/ai-provider-research.service.test.ts tests/unit/main/services/ai-provider-policy.test.ts tests/unit/main/services/openai-responses.client.test.ts tests/unit/main/services/openai-responses.parser.test.ts
git commit -m "refactor(ai): normalize provider research supplements"
```

---

### Task 6: Extract and Validate Evidence Without Citation Hallucination

**Files:**
- Create: `src/main/services/ai-evidence.service.ts`
- Test: `tests/unit/main/services/ai-evidence.service.test.ts`

**Interfaces:**
- Consumes: `AIJsonStageClient`, `ResearchPlan`, normalized `ResearchSource[]`, `parseResearchEvidence()`.
- Produces: `AIEvidenceService.extract(): Promise<{ evidence: ResearchEvidence; diagnostic: AIStageDiagnostic }>`.

- [ ] **Step 1: Write failing extraction and identity tests**

Cover valid multi-source claims, unknown source IDs, altered PMID/title/URL/DOI, source-free claims, duplicate identities, empty recommendations, malformed JSON, prompt injection inside an abstract, cancellation, and one bounded repair. Assert the model receives retrieved records under an untrusted-data delimiter and cannot define new source identity.

```ts
const invalid = {
  researchQuestion: plan.englishResearchQuestion,
  claims: [{ claim: 'Hypertension is common', sourceIds: ['pubmed:00000000'], strength: 'high' }],
  questionnaireRecommendations: ['Measure blood pressure history'],
  limitations: [],
  sources
}
await expect(service.extract({ plan, sources, config })).rejects.toMatchObject({
  code: 'AI_EVIDENCE_INVALID'
})
```

- [ ] **Step 2: Run evidence tests and verify RED**

Run: `pnpm test:unit -- tests/unit/main/services/ai-evidence.service.test.ts`

Expected: FAIL because the evidence service does not exist.

- [ ] **Step 3: Implement extraction with immutable source identity**

Build a map from `sourceId` to the normalized input record. Require the output `sources` array to be a byte-for-byte canonical projection of referenced input identities; replace accepted output sources with cloned originals before returning. Limit the model to one initial call and one repair containing only validation codes and paths.

```ts
export interface AIEvidenceService {
  extract(request: {
    plan: ResearchPlan
    sources: readonly ResearchSource[]
    config: AIMainConfig
    signal?: AbortSignal
  }): Promise<{ evidence: ResearchEvidence; diagnostic: AIStageDiagnostic }>
}
```

- [ ] **Step 4: Run evidence tests**

Run: `pnpm test:unit -- tests/unit/main/services/ai-evidence.service.test.ts`

Expected: PASS; injected instructions remain inert data and every accepted claim resolves to immutable input sources.

- [ ] **Step 5: Commit the evidence stage**

```bash
git add src/main/services/ai-evidence.service.ts tests/unit/main/services/ai-evidence.service.test.ts
git commit -m "feat(ai): extract source-bound research evidence"
```

---

### Task 7: Generate and Assemble Direct JSON Questionnaire Batches

**Files:**
- Create: `src/main/services/ai-questionnaire-generator.service.ts`
- Modify: `src/main/services/ai-questionnaire.harness.ts`
- Test: `tests/unit/main/services/ai-questionnaire-generator.service.test.ts`
- Modify: `tests/unit/main/services/ai-questionnaire.harness.test.ts`

**Interfaces:**
- Consumes: `AIJsonStageClient`, `ResearchEvidence`, original-language user request, optional active/attached questionnaire, exact provider schema, existing harness and repair errors.
- Produces: `AIQuestionnaireGenerator.generate(): Promise<QuestionnaireGenerationResult>`, direct `QuestionnaireEnvelope`, batch checkpoints, deterministic assembly, and prompt/harness version `3.0.0`.

- [ ] **Step 1: Write failing direct and batched generation tests**

Assert direct requests contain JSON Output and no tools, MiMo ordinary content is accepted, envelope examples contain every required nullable field, evidence source IDs are not emitted as questionnaire fields, and existing field/type/regex protections remain. Add a 120-question case that plans three forty-question batches, a `finish_reason: "length"` case that retries as twenty-question batches, duplicate IDs, missing orders, cross-batch rule references, stale base questionnaire, cancellation, and repair of only the owning batch.

```ts
const result = await generator.generate({
  userText: '生成120题中文高血压危险因素问卷',
  evidence,
  baseQuestionnaire,
  config
})
expect(result.envelope.questionnaire?.questions).toHaveLength(120)
expect(result.envelope.questionnaire?.questions.map(({ order }) => order)).toEqual(
  Array.from({ length: 120 }, (_, index) => index)
)
```

- [ ] **Step 2: Run generator tests and verify RED**

Run: `pnpm test:unit -- tests/unit/main/services/ai-questionnaire-generator.service.test.ts tests/unit/main/services/ai-questionnaire.harness.test.ts`

Expected: FAIL because the new direct/batched generator and assembler do not exist.

- [ ] **Step 3: Implement prompt version 3.0.0 and deterministic batching**

Export the exact questionnaire envelope schema from the harness module for prompt construction. Add a compact valid JSON example. Route every new generator call through `AIJsonStageClient`; leave the legacy orchestrator path intact until Task 8 switches atomically. Select direct mode only when estimated question count is at most forty and serialized required context remains below the direct threshold; otherwise request a `QuestionnaireStructurePlan`, then question batches and rule batches.

```ts
export interface AIQuestionnaireGenerator {
  generate(request: {
    userText: string
    evidence: ResearchEvidence
    baseQuestionnaire?: QuestionnaireDef
    explicitAttachment?: QuestionnaireDef
    config: AIMainConfig
    checkpoint?: QuestionnaireGenerationCheckpoint
    signal?: AbortSignal
    onBatch?: (completed: number, total: number, checkpoint: QuestionnaireGenerationCheckpoint) => Promise<void>
  }): Promise<QuestionnaireGenerationResult>
}
```

The assembler owns ordering and rejects duplicates, unknown rule targets, missing planned IDs, unexpected fields, and base-revision drift before invoking the full harness. On truncation, halve the current batch size down to a minimum of five. At most three generation/repair attempts are allowed per batch. Do not coerce field types or silently delete model fields.

- [ ] **Step 4: Run generator and harness tests**

Run: `pnpm test:unit -- tests/unit/main/services/ai-questionnaire-generator.service.test.ts tests/unit/main/services/ai-questionnaire.harness.test.ts`

Expected: PASS for direct and 120-question batched paths; old forbidden-field/type tests remain green.

- [ ] **Step 5: Commit questionnaire generation**

```bash
git add src/main/services/ai-questionnaire-generator.service.ts src/main/services/ai-questionnaire.harness.ts tests/unit/main/services/ai-questionnaire-generator.service.test.ts tests/unit/main/services/ai-questionnaire.harness.test.ts
git commit -m "feat(ai): generate validated questionnaire batches"
```

---

### Task 8: Orchestrate Stages, Checkpoints, Recovery, and Config Migration

**Files:**
- Modify: `src/main/services/ai-questionnaire.orchestrator.ts`
- Modify: `src/main/services/ai-agent-contracts.ts`
- Modify: `src/main/services/ai-session.repository.ts`
- Modify: `src/main/services/ai-config.service.ts`
- Modify: `src/main/services/openai-compatible.client.ts`
- Modify: `src/main/services/openai-stream.parser.ts`
- Modify: `src/main/ipc/ai.ipc.ts`
- Modify: `src/shared/ai-assistant-contract.ts`
- Modify: `src/main/services/ai-public-validation.ts`
- Delete: `src/main/services/ai-research.service.ts`
- Test: `tests/unit/main/services/ai-questionnaire.orchestrator.test.ts`
- Modify: `tests/unit/main/services/ai-agent-contracts.test.ts`
- Test: `tests/unit/main/services/ai-session.repository.test.ts`
- Test: `tests/unit/main/services/ai-config.service.test.ts`
- Modify: `tests/unit/main/services/openai-compatible.client.test.ts`
- Modify: `tests/unit/main/services/ai-public-validation.test.ts`
- Delete: `tests/unit/main/services/ai-research.service.test.ts`
- Test: `tests/unit/main/ai.ipc.test.ts`

**Interfaces:**
- Consumes: planner, PubMed client, provider research, evidence service, questionnaire generator, typed checkpoints, existing project persistence queue.
- Produces: the approved fixed stage order, resumable runs, cache invalidation, stage diagnostics, mandatory research policy, and unchanged final artifact/apply APIs.

- [ ] **Step 1: Write failing orchestration and recovery tests**

Use ordered spies and real repository state to prove `planning -> pubmed -> provider_search -> extracting -> generating -> validating`. Cover PubMed success/provider failure continuation, PubMed empty/provider success continuation, both empty stop, PubMed failure/provider failure stop, PubMed failure/provider success continuation, cancellation at every stage, checkpoint resume without repeated calls, provider/model/request/base-revision invalidation, batch checkpoint recovery, atomic persistence rollback, and sanitized diagnostics. Add config tests showing schema v1/v2 `webSearchEnabled` remains readable but no longer controls execution; schema-v3 persistence omits it. Add public validation tests for the six new progress stages and bounded error/diagnostic fields.

```ts
expect(stageCalls).toEqual([
  'planning',
  'pubmed',
  'provider_search',
  'extracting',
  'generating',
  'validating'
])
expect(noEvidenceResult).toMatchObject({ ok: false, errorCode: 'AI_RESEARCH_NO_EVIDENCE' })
```

- [ ] **Step 2: Run orchestration tests and verify RED**

Run: `pnpm test:unit -- tests/unit/main/services/ai-questionnaire.orchestrator.test.ts tests/unit/main/services/ai-session.repository.test.ts tests/unit/main/services/ai-config.service.test.ts tests/unit/main/services/openai-compatible.client.test.ts tests/unit/main/services/ai-public-validation.test.ts tests/unit/main/ai.ipc.test.ts`

Expected: FAIL because the current orchestrator has one research summary and one questionnaire completion loop.

- [ ] **Step 3: Implement staged orchestration and typed checkpoints**

Inject the five service ports into `AIQuestionnaireOrchestratorDependencies`. Define the exact version-1 `AgentCheckpoint` discriminated union now that every stage artifact type exists, add `parseAgentCheckpoint()`, and persist a checkpoint after every successfully validated stage and each completed questionnaire batch. Derive a checkpoint compatibility hash from project/session IDs, user message ID/content hash, base questionnaire revision/hash, prompt/schema/harness versions, provider/endpoint/model, and research adapter version.

```ts
export interface AIQuestionnaireOrchestratorDependencies {
  persistProject: AIPersistProjectHook
  planner: AIResearchPlanner
  pubmed: PubMedClient
  providerResearch: AIProviderResearchService
  evidence: AIEvidenceService
  generator: AIQuestionnaireGenerator
  createId?: () => string
  now?: () => string
}
```

Always call PubMed and always attempt provider search. Permit generation when either layer returns at least one normalized source; otherwise fail before extraction. Replace the function-call capability cache with provider-search protocol capability. Switch the orchestrator to `AIQuestionnaireGenerator`, then remove questionnaire tool extraction, `function_call` fallback, the old mixed research service, and their obsolete tests. Preserve the current project queue, stale-basis checks, atomic artifact commit, cancellation semantics, and encrypted project persistence hook.

Parse legacy config schema versions 1 and 2, ignore stored `webSearchEnabled` for execution, and write schema version 3 without that field. Keep a deprecated optional public field through this task so the existing renderer remains type-safe; config reads may expose its migrated value, but config writes omit it and execution ignores it. Keep API keys encrypted with Electron `safeStorage`. Extend `AIProgressStage` with the six stages and add public errors `AI_RESEARCH_PLAN_INVALID`, `AI_PUBMED_UNAVAILABLE`, `AI_RESEARCH_NO_EVIDENCE`, `AI_EVIDENCE_INVALID`, and `AI_MODEL_OUTPUT_TRUNCATED`. Update IPC response validation for new progress/error/diagnostic fields without exposing internal checkpoints or raw content.

- [ ] **Step 4: Run orchestration, repository, config, and IPC tests**

Run: `pnpm test:unit -- tests/unit/main/services/ai-questionnaire.orchestrator.test.ts tests/unit/main/services/ai-session.repository.test.ts tests/unit/main/services/ai-config.service.test.ts tests/unit/main/services/openai-compatible.client.test.ts tests/unit/main/services/ai-public-validation.test.ts tests/unit/main/ai.ipc.test.ts`

Expected: PASS; resumed runs do not repeat completed PubMed/provider/model stages and both-empty evidence never reaches the generator.

Run: `pnpm typecheck`

Expected: PASS after all main-process callers and public unions migrate; the renderer still compiles against the deprecated optional config field until Task 9 removes it.

- [ ] **Step 5: Commit orchestration and persistence**

```bash
git add src/main/services/ai-questionnaire.orchestrator.ts src/main/services/ai-agent-contracts.ts src/main/services/ai-session.repository.ts src/main/services/ai-config.service.ts src/main/services/openai-compatible.client.ts src/main/services/openai-stream.parser.ts src/main/ipc/ai.ipc.ts src/shared/ai-assistant-contract.ts src/main/services/ai-public-validation.ts tests/unit/main/services/ai-questionnaire.orchestrator.test.ts tests/unit/main/services/ai-agent-contracts.test.ts tests/unit/main/services/ai-session.repository.test.ts tests/unit/main/services/ai-config.service.test.ts tests/unit/main/services/openai-compatible.client.test.ts tests/unit/main/services/ai-public-validation.test.ts tests/unit/main/ai.ipc.test.ts
git rm src/main/services/ai-research.service.ts tests/unit/main/services/ai-research.service.test.ts
git commit -m "feat(ai): orchestrate resumable research stages"
```

---

### Task 9: Expose Truthful Progress, Evidence Mode, and Specific Errors

**Files:**
- Modify: `src/renderer/components/ai/AIProviderSettings.tsx`
- Modify: `src/renderer/components/ai/AIRunProgress.tsx`
- Modify: `src/renderer/components/ai/ai-errors.ts`
- Modify: `src/renderer/pages/AIQuestionnairePage.tsx`
- Modify: `src/shared/ai-assistant-contract.ts`
- Test: `tests/unit/renderer/ai-provider-settings.test.tsx`
- Test: `tests/unit/renderer/AIQuestionnairePage.test.tsx`

**Interfaces:**
- Consumes: new public stage snapshots, research mode/status, citations, batch counters, and public error codes.
- Produces: mandatory-research settings copy, exact stage labels, PubMed-only/provider-supplement badges, recovered progress, and bounded diagnostic summaries.

- [ ] **Step 1: Write failing renderer behavior tests**

Assert the provider settings no longer render a Web Search checkbox, explain mandatory PubMed and optional-by-capability provider supplementation, and link to NCBI disclaimer/copyright pages. Assert exact progress labels for all six stages and batch `2/5`, PubMed-only versus supplemented result badges, specific no-evidence/PubMed/truncation errors, recovered stage rendering, and absence of raw diagnostic/provider content.

```tsx
expect(screen.queryByRole('checkbox', { name: /联网搜索/ })).not.toBeInTheDocument()
expect(screen.getByText('正在检索 PubMed')).toBeInTheDocument()
expect(screen.getByText('正在生成问卷（第 2/5 批）')).toBeInTheDocument()
```

- [ ] **Step 2: Run renderer tests and verify RED**

Run: `pnpm test:unit -- tests/unit/renderer/ai-provider-settings.test.tsx tests/unit/renderer/AIQuestionnairePage.test.tsx`

Expected: FAIL because the old toggle and coarse connecting/streaming labels remain.

- [ ] **Step 3: Implement settings, progress, and error UI**

Remove the deprecated optional `webSearchEnabled` public field and renderer state together, then update payloads to the schema-v3 config shape. Map stages exactly:

```ts
const STAGE_LABELS: Record<AIProgressStage, string> = {
  starting: '正在准备任务',
  planning: '正在翻译并规划检索',
  pubmed: '正在检索 PubMed',
  provider_search: '正在补充权威来源',
  extracting: '正在提取研究证据',
  generating: '正在生成问卷',
  validating: '正在进行本地校验',
  repairing: '正在修复问卷批次',
  clarification: '已收到补充问题',
  completed: '生成完成',
  failed: '生成失败',
  cancelled: '已取消生成',
  connecting: '正在连接模型',
  streaming: '正在接收模型回答'
}
```

Keep legacy labels while old active/recovered runs remain readable. Show only public diagnostic summaries and normalized citation links. Do not render provider snippets as trusted HTML.

- [ ] **Step 4: Run renderer tests and accessibility checks**

Run: `pnpm test:unit -- tests/unit/renderer/ai-provider-settings.test.tsx tests/unit/renderer/AIQuestionnairePage.test.tsx tests/unit/renderer/quality-and-guards.test.tsx`

Expected: PASS with no duplicate labels, inaccessible progress text, or old toggle.

Run: `pnpm typecheck`

Expected: PASS after the deprecated public config field and its renderer consumers are removed together.

- [ ] **Step 5: Commit the UI**

```bash
git add src/renderer/components/ai/AIProviderSettings.tsx src/renderer/components/ai/AIRunProgress.tsx src/renderer/components/ai/ai-errors.ts src/renderer/pages/AIQuestionnairePage.tsx src/shared/ai-assistant-contract.ts tests/unit/renderer/ai-provider-settings.test.tsx tests/unit/renderer/AIQuestionnairePage.test.tsx
git commit -m "feat(ai): show staged research progress"
```

---

### Task 10: Verify Migration, Security Boundaries, and Release Build

**Files:**
- Create: `tests/unit/main/services/ai-agent.integration.test.ts`
- Modify when a failing UI acceptance boundary proves necessary: `tests/e2e/app.spec.ts`
- Modify when a failing packaged boundary proves necessary: `tests/e2e/packaged.spec.ts`
- Modify: `docs/superpowers/specs/2026-09-11-staged-academic-research-agent-design.md`

**Interfaces:**
- Consumes: all preceding tasks and the existing 0.8.0 Windows build pipeline.
- Produces: verified deterministic suite, production build, packaged smoke evidence, final design status, and regenerated 0.8.0 artifacts.

- [ ] **Step 1: Add one deterministic full-pipeline integration fixture**

Use injected model transport, PubMed fetcher, provider supplement, repository, and persistence hook in a main-process integration test. Return a Chinese-to-English plan, ESearch/EFetch fixtures, a failed provider supplement, validated evidence, and a direct questionnaire JSON object. Assert exact stage order, PubMed-only status, canonical citation URL, final validated artifact, checkpoint writes, and absence of `tools`, `tool_choice`, `submit_questionnaire`, API keys, and unrelated project data in captured request bodies. Do not use live network access.

```ts
expect(observedStages).toEqual([
  '正在翻译并规划检索',
  '正在检索 PubMed',
  '正在补充权威来源',
  '正在提取研究证据',
  '正在生成问卷',
  '正在进行本地校验'
])
```

- [ ] **Step 2: Run the full-pipeline test and verify RED, then GREEN**

Run the new test before wiring any missing boundary and confirm it fails at that boundary. Implement only the missing integration wiring in the owning file, then run:

Run: `pnpm test:unit -- tests/unit/main/services/ai-agent.integration.test.ts`

Expected: PASS with the exact ordered stages and direct JSON request assertions.

- [ ] **Step 3: Run the focused security and migration suites**

Run: `pnpm test:unit -- tests/unit/main/services/ai-agent-contracts.test.ts tests/unit/main/services/pubmed.client.test.ts tests/unit/main/services/ai-session.repository.test.ts tests/unit/main/services/ai-config.service.test.ts tests/unit/main/services/ai-questionnaire.orchestrator.test.ts tests/unit/main/services/ai-questionnaire-generator.service.test.ts tests/unit/renderer/AIQuestionnairePage.test.tsx`

Expected: PASS with no failures.

- [ ] **Step 4: Run the repository release gates once**

Run: `pnpm check`

Expected: lint, typecheck, coverage suite, and production build all exit 0.

Run: `pnpm test:e2e`

Expected: all unpackaged Electron E2E tests pass.

Run: `pnpm build:win`

Expected: `release/EasyEpi-0.8.0-setup-x64.exe`, `release/EasyEpi-0.8.0-portable-x64.exe`, and the setup blockmap are regenerated from the final commit.

Run: `pnpm test:e2e:packaged` with `EASYEPI_EXECUTABLE` first pointing to the portable artifact and a new isolated `EASYEPI_USER_DATA_DIR`, then once to `release/win-unpacked/EasyEpi.exe`.

Expected: portable packaged scenarios pass; unpacked installation smoke passes with its intentionally inapplicable scenarios skipped.

- [ ] **Step 5: Mark the spec implemented and commit verification artifacts**

Change the design document status from `Draft for final review` to `Implemented`, record the final verification commands/counts without committing generated binaries, and commit only source/tests/docs:

```bash
git add src tests package.json pnpm-lock.yaml docs/superpowers/specs/2026-09-11-staged-academic-research-agent-design.md
git commit -m "test(ai): verify staged academic research agent"
```

After the commit, run `git status --short` and require an empty result before reporting completion. Copy the verified Windows artifacts to `D:\EasyEpi\release`, calculate SHA-256 hashes, and report that Authenticode remains `NotSigned` unless a signing certificate has been configured.
