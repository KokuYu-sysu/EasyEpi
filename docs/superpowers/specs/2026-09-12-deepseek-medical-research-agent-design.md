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
| Unit + coverage | `pnpm test:coverage` | 99 files, 1396 tests, all passing; 86.2% statements / 80.9% branches |
| Build | `pnpm build` | main, preload, renderer bundles built |
| Release gate | `pnpm check` | exit 0 |
| Unpackaged E2E | `pnpm test:e2e` | 14 passed |
| Packaged portable | `pnpm test:e2e:packaged` with `EASYEPI_EXECUTABLE` on `EasyEpi-0.8.0-portable-x64.exe` | 6 passed |
| Packaged unpacked | `pnpm test:e2e:packaged` with `EASYEPI_EXECUTABLE` on `release/win-unpacked/EasyEpi.exe` | 1 passed, 5 intentionally skipped |
| Artifacts | `pnpm build:win` | `EasyEpi-0.8.0-setup-x64.exe`, `EasyEpi-0.8.0-portable-x64.exe`, setup blockmap |

Artifacts copied to `D:\EasyEpi\release` from commit `44e4b36`:

| File | Size | SHA-256 |
| --- | --- | --- |
| `EasyEpi-0.8.0-setup-x64.exe` | 104,959,454 | `EAD559C314A39F26A678B6C5832FADA051A6D2E77FB6917D914C65C0C1C70870` |
| `EasyEpi-0.8.0-portable-x64.exe` | 104,741,400 | `5653E5B03240CEBA45A9C802BA6BF3DCEC0AD9B24B2E47D5202D71F59DE07FF6` |
| `EasyEpi-0.8.0-setup-x64.exe.blockmap` | 110,984 | `8C7F079FF0280E64F3F7060DDD172D379E56BFAF615B23EFA7048D723FF80447` |

## Protocol Hardening

Three request-shape risks were removed after the first real-world failure report:

- **No assistant turns are replayed.** Both bounded repair loops previously echoed the rejected answer
  as an `assistant` message. DeepSeek's reasoning models require an assistant message to carry its
  reasoning content (`requiresReasoningContentOnAssistantMessages`), so a bare replay can be rejected
  with a 400 and would convert a repairable rejection into a hard provider error. The previous answer
  is now embedded in the following user turn, and the whole pipeline is system/user only.
- **One combined user turn per generation request.** The blueprint instruction is folded into the same
  user message as the research payload instead of being sent as a second consecutive user message.
- **Generous output budgets.** The planner and evidence stages request 16,384 output tokens rather
  than 8,192, so a reasoning model's thinking cannot consume the budget and truncate the structured
  object. The bound is an upper limit, not a cost.

The packaged `app.asar` was inspected and contains `/node_modules/saxes`, its `xmlchars`
dependency, and every `out/main/services/research/*` bundle, so the PubMed XML parser and the
staged pipeline are present in the shipped application. Authenticode status is `NotSigned`
(no signing certificate is configured).

