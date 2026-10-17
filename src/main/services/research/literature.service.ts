import {
  RESEARCH_LIMITS,
  type LiteratureSource,
  type ResearchDiagnostic,
  type ResearchPlan
} from './contracts'
import type { EuropePmcClient } from './europepmc.client'
import type { PreprintClient } from './preprint.client'
import type { PubMedClient } from './pubmed.client'

export interface LiteratureSearchRequest {
  plan: ResearchPlan
  /** Carries the optional NCBI API key through to the E-utilities requests. */
  config?: { ncbiApiKey?: string }
  signal?: AbortSignal
}

export interface LiteratureSearchResult {
  sources: LiteratureSource[]
  diagnostics: ResearchDiagnostic[]
}

export interface AILiteratureService {
  search(request: LiteratureSearchRequest): Promise<LiteratureSearchResult>
}

export interface AILiteratureServiceDependencies {
  pubmed?: PubMedClient
  europePmc?: EuropePmcClient
  preprint?: PreprintClient
  maxPreprintLookups?: number
}

const DEFAULT_MAX_PREPRINT_LOOKUPS = 5
const CJK_PATTERN = /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/

function englishOnly(values: readonly string[]): string[] {
  return values.filter((value) => value.length > 0 && !CJK_PATTERN.test(value))
}

/** De-duplicates before slot budgeting, so a repeated query does not waste a search slot. */
function unique(values: readonly string[]): string[] {
  return [...new Set(values)]
}

/**
 * PubMed and Europe PMC are English-first indexes: a non-English query silently returns unrelated
 * records, and a single over-narrow free-text query can return nothing at all. The planner's own
 * queries are used first, then a MeSH query and a Title/Abstract query built from the plan's terms so
 * a broad topic such as "chronic disease in the elderly" still retrieves records.
 */
export function buildPubMedQueries(plan: ResearchPlan): string[] {
  const queries: string[] = []
  const push = (query: string): void => {
    const trimmed = query.trim()
    if (trimmed.length === 0 || trimmed.length > RESEARCH_LIMITS.maxQueryLength) return
    if (queries.includes(trimmed)) return
    queries.push(trimmed)
  }

  for (const query of unique(englishOnly(plan.searchQueries)).slice(0, 3)) push(query)

  const mesh = unique(englishOnly(plan.meshTerms)).slice(0, 3)
  if (mesh.length > 0) push(mesh.map((term) => `${term}[MeSH Terms]`).join(' AND '))

  const keywords = unique(englishOnly(plan.keywords)).slice(0, 3)
  if (keywords.length > 0) push(keywords.map((term) => `${term}[Title/Abstract]`).join(' AND '))

  for (const factor of unique(englishOnly(plan.riskFactors.map(({ factor: name }) => name))).slice(0, 2)) {
    push(`${factor}[Title/Abstract]`)
  }
  return queries.slice(0, RESEARCH_LIMITS.maxQueries)
}

/** Europe PMC gets the model's queries plus one keyword query, capped by the shared query limit. */
export function buildPreprintQueries(plan: ResearchPlan): string[] {
  const queries: string[] = []
  const push = (query: string): void => {
    const trimmed = query.trim()
    if (trimmed.length === 0 || queries.includes(trimmed)) return
    queries.push(trimmed)
  }
  for (const query of unique(englishOnly(plan.searchQueries)).slice(0, 2)) push(query)
  const keywords = unique(englishOnly(plan.keywords)).slice(0, 3)
  if (keywords.length > 0) push(keywords.join(' AND '))
  const factors = unique(englishOnly(plan.riskFactors.map(({ factor: name }) => name))).slice(0, 1)
  for (const factor of factors) push(factor)
  return queries.slice(0, RESEARCH_LIMITS.maxQueries)
}

