/**
 * Internal contracts for the staged research pipeline.
 *
 * Every external value crosses one of the parsers in this module before it can influence a model
 * request. The parsers are exact-key, bounded, and they never accept source identity that the
 * retriever did not produce.
 */

export const RESEARCH_LIMITS = Object.freeze({
  maxQueries: 3,
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
  maxClaims: 30,
  maxClaimLength: 1_000,
  maxRecommendations: 20,
  maxLimitations: 10
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

export interface EvidenceClaim {
  claim: string
  sourceIds: string[]
  strength: 'low' | 'medium' | 'high'
}

export interface EvidenceSourceRef {
  sourceId: string
  title: string
  url: string
}

export interface ResearchEvidence {
  researchQuestion: string
  claims: EvidenceClaim[]
  questionnaireRecommendations: string[]
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

export function parseResearchPlan(value: unknown): ResearchPlan {
  if (!isPlainRecord(value)) reject('AI_RESEARCH_PLAN_INVALID')
  if (!hasExactKeys(value, [
    'originalLanguage', 'englishResearchQuestion', 'domain', 'searchQueries',
    'keywords', 'meshTerms', 'population', 'exposureOrIntervention', 'outcomes'
  ])) reject('AI_RESEARCH_PLAN_INVALID')

  const originalLanguage = boundedString(value.originalLanguage, RESEARCH_LIMITS.maxShortTextLength)
  const englishResearchQuestion = boundedString(
    value.englishResearchQuestion,
    RESEARCH_LIMITS.maxQueryLength
  )
  const domain = value.domain
  const searchQueries = boundedStringArray(value.searchQueries, RESEARCH_LIMITS.maxQueries, RESEARCH_LIMITS.maxQueryLength)
  const keywords = boundedStringArray(value.keywords, RESEARCH_LIMITS.maxKeywords, RESEARCH_LIMITS.maxShortTextLength)
  const meshTerms = boundedStringArray(value.meshTerms, RESEARCH_LIMITS.maxMeshTerms, RESEARCH_LIMITS.maxShortTextLength)
  const population = boundedString(value.population, RESEARCH_LIMITS.maxTextLength, true)
  const exposureOrIntervention = boundedString(value.exposureOrIntervention, RESEARCH_LIMITS.maxTextLength, true)
  const outcomes = boundedStringArray(value.outcomes, RESEARCH_LIMITS.maxOutcomes, RESEARCH_LIMITS.maxTextLength, true)

  if (originalLanguage === undefined || englishResearchQuestion === undefined ||
    (domain !== 'medical' && domain !== 'non_medical') ||
    searchQueries === undefined || searchQueries.length === 0 ||
    keywords === undefined || meshTerms === undefined ||
    population === undefined || exposureOrIntervention === undefined || outcomes === undefined) {
    reject('AI_RESEARCH_PLAN_INVALID')
  }

  // Search inputs must be English: the PubMed and Europe PMC indexes are English-first, and a
  // non-English query silently returns unrelated records.
  if (/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(englishResearchQuestion) ||
    searchQueries.some((query) => /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(query))) {
    reject('AI_RESEARCH_PLAN_INVALID')
  }

  return {
    originalLanguage,
    englishResearchQuestion,
    domain,
    searchQueries: [...new Set(searchQueries)],
    keywords,
    meshTerms,
    population,
    exposureOrIntervention,
    outcomes
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
  if (!hasExactKeys(
    value,
    ['researchQuestion', 'claims', 'questionnaireRecommendations', 'limitations', 'sources']
  )) reject('AI_EVIDENCE_INVALID')

  const researchQuestion = boundedString(value.researchQuestion, RESEARCH_LIMITS.maxQueryLength)
  const limitations = boundedStringArray(value.limitations, RESEARCH_LIMITS.maxLimitations, RESEARCH_LIMITS.maxTextLength, true)
  const recommendations = boundedStringArray(
    value.questionnaireRecommendations,
    RESEARCH_LIMITS.maxRecommendations,
    RESEARCH_LIMITS.maxTextLength,
    true
  )
  if (researchQuestion === undefined || limitations === undefined || recommendations === undefined) {
    reject('AI_EVIDENCE_INVALID')
  }
  if (!Array.isArray(value.claims) || value.claims.length === 0 ||
    value.claims.length > RESEARCH_LIMITS.maxClaims) {
    reject('AI_EVIDENCE_INVALID')
  }

  const byId = new Map(availableSources.map((source) => [source.sourceId, source]))
  const referenced = new Set<string>()
  const claims: EvidenceClaim[] = []
  for (const rawClaim of value.claims) {
    if (!isPlainRecord(rawClaim) || !hasExactKeys(rawClaim, ['claim', 'sourceIds', 'strength'])) {
      reject('AI_EVIDENCE_INVALID')
    }
    const claim = boundedString(rawClaim.claim, RESEARCH_LIMITS.maxClaimLength)
    const strength = rawClaim.strength
    const ids = boundedStringArray(rawClaim.sourceIds, RESEARCH_LIMITS.maxSources, 2_048)
    if (claim === undefined || ids === undefined || ids.length === 0 ||
      (strength !== 'low' && strength !== 'medium' && strength !== 'high')) {
      reject('AI_EVIDENCE_INVALID')
    }
    for (const id of ids) {
      if (!byId.has(id)) reject('AI_EVIDENCE_INVALID')
      referenced.add(id)
    }
    claims.push({ claim, sourceIds: [...new Set(ids)], strength })
  }

  if (!Array.isArray(value.sources) || value.sources.length > RESEARCH_LIMITS.maxSources) {
    reject('AI_EVIDENCE_INVALID')
  }
  const seen = new Set<string>()
  const sources: EvidenceSourceRef[] = []
  for (const rawSource of value.sources) {
    if (!isPlainRecord(rawSource) || !hasExactKeys(rawSource, ['sourceId', 'title', 'url'])) {
      reject('AI_EVIDENCE_INVALID')
    }
    const sourceId = boundedString(rawSource.sourceId, 2_048)
    const original = sourceId === undefined ? undefined : byId.get(sourceId)
    // Source identity is immutable: title and url must be byte-identical to the retrieved record.
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

  return {
    researchQuestion,
    claims,
    questionnaireRecommendations: recommendations,
    limitations,
    sources
  }
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
