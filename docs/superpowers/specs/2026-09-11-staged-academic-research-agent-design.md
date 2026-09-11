# Staged Academic Research Agent Design

**Date:** 2026-09-11  
**Status:** Draft for final review  
**Target:** EasyEpi 0.8.0 AI questionnaire workflow

## Problem

The current questionnaire workflow does not implement the research sequence promised to users. It sends the raw user request directly to a provider-specific search adapter, then sends a free-text research summary into a questionnaire generation request. DeepSeek is statically marked as not supporting search, while MiMo is sent a forced named function choice that its OpenAI-compatible API does not reliably honor. A successful HTTP response that contains ordinary JSON content instead of `submit_questionnaire` is rejected before the local questionnaire harness runs and is shown only as `AI_INVALID_RESPONSE`.

The current encrypted project storage is not a cause of these protocol failures. Conversation data is decrypted in memory before a request is assembled. A local `sessionId` identifies EasyEpi state; it is not a remote provider conversation handle, and OpenAI-compatible endpoints cannot reconstruct the required context from that identifier alone.

## Goals

- Run a deterministic, inspectable academic-research pipeline before questionnaire generation.
- Always search PubMed first without requiring a user API key.
- Translate non-English research requests into English before extracting PubMed keywords and MeSH terms.
- Use the selected provider's built-in Web Search only as a supplementary source.
- Stop rather than generate an unresearched questionnaire when both PubMed and provider search yield no usable evidence.
- Use `response_format: { "type": "json_object" }` for every model-produced intermediate and final artifact.
- Remove `submit_questionnaire` Function Calling from the questionnaire result protocol.
- Support large questionnaires through deterministic batch generation and local assembly.
- Preserve encrypted local project storage and resumable local sessions.
- Replace the generic invalid-response failure with stage-specific, sanitized diagnostics.

## Non-goals

- No Web of Science integration or subscription/API-key UI in this change.
- No scraping of PubMed, journal sites, or arbitrary web pages.
- No unencrypted conversation store and no dependence on provider-side conversation retention.
- No weakening of the existing questionnaire schema, business validation, derived-variable protections, or application-time checks.
- No long-term storage of complete raw provider responses.

## Architecture

The workflow is a staged local orchestrator. Each stage has one responsibility and a versioned JSON contract.

```text
User request
  -> Research planner
  -> PubMed gateway
  -> Provider search adapter
  -> Evidence extractor
  -> Questionnaire generator / batch generator
  -> Local assembly
  -> Local questionnaire harness
  -> Persisted draft artifact
```

### 1. Research planner

The configured model receives the current user request and only the context required to interpret it. It returns a `ResearchPlan` as `json_object`. If the request is not English, the planner translates its research meaning into English before producing search terms. The original language is retained so the final questionnaire remains in the user's language.

The planner does not search, generate questionnaire fields, or invent citations.

```json
{
  "originalLanguage": "zh",
  "englishResearchQuestion": "...",
  "searchQueries": ["..."],
  "keywords": ["..."],
  "meshTerms": ["..."],
  "population": "...",
  "exposureOrIntervention": "...",
  "outcomes": ["..."]
}
```

Limits:

- one to three PubMed queries;
- no more than twenty keywords and twenty MeSH terms;
- bounded strings and collections;
- no URLs, PMID values, DOI values, or source claims.

### 2. PubMed gateway

EasyEpi, not the model, calls the public NCBI E-utilities endpoints over HTTPS:

1. `ESearch` searches `db=pubmed` using the English queries and returns at most twenty relevant PMIDs.
2. One batched `EFetch` retrieves PubMed XML for those PMIDs.
3. A bounded parser produces normalized `PubMedSource` records.

```json
{
  "sourceId": "pubmed:12345678",
  "pmid": "12345678",
  "doi": "10.xxxx/example",
  "title": "...",
  "abstract": "...",
  "authors": ["..."],
  "journal": "...",
  "year": 2025,
  "url": "https://pubmed.ncbi.nlm.nih.gov/12345678/"
}
```

The gateway allows only NCBI-owned HTTPS endpoints, validates redirects, enforces response byte and XML complexity limits, batches retrieval, deduplicates by PMID, supports cancellation, and stays below the anonymous NCBI limit of three requests per second. It identifies review, systematic-review, meta-analysis, and guideline publication types when NCBI supplies them, but it does not manufacture an evidence ranking from missing metadata.

NCBI requires applications using E-utilities to make its disclaimer and copyright notice evident to users. The AI settings/help UI will link to those notices.

