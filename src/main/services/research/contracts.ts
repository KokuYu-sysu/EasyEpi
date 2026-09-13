/**
 * Internal contracts for the staged research pipeline.
 *
 * Every external value crosses one of the parsers in this module before it can influence a model
 * request. The parsers are exact-key, bounded, and they never accept source identity that the
 * retriever did not produce.
 */

export const RESEARCH_LIMITS = Object.freeze({
  maxQueries: 5,
  maxKeywords: 20,
  maxMeshTerms: 20,
  maxOutcomes: 10,
  maxShortTextLength: 200,
  maxTextLength: 2_000,
  maxQueryLength: 500,
  maxSources: 20,
  maxAbstractChars: 6_000,
  maxAuthors: 20,
  maxAuthorLength: 200,
  maxTitleLength: 1_000,
  maxJournalLength: 300,
  maxSnippetChars: 1_200,
  maxClaimLength: 1_000,
  maxLimitations: 10,
  maxFactors: 40,
  maxDomains: 20,
  maxDomainItems: 15
})

export type ResearchDomain = 'medical' | 'non_medical'
export type ResearchStageName = 'planning' | 'literature' | 'web_search' | 'extracting'
export type ResearchOutcome =
  | 'success'
  | 'empty'
  | 'unsupported'
  | 'invalid'
  | 'truncated'
  | 'failed'
  | 'skipped'

/**
 * One candidate risk factor, exposure, or physiological characteristic the questionnaire should cover.
 * `factor` is the English retrieval key; `label` stays in the user's language so the generated
 * questionnaire reads naturally. The questionnaire is built from this inventory plus whatever
 * evidence the retrieval stages can bind to it — not by reproducing any single published instrument.
 */
export interface ResearchPlanFactor {
  factor: string
  label: string
  category: string
}

/** A questionnaire section the model recommends, with concrete item hints. */
export interface ResearchPlanDomain {
  domain: string
  items: string[]
}

export interface ResearchPlan {
  originalLanguage: string
  englishResearchQuestion: string
  domain: ResearchDomain
  searchQueries: string[]
  keywords: string[]
  meshTerms: string[]
  population: string
  exposureOrIntervention: string
  outcomes: string[]
  riskFactors: ResearchPlanFactor[]
  questionnaireDomains: ResearchPlanDomain[]
}

/**
 * Retrieval result. `pubmed` records come from NCBI E-utilities; `epmc` records come from Europe PMC,
 * which is the only public keyword index over bioRxiv and medRxiv preprints. `server` is set when the
 * record was confirmed to be a preprint on one of those two servers.
 */
export interface LiteratureSource {
  sourceId: string
  kind: 'pubmed' | 'epmc'
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
  /** True when the bioRxiv/medRxiv details API confirmed the DOI and metadata. */
  preprintVerified?: boolean
}

export interface WebSource {
  sourceId: string
  kind: 'web'
  title: string
  url: string
  snippet: string
}

export type ResearchSource = LiteratureSource | WebSource

/**
 * One factor carried into questionnaire design, with whatever evidence the retrieval stages could
 * bind to it. `evidence: 'none'` is a first-class outcome: it means the factor is standard practice
 * for this topic but no retrieved record supported it, so the questionnaire must not present it as
 * evidence-backed. This is what lets a questionnaire be built from a factor inventory instead of
 * requiring one retrieved paper that already contains a matching instrument.
 */
export interface EvidenceFactor {
  factor: string
  label: string
  category: string
  evidence: 'supported' | 'contextual' | 'none'
  sourceIds: string[]
  note: string
}

export interface EvidenceSourceRef {
  sourceId: string
  title: string
  url: string
}

export interface ResearchEvidence {
  researchQuestion: string
  factors: EvidenceFactor[]
  questionnaireDomains: ResearchPlanDomain[]
  limitations: string[]
  sources: EvidenceSourceRef[]
}

export interface ResearchDiagnostic {
  stage: ResearchStageName
  protocol: 'chat' | 'responses' | 'pubmed-esearch' | 'pubmed-efetch' | 'europepmc' | 'biorxiv'
  outcome: ResearchOutcome
  status?: number
  sourceCount?: number
  retryCount?: number
  errorCode?: string
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

export function hasExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = []
): boolean {
  const allowed = new Set([...required, ...optional])
  return required.every((key) => Object.prototype.hasOwnProperty.call(value, key)) &&
    Object.keys(value).every((key) => allowed.has(key))
}