Not verified end to end: a real DeepSeek call. The build machine has no outbound network, so the
Responses `web_search` request shape and the planner's tolerance are proven only against injected
transports and the provider contracts recovered from the local `openai` SDK and DeepSeek model
catalogue.

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
  searchQueries: string[]      // 0..5, English
  keywords: string[]           // <= 20, English
  meshTerms: string[]          // <= 20, English
  population: string
  exposureOrIntervention: string
  outcomes: string[]
  riskFactors: Array<{ factor: string; label: string; category: string }>
  questionnaireDomains: Array<{ domain: string; items: string[] }>
}
```

**The plan is a factor inventory, not a search for a matching instrument.** The questionnaire is
built from `riskFactors` and `questionnaireDomains`; the search stages exist to attach evidence to
each factor separately. `riskFactors[].factor` and the search keys are English, while
`riskFactors[].label`, `questionnaireDomains[].domain` and `questionnaireDomains[].items` are in the
user's language because they become questionnaire text. This is what makes a broad request such as a
national chronic-disease survey workable: no published paper answers it, but the constructs are well
established.

The planner is a free-form JSON stage, so the parser normalizes rather than rejects. It tolerates
extra keys, missing keys, renamed keys, scalar-where-array, over-limit lists (truncated), an unknown
or absent `domain` (resolved to `medical`), and non-English text in the free-form fields — a model
that answers in the user's language is translated or worked around downstream, not discarded. Only an
object carrying no query, no keyword and no factor at all is rejected as
`AI_RESEARCH_PLAN_INVALID`, after one bounded repair attempt. The earlier exact-key and
English-only checks were the source of a false `AI_RESEARCH_PLAN_INVALID` on ordinary Chinese
requests; that is a deliberate removal, not a relaxation of safety.

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

The model receives the normalized sources, the planner's factor inventory, and the recommended
domains as untrusted quoted data, and returns a factor-by-factor mapping:

```ts
interface ResearchEvidence {
  researchQuestion: string
  factors: Array<{
    factor: string
    label: string
    category: string
    evidence: 'supported' | 'contextual' | 'none'
    sourceIds: string[]
    note: string
  }>
  questionnaireDomains: Array<{ domain: string; items: string[] }>
  limitations: string[]
  sources: Array<{ sourceId: string; title: string; url: string }>
}
```

`evidence: 'none'` with an empty `sourceIds` list is a first-class, expected outcome: it means the
factor is standard practice for this topic but no retrieved record supported it. The extractor is
instructed to return an entry for every inventory factor and to mark the unsupported ones rather than
dropping them or inventing a source. This is the mechanism that lets a questionnaire be built from a
factor inventory instead of requiring one retrieved paper whose instrument already matches.

Local validation still runs against the caller-owned source inventory: unknown source ids, mutated
identity, and duplicate identities are rejected for every cited id, and accepted sources are replaced
with clones of the original records, so the model cannot invent or edit source identity. A blueprint
with no factors and no domains is the only shape rejected as `AI_EVIDENCE_INVALID`.

### 5. Generation

Questionnaire generation stays on Chat Completions with
`response_format: { "type": "json_object" }` and no tools. The system prompt carries the exact
envelope contract and a compact example.

Every generation turn also receives two synthetic messages after the research context: the blueprint
(factor inventory, recommended domains, evidence, retrieval notes) and a fixed instruction telling the
model to build from that blueprint, to use evidence where a factor carries `sourceIds`, to include
factors marked `evidence: "none"` as standard items rather than assertions, and explicitly **not** to
reproduce one specific published questionnaire.

Size handling: a single structured request is used with an output-token bound of 65,536. DeepSeek's
current catalogue serves up to 384,000 output tokens, so batching was deliberately not implemented —
it would add assembly complexity for a range that a single response already covers. A `finish_reason`
of `length`/`max_tokens` (or an `incomplete` Responses status) maps to `AI_RESPONSE_TRUNCATED`, which
the orchestrator turns into one bounded repair asking for a more compact envelope rather than a
terminal failure.

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
| Planning unusable | One repair with bounded codes/paths, then `AI_RESEARCH_PLAN_INVALID`. Only an object with no query, keyword, or factor reaches this. |
| PubMed network | Two bounded retries, then literature degrades to empty. |
| PubMed all queries empty | The literal query, the MeSH query, and the Title/Abstract query have all been tried; literature degrades to empty, not an error. |
| Europe PMC / preprint failure | Literature keeps PubMed results and records a diagnostic. |
| Web search unsupported or failed | The run continues with whatever literature supplied, or with none; the reason is recorded in the retrieval notes. |
| No usable source at all | The questionnaire is still built from the planner's factor inventory via `knowledgeOnlyEvidence()`, every factor marked `evidence: "none"`, with no citations and the reason stated in the assistant message. This is **not** a hard stop. |
| Evidence identity mismatch | Retry extraction once, then `AI_EVIDENCE_INVALID`. |
| Output truncated | One bounded repair asking for a more compact envelope, then `AI_RESPONSE_TRUNCATED`. |
| Harness rejection | Up to three attempts with bounded repair instructions. |
| Cancellation | Abort active work, keep completed checkpoints, mark `AI_CANCELLED`. |

**Why an empty retrieval is no longer fatal.** The first shipped policy stopped a medical run when
literature and web search both returned nothing. In practice that made the feature unusable for
exactly the requests it exists for: a broad national survey such as a Chinese older-adult
chronic-disease questionnaire has no single retrievable paper that answers it, so the pipeline
reliably retrieved nothing and refused to produce anything. The factor inventory is the blueprint, and
evidence is an enrichment of it, not a precondition. When retrieval is empty the run produces a
questionnaire from that blueprint and says so plainly.

The assistant message never claims a search happened unless evidence was actually retrieved. When no
evidence was used, the disclaimer is emitted together with the per-stage retrieval notes:

> 【本次未检索到外部证据】已根据该主题的常规流行病学要素与当前对话生成问卷；未使用或核验任何外部来源，请务必人工核对。
> 检索情况：PubMed / Europe PMC 未返回可用记录… 当前模型不支持内置联网搜索…

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