function normalizeDoi(doi: string | undefined): string | undefined {
  if (doi === undefined) return undefined
  const trimmed = doi.trim().toLowerCase().replace(/^https?:\/\/(?:dx\.)?doi\.org\//, '')
  return trimmed.length === 0 ? undefined : trimmed
}

/**
 * Merges the two literature providers. PubMed records win on DOI collisions because NCBI supplies the
 * indexed publication rather than the preprint, and preprint-server enrichment is applied last so the
 * landing URL and version come from the server that actually hosts the record.
 */
function mergeSources(pubmed: readonly LiteratureSource[], preprint: readonly LiteratureSource[]): LiteratureSource[] {
  const seenDoi = new Set<string>()
  const seenId = new Set<string>()
  const merged: LiteratureSource[] = []
  for (const source of [...pubmed, ...preprint]) {
    if (seenId.has(source.sourceId)) continue
    const doi = normalizeDoi(source.doi)
    if (doi !== undefined && seenDoi.has(doi)) continue
    seenId.add(source.sourceId)
    if (doi !== undefined) seenDoi.add(doi)
    merged.push(source)
    if (merged.length >= RESEARCH_LIMITS.maxSources) break
  }
  return merged
}

export function createAILiteratureService(
  dependencies: AILiteratureServiceDependencies = {}
): AILiteratureService {
  const maxPreprintLookups = dependencies.maxPreprintLookups ?? DEFAULT_MAX_PREPRINT_LOOKUPS

  async function enrichWithPreprintServer(
    sources: readonly LiteratureSource[],
    signal: AbortSignal | undefined,
    diagnostics: ResearchDiagnostic[]
  ): Promise<LiteratureSource[]> {
    const preprint = dependencies.preprint
    if (preprint === undefined) return [...sources]
    const enriched: LiteratureSource[] = []
    let lookups = 0
    for (const source of sources) {
      const doi = normalizeDoi(source.doi)
      if (source.server === undefined || doi === undefined || lookups >= maxPreprintLookups) {
        enriched.push(source)
        continue
      }
      lookups += 1
      const result = await preprint.lookup({ server: source.server, doi }, signal)
      diagnostics.push(result.diagnostic)
      const metadata = result.metadata
      if (metadata === undefined) {
        enriched.push(source)
        continue
      }
      enriched.push({
        ...source,
        title: metadata.title,
        authors: metadata.authors.length === 0 ? source.authors : metadata.authors,
        url: metadata.landingUrl,
        ...(metadata.year === undefined ? {} : { year: metadata.year }),
        preprintVerified: true
      })
    }
    return enriched
  }

  return {
    async search(request) {
      const diagnostics: ResearchDiagnostic[] = []
      const configuredKey = request.config?.ncbiApiKey?.trim()
      const ncbiApiKey = configuredKey === undefined || configuredKey.length === 0
        ? undefined
        : configuredKey
      if (request.plan.domain !== 'medical') {
        diagnostics.push({ stage: 'literature', protocol: 'pubmed-esearch', outcome: 'skipped' })
        return { sources: [], diagnostics }
      }

      let pubmedSources: LiteratureSource[] = []
      if (dependencies.pubmed !== undefined) {
        try {
          const result = await dependencies.pubmed.search({
            searchQueries: buildPubMedQueries(request.plan),
            meshTerms: request.plan.meshTerms,
            keywords: request.plan.keywords,
            ...(ncbiApiKey === undefined ? {} : { apiKey: ncbiApiKey })
          }, request.signal)
          pubmedSources = result.sources
          diagnostics.push(...result.diagnostics)
        } catch (error) {
          if (error instanceof Error && error.message === 'AI_CANCELLED') throw error
          const errorCode = error instanceof Error && /^[A-Z][A-Z0-9_]{1,127}$/.test(error.message)
            ? error.message
            : 'AI_PUBMED_UNAVAILABLE'
          diagnostics.push({
            stage: 'literature', protocol: 'pubmed-esearch', outcome: 'failed', errorCode
          })
        }
      }

      let preprintSources: LiteratureSource[] = []
      if (dependencies.europePmc !== undefined) {
        try {
          const result = await dependencies.europePmc.searchPreprints(
            { queries: buildPreprintQueries(request.plan) },
            request.signal
          )
          preprintSources = result.sources
          diagnostics.push(...result.diagnostics)
        } catch (error) {
          if (error instanceof Error && error.message === 'AI_CANCELLED') throw error
          diagnostics.push({
            stage: 'literature', protocol: 'europepmc', outcome: 'failed', errorCode: 'AI_RESEARCH_SOURCE_INVALID'
          })
        }
      }

      // PubMed E-utilities is the only stage that depends on reaching NCBI. When it comes back empty —
      // blocked, throttled, or genuinely no match — ask Europe PMC for the same MEDLINE record set,
      // which is served from a different host. Without this, an unreachable NCBI leaves the
      // questionnaire with nothing but preprints.
      if (pubmedSources.length === 0 && dependencies.europePmc?.searchMedline !== undefined) {
        try {
          const result = await dependencies.europePmc.searchMedline(
            { queries: buildPubMedQueries(request.plan) },
            request.signal
          )
          if (result.sources.length > 0) pubmedSources = result.sources
          diagnostics.push(...result.diagnostics)
        } catch (error) {
          if (error instanceof Error && error.message === 'AI_CANCELLED') throw error
          diagnostics.push({
            stage: 'literature', protocol: 'europepmc', outcome: 'failed', errorCode: 'AI_RESEARCH_SOURCE_INVALID'
          })
        }
      }

      const merged = mergeSources(pubmedSources, preprintSources)
      const enriched = await enrichWithPreprintServer(merged, request.signal, diagnostics)
      diagnostics.push({
        stage: 'literature',
        protocol: 'pubmed-esearch',
        outcome: enriched.length === 0 ? 'empty' : 'success',
        sourceCount: enriched.length
      })
      return { sources: enriched, diagnostics }
    }
  }
}