function boundedString(value: unknown, maxLength: number, allowEmpty = false): string | undefined {
  if (typeof value !== 'string') return undefined
  if (value.length > maxLength) return undefined
  if (!allowEmpty && value.trim().length === 0) return undefined
  return value
}

function boundedStringArray(
  value: unknown,
  maxItems: number,
  maxLength: number,
  allowEmpty = false
): string[] | undefined {
  if (!Array.isArray(value) || value.length > maxItems) return undefined
  const result: string[] = []
  for (const item of value) {
    const text = boundedString(item, maxLength, allowEmpty)
    if (text === undefined) return undefined
    result.push(text.trim())
  }
  return result
}

function httpsUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2_048) return undefined
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username.length > 0 || url.password.length > 0) return undefined
    return url.toString()
  } catch {
    return undefined
  }
}

export class ResearchContractError extends Error {
  constructor(readonly errorCode: string) {
    super(errorCode)
    this.name = 'ResearchContractError'
  }
}

function reject(errorCode: string): never {
  throw new ResearchContractError(errorCode)
}

/**
 * The planner is a free-form JSON stage, not a schema-constrained one: DeepSeek's `json_object` mode
 * does not enforce a schema, and a model that adds a helpful extra key or answers in the user's
 * language is not wrong. This parser therefore normalizes instead of rejecting, and only fails when
 * the object carries nothing that could drive a search or a questionnaire at all.
 */
const CJK_PATTERN = /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/

export function hasCjkText(value: string): boolean {
  return CJK_PATTERN.test(value)
}

function textOrUndefined(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > maxLength) return undefined
  return trimmed
}

function firstDefined(record: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) return record[key]
  }
  return undefined
}

/** Accepts a single string or an array of strings, dropping unusable entries and truncating extras. */
function coerceStringList(value: unknown, maxItems: number, maxLength: number): string[] {
  const raw = typeof value === 'string' ? [value] : Array.isArray(value) ? value : []
  const result: string[] = []
  for (const item of raw) {
    const text = textOrUndefined(item, maxLength)
    if (text === undefined || result.includes(text)) continue
    result.push(text)
    if (result.length >= maxItems) break
  }
  return result
}

function coerceDomain(value: unknown): ResearchDomain {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (text.length === 0) return 'medical'
  if (/non[\s_-]*medical|not[\s_-]*medical|\bother\b|\bgeneral\b|非医学|非医疗|其他/.test(text)) {
    return 'non_medical'
  }
  return 'medical'
}

function coerceFactors(value: unknown): ResearchPlanFactor[] {
  const raw = Array.isArray(value) ? value : []
  const factors: ResearchPlanFactor[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    const record = isPlainRecord(item) ? item : undefined
    const factor = record === undefined
      ? textOrUndefined(item, RESEARCH_LIMITS.maxShortTextLength)
      : textOrUndefined(firstDefined(record, ['factor', 'name', 'key', 'riskFactor']), RESEARCH_LIMITS.maxShortTextLength)
    if (factor === undefined) continue
    const key = factor.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    const label = (record === undefined
      ? undefined
      : textOrUndefined(firstDefined(record, ['label', 'displayName', 'chinese', 'name']), RESEARCH_LIMITS.maxTextLength)) ?? factor
    const category = (record === undefined
      ? undefined
      : textOrUndefined(firstDefined(record, ['category', 'group', 'type']), RESEARCH_LIMITS.maxShortTextLength)) ?? ''
    factors.push({ factor, label, category })
    if (factors.length >= RESEARCH_LIMITS.maxFactors) break
  }
  return factors
}

function coerceDomains(value: unknown): ResearchPlanDomain[] {
  const raw = Array.isArray(value) ? value : []
  const domains: ResearchPlanDomain[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    const record = isPlainRecord(item) ? item : undefined
    const domain = record === undefined
      ? textOrUndefined(item, RESEARCH_LIMITS.maxTextLength)
      : textOrUndefined(firstDefined(record, ['domain', 'name', 'section', 'title']), RESEARCH_LIMITS.maxTextLength)
    if (domain === undefined || seen.has(domain)) continue
    seen.add(domain)
    const items = record === undefined
      ? []
      : coerceStringList(
          firstDefined(record, ['items', 'examples', 'exampleItems', 'questions']),
          RESEARCH_LIMITS.maxDomainItems,
          RESEARCH_LIMITS.maxTextLength
        )
    domains.push({ domain, items })
    if (domains.length >= RESEARCH_LIMITS.maxDomains) break
  }
  return domains
}

