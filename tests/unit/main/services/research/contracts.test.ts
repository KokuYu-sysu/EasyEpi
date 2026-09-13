import { describe, expect, it } from 'vitest'

import {
  ResearchContractError,
  parseLiteratureSource,
  parseResearchDiagnostic,
  parseResearchEvidence,
  parseResearchPlan,
  parseWebSource,
  type ResearchSource
} from '@main/services/research/contracts'

const validPlan = {
  originalLanguage: 'zh',
  englishResearchQuestion: 'Risk factors for chronic disease among older adults in China',
  domain: 'medical',
  searchQueries: ['chronic disease AND aged AND China'],
  keywords: ['chronic disease', 'older adults'],
  meshTerms: ['Chronic Disease', 'Aged'],
  population: 'older adults',
  exposureOrIntervention: 'dietary and lifestyle factors',
  outcomes: ['chronic disease prevalence'],
  riskFactors: [
    { factor: 'dietary sodium intake', label: '膳食钠摄入', category: 'dietary' },
    { factor: 'parity', label: '生育次数', category: 'reproductive' }
  ],
  questionnaireDomains: [{ domain: '一般情况', items: ['年龄', '文化程度'] }]
}

const pubmedSource = {
  sourceId: 'pubmed:12345678',
  kind: 'pubmed' as const,
  title: 'Hypertension in older adults',
  abstract: 'Abstract text',
  authors: ['Doe J'],
  journal: 'Journal',
  year: 2024,
  doi: '10.1000/example',
  pmid: '12345678',
  url: 'https://pubmed.ncbi.nlm.nih.gov/12345678/',
  publicationTypes: ['Journal Article']
}

const webSource = {
  sourceId: 'web:https://www.who.int/report',
  kind: 'web' as const,
  title: 'WHO report',
  url: 'https://www.who.int/report',
  snippet: 'Snippet'
}

describe('parseResearchPlan', () => {
  it('normalizes duplicate and over-limit query lists instead of rejecting them', () => {
    const plan = parseResearchPlan({ ...validPlan, searchQueries: ['a', 'a', 'b'] })
    expect(plan.searchQueries).toEqual(['a', 'b'])

    const many = parseResearchPlan({
      ...validPlan,
      keywords: Array.from({ length: 30 }, (_, index) => `keyword ${index}`)
    })
    expect(many.keywords).toHaveLength(20)
  })

  it('tolerates extra keys, missing keys, and synonyms', () => {
    // A free-form JSON stage adds helpful keys and renames fields; neither is an error.
    const plan = parseResearchPlan({
      ...validPlan,
      unexpected: true,
      confidence: 0.9,
      topic: 'ignored because englishResearchQuestion exists'
    })
    expect(plan.englishResearchQuestion).toBe(validPlan.englishResearchQuestion)
    expect(plan).not.toHaveProperty('unexpected')

    const renamed = parseResearchPlan({
      language: 'zh',
      topic: 'Chronic disease in older adults',
      researchDomain: 'non-medical',
      queries: 'chronic disease AND aged',
      factors: ['smoking'],
      domains: [{ name: '一般情况', examples: ['年龄'] }]
    })
    expect(renamed.englishResearchQuestion).toBe('Chronic disease in older adults')
    expect(renamed.domain).toBe('non_medical')
    expect(renamed.searchQueries).toEqual(['chronic disease AND aged'])
    expect(renamed.riskFactors).toEqual([{ factor: 'smoking', label: 'smoking', category: '' }])
    expect(renamed.questionnaireDomains).toEqual([{ domain: '一般情况', items: ['年龄'] }])
    expect(renamed.population).toBe('')
    expect(renamed.outcomes).toEqual([])
  })

  it('keeps the model answer usable when it stays in the request language', () => {
    // The search stages translate or fall back on their own; rejecting the whole plan because a
    // free-form answer echoed Chinese was the source of a false AI_RESEARCH_PLAN_INVALID.
    const plan = parseResearchPlan({
      ...validPlan,
      englishResearchQuestion: '中国老年人慢性病危险因素',
      searchQueries: ['中国老年人 慢性病']
    })
    expect(plan.englishResearchQuestion).toContain('中国老年人')
    expect(plan.riskFactors).toHaveLength(2)
  })

  it('defaults an unknown or missing domain to medical', () => {
    expect(parseResearchPlan({ ...validPlan, domain: 'unknown' }).domain).toBe('medical')
    expect(parseResearchPlan({ ...validPlan, domain: undefined }).domain).toBe('medical')
    expect(parseResearchPlan({ ...validPlan, domain: 'non_medical' }).domain).toBe('non_medical')
    expect(parseResearchPlan({ ...validPlan, domain: '非医学' }).domain).toBe('non_medical')
  })

  it('coerces a scalar where a list was expected', () => {
    const plan = parseResearchPlan({ ...validPlan, outcomes: 'chronic disease prevalence' })
    expect(plan.outcomes).toEqual(['chronic disease prevalence'])
  })

  it('rejects only an object that carries nothing usable at all', () => {
    expect(() => parseResearchPlan(null)).toThrow('AI_RESEARCH_PLAN_INVALID')
    expect(() => parseResearchPlan([])).toThrow('AI_RESEARCH_PLAN_INVALID')
    expect(() => parseResearchPlan({})).toThrow('AI_RESEARCH_PLAN_INVALID')
    expect(() => parseResearchPlan({ note: 'sorry' })).toThrow('AI_RESEARCH_PLAN_INVALID')
    // A single usable key is enough.
    expect(parseResearchPlan({ keywords: ['hypertension'] }).keywords).toEqual(['hypertension'])
  })

  it('throws a typed contract error carrying the public code', () => {
    try {
      parseResearchPlan({})
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(ResearchContractError)
      expect((error as ResearchContractError).errorCode).toBe('AI_RESEARCH_PLAN_INVALID')
    }
  })
})

