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
      if (request.plan.domain !== 'medical') {
        diagnostics.push({ stage: 'literature', protocol: 'pubmed-esearch', outcome: 'skipped' })
        return { sources: [], diagnostics }
      }

      let pubmedSources: LiteratureSource[] = []
      if (dependencies.pubmed !== undefined) {
        try {
          const result = await dependencies.pubmed.search({
            searchQueries: request.plan.searchQueries,
            meshTerms: request.plan.meshTerms,
            keywords: request.plan.keywords
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
            { queries: request.plan.searchQueries },
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