export function parseResearchPlan(value: unknown): ResearchPlan {
  if (!isPlainRecord(value)) reject('AI_RESEARCH_PLAN_INVALID')

  const originalLanguage =
    textOrUndefined(firstDefined(value, ['originalLanguage', 'language', 'lang']), RESEARCH_LIMITS.maxShortTextLength) ??
    'unknown'
  const englishResearchQuestion = textOrUndefined(
    firstDefined(value, ['englishResearchQuestion', 'researchQuestion', 'topic', 'question']),
    RESEARCH_LIMITS.maxQueryLength
  )
  const population =
    textOrUndefined(firstDefined(value, ['population', 'studyPopulation', 'subjects']), RESEARCH_LIMITS.maxTextLength) ?? ''
  const exposureOrIntervention = textOrUndefined(
    firstDefined(value, ['exposureOrIntervention', 'exposure', 'intervention']),
    RESEARCH_LIMITS.maxTextLength
  ) ?? ''
  const outcomes = coerceStringList(value.outcomes, RESEARCH_LIMITS.maxOutcomes, RESEARCH_LIMITS.maxTextLength)
  const keywords = coerceStringList(value.keywords, RESEARCH_LIMITS.maxKeywords, RESEARCH_LIMITS.maxShortTextLength)
  const meshTerms = coerceStringList(
    firstDefined(value, ['meshTerms', 'mesh']),
    RESEARCH_LIMITS.maxMeshTerms,
    RESEARCH_LIMITS.maxShortTextLength
  )
  const riskFactors = coerceFactors(firstDefined(value, ['riskFactors', 'factors', 'determinants']))
  const questionnaireDomains = coerceDomains(
    firstDefined(value, ['questionnaireDomains', 'domains', 'sections'])
  )
  const searchQueries = coerceStringList(
    firstDefined(value, ['searchQueries', 'queries']),
    RESEARCH_LIMITS.maxQueries,
    RESEARCH_LIMITS.maxQueryLength
  )

  const topic = englishResearchQuestion ?? keywords[0] ?? meshTerms[0] ?? riskFactors[0]?.factor ?? ''
  if (topic.length === 0 && searchQueries.length === 0 && keywords.length === 0 &&
    meshTerms.length === 0 && riskFactors.length === 0) {
    reject('AI_RESEARCH_PLAN_INVALID')
  }

  return {
    originalLanguage,
    englishResearchQuestion: englishResearchQuestion ?? topic,
    domain: coerceDomain(firstDefined(value, ['domain', 'researchDomain', 'field'])),
    searchQueries,
    keywords,
    meshTerms,
    population,
    exposureOrIntervention,
    outcomes,
    riskFactors,
    questionnaireDomains
  }
}

export function parseLiteratureSource(value: unknown): LiteratureSource {
  if (!isPlainRecord(value)) reject('AI_RESEARCH_SOURCE_INVALID')
  if (!hasExactKeys(
    value,
    ['sourceId', 'kind', 'title', 'abstract', 'authors', 'url', 'publicationTypes'],
    ['server', 'journal', 'year', 'doi', 'pmid', 'preprintVerified']
  )) reject('AI_RESEARCH_SOURCE_INVALID')

  const sourceId = boundedString(value.sourceId, 2_048)
  const kind = value.kind
  const title = boundedString(value.title, RESEARCH_LIMITS.maxTitleLength)
  const abstract = typeof value.abstract === 'string' && value.abstract.length <= RESEARCH_LIMITS.maxAbstractChars
    ? value.abstract
    : undefined
  const authors = boundedStringArray(value.authors, RESEARCH_LIMITS.maxAuthors, RESEARCH_LIMITS.maxAuthorLength, true)
  const url = httpsUrl(value.url)
  const publicationTypes = boundedStringArray(value.publicationTypes, 20, RESEARCH_LIMITS.maxJournalLength, true)
  const server = value.server
  const journal = value.journal === undefined
    ? undefined
    : boundedString(value.journal, RESEARCH_LIMITS.maxJournalLength)
  const year = value.year === undefined ? undefined : value.year
  const doi = value.doi === undefined ? undefined : boundedString(value.doi, 300)
  const pmid = value.pmid === undefined ? undefined : boundedString(value.pmid, 32)
  const preprintVerified = value.preprintVerified === undefined ? undefined : value.preprintVerified

  if (sourceId === undefined || (kind !== 'pubmed' && kind !== 'epmc') || title === undefined ||
    abstract === undefined || authors === undefined || url === undefined ||
    publicationTypes === undefined) {
    reject('AI_RESEARCH_SOURCE_INVALID')
  }
  if (!sourceId.startsWith(kind === 'pubmed' ? 'pubmed:' : 'epmc:')) reject('AI_RESEARCH_SOURCE_INVALID')
  if (server !== undefined && server !== 'bioRxiv' && server !== 'medRxiv') reject('AI_RESEARCH_SOURCE_INVALID')
  if (journal === undefined && value.journal !== undefined) reject('AI_RESEARCH_SOURCE_INVALID')
  if (doi === undefined && value.doi !== undefined) reject('AI_RESEARCH_SOURCE_INVALID')
  if (pmid === undefined && value.pmid !== undefined) reject('AI_RESEARCH_SOURCE_INVALID')
  if (year !== undefined && (!Number.isSafeInteger(year) || Number(year) < 1800 || Number(year) > 2200)) {
    reject('AI_RESEARCH_SOURCE_INVALID')
  }
  if (preprintVerified !== undefined && typeof preprintVerified !== 'boolean') {
    reject('AI_RESEARCH_SOURCE_INVALID')
  }

  return {
    sourceId,
    kind,
    title,
    abstract,
    authors,
    url,
    publicationTypes,
    ...(server === undefined ? {} : { server }),
    ...(journal === undefined ? {} : { journal }),
    ...(year === undefined ? {} : { year: Number(year) }),
    ...(doi === undefined ? {} : { doi }),
    ...(pmid === undefined ? {} : { pmid }),
    ...(preprintVerified === undefined ? {} : { preprintVerified })
  }
}

