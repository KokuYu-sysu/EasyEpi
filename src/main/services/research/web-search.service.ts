import type { AIMainConfig } from '../ai-config.service'
import { AIClientError } from '../openai-compatible.client'
import {
  AIResponsesUnsupportedError,
  type AIResponsesSearchResult
} from '../openai-responses.client'
import type { AIResponseCitation } from '../openai-responses.parser'

import {
  RESEARCH_LIMITS,
  type LiteratureSource,
  type ResearchDiagnostic,
  type ResearchPlan,
  type WebSource
} from './contracts'

export type WebSearchStatus = 'searched' | 'empty' | 'unsupported' | 'failed'

export interface WebSearchRequest {
  plan: ResearchPlan
  literatureSources: readonly LiteratureSource[]
  config: AIMainConfig
  /** Cached negotiation result for this endpoint and model. */
  cachedSupported?: boolean
  signal?: AbortSignal
}

export interface WebSearchResult {
  status: WebSearchStatus
  sources: WebSource[]
  citations: AIResponseCitation[]
  /** Present only when this run established the capability for the first time. */
  supported?: boolean
  diagnostic: ResearchDiagnostic
}

export interface AIWebSearchService {
  search(request: WebSearchRequest): Promise<WebSearchResult>
}

export interface AIWebSearchServiceDependencies {
  client?: {
    search(request: {
      baseUrl: string
      model: string
      apiKey?: string
      instructions?: string
      input: string
      maxOutputTokens?: number
      signal?: AbortSignal
    }): Promise<AIResponsesSearchResult>
  }
}

const AUTHORITY_HOSTS: readonly string[] = [
  'pubmed.ncbi.nlm.nih.gov',
  'ncbi.nlm.nih.gov',
  'who.int',
  'cdc.gov',
  'nih.gov',
  'nice.org.uk',
  'cochrane.org',
  'doi.org',
  'biorxiv.org',
  'medrxiv.org',
  'europepmc.org',
  'eurosurveillance.org',
  'thelancet.com',
  'bmj.com',
  'nejm.org',
  'jamanetwork.com',
  'nature.com',
  'sciencedirect.com',
  'springer.com',
  'wiley.com',
  'academic.oup.com'
]

function isAuthority(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return AUTHORITY_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))
  } catch {
    return false
  }
}

function instructionsFor(plan: ResearchPlan): string {
  const base = 'You are a research assistant for an epidemiology questionnaire builder. ' +
    'Search the web, then answer in plain prose with citations. Never invent sources.'
  if (plan.domain === 'medical') {
    return `${base} Prefer peer-reviewed literature, systematic reviews, clinical guidelines, and ` +
      'national or international public-health bodies such as the WHO, the CDC, the NIH, and NICE. ' +
      'Give prevalence figures, validated instruments, and established risk factors with their sources.'
  }
  return `${base} Prefer authoritative institutional sources such as government statistical offices, ` +
    'professional bodies, standards organisations, and peer-reviewed methodology papers.'
}

function gapInventory(sources: readonly LiteratureSource[]): string {
  if (sources.length === 0) {
    return 'No literature records were retrieved for this question, so cover the topic broadly.'
  }
  const listed = sources
    .slice(0, RESEARCH_LIMITS.maxSources)
    .map((source) => `- ${source.title}${source.year === undefined ? '' : ` (${source.year})`}`)
    .join('\n')
  return 'These literature records are already on file. Do not repeat them; look for complementary ' +
    `authoritative material such as guidelines, surveillance data, or validated instruments.\n${listed}`
}

function buildInput(plan: ResearchPlan, sources: readonly LiteratureSource[]): string {
  return [
    `Research question: ${plan.englishResearchQuestion}`,
    `Population: ${plan.population}`,
    `Exposure or intervention: ${plan.exposureOrIntervention}`,
    `Outcomes: ${plan.outcomes.join('; ')}`,
    `Keywords: ${plan.keywords.join(', ')}`,
    gapInventory(sources)
  ].join('\n')
}