describe('parseLiteratureSource', () => {
  it('accepts a complete PubMed record', () => {
    expect(parseLiteratureSource(pubmedSource)).toMatchObject({ sourceId: 'pubmed:12345678', kind: 'pubmed' })
  })

  it('rejects a source id that does not match its kind prefix', () => {
    expect(() => parseLiteratureSource({ ...pubmedSource, sourceId: 'epmc:1' }))
      .toThrow('AI_RESEARCH_SOURCE_INVALID')
  })

  it('rejects a non-HTTPS url, a credentialed url, and an out-of-range year', () => {
    expect(() => parseLiteratureSource({ ...pubmedSource, url: 'http://pubmed.ncbi.nlm.nih.gov/1/' }))
      .toThrow('AI_RESEARCH_SOURCE_INVALID')
    expect(() => parseLiteratureSource({ ...pubmedSource, url: 'https://user:pass@pubmed.ncbi.nlm.nih.gov/1/' }))
      .toThrow('AI_RESEARCH_SOURCE_INVALID')
    expect(() => parseLiteratureSource({ ...pubmedSource, year: 1500 }))
      .toThrow('AI_RESEARCH_SOURCE_INVALID')
  })

  it('rejects an unknown server and unknown keys', () => {
    expect(() => parseLiteratureSource({ ...pubmedSource, server: 'arxiv' }))
      .toThrow('AI_RESEARCH_SOURCE_INVALID')
    expect(() => parseLiteratureSource({ ...pubmedSource, extra: 1 }))
      .toThrow('AI_RESEARCH_SOURCE_INVALID')
    expect(parseLiteratureSource({ ...pubmedSource, server: 'medRxiv' }))
      .toMatchObject({ server: 'medRxiv' })
  })
})

describe('parseWebSource', () => {
  it('accepts a web source and requires the web kind prefix', () => {
    expect(parseWebSource(webSource)).toMatchObject({ kind: 'web' })
    expect(() => parseWebSource({ ...webSource, sourceId: 'pubmed:1' })).toThrow('AI_RESEARCH_SOURCE_INVALID')
    expect(() => parseWebSource({ ...webSource, kind: 'pubmed' })).toThrow('AI_RESEARCH_SOURCE_INVALID')
  })
})