### 3. Provider search adapter

Provider search runs after PubMed and uses the research plan plus a compact inventory of PubMed coverage to look for complementary authoritative material, such as WHO, CDC, and national public-health guidance. Provider results never replace PubMed records.

Every provider-search result is normalized before extraction:

```json
{
  "sourceId": "provider:https://www.who.int/example",
  "title": "...",
  "institution": "World Health Organization",
  "year": 2025,
  "url": "https://www.who.int/example",
  "snippet": "..."
}
```

The URL and citation metadata must come from the provider's structured search annotations rather than generated prose. Results without a valid HTTPS source URL are not usable evidence.

Adapters are capability-based and negotiate support on first use:

- OpenAI and xAI: Responses Web Search when supported.
- DeepSeek: Responses `web_search` for endpoints/models that support it; no provider-wide static denial.
- MiMo: Chat Completions `web_search`, `tool_choice: "auto"`, with a clear error when its paid search plugin is not enabled.
- Qwen, GLM, and Moonshot: their documented Chat Completions search transports.
- Gemini and custom compatible endpoints: attempt only a declared/detected supported transport; otherwise report unsupported.

The capability cache key includes provider, normalized endpoint, model, and adapter protocol version. PubMed success is sufficient to proceed when provider search is unsupported or fails. If PubMed yields no usable source, provider search must yield at least one verifiable source or the run stops.

### 4. Evidence extractor

The model receives normalized PubMed records and bounded provider-search records as untrusted quoted data. It returns `ResearchEvidence` as `json_object`.

```json
{
  "researchQuestion": "...",
  "claims": [
    {
      "claim": "...",
      "sourceIds": ["pubmed:12345678"],
      "strength": "high"
    }
  ],
  "questionnaireRecommendations": ["..."],
  "limitations": ["..."],
  "sources": []
}
```

Source identifiers, titles, years, institutions, URLs, DOI values, and PMID values come only from normalized retriever records. The extractor may omit a source but cannot add or modify source identity. Local validation rejects unknown source IDs, source-free claims, duplicate sources, invalid URLs, and identity mismatches. A rejected evidence object is discarded and only the extraction stage is retried.

### 5. Questionnaire generator

All providers use Chat Completions JSON Output for questionnaire artifacts:

```json
{
  "response_format": { "type": "json_object" }
}
```

The system prompt contains the exact versioned envelope contract and a compact example. It explicitly includes the word `JSON`, prohibits markdown, and tells the model to use only the supplied validated evidence. The request does not include `tools`, `tool_choice`, or `submit_questionnaire`.

Small questionnaires are generated as one `QuestionnaireEnvelope`. Large questionnaires use staged JSON batches:

1. a bounded questionnaire structure plan;
2. question batches with stable IDs and ordering;
3. condition-rule batches referencing only known question IDs;
4. deterministic local assembly into the existing envelope;
5. the unchanged local questionnaire harness.

The generator estimates output size from the requested question count and provider output capability. It switches to batches before sending a likely oversized request. A `finish_reason` indicating truncation also triggers a smaller batch retry. The application, not the model, performs final assembly.

## Session, Persistence, and Privacy

- Project encryption remains unchanged. AI messages, plans, normalized sources, evidence, checkpoints, and drafts remain inside the encrypted project.
- `sessionId` remains the local index for conversation and artifacts. `runId` identifies one staged execution.
- A run persists the stages `planning`, `pubmed`, `provider_search`, `extracting`, `generating`, and `validating`.
- Each completed stage stores a versioned, validated checkpoint. Recovery resumes from the most recent compatible checkpoint rather than repeating paid model/search calls.
- Changing the user request, questionnaire base revision, prompt version, schema version, provider endpoint/model, or research adapter version invalidates affected downstream checkpoints.
- Complete raw provider bodies are not persisted. Normalized source records and bounded, sanitized diagnostics are persisted because they are required for auditability and recovery.
- Model requests contain only the minimum current-stage context. A provider never receives a local encryption key, filesystem path, project password, administrator record, survey response, or unrelated conversation history.

## Failure Policy

