# DeepSeek-Only Medical Research Agent Design

**Date:** 2026-09-12
**Status:** Implemented
**Target:** EasyEpi 0.8.0 AI questionnaire workflow

## Verification

Executed against the final commit on the `codex/easyepi-0.8.0` worktree:

| Gate | Command | Result |
| --- | --- | --- |
| Lint | `pnpm lint` | clean |
| Types | `pnpm typecheck` | clean (main and renderer projects) |
| Unit + coverage | `pnpm test:coverage` | 99 files, 1347 tests, all passing; 86.14% statements / 80.84% branches |
| Build | `pnpm build` | main, preload, renderer bundles built |
| Release gate | `pnpm check` | exit 0 |
| Unpackaged E2E | `pnpm test:e2e` | 14 passed |
| Packaged portable | `pnpm test:e2e:packaged` with `EASYEPI_EXECUTABLE` on `EasyEpi-0.8.0-portable-x64.exe` | 6 passed |
| Packaged unpacked | `pnpm test:e2e:packaged` with `EASYEPI_EXECUTABLE` on `release/win-unpacked/EasyEpi.exe` | 1 passed, 5 intentionally skipped |
| Artifacts | `pnpm build:win` | `EasyEpi-0.8.0-setup-x64.exe`, `EasyEpi-0.8.0-portable-x64.exe`, setup blockmap |

The packaged `app.asar` was inspected and contains `/node_modules/saxes`, its `xmlchars`
dependency, and every `out/main/services/research/*` bundle, so the PubMed XML parser and the
staged pipeline are present in the shipped application. Authenticode status is `NotSigned`
(no signing certificate is configured).

## Problem

The current AI questionnaire workflow has four defects that break the research-assisted design
promise:

1. Multi-provider complexity. `src/shared/ai-provider-profiles.ts` ships nine provider presets and
   `src/main/services/ai-provider-policy.ts` carries a per-provider transport matrix. Only one
   provider is actually required, and the matrix multiplies failure modes the harness must absorb.
2. DeepSeek is statically marked `searchTransport: 'unsupported'`, so the one supported provider can
   never perform its built-in web search.
3. Retrieval is not literature-aware. `ai-research.service.ts` asks the provider for a free-text
   summary and passes the prose into questionnaire generation. There is no PubMed, preprint, or
   citation-identity validation anywhere in the pipeline.
4. A model response that contains ordinary JSON instead of a `submit_questionnaire` function call is
   rejected as `AI_INVALID_RESPONSE` before the local harness ever runs. Large questionnaires are
   additionally truncated because the completion token limit is 16,384 while DeepSeek now serves
   384,000 output tokens.

## Goals

- Support exactly one AI provider: DeepSeek.
- Perform real medical-literature retrieval through public APIs: PubMed E-utilities, Europe PMC
  (preprint keyword search over bioRxiv/medRxiv), and the bioRxiv/medRxiv official details API.
- Use the DeepSeek Responses API native `web_search` tool for web search.
- Route by domain: medical requests use literature + web search; non-medical requests use web search
  only.
- Raise context and output limits to match the current DeepSeek model catalogue.
- Guarantee every produced questionnaire is schema-legal, verified twice: by the main-process harness
  and independently by the local renderer before the draft can be applied.
- Keep encrypted project storage, session checkpointing, and the existing questionnaire schema
  authoritative.

## Non-goals

- No provider picker, provider presets, or custom base URL. DeepSeek only.
- No scraping of PubMed, journal sites, or arbitrary pages.
- No weakening of the questionnaire schema, derived-variable protection, regex immutability, or
  apply-time checks.
- No persistence of raw provider bodies, prompts, or API keys.
- No live network access in the deterministic test suite.

## Provider Contract

`AI_PROVIDER_IDS` becomes `['deepseek']`. `AIProviderId` is `'deepseek'`.

```ts
export const DEEPSEEK_BASE_URL = 'https://api.deepseek.com'
export const DEEPSEEK_DEFAULT_MODEL = 'deepseek-v4-flash'
```

