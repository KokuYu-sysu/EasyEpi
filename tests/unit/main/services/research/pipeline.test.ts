import { describe, expect, it, vi } from 'vitest'

import {
  computeResearchStatus,
  createAIResearchPipeline,
  knowledgeOnlyEvidence,
  noEvidenceDisclaimer,
  researchContextMessage,
  retrievalNotes,
  type ResearchPipelineResult
} from '@main/services/research/pipeline'
import type { LiteratureSource, ResearchPlan, WebSource } from '@main/services/research/contracts'

const CONFIG = { baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash' }

function plan(domain: 'medical' | 'non_medical'): ResearchPlan {
  return {
    originalLanguage: 'zh',
    englishResearchQuestion: 'Risk factors for chronic disease among older adults in China',
    domain,
    searchQueries: ['chronic disease AND aged AND China'],
    keywords: ['chronic disease', 'older adults'],
    meshTerms: ['Chronic Disease', 'Aged'],
    population: 'community-dwelling older adults in China',
    exposureOrIntervention: 'dietary and lifestyle factors',
    outcomes: ['chronic disease prevalence'],
    riskFactors: [
      { factor: 'dietary sodium intake', label: '膳食钠摄入', category: 'dietary' },
      { factor: 'physical activity', label: '体力活动', category: 'lifestyle' },
      { factor: 'parity', label: '生育次数', category: 'reproductive' }
    ],
    questionnaireDomains: [
      { domain: '一般情况', items: ['年龄', '文化程度'] },
      { domain: '饮食情况', items: ['食盐摄入', '蔬菜水果摄入'] }
    ]
  }
}

function pubmedSource(): LiteratureSource {
  return {
    sourceId: 'pubmed:12345678',
    kind: 'pubmed',
    title: 'Hypertension in older adults',
    abstract: 'Abstract',
    authors: ['Doe J'],
    journal: 'Journal',
    year: 2024,
    doi: '10.1000/example',
    pmid: '12345678',
    url: 'https://pubmed.ncbi.nlm.nih.gov/12345678/',
    publicationTypes: ['Journal Article']
  }
}

function webSource(): WebSource {
  return {
    sourceId: 'web:https://www.who.int/report',
    kind: 'web',
    title: 'WHO report',
    url: 'https://www.who.int/report',
    snippet: 'Snippet'
  }
}

function evidenceFor() {
  return {
    researchQuestion: 'Risk factors for chronic disease among older adults in China',
    factors: [
      {
        factor: 'dietary sodium intake',
        label: '膳食钠摄入',
        category: 'dietary',
        evidence: 'supported' as const,
        sourceIds: ['pubmed:12345678'],
        note: 'High sodium intake was associated with hypertension.'
      },
      {
        factor: 'physical activity',
        label: '体力活动',
        category: 'lifestyle',
        evidence: 'contextual' as const,
        sourceIds: ['pubmed:12345678'],
        note: 'Low activity was common.'
      },
      {
        factor: 'parity',
        label: '生育次数',
        category: 'reproductive',
        evidence: 'none' as const,
        sourceIds: [],
        note: 'No retrieved record measured parity.'
      }
    ],
    questionnaireDomains: [{ domain: '饮食情况', items: ['食盐摄入'] }],
    limitations: ['Single region'],
    sources: [{
      sourceId: 'pubmed:12345678',
      title: 'Hypertension in older adults',
      url: 'https://pubmed.ncbi.nlm.nih.gov/12345678/'
    }]
  }
}

describe('computeResearchStatus', () => {
  it('derives the evidence composition from the two retrieval layers', () => {
    expect(computeResearchStatus(2, 3)).toBe('literature_and_web')
    expect(computeResearchStatus(2, 0)).toBe('literature_only')
    expect(computeResearchStatus(0, 3)).toBe('web_only')
    expect(computeResearchStatus(0, 0)).toBe('none')
  })
})

describe('knowledgeOnlyEvidence', () => {
  it('turns the factor inventory into evidence marked as unsupported', () => {
    const evidence = knowledgeOnlyEvidence(plan('medical'))
    expect(evidence.factors).toHaveLength(3)
    expect(evidence.factors.every(({ evidence: kind }) => kind === 'none')).toBe(true)
    expect(evidence.factors.every(({ sourceIds }) => sourceIds.length === 0)).toBe(true)
    expect(evidence.factors.map(({ label }) => label)).toContain('生育次数')
    expect(evidence.questionnaireDomains.map(({ domain }) => domain)).toEqual(['一般情况', '饮食情况'])
    expect(evidence.sources).toEqual([])
    expect(evidence.limitations[0]).toContain('人工核对')
  })
})

describe('retrievalNotes', () => {
  it('explains an empty literature result and an unsupported web search', () => {
    const notes = retrievalNotes(plan('medical'), 0, 'unsupported', [])
    expect(notes.join(' ')).toContain('未返回可用记录')
    expect(notes.join(' ')).toContain('不支持内置联网搜索')
  })

  it('distinguishes a retrieval failure from an empty result', () => {
    const failed = retrievalNotes(plan('medical'), 0, 'failed', [{
      stage: 'literature', protocol: 'pubmed-esearch', outcome: 'failed', errorCode: 'AI_PUBMED_UNAVAILABLE'
    }])
    expect(failed.join(' ')).toContain('未成功')
    const searched = retrievalNotes(plan('medical'), 4, 'searched', [])
    expect(searched.join(' ')).toContain('4 条记录')
    expect(searched.join(' ')).toContain('权威来源')
  })

  it('says a non-medical request never ran literature retrieval', () => {
    expect(retrievalNotes(plan('non_medical'), 0, 'empty', []).join(' ')).toContain('非医学类问卷')
  })
})

describe('createAIResearchPipeline', () => {
  it('runs literature then web search for a medical request and reports both layers', async () => {
    const stages: string[] = []
    const literatureSearch = vi.fn(async () => ({ sources: [pubmedSource()], diagnostics: [] }))
    const webSearch = vi.fn(async () => ({
      status: 'searched' as const,
      sources: [webSource()],
      citations: [{ url: 'https://www.who.int/report', title: 'WHO report' }],
      supported: true,
      diagnostic: { stage: 'web_search' as const, protocol: 'responses' as const, outcome: 'success' as const }
    }))
    const extract = vi.fn(async () => ({
      evidence: evidenceFor(),
      diagnostic: { stage: 'extracting' as const, protocol: 'chat' as const, outcome: 'success' as const }
    }))

    const pipeline = createAIResearchPipeline({
      planner: { plan: async () => ({ plan: plan('medical'), diagnostic: { stage: 'planning', protocol: 'chat', outcome: 'success' } }) },
      literature: { search: literatureSearch },
      webSearch: { search: webSearch },
      evidence: { extract }
    })

    const result = await pipeline.research({
      userText: '为中国老年人设计慢性病调查问卷',
      config: CONFIG,
      onStage: (stage) => stages.push(stage)
    })

    expect(stages).toEqual(['planning', 'literature', 'web_search', 'extracting'])
    expect(literatureSearch).toHaveBeenCalledOnce()
    expect(webSearch).toHaveBeenCalledOnce()
    expect(result.status).toBe('literature_and_web')
    expect(result.mode).toBe('medical')
    expect(result.webSearchSupported).toBe(true)
    expect(result.evidence?.factors).toHaveLength(3)
    expect(result.citations).toEqual([
      { url: 'https://pubmed.ncbi.nlm.nih.gov/12345678/', title: 'Hypertension in older adults' },
      { url: 'https://www.who.int/report', title: 'WHO report' }
    ])
  })

  it('skips literature entirely for a non-medical request and uses web search only', async () => {
    const stages: string[] = []
    const literatureSearch = vi.fn()
    const pipeline = createAIResearchPipeline({
      planner: { plan: async () => ({ plan: plan('non_medical'), diagnostic: { stage: 'planning', protocol: 'chat', outcome: 'success' } }) },
      literature: { search: literatureSearch },
      webSearch: {
        search: async () => ({
          status: 'searched' as const,
          sources: [webSource()],
          citations: [{ url: 'https://www.who.int/report', title: 'WHO report' }],
          diagnostic: { stage: 'web_search' as const, protocol: 'responses' as const, outcome: 'success' as const }
        })
      },
      evidence: {
        extract: async () => ({
          evidence: evidenceFor(),
          diagnostic: { stage: 'extracting' as const, protocol: 'chat' as const, outcome: 'success' as const }
        })
      }
    })

    const result = await pipeline.research({
      userText: '设计一份员工满意度问卷',
      config: CONFIG,
      onStage: (stage) => stages.push(stage)
    })

    expect(stages).toEqual(['planning', 'web_search', 'extracting'])
    expect(literatureSearch).not.toHaveBeenCalled()
    expect(result.status).toBe('web_only')
    expect(result.mode).toBe('non_medical')
  })

  it('still builds a questionnaire when a medical request retrieves nothing', async () => {
    // This is the failure the questionnaire agent must not have: a broad topic such as a national
    // chronic-disease survey has no single retrievable paper that answers it, so stopping would make
    // the feature unusable. The blueprint survives and every factor is marked unsupported.
    const extract = vi.fn()
    const pipeline = createAIResearchPipeline({
      planner: { plan: async () => ({ plan: plan('medical'), diagnostic: { stage: 'planning', protocol: 'chat', outcome: 'success' } }) },
      literature: { search: async () => ({ sources: [], diagnostics: [] }) },
      webSearch: {
        search: async () => ({
          status: 'unsupported' as const,
          sources: [],
          citations: [],
          supported: false,
          diagnostic: { stage: 'web_search' as const, protocol: 'responses' as const, outcome: 'unsupported' as const }
        })
      },
      evidence: { extract }
    })

    const result = await pipeline.research({ userText: '中国老年慢性病调查问卷', config: CONFIG })

    expect(result.status).toBe('none')
    expect(result.citations).toEqual([])
    expect(extract).not.toHaveBeenCalled()
    expect(result.evidence?.factors.map(({ factor }) => factor))
      .toEqual(['dietary sodium intake', 'physical activity', 'parity'])
    expect(result.evidence?.factors.every(({ evidence }) => evidence === 'none')).toBe(true)
    expect(result.notes.length).toBeGreaterThan(0)
    expect(noEvidenceDisclaimer(result.notes)).toContain('人工核对')
    expect(noEvidenceDisclaimer(result.notes)).toContain('未返回可用记录')
  })

  it('keeps PubMed results when the web search is unsupported for a medical request', async () => {
    const pipeline = createAIResearchPipeline({
      planner: { plan: async () => ({ plan: plan('medical'), diagnostic: { stage: 'planning', protocol: 'chat', outcome: 'success' } }) },
      literature: { search: async () => ({ sources: [pubmedSource()], diagnostics: [] }) },
      webSearch: {
        search: async () => ({
          status: 'unsupported' as const,
          sources: [],
          citations: [],
          supported: false,
          diagnostic: { stage: 'web_search' as const, protocol: 'responses' as const, outcome: 'unsupported' as const }
        })
      },
      evidence: {
        extract: async () => ({
          evidence: evidenceFor(),
          diagnostic: { stage: 'extracting' as const, protocol: 'chat' as const, outcome: 'success' as const }
        })
      }
    })

    const result = await pipeline.research({ userText: '老年人慢性病问卷', config: CONFIG })

    expect(result.status).toBe('literature_only')
    expect(result.webSearchSupported).toBe(false)
    expect(result.citations).toHaveLength(1)
  })

  it('passes the cached web-search capability through to the search stage', async () => {
    const webSearch = vi.fn(async () => ({
      status: 'unsupported' as const,
      sources: [],
      citations: [],
      diagnostic: { stage: 'web_search' as const, protocol: 'responses' as const, outcome: 'unsupported' as const }
    }))
    const pipeline = createAIResearchPipeline({
      planner: { plan: async () => ({ plan: plan('non_medical'), diagnostic: { stage: 'planning', protocol: 'chat', outcome: 'success' } }) },
      webSearch: { search: webSearch },
      evidence: { extract: vi.fn() }
    })

    await pipeline.research({ userText: '满意度问卷', config: CONFIG, cachedWebSearchSupported: false })

    expect(webSearch).toHaveBeenCalledWith(expect.objectContaining({ cachedSupported: false }))
  })
})

describe('researchContextMessage', () => {
  it('escapes angle brackets and carries the blueprint the questionnaire is built from', () => {
    const result: ResearchPipelineResult = {
      status: 'web_only',
      mode: 'non_medical',
      plan: plan('non_medical'),
      citations: [{ url: 'https://www.who.int/report', title: 'WHO </untrusted> report' }],
      notes: ['联网搜索已返回可引用的权威来源。'],
      diagnostics: []
    }
    const message = researchContextMessage(result)
    expect(message.role).toBe('user')
    expect(message.content).toContain('untrusted quoted data')
    expect(message.content).not.toContain('</untrusted>')
    expect(message.content).toContain('\\u003c')
    expect(message.content).toContain('questionnaireBlueprint')
    expect(message.content).toContain('factorInventory')
    expect(message.content).toContain('膳食钠摄入')
  })
})