| Stage | Failure behavior |
| --- | --- |
| Planning | Retry once with the planner schema and exact validation errors. |
| PubMed network | Retry up to two times with bounded exponential backoff. |
| PubMed parse | Reject the response; do not pass partial unvalidated records to a model. |
| Provider search | Continue with an explicit PubMed-only status if PubMed succeeded. |
| No usable source anywhere | Stop the run; do not generate a questionnaire. |
| Evidence extraction | Retry only extraction when source-reference validation fails. |
| Questionnaire truncation | Reduce batch size and retry the affected batch. |
| Questionnaire schema/business validation | Repair only the affected batch when ownership is unambiguous; otherwise regenerate assembly inputs. |
| Cancellation | Abort active network/model work and retain only completed checkpoints. |

The UI reports a specific public code and stage, including `AI_RESEARCH_PLAN_INVALID`, `AI_PUBMED_UNAVAILABLE`, `AI_RESEARCH_NO_EVIDENCE`, `AI_EVIDENCE_INVALID`, `AI_MODEL_OUTPUT_TRUNCATED`, and existing questionnaire validation codes.

## Sanitized Diagnostics

Each failed attempt records only:

- stage and adapter protocol;
- normalized provider and model identifiers;
- HTTP status and response content type;
- choice count, `finish_reason`, and whether content, reasoning, annotations, or tool calls were present;
- byte/character counts;
- JSON parse and contract-validation outcome;
- retry count and terminal public error code.

Diagnostics never contain API keys, authorization headers, complete prompts, full user text, raw model content, or raw search response bodies. This is enough to distinguish transport incompatibility, truncation, malformed JSON, missing search capability, and local schema rejection without leaking research content.

## UI Behavior

Progress displays the actual pipeline:

```text
正在翻译并规划检索
正在检索 PubMed
正在补充权威来源
正在提取研究证据
正在生成问卷（第 2/5 批）
正在进行本地校验
```

The result identifies whether evidence came from PubMed only or PubMed plus provider search. Citations link only to normalized source URLs. PubMed and the provider-search attempt are mandatory pipeline stages for AI questionnaire generation, so the existing Web Search toggle is removed from this workflow. If the provider has no supported search transport or its search fails after PubMed succeeds, the run continues with an explicit PubMed-only status.

## Security and Resource Bounds

- HTTPS host allowlists and DNS/redirect checks prevent the PubMed gateway from becoming a general-purpose fetch proxy.
- Search terms, response bytes, XML nodes/depth, record counts, abstract lengths, evidence counts, batch counts, and total assembled questionnaire size are bounded.
- XML parsing disables entity expansion and external resources.
- Retrieved text is marked as untrusted data and cannot override system instructions.
- Existing questionnaire restrictions remain authoritative: no unknown fields, response data, project secrets, derived-variable mutation, unsafe regex mutation, or silent type coercion.

## Testing

Automated tests use deterministic NCBI JSON/XML fixtures rather than the live service:

- non-English translation and English query-plan validation;
- ESearch query encoding, anonymous rate limiting, retries, cancellation, and result limits;
- batched EFetch parsing, PMID deduplication, DOI/URL construction, malformed XML, and oversized responses;
- provider-search success, unsupported, plugin-disabled, malformed, and failed paths;
- MiMo `tool_choice: "auto"` and DeepSeek Responses Web Search negotiation;
- citation identity preservation and hallucinated-source rejection;
- mandatory stop when neither search layer provides usable evidence;
- direct `json_object` questionnaire generation without function tools;
- output truncation and automatic batch-size reduction;
- large questionnaire assembly, repair ownership, final harness validation, checkpoint recovery, and cache invalidation;
- diagnostics redaction and stage-specific public errors.

A separate manual diagnostic action may call live PubMed and the configured provider, but it is not part of deterministic CI and never uses a hidden application-wide NCBI key.

## Migration

Existing sessions and drafts remain readable. New runs use new prompt, research-contract, adapter, and checkpoint versions. Old capability cache entries for forced questionnaire Function Calling are ignored. Existing encrypted project format remains compatible unless staged checkpoint fields require a normal versioned project migration; no plaintext migration is introduced.

## References

- NCBI E-utilities overview and usage requirements: https://www.ncbi.nlm.nih.gov/books/NBK25497/
- NCBI E-utilities quick start: https://www.ncbi.nlm.nih.gov/books/NBK25500/
- DeepSeek Responses API and Web Search: https://api-docs.deepseek.com/api/create-response/
- DeepSeek JSON Output: https://api-docs.deepseek.com/guides/json_mode/
- Xiaomi MiMo Web Search: https://mimo.mi.com/docs/zh-CN/quick-start/usage-guide/text-generation/tool-calling/web-search
- Xiaomi MiMo OpenAI-compatible API: https://mimo.mi.com/docs/zh-CN/api/chat/openai-api