`deepseek-v4-flash` and `deepseek-v4-pro` are the current catalogue entries (1,000,000-token context,
384,000-token maximum output). `deepseek-chat` and `deepseek-reasoner` are legacy V3 aliases and are
not assumed to exist.

### Stored configuration schema v3

```ts
interface StoredAIConfigV3 {
  schemaVersion: 3
  baseUrl: string            // always the DeepSeek origin after normalization
  model: string
  encryptedApiKey?: string
  privacyAcceptedAt?: string
  privacyNoticeVersion?: number
}
```

`providerId` and `webSearchEnabled` are removed. Search is a mandatory pipeline stage, not a
preference.

Migration from v1/v2 is total and automatic:

- `baseUrl` is normalized to `DEEPSEEK_BASE_URL` unless it already resolves to the DeepSeek host.
- `encryptedApiKey` is retained only when the previously stored base URL already resolved to the
  DeepSeek host; otherwise it is dropped (the existing key-retention rule already requires an
  unchanged normalized `baseUrl`).
- `model` is reset to `DEEPSEEK_DEFAULT_MODEL` when the previous host was not DeepSeek, because a
  model id issued for another vendor cannot exist on DeepSeek.
- `privacyAcceptedAt` / `privacyNoticeVersion` are always carried forward.

The settings surface is reduced to a model field and an API key field. The endpoint is displayed as
read-only text.

## DeepSeek Responses Web Search

New transport in `src/main/services/openai-responses.client.ts`:

```http
POST https://api.deepseek.com/responses
Authorization: Bearer <key>
Content-Type: application/json

{
  "model": "deepseek-v4-flash",
  "instructions": "...",
  "input": "<research question>",
  "tools": [{ "type": "web_search" }],
  "tool_choice": "auto",
  "stream": false
}
```

Confirmed details:

- The tool type string is `web_search` (not `web_search_preview`).
- The output-token field is `max_output_tokens` and must be at least 16. `max_completion_tokens`
  belongs to Chat Completions and must never be sent to `/responses`.
- `filters.allowed_domains` is treated as unsupported. Authority restriction is expressed in
  `instructions` and enforced by client-side URL filtering instead.
- The `/v1/responses` spelling is a documented alias and is used as an endpoint fallback.

Response parsing accepts the documented vocabulary but requires nothing beyond what is proven:

- `status` ∈ `completed | incomplete | failed | in_progress | queued`; `failed` and `incomplete` are
  terminal errors, not partial success.
- `output[]` item types `reasoning | web_search_call | message`. A `web_search_call` item is the
  evidence that a search actually ran.
- `message.content[]` parts of type `output_text`, tolerating a `text` key spelling; `annotations`
  and `web_search_call` are optional and their absence is not an error.
- Citations come only from `annotations[]` entries of type `url_citation` with an HTTPS `url`. URLs
  embedded in prose are never promoted to sources.

Capability negotiation: a 400/404 whose message names the `web_search` tool or the `/responses`
route is cached per `endpoint + model` so a run never pays for the same discovery twice. A cached
`unsupported` result skips the stage and reports `unsupported` instead of retrying.

Domain restriction is applied after parsing: when the plan is medical, citations whose host is on the
authority allow-list (PubMed, DOI resolvers, WHO, CDC, NIH, NICE, and the major publishers) are
preferred. The preference is not a cull — if no citation is on the allow-list, the structured
citations are retained, because they are still real HTTPS sources and discarding them would turn a
usable answer into a spurious no-evidence stop.

## Literature Retrieval

### PubMed E-utilities (`pubmed.client.ts`)

```http
GET https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi
    ?db=pubmed&term=<query>&retmode=json&retmax=20&retstart=0&sort=relevance&tool=easyepi&email=<contact>
GET https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi
    ?db=pubmed&id=<comma-separated PMIDs>&rettype=abstract&retmode=xml&tool=easyepi&email=<contact>
```

