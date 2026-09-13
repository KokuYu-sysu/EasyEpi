import { describe, expect, it, vi } from 'vitest'

import type { ResearchPlan } from '@main/services/research/contracts'
import { createAIEvidenceService } from '@main/services/research/evidence.service'
import { createAILiteratureService, buildPreprintQueries, buildPubMedQueries } from '@main/services/research/literature.service'
import { createAIResearchPlanner } from '@main/services/research/planner.service'
import { createAIWebSearchService } from '@main/services/research/web-search.service'
import { AIClientError, type AIChatCompletionRequest } from '@main/services/openai-compatible.client'
import { AIResponsesUnsupportedError } from '@main/services/openai-responses.client'

const CONFIG = { baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash', apiKey: 'k' }

function plan(domain: 'medical' | 'non_medical' = 'medical'): ResearchPlan {
  return {
    originalLanguage: 'zh',
    englishResearchQuestion: 'Risk factors for chronic disease among older adults in China',
    domain,
    searchQueries: ['chronic disease AND aged AND China'],
    keywords: ['chronic disease', 'older adults'],
    meshTerms: ['Chronic Disease', 'Aged'],
    population: 'older adults',
    exposureOrIntervention: 'dietary and lifestyle factors',
    outcomes: ['chronic disease prevalence'],
    riskFactors: [
      { factor: 'dietary sodium intake', label: '膳食钠摄入', category: 'dietary' },
      { factor: 'physical activity', label: '体力活动', category: 'lifestyle' },
      { factor: 'parity', label: '生育次数', category: 'reproductive' }
    ],
    questionnaireDomains: [
      { domain: '一般情况', items: ['年龄', '文化程度'] },
      { domain: '饮食情况', items: ['食盐摄入'] }
    ]
  }
}

const validPlanJson = JSON.stringify({
  originalLanguage: 'zh',
  englishResearchQuestion: 'Risk factors for chronic disease among older adults in China',
  domain: 'medical',
  searchQueries: ['chronic disease AND aged AND China'],
  keywords: ['chronic disease'],
  meshTerms: ['Chronic Disease'],
  population: 'older adults',
  exposureOrIntervention: 'dietary factors',
  outcomes: ['chronic disease prevalence'],
  riskFactors: [{ factor: 'dietary sodium intake', label: '膳食钠摄入', category: 'dietary' }],
  questionnaireDomains: [{ domain: '饮食情况', items: ['食盐摄入'] }]
})

describe('createAIResearchPlanner', () => {
  it('requests JSON output with no tools and returns the parsed plan', async () => {
    const complete = vi.fn(async (_request: AIChatCompletionRequest) => ({
      content: validPlanJson,
      streamingSupported: false,
      responseFormatSupported: true
    }))
    const planner = createAIResearchPlanner({ client: { complete } })

    const result = await planner.plan({ userText: '为中国大学生设计高血压危险因素问卷', config: CONFIG })

    expect(result.plan.domain).toBe('medical')
    const request = complete.mock.calls[0]![0]
    expect(request.outputMode).toBe('json_object')
    expect(request.streamingSupported).toBe(false)
    expect(request.messages[0]!.content).toContain('Return ONE JSON object')
  })

  it('repairs once when the object carries nothing usable, then fails', async () => {
    // The planner is deliberately tolerant, so only an object with no query, no keyword and no factor
    // is unusable. A model that merely answers in the request language is no longer rejected.
    const complete = vi.fn(async (_request: AIChatCompletionRequest) => ({
      content: JSON.stringify({ note: 'I could not produce a plan.' }),
      streamingSupported: false,
      responseFormatSupported: true
    }))
    const planner = createAIResearchPlanner({ client: { complete } })

    await expect(planner.plan({ userText: '老年慢性病问卷', config: CONFIG }))
      .rejects.toThrow('AI_RESEARCH_PLAN_INVALID')
    expect(complete).toHaveBeenCalledTimes(2)
    const secondRequest = complete.mock.calls[1]![0]
    expect(secondRequest.messages.at(-1)!.content).toContain('AI_RESEARCH_PLAN_INVALID')
  })

  it('accepts a plan whose free-form fields stayed in the request language', async () => {
    const complete = vi.fn(async (_request: AIChatCompletionRequest) => ({
      content: JSON.stringify({
        ...JSON.parse(validPlanJson),
        englishResearchQuestion: '中国老年人慢性病危险因素',
        searchQueries: ['中国老年人 慢性病 危险因素']
      }),
      streamingSupported: false,
      responseFormatSupported: true
    }))
    const planner = createAIResearchPlanner({ client: { complete } })

    const result = await planner.plan({ userText: '老年慢性病问卷', config: CONFIG })

    expect(complete).toHaveBeenCalledOnce()
    expect(result.plan.riskFactors).toHaveLength(1)
    expect(result.plan.questionnaireDomains[0]?.domain).toBe('饮食情况')
  })

  it('does not repair after cancellation', async () => {
    const controller = new AbortController()
    const complete = vi.fn(async (_request: AIChatCompletionRequest) => {
      controller.abort()
      return { content: '{}', streamingSupported: false, responseFormatSupported: true }
    })
    const planner = createAIResearchPlanner({ client: { complete } })

    await expect(planner.plan({ userText: '高血压问卷', config: CONFIG, signal: controller.signal }))
      .rejects.toThrow('AI_CANCELLED')
    expect(complete).toHaveBeenCalledOnce()
  })
})

describe('createAIEvidenceService', () => {
  const pubmed = {
    sourceId: 'pubmed:12345678',
    kind: 'pubmed' as const,
    title: 'Hypertension in students',
    abstract: 'Abstract',
    authors: ['Doe J'],
    url: 'https://pubmed.ncbi.nlm.nih.gov/12345678/',
    publicationTypes: []
  }

  it('maps retrieved records onto the factor inventory and quotes them as untrusted data', async () => {
    const complete = vi.fn(async (_request: AIChatCompletionRequest) => ({
      content: JSON.stringify({
        researchQuestion: 'Risk factors for chronic disease among older adults in China',
        factors: [
          {
            factor: 'dietary sodium intake',
            label: '膳食钠摄入',
            category: 'dietary',
            evidence: 'supported',
            sourceIds: ['pubmed:12345678'],
            note: 'High intake was associated with hypertension.'
          },
          {
            factor: 'parity',
            label: '生育次数',
            category: 'reproductive',
            evidence: 'none',
            sourceIds: [],
            note: 'No record measured parity.'
          }
        ],
        questionnaireDomains: [{ domain: '饮食情况', items: ['食盐摄入'] }],
        limitations: [],
        sources: [{ sourceId: pubmed.sourceId, title: pubmed.title, url: pubmed.url }]
      }),
      streamingSupported: false,
      responseFormatSupported: true
    }))
    const service = createAIEvidenceService({ client: { complete } })

    const result = await service.extract({ plan: plan(), sources: [pubmed], config: CONFIG })

    expect(result.evidence.sources[0]?.sourceId).toBe('pubmed:12345678')
    expect(result.evidence.factors).toHaveLength(2)
    expect(result.evidence.factors[1]).toMatchObject({ evidence: 'none', sourceIds: [] })
    const userMessage = complete.mock.calls[0]![0].messages.at(-1)!.content
    expect(userMessage).toContain('untrusted quoted data')
    expect(userMessage).toContain('pubmed:12345678')
    // The planner's factor inventory is handed over so the model maps evidence onto those constructs
    // instead of looking for a single paper that already contains a matching questionnaire.
    expect(userMessage).toContain('Factor inventory to map onto')
    expect(userMessage).toContain('dietary sodium intake')
    expect(userMessage).toContain('生育次数')
  })

  it('rejects an unknown source id and repairs once', async () => {
    const complete = vi.fn(async (_request: AIChatCompletionRequest) => ({
      content: JSON.stringify({
        researchQuestion: 'Q',
        factors: [{
          factor: 'dietary sodium intake',
          label: '膳食钠摄入',
          evidence: 'supported',
          sourceIds: ['pubmed:99999999']
        }],
        limitations: [],
        sources: [{ sourceId: 'pubmed:99999999', title: 'X', url: 'https://pubmed.ncbi.nlm.nih.gov/99999999/' }]
      }),
      streamingSupported: false,
      responseFormatSupported: true
    }))
    const service = createAIEvidenceService({ client: { complete } })

    await expect(service.extract({ plan: plan(), sources: [pubmed], config: CONFIG }))
      .rejects.toThrow('AI_EVIDENCE_INVALID')
    expect(complete).toHaveBeenCalledTimes(2)
  })

  it('refuses to run without any retrieved source', async () => {
    const service = createAIEvidenceService({ client: { complete: vi.fn() } })
    await expect(service.extract({ plan: plan(), sources: [], config: CONFIG }))
      .rejects.toThrow('AI_RESEARCH_NO_EVIDENCE')
  })
})

describe('createAIWebSearchService', () => {
  const citation = { url: 'https://www.who.int/report', title: 'WHO report' }

  it('asks for the hosted web_search tool and turns citations into sources', async () => {
    const search = vi.fn(async (request: { input: string; instructions?: string }) => ({
      content: 'Spironolactone is best supported [1].',
      citations: [citation],
      searched: true,
      streamingSupported: false,
      request
    }))
    const service = createAIWebSearchService({ client: { search } })

    const result = await service.search({ plan: plan(), literatureSources: [], config: CONFIG })

    expect(result.status).toBe('searched')
    expect(result.supported).toBe(true)
    expect(result.sources).toEqual([{
      sourceId: 'web:https://www.who.int/report',
      kind: 'web',
      title: 'WHO report',
      url: 'https://www.who.int/report',
      snippet: 'Spironolactone is best supported [1].'
    }])
    const request = search.mock.calls[0]![0]
    expect(request.instructions).toContain('WHO')
  })

  it('drops non-authoritative citations for a medical request but keeps them for a non-medical one', async () => {
    const citations = [
      citation,
      { url: 'https://random-blog.example/post', title: 'Blog post' }
    ]
    const service = createAIWebSearchService({
      client: { search: async () => ({ content: 'text', citations, searched: true, streamingSupported: false }) }
    })

    const medical = await service.search({ plan: plan('medical'), literatureSources: [], config: CONFIG })
    expect(medical.sources.map(({ url }) => url)).toEqual([citation.url])

    const nonMedical = await service.search({ plan: plan('non_medical'), literatureSources: [], config: CONFIG })
    expect(nonMedical.sources.map(({ url }) => url)).toEqual([citation.url, 'https://random-blog.example/post'])
  })

  it('keeps structured citations when no medical citation is on the authority allow-list', async () => {
    const service = createAIWebSearchService({
      client: {
        search: async () => ({
          content: 'text',
          citations: [{ url: 'https://journals.plos.org/article', title: 'PLOS article' }],
          searched: true,
          streamingSupported: false
        })
      }
    })

    const result = await service.search({ plan: plan('medical'), literatureSources: [], config: CONFIG })

    expect(result.status).toBe('searched')
    expect(result.sources.map(({ url }) => url)).toEqual(['https://journals.plos.org/article'])
  })

  it('reports unsupported without calling the transport when the capability is cached false', async () => {
    const search = vi.fn()
    const service = createAIWebSearchService({ client: { search } })

    const result = await service.search({
      plan: plan('non_medical'),
      literatureSources: [],
      config: CONFIG,
      cachedSupported: false
    })

    expect(result.status).toBe('unsupported')
    expect(search).not.toHaveBeenCalled()
  })

  it('converts a web_search refusal into an unsupported result carrying the cacheable flag', async () => {
    const service = createAIWebSearchService({
      client: { search: async () => { throw new AIResponsesUnsupportedError('web_search_tool', 400) } }
    })

    const result = await service.search({ plan: plan('medical'), literatureSources: [], config: CONFIG })

    expect(result.status).toBe('unsupported')
    expect(result.supported).toBe(false)
    expect(result.diagnostic.errorCode).toBe('AI_RESEARCH_UNSUPPORTED')
  })

  it('reports a transport failure as failed and rethrows cancellation', async () => {
    const failing = createAIWebSearchService({
      client: { search: async () => { throw new AIClientError('AI_NETWORK_ERROR') } }
    })
    await expect(failing.search({ plan: plan(), literatureSources: [], config: CONFIG }))
      .resolves.toMatchObject({ status: 'failed' })

    const cancelled = createAIWebSearchService({
      client: { search: async () => { throw new AIClientError('AI_CANCELLED') } }
    })
    await expect(cancelled.search({ plan: plan(), literatureSources: [], config: CONFIG }))
      .rejects.toThrow('AI_CANCELLED')
  })

  it('reports an empty result when the model answers without any citation', async () => {
    const service = createAIWebSearchService({
      client: { search: async () => ({ content: 'prose only', citations: [], searched: true, streamingSupported: false }) }
    })
    const result = await service.search({ plan: plan(), literatureSources: [], config: CONFIG })
    expect(result.status).toBe('empty')
    expect(result.citations).toEqual([])
  })
})

describe('createAILiteratureService', () => {
  const pubmedRecord = {
    sourceId: 'pubmed:12345678',
    kind: 'pubmed' as const,
    title: 'PubMed record',
    abstract: 'A',
    authors: ['Doe J'],
    doi: '10.1101/2025.01.01.25300000',
    url: 'https://pubmed.ncbi.nlm.nih.gov/12345678/',
    publicationTypes: []
  }
  const epmcRecord = {
    sourceId: 'epmc:PPR123',
    kind: 'epmc' as const,
    title: 'Preprint record',
    abstract: 'B',
    authors: ['Roe J'],
    doi: '10.1101/2025.01.01.25300000',
    server: 'medRxiv' as const,
    url: 'https://doi.org/10.1101/2025.01.01.25300000',
    publicationTypes: []
  }

  it('does not touch the network for a non-medical plan', async () => {
    const pubmed = { search: vi.fn() }
    const service = createAILiteratureService({ pubmed })
    const result = await service.search({ plan: plan('non_medical') })
    expect(pubmed.search).not.toHaveBeenCalled()
    expect(result.sources).toEqual([])
    expect(result.diagnostics[0]).toMatchObject({ outcome: 'skipped' })
  })

  it('merges PubMed and preprint results by DOI and enriches preprints through the server API', async () => {
    const lookup = vi.fn(async () => ({
      metadata: {
        server: 'medRxiv' as const,
        doi: '10.1101/2025.01.01.25300000',
        title: 'Verified preprint title',
        authors: ['Roe J'],
        year: 2025,
        version: '2',
        landingUrl: 'https://www.medrxiv.org/content/10.1101/2025.01.01.25300000v2'
      },
      diagnostic: { stage: 'literature' as const, protocol: 'biorxiv' as const, outcome: 'success' as const }
    }))
    const service = createAILiteratureService({
      pubmed: { search: async () => ({ sources: [pubmedRecord], diagnostics: [] }) },
      europePmc: { searchPreprints: async () => ({ sources: [epmcRecord], diagnostics: [] }) },
      preprint: { lookup }
    })

    const result = await service.search({ plan: plan('medical') })

    // The PubMed record wins the DOI collision, so the preprint lookup has nothing left to enrich.
    expect(result.sources).toHaveLength(1)
    expect(result.sources[0]!.sourceId).toBe('pubmed:12345678')
    expect(lookup).not.toHaveBeenCalled()
  })

  it('enriches a preprint-only result and records the verification flag', async () => {
    const service = createAILiteratureService({
      pubmed: { search: async () => ({ sources: [], diagnostics: [] }) },
      europePmc: { searchPreprints: async () => ({ sources: [epmcRecord], diagnostics: [] }) },
      preprint: {
        lookup: async () => ({
          metadata: {
            server: 'medRxiv' as const,
            doi: epmcRecord.doi,
            title: 'Verified preprint title',
            authors: ['Roe J'],
            year: 2025,
            version: '2',
            landingUrl: 'https://www.medrxiv.org/content/10.1101/2025.01.01.25300000v2'
          },
          diagnostic: { stage: 'literature' as const, protocol: 'biorxiv' as const, outcome: 'success' as const }
        })
      }
    })

    const result = await service.search({ plan: plan('medical') })

    expect(result.sources).toHaveLength(1)
    expect(result.sources[0]).toMatchObject({
      title: 'Verified preprint title',
      url: 'https://www.medrxiv.org/content/10.1101/2025.01.01.25300000v2',
      preprintVerified: true
    })
  })

  it('keeps PubMed results when the preprint provider fails', async () => {
    const service = createAILiteratureService({
      pubmed: { search: async () => ({ sources: [pubmedRecord], diagnostics: [] }) },
      europePmc: { searchPreprints: async () => { throw new Error('boom') } }
    })

    const result = await service.search({ plan: plan('medical') })

    expect(result.sources).toHaveLength(1)
    expect(result.diagnostics.some(({ outcome }) => outcome === 'failed')).toBe(true)
  })

  it('records a PubMed failure without aborting the run', async () => {
    const service = createAILiteratureService({
      pubmed: { search: async () => { throw new Error('AI_PUBMED_UNAVAILABLE') } }
    })

    const result = await service.search({ plan: plan('medical') })

    expect(result.sources).toEqual([])
    expect(result.diagnostics.some(({ errorCode }) => errorCode === 'AI_PUBMED_UNAVAILABLE')).toBe(true)
  })
})

describe('literature query construction', () => {
  it('adds MeSH and Title/Abstract fallbacks after the planner queries', () => {
    // A single over-narrow free-text query returning nothing was a real failure mode: a broad topic
    // such as a national chronic-disease survey needs the MeSH and keyword forms as well.
    const queries = buildPubMedQueries(plan('medical'))
    expect(queries[0]).toBe('chronic disease AND aged AND China')
    expect(queries).toContain('Chronic Disease[MeSH Terms] AND Aged[MeSH Terms]')
    expect(queries).toContain('chronic disease[Title/Abstract] AND older adults[Title/Abstract]')
    expect(queries.length).toBeLessThanOrEqual(5)
  })

  it('never sends a non-English query to an English-first index', () => {
    const chinese: ResearchPlan = {
      ...plan('medical'),
      searchQueries: ['中国老年人 慢性病', 'chronic disease AND aged'],
      keywords: ['老年人', 'older adults'],
      meshTerms: ['老年人'],
      riskFactors: [{ factor: '吸烟', label: '吸烟', category: 'lifestyle' }]
    }
    const queries = buildPubMedQueries(chinese)
    expect(queries).toEqual(['chronic disease AND aged', 'older adults[Title/Abstract]'])
    expect(queries.every((query) => !/[\u3400-\u9fff]/.test(query))).toBe(true)
  })

  it('caps the query list and drops duplicates', () => {
    const many: ResearchPlan = {
      ...plan('medical'),
      searchQueries: ['a AND b', 'a AND b', 'c', 'd', 'e', 'f'],
      meshTerms: [],
      keywords: [],
      riskFactors: []
    }
    const queries = buildPubMedQueries(many)
    expect(queries).toEqual(['a AND b', 'c', 'd'])
  })

  it('builds a smaller preprint query set', () => {
    const queries = buildPreprintQueries(plan('medical'))
    expect(queries[0]).toBe('chronic disease AND aged AND China')
    expect(queries).toContain('chronic disease AND older adults')
    expect(queries.length).toBeLessThanOrEqual(5)
  })
})