export function parseWebSource(value: unknown): WebSource {
  if (!isPlainRecord(value)) reject('AI_RESEARCH_SOURCE_INVALID')
  if (!hasExactKeys(value, ['sourceId', 'kind', 'title', 'url', 'snippet'])) {
    reject('AI_RESEARCH_SOURCE_INVALID')
  }
  const sourceId = boundedString(value.sourceId, 2_048)
  const title = boundedString(value.title, RESEARCH_LIMITS.maxTitleLength)
  const url = httpsUrl(value.url)
  const snippet = typeof value.snippet === 'string' && value.snippet.length <= RESEARCH_LIMITS.maxSnippetChars
    ? value.snippet
    : undefined
  if (value.kind !== 'web' || sourceId === undefined || title === undefined ||
    url === undefined || snippet === undefined || !sourceId.startsWith('web:')) {
    reject('AI_RESEARCH_SOURCE_INVALID')
  }
  return { sourceId, kind: 'web', title, url, snippet }
}

export function parseResearchSource(value: unknown): ResearchSource {
  if (!isPlainRecord(value)) reject('AI_RESEARCH_SOURCE_INVALID')
  return value.kind === 'web' ? parseWebSource(value) : parseLiteratureSource(value)
}

export function parseResearchEvidence(
  value: unknown,
  availableSources: readonly ResearchSource[]
): ResearchEvidence {
  if (!isPlainRecord(value)) reject('AI_EVIDENCE_INVALID')

  const researchQuestion =
    textOrUndefined(firstDefined(value, ['researchQuestion', 'topic']), RESEARCH_LIMITS.maxQueryLength) ?? ''
  const limitations = coerceStringList(value.limitations, RESEARCH_LIMITS.maxLimitations, RESEARCH_LIMITS.maxTextLength)
  const questionnaireDomains = coerceDomains(
    firstDefined(value, ['questionnaireDomains', 'domains', 'sections'])
  )

  const byId = new Map(availableSources.map((source) => [source.sourceId, source]))
  const referenced = new Set<string>()
  const rawFactors = firstDefined(value, ['factors', 'riskFactors', 'determinants'])
  const factors: EvidenceFactor[] = []
  const seenFactors = new Set<string>()
  for (const rawFactor of Array.isArray(rawFactors) ? rawFactors : []) {
    const record = isPlainRecord(rawFactor) ? rawFactor : undefined
    if (record === undefined) continue
    const factor = textOrUndefined(
      firstDefined(record, ['factor', 'name', 'key']),
      RESEARCH_LIMITS.maxShortTextLength
    )
    if (factor === undefined) continue
    const key = factor.toLowerCase()
    if (seenFactors.has(key)) continue
    seenFactors.add(key)
    const ids = coerceStringList(record.sourceIds, RESEARCH_LIMITS.maxSources, 2_048)
    // Source identity is immutable: a cited id must exist in the retrieved inventory.
    for (const id of ids) {
      if (!byId.has(id)) reject('AI_EVIDENCE_INVALID')
      referenced.add(id)
    }
    const declared = record.evidence
    const evidence: EvidenceFactor['evidence'] = ids.length === 0
      ? 'none'
      : declared === 'supported' ? 'supported' : 'contextual'
    factors.push({
      factor,
      label: textOrUndefined(firstDefined(record, ['label', 'displayName']), RESEARCH_LIMITS.maxTextLength) ?? factor,
      category: textOrUndefined(firstDefined(record, ['category', 'group']), RESEARCH_LIMITS.maxShortTextLength) ?? '',
      evidence,
      sourceIds: [...new Set(ids)],
      note: textOrUndefined(firstDefined(record, ['note', 'rationale', 'reason']), RESEARCH_LIMITS.maxClaimLength) ?? ''
    })
    if (factors.length >= RESEARCH_LIMITS.maxFactors) break
  }

  if (factors.length === 0 && questionnaireDomains.length === 0) reject('AI_EVIDENCE_INVALID')

  const rawSources = Array.isArray(value.sources) ? value.sources : []
  if (rawSources.length > RESEARCH_LIMITS.maxSources) reject('AI_EVIDENCE_INVALID')
  const seen = new Set<string>()
  const sources: EvidenceSourceRef[] = []
  for (const rawSource of rawSources) {
    if (!isPlainRecord(rawSource)) reject('AI_EVIDENCE_INVALID')
    const sourceId = textOrUndefined(rawSource.sourceId, 2_048)
    const original = sourceId === undefined ? undefined : byId.get(sourceId)
    // Title and url must be byte-identical to the retrieved record, so the model cannot rewrite them.
    if (original === undefined || seen.has(original.sourceId) ||
      rawSource.title !== original.title || rawSource.url !== original.url) {
      reject('AI_EVIDENCE_INVALID')
    }
    seen.add(original.sourceId)
    sources.push({ sourceId: original.sourceId, title: original.title, url: original.url })
  }
  for (const id of referenced) {
    if (!seen.has(id)) reject('AI_EVIDENCE_INVALID')
  }

  return { researchQuestion, factors, questionnaireDomains, limitations, sources }
}