- Anonymous rate limit is 3 requests per second; the client serializes all requests with a shared
  limiter at ≥334 ms spacing.
- `count` and `retmax` in the ESearch JSON are strings and are coerced explicitly.
- EFetch XML is parsed with `saxes@6.0.0` in a bounded reader: no DTD resolution, no external
  entities, depth ≤32, ≤100,000 nodes, ≤8 MB per response.
- Extracted per record: PMID, title (concatenated mixed content), abstract (repeated `AbstractText`
  with optional `Label`, joined), authors (`LastName`/`ForeName`, or `CollectiveName`), journal
  (`Title`, falling back to `ISOAbbreviation`), year (`PubDate/Year`, falling back to
  `MedlineDate`), DOI (`ArticleId[@IdType="doi"]`, falling back to
  `ELocationID[@EIdType="doi"]`), publication types, and the canonical URL
  `https://pubmed.ncbi.nlm.nih.gov/<PMID>/` built from the PMID only.
- A malformed `PubmedArticle` is skipped, never aborting the batch. `PubmedBookArticle` is skipped.
- Retry 429 and 5xx twice at 500 ms then 1,000 ms, honouring `Retry-After` only in 0–5 s.

### Europe PMC preprint keyword search (`europepmc.client.ts`)

bioRxiv and medRxiv publish no keyword-search API. Europe PMC indexes both servers' preprints and
does support keyword search, so it supplies discovery and the official servers supply verified
metadata.

```http
GET https://www.ebi.ac.uk/europepmc/webservices/rest/search
    ?query=(TITLE_ABS:"..." AND "...") AND SRC:PPR AND PUBLISHER:"medRxiv"
    &format=json&resultType=core&pageSize=25&sort=P_PDATE_D%20desc&cursorMark=*
```

- `resultType=core` is required to receive `abstractText`.
- `SRC:PPR` alone does not distinguish the two servers; `PUBLISHER:"bioRxiv"` /
  `PUBLISHER:"medRxiv"` does.
- Terminal pagination is unreliable (the final page may echo the request cursor), so paging stops on
  `nextCursorMark === cursorMark`, an empty page, or the page-size budget.
- `pubYear` is a string and is coerced.

### bioRxiv / medRxiv metadata (`preprint.client.ts`)

```http
GET https://api.biorxiv.org/details/{server}/{doi}
```

Used only to verify a DOI discovered by Europe PMC and to complete title, authors, date, version, and
category. The landing URL is
`https://www.{biorxiv|medrxiv}.org/content/<doi>v<version>`, with the host taken from the record's
`server` field rather than inferred from the DOI prefix. Responses are paged at 100 records and the
`messages[0].status === 'no posts found'` case yields an empty collection.

## Pipeline

```text
planning
  -> [medical]  literature      PubMed -> Europe PMC -> bioRxiv/medRxiv metadata
  -> [always]   web_search      DeepSeek Responses web_search
  ->            extracting      evidence bound to immutable source identities
  ->            generating      JSON envelope, batched when oversized
  ->            validating      main harness + shared format validator
```

### 1. Planning

The planner returns a `ResearchPlan` as JSON only:

```ts
interface ResearchPlan {
  originalLanguage: string
  englishResearchQuestion: string
  domain: 'medical' | 'non_medical'
  searchQueries: string[]      // 1..3
  keywords: string[]           // <= 20
  meshTerms: string[]          // <= 20
  population: string
  exposureOrIntervention: string
  outcomes: string[]
}
```

Non-English requests are translated into English for searching only; the questionnaire stays in the
user's language. The planner never produces citations. An invalid plan is repaired once with the
bounded validation codes and paths, then fails as `AI_RESEARCH_PLAN_INVALID`.

An unparseable or missing `domain` resolves to `medical`, because literature retrieval degrades
harmlessly (empty result) while a wrongly skipped literature stage cannot be recovered.

### 2. Literature stage

Runs only for `domain === 'medical'`. Queries run in order PubMed, Europe PMC, then bioRxiv/medRxiv
metadata verification. Each source is normalized to:

```ts
interface LiteratureSource {
  sourceId: string          // 'pubmed:12345678' | 'epmc:PPR123' | 'biorxiv:10.1101/...'
  kind: 'pubmed' | 'epmc' | 'preprint'
  server?: 'bioRxiv' | 'medRxiv'
  title: string
  abstract: string
  authors: string[]
  journal?: string
  year?: number
  doi?: string
  pmid?: string
  url: string
  publicationTypes: string[]
}
```

A literature failure produces a diagnostic and an empty source list; it never aborts the run by
itself. One bounded retry is allowed per provider.

### 3. Web search stage

Always runs. The query is the English research question plus a compact gap inventory of what the
literature stage already found, so the model does not re-discover the same records. The web sources
are normalized to `WebSource` with `sourceId = 'web:<normalized url>'`.

### 4. Evidence extraction

The model receives the normalized sources as untrusted quoted data and returns:

```ts
interface ResearchEvidence {
  researchQuestion: string
  claims: Array<{ claim: string; sourceIds: string[]; strength: 'low' | 'medium' | 'high' }>
  questionnaireRecommendations: string[]
  limitations: string[]
  sources: Array<{ sourceId: string; title: string; url: string }>
}
```

Local validation runs against the caller-owned source inventory: unknown source ids, mutated
identity, source-free claims, and duplicate identities are rejected. Accepted sources are replaced
with clones of the original records, so the model cannot invent or edit source identity.

### 5. Generation

Questionnaire generation stays on Chat Completions with
`response_format: { "type": "json_object" }` and no tools. The system prompt carries the exact
envelope contract and a compact example, and instructs the model to use only the supplied evidence.

Size handling:

- Estimate is derived from the requested question count and the serialized evidence size.
- A single request is used when the estimate fits the configured output budget.
- Otherwise questions are generated in ordered batches of at most 30, then assembled
  deterministically: ordering, id de-duplication, missing-id detection, and cross-batch rule
  reference checks all happen locally before the harness runs.
- `finish_reason` values `length`, `max_tokens`, or an `incomplete` Responses status halve the batch
  size, down to a floor of five questions, and retry the owning batch only.

### 6. Dual validation

The main-process harness remains the authority. A new shared validator,
`src/shared/questionnaire-format.ts`, is a strict structural checker usable from both processes:

```ts
export function validateQuestionnaireFormat(
  value: unknown,
  options?: { protectedVariableNames?: readonly string[] }
): { ok: true; questionnaire: QuestionnaireDef } | { ok: false; issues: QuestionnaireFormatIssue[] }
```

It enforces exact field sets, enum values, ordering, option integrity, constraint consistency,
variable-name syntax and uniqueness, condition-rule reference integrity, and derived-variable
withholding. It is deliberately a subset of the harness rules, so a harness-approved draft can never
be rejected by it; a test pins that property.

The renderer runs it on `preview.draft` before rendering the draft card and before enabling
"应用到正式问卷". A failure shows the offending field paths and blocks apply, which is what makes the
guarantee "the questionnaire is recognised by the app" observable in the renderer rather than assumed.

## Context, Output, and Resource Bounds

| Bound | Before | After |
| --- | --- | --- |
| `MAX_CONTEXT_CHARACTERS` | 60,000 | 400,000 |
| completion token limit | 16,384 | 65,536 |
| max response bytes | 2,000,000 | 16,000,000 |
| max model text length | 2,000,000 | 6,000,000 |
| max questions | 500 | 500 (unchanged) |
| max sources per stage | n/a | 20 PubMed, 20 preprints, 20 web |

## Failure Policy