function snippetFor(content: string, url: string): string {
  const text = content.trim().replaceAll(/\s+/g, ' ')
  if (text.length === 0) return url
  return text.slice(0, RESEARCH_LIMITS.maxSnippetChars)
}

export function createAIWebSearchService(
  dependencies: AIWebSearchServiceDependencies = {}
): AIWebSearchService {
  return {
    async search(request) {
      if (request.cachedSupported === false) {
        return {
          status: 'unsupported',
          sources: [],
          citations: [],
          diagnostic: { stage: 'web_search', protocol: 'responses', outcome: 'unsupported' }
        }
      }
      const client = dependencies.client
      if (client === undefined) {
        return {
          status: 'failed',
          sources: [],
          citations: [],
          diagnostic: {
            stage: 'web_search', protocol: 'responses', outcome: 'failed',
            errorCode: 'AI_RESEARCH_UNSUPPORTED'
          }
        }
      }

      try {
        const result = await client.search({
          baseUrl: request.config.baseUrl,
          model: request.config.model,
          ...(request.config.apiKey === undefined ? {} : { apiKey: request.config.apiKey }),
          instructions: instructionsFor(request.plan),
          input: buildInput(request.plan, request.literatureSources),
          ...(request.signal === undefined ? {} : { signal: request.signal })
        })

        // Authority restriction is enforced here rather than through the API, because the DeepSeek
        // `web_search` tool does not accept a domain filter. It is a preference, not a cull: if no
        // citation is on the allow-list the structured citations are still real HTTPS sources, and
        // discarding them would turn a usable answer into a spurious no-evidence stop.
        let preferred = result.citations
        if (request.plan.domain === 'medical') {
          const authoritative = result.citations.filter((citation) => isAuthority(citation.url))
          preferred = authoritative.length > 0 ? authoritative : result.citations
        }
        const content = result.content
        const seen = new Set<string>()
        const sources: WebSource[] = []
        for (const citation of preferred) {
          const sourceId = `web:${citation.url}`
          if (seen.has(sourceId) || sources.length >= RESEARCH_LIMITS.maxSources) continue
          seen.add(sourceId)
          sources.push({
            sourceId,
            kind: 'web',
            title: citation.title,
            url: citation.url,
            snippet: snippetFor(content, citation.url)
          })
        }
        return {
          status: sources.length === 0 ? 'empty' : 'searched',
          sources,
          citations: sources.map(({ title, url }) => ({ title, url })),
          ...(result.searched ? { supported: true } : {}),
          diagnostic: {
            stage: 'web_search',
            protocol: 'responses',
            outcome: sources.length === 0 ? 'empty' : 'success',
            sourceCount: sources.length
          }
        }
      } catch (error) {
        if (error instanceof AIResponsesUnsupportedError) {
          return {
            status: 'unsupported',
            sources: [],
            citations: [],
            supported: false,
            diagnostic: {
              stage: 'web_search',
              protocol: 'responses',
              outcome: 'unsupported',
              errorCode: 'AI_RESEARCH_UNSUPPORTED'
            }
          }
        }
        if (error instanceof AIClientError) {
          if (error.code === 'AI_CANCELLED') throw error
          return {
            status: 'failed',
            sources: [],
            citations: [],
            diagnostic: {
              stage: 'web_search',
              protocol: 'responses',
              outcome: error.code === 'AI_RESPONSE_TOO_LARGE' ? 'truncated' : 'failed',
              errorCode: error.code
            }
          }
        }
        return {
          status: 'failed',
          sources: [],
          citations: [],
          diagnostic: {
            stage: 'web_search', protocol: 'responses', outcome: 'failed',
            errorCode: 'AI_RESEARCH_UNSUPPORTED'
          }
        }
      }
    }
  }
}