export function parseResearchDiagnostic(value: unknown): ResearchDiagnostic {
  if (!isPlainRecord(value)) reject('AI_RESEARCH_DIAGNOSTIC_INVALID')
  if (!hasExactKeys(value, ['stage', 'protocol', 'outcome'], [
    'status', 'sourceCount', 'retryCount', 'errorCode'
  ])) reject('AI_RESEARCH_DIAGNOSTIC_INVALID')
  const stage = value.stage
  const protocol = value.protocol
  const outcome = value.outcome
  if ((stage !== 'planning' && stage !== 'literature' && stage !== 'web_search' && stage !== 'extracting') ||
    (protocol !== 'chat' && protocol !== 'responses' && protocol !== 'pubmed-esearch' &&
      protocol !== 'pubmed-efetch' && protocol !== 'europepmc' && protocol !== 'biorxiv') ||
    (outcome !== 'success' && outcome !== 'empty' && outcome !== 'unsupported' &&
      outcome !== 'invalid' && outcome !== 'truncated' && outcome !== 'failed' && outcome !== 'skipped')) {
    reject('AI_RESEARCH_DIAGNOSTIC_INVALID')
  }
  const { status, sourceCount, retryCount, errorCode } = value
  if (status !== undefined && (!Number.isSafeInteger(status) || Number(status) < 100 || Number(status) > 599)) {
    reject('AI_RESEARCH_DIAGNOSTIC_INVALID')
  }
  if (sourceCount !== undefined && (!Number.isSafeInteger(sourceCount) || Number(sourceCount) < 0)) {
    reject('AI_RESEARCH_DIAGNOSTIC_INVALID')
  }
  if (retryCount !== undefined && (!Number.isSafeInteger(retryCount) || Number(retryCount) < 0 || Number(retryCount) > 5)) {
    reject('AI_RESEARCH_DIAGNOSTIC_INVALID')
  }
  if (errorCode !== undefined && (typeof errorCode !== 'string' || !/^[A-Z][A-Z0-9_]{1,127}$/.test(errorCode))) {
    reject('AI_RESEARCH_DIAGNOSTIC_INVALID')
  }
  return {
    stage,
    protocol,
    outcome,
    ...(status === undefined ? {} : { status: Number(status) }),
    ...(sourceCount === undefined ? {} : { sourceCount: Number(sourceCount) }),
    ...(retryCount === undefined ? {} : { retryCount: Number(retryCount) }),
    ...(errorCode === undefined ? {} : { errorCode })
  }
}