| Stage | Behavior |
| --- | --- |
| Planning invalid | One repair with bounded codes/paths, then `AI_RESEARCH_PLAN_INVALID`. |
| PubMed network | Two bounded retries, then literature degrades to empty. |
| PubMed all queries empty | Literature degrades to empty, not an error. |
| Europe PMC / preprint failure | Literature keeps PubMed results and records a diagnostic. |
| Web search unsupported or failed | Non-medical run continues with `none` and the explicit disclaimer; medical run continues when literature supplied sources. |
| No usable source at all | `AI_RESEARCH_NO_EVIDENCE`. For medical requests this stops the run. For non-medical requests the run stops only when web search also failed or is unsupported; a successful search that returned no citable source is not a hard failure. |
| Evidence identity mismatch | Retry extraction once, then `AI_EVIDENCE_INVALID`. |
| Output truncated | Halve the batch, floor five, retry the owning batch. |
| Harness rejection | Up to three attempts with bounded repair instructions. |
| Cancellation | Abort active work, keep completed checkpoints, mark `AI_CANCELLED`. |

For a medical request the run stops without producing a questionnaire when literature and web search
both yield nothing usable. For a non-medical request, a web search that is unsupported, failed, or
empty degrades to the honest no-external-evidence disclaimer rather than blocking the user.

The assistant message never claims a search happened unless evidence was actually retrieved. When no
evidence was used, the fixed disclaimer is emitted:

> 【本次未联网】已根据当前对话生成结果；未使用或核验任何外部来源。

## Progress and Public Surface

`AIProgressStage` gains `planning`, `literature`, `web_search`, and `extracting`. A new
`stage_changed` progress event carries the current stage so the live UI reflects the real pipeline
instead of a stalled "connecting". `researchStatus` becomes
`literature_and_web | literature_only | web_only | none`. New public error codes:
`AI_RESEARCH_PLAN_INVALID`, `AI_PUBMED_UNAVAILABLE`, `AI_RESEARCH_NO_EVIDENCE`,
`AI_RESEARCH_SOURCE_INVALID`, `AI_EVIDENCE_INVALID`, `AI_RESEARCH_UNSUPPORTED`,
`AI_RESPONSE_TRUNCATED`, and `AI_MODEL_OUTPUT_TRUNCATED`.

Diagnostics are sanitized: stage, protocol, provider, model, HTTP status, content type, finish
reason, choice count, presence flags, byte/character counts, JSON parse outcome, retry count, and the
terminal public error code. Never API keys, headers, prompts, raw content, or raw response bodies.

## Testing

Deterministic fixtures only; no live network in `pnpm test:unit`.

- planner: translation, domain classification, over-limit terms, malformed JSON, one repair, cancellation;
- PubMed: exact query encoding, rate-limit pacing, 429/5xx retry, EFetch batching, structured
  abstracts, DOI fallbacks, malformed-record skipping, oversize and depth rejection, cancellation;
- Europe PMC: preprint query construction, publisher discrimination, cursor termination, string
  coercion;
- bioRxiv: DOI verification, `no posts found`, version/landing URL construction;
- Responses transport: `web_search` body shape, `max_output_tokens` field, capability negotiation and
  caching, `url_citation` extraction, prose-only citation rejection, `failed`/`incomplete` status,
  non-HTTPS rejection;
- evidence: immutable identity, unknown source id rejection, source-free claims;
- generation: direct and batched paths, truncation-driven batch halving, deterministic assembly,
  duplicate and missing id rejection, cross-batch rule references;
- validation: harness-approved drafts always pass the shared validator; the renderer blocks apply on
  failure;
- repository: new progress stages and transitions, run result with the new research status;
- integration: a full pipeline with injected transports proving the exact stage order, the
  literature-only status, and the absence of tools/API keys in captured bodies.

## References

- DeepSeek Responses API: https://api-docs.deepseek.com/api/create-response/
- DeepSeek Responses guide: https://api-docs.deepseek.com/guides/responses_api/
- NCBI E-utilities in depth: https://www.ncbi.nlm.nih.gov/books/NBK25499/
- NCBI E-utilities quick start: https://www.ncbi.nlm.nih.gov/books/NBK25500/
- Europe PMC REST reference: https://europepmc.org/RestfulWebService
- bioRxiv API: https://api.biorxiv.org/ and https://api.biorxiv.org/details/help
