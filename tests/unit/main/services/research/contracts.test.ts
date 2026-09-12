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
  englishResearchQuestion: 'Risk factors for hypertension in university students',
  domain: 'medical',
  searchQueries: ['hypertension AND university students'],
  keywords: ['hypertension', 'university students'],
  meshTerms: ['Hypertension', 'Students'],
  population: 'university students',
  exposureOrIntervention: 'risk factors',
  outcomes: ['hypertension prevalence']
}

const pubmedSource = {
  sourceId: 'pubmed:12345678',
  kind: 'pubmed' as const,
  title: 'Hypertension in students',
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
  it('accepts an exact English plan and normalizes duplicate queries', () => {
    const plan = parseResearchPlan({ ...validPlan, searchQueries: ['a', 'a'] })
    expect(plan.searchQueries).toEqual(['a'])
    expect(plan.domain).toBe('medical')
  })

  it('rejects extra keys, non-English search text, and over-limit collections', () => {
    expect(() => parseResearchPlan({ ...validPlan, unexpected: true })).toThrow('AI_RESEARCH_PLAN_INVALID')
    expect(() => parseResearchPlan({ ...validPlan, englishResearchQuestion: '高血压危险因素' }))
      .toThrow('AI_RESEARCH_PLAN_INVALID')
    expect(() => parseResearchPlan({ ...validPlan, searchQueries: ['高血压 AND students'] }))
      .toThrow('AI_RESEARCH_PLAN_INVALID')
    expect(() => parseResearchPlan({ ...validPlan, searchQueries: ['a', 'b', 'c', 'd'] }))
      .toThrow('AI_RESEARCH_PLAN_INVALID')
    expect(() => parseResearchPlan({ ...validPlan, keywords: Array.from({ length: 21 }, (_, i) => `k${i}`) }))
      .toThrow('AI_RESEARCH_PLAN_INVALID')
    expect(() => parseResearchPlan({ ...validPlan, domain: 'unknown' })).toThrow('AI_RESEARCH_PLAN_INVALID')
    expect(() => parseResearchPlan({ ...validPlan, searchQueries: [] })).toThrow('AI_RESEARCH_PLAN_INVALID')
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
    claims: [{ claim: 'Hypertension is common', sourceIds: ['pubmed:12345678'], strength: 'high' }],
    questionnaireRecommendations: ['Ask about salt intake'],
    limitations: ['Single region'],
    sources: [{
      sourceId: 'pubmed:12345678',
      title: pubmedSource.title,
      url: pubmedSource.url
    }]
  }

  it('accepts evidence whose identity is copied from the retrieved inventory', () => {
    const evidence = parseResearchEvidence(validEvidence, sources)
    expect(evidence.claims).toHaveLength(1)
    expect(evidence.sources[0]?.sourceId).toBe('pubmed:12345678')
  })

  it('rejects an unknown source id', () => {
    expect(() => parseResearchEvidence({
      ...validEvidence,
      claims: [{ claim: 'Claim', sourceIds: ['pubmed:99999999'], strength: 'high' }],
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

  it('rejects a claim with no sources and an uncited reference', () => {
    expect(() => parseResearchEvidence({
      ...validEvidence,
      claims: [{ claim: 'Claim', sourceIds: [], strength: 'high' }]
    }, sources)).toThrow('AI_EVIDENCE_INVALID')
    expect(() => parseResearchEvidence({ ...validEvidence, sources: [] }, sources))
      .toThrow('AI_EVIDENCE_INVALID')
  })

  it('rejects duplicate source identities and unknown keys', () => {
    expect(() => parseResearchEvidence({
      ...validEvidence,
      sources: [validEvidence.sources[0], validEvidence.sources[0]]
    }, sources)).toThrow('AI_EVIDENCE_INVALID')
    expect(() => parseResearchEvidence({ ...validEvidence, extra: true }, sources))
      .toThrow('AI_EVIDENCE_INVALID')
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