describe('parseResearchEvidence', () => {
  const sources: ResearchSource[] = [
    parseLiteratureSource(pubmedSource),
    parseWebSource(webSource)
  ]

  const validEvidence = {
    researchQuestion: validPlan.englishResearchQuestion,
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
        note: 'No retrieved record measured parity.'
      }
    ],
    questionnaireDomains: [{ domain: '饮食情况', items: ['食盐摄入'] }],
    limitations: ['Single region'],
    sources: [{
      sourceId: 'pubmed:12345678',
      title: pubmedSource.title,
      url: pubmedSource.url
    }]
  }

  it('accepts a factor inventory whose identity is copied from the retrieved inventory', () => {
    const evidence = parseResearchEvidence(validEvidence, sources)
    expect(evidence.factors).toHaveLength(2)
    expect(evidence.factors[0]?.evidence).toBe('supported')
    expect(evidence.sources[0]?.sourceId).toBe('pubmed:12345678')
  })

  it('treats an uncited factor as unsupported rather than rejecting it', () => {
    // This is the normal case: most factors have no matching record, and that must not be an error.
    const evidence = parseResearchEvidence({
      ...validEvidence,
      factors: [{ factor: 'parity', label: '生育次数', evidence: 'supported', sourceIds: [] }]
    }, sources)
    expect(evidence.factors[0]).toMatchObject({ evidence: 'none', sourceIds: [] })
  })

  it('rejects an unknown source id', () => {
    expect(() => parseResearchEvidence({
      ...validEvidence,
      factors: [{
        factor: 'dietary sodium intake',
        label: '膳食钠摄入',
        evidence: 'supported',
        sourceIds: ['pubmed:99999999']
      }],
      sources: [{ sourceId: 'pubmed:99999999', title: 'X', url: 'https://pubmed.ncbi.nlm.nih.gov/99999999/' }]
    }, sources)).toThrow('AI_EVIDENCE_INVALID')
  })

  it('rejects a mutated title or url for a known source id', () => {
    expect(() => parseResearchEvidence({
      ...validEvidence,
      sources: [{ sourceId: 'pubmed:12345678', title: 'Rewritten', url: pubmedSource.url }]
    }, sources)).toThrow('AI_EVIDENCE_INVALID')
    expect(() => parseResearchEvidence({
      ...validEvidence,
      sources: [{ sourceId: 'pubmed:12345678', title: pubmedSource.title, url: 'https://evil.example/1' }]
    }, sources)).toThrow('AI_EVIDENCE_INVALID')
  })

  it('rejects duplicate source identities', () => {
    expect(() => parseResearchEvidence({
      ...validEvidence,
      sources: [validEvidence.sources[0], validEvidence.sources[0]]
    }, sources)).toThrow('AI_EVIDENCE_INVALID')
  })

  it('rejects a cited factor that is missing from the referenced source list', () => {
    expect(() => parseResearchEvidence({ ...validEvidence, sources: [] }, sources))
      .toThrow('AI_EVIDENCE_INVALID')
  })

  it('rejects an object with neither factors nor domains', () => {
    expect(() => parseResearchEvidence({ ...validEvidence, factors: [], questionnaireDomains: [] }, sources))
      .toThrow('AI_EVIDENCE_INVALID')
  })

  it('accepts a blueprint-only object with no retrieved sources at all', () => {
    const evidence = parseResearchEvidence({
      researchQuestion: validPlan.englishResearchQuestion,
      factors: [{ factor: 'physical activity', label: '体力活动', evidence: 'none', sourceIds: [] }]
    }, [])
    expect(evidence.factors).toHaveLength(1)
    expect(evidence.sources).toEqual([])
  })
})

describe('parseResearchDiagnostic', () => {
  it('accepts a bounded diagnostic and rejects unknown protocols or oversized retry counts', () => {
    expect(parseResearchDiagnostic({ stage: 'web_search', protocol: 'responses', outcome: 'success', sourceCount: 3 }))
      .toMatchObject({ stage: 'web_search', sourceCount: 3 })
    expect(() => parseResearchDiagnostic({ stage: 'web_search', protocol: 'grpc', outcome: 'success' }))
      .toThrow('AI_RESEARCH_DIAGNOSTIC_INVALID')
    expect(() => parseResearchDiagnostic({ stage: 'literature', protocol: 'europepmc', outcome: 'failed', retryCount: 9 }))
      .toThrow('AI_RESEARCH_DIAGNOSTIC_INVALID')
    expect(() => parseResearchDiagnostic({ stage: 'literature', protocol: 'europepmc', outcome: 'failed', errorCode: 'bad code' }))
      .toThrow('AI_RESEARCH_DIAGNOSTIC_INVALID')
  })
})
