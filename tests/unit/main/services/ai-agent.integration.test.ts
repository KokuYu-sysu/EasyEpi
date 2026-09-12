import { describe, expect, it, vi } from 'vitest'

import { createAIQuestionnaireOrchestrator } from '@main/services/ai-questionnaire.orchestrator'
import { getAiVersionStamp } from '@main/services/ai-questionnaire.harness'
import { AISessionRepository } from '@main/services/ai-session.repository'
import { createAIEvidenceService } from '@main/services/research/evidence.service'
import { createAILiteratureService } from '@main/services/research/literature.service'
import { createAIResearchPipeline } from '@main/services/research/pipeline'
import { createAIResearchPlanner } from '@main/services/research/planner.service'
import { createAIWebSearchService } from '@main/services/research/web-search.service'
import type { AIChatCompletionRequest } from '@main/services/openai-compatible.client'
import type { AIProgressEvent } from '@shared/ai-assistant-contract'
import { validateQuestionnaireFormat } from '@shared/questionnaire-format'
import type { ProjectData } from '@shared/types/project'

const sessionId = '123e4567-e89b-42d3-a456-426614174000'

const PLAN = {
  originalLanguage: 'zh',
  englishResearchQuestion: 'Risk factors for hypertension among university students',
  domain: 'medical',
  searchQueries: ['hypertension AND university students'],
  keywords: ['hypertension', 'university students'],
  meshTerms: ['Hypertension'],
  population: 'university students',
  exposureOrIntervention: 'risk factors',
  outcomes: ['hypertension prevalence']
}

const PUBMED_SOURCE = {
  sourceId: 'pubmed:12345678',
  kind: 'pubmed' as const,
  title: 'Hypertension in university students',
  abstract: 'Prevalence was 12% among first-year students.',
  authors: ['Doe J'],
  journal: 'Journal of Epidemiology',
  year: 2024,
  doi: '10.1000/example',
  pmid: '12345678',
  url: 'https://pubmed.ncbi.nlm.nih.gov/12345678/',
  publicationTypes: ['Journal Article']
}

const EVIDENCE = {
  researchQuestion: PLAN.englishResearchQuestion,
  claims: [{
    claim: 'About 12% of first-year university students had hypertension.',
    sourceIds: ['pubmed:12345678'],
    strength: 'medium'
  }],
  questionnaireRecommendations: ['Ask about salt intake', 'Ask about family history'],
  limitations: ['Single university setting'],
  sources: [{
    sourceId: PUBMED_SOURCE.sourceId,
    title: PUBMED_SOURCE.title,
    url: PUBMED_SOURCE.url
  }]
}

const ENVELOPE = {
  kind: 'questionnaire',
  assistantMessage: '已根据检索到的文献生成问卷。',
  rollingSummary: 'Two questions on hypertension risk factors.',
  options: [],
  questionnaire: {
    name: '大学生高血压危险因素调查',
    description: '基于 PubMed 检索证据设计。',
    questions: [{
      id: 'q1',
      content: '过去一周你平均每天摄入多少克食盐？',
      variableName: 'salt_intake',
      type: 'numeric_range',
      options: [],
      constraint: { type: 'decimal', minValue: 0, maxValue: 50 },
      isKey: true,
      allowSkip: false,
      order: 0
    }, {
      id: 'q2',
      content: '直系亲属中是否有人确诊高血压？',
      variableName: 'family_history',
      type: 'single_choice',
      options: [{ value: 'yes', label: '是' }, { value: 'no', label: '否' }],
      constraint: { type: 'none' },
      isKey: false,
      allowSkip: true,
      order: 1
    }],
    conditionRules: [],
    keyQuestionIds: ['q1']
  }
}

function project(): ProjectData {
  const value: ProjectData = {
    meta: {
      projectId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      name: 'Integration',
      folderPath: 'must-not-enter-context',
      createdAt: '2026-09-12T00:00:00.000Z',
      lastModifiedAt: '2026-09-12T00:00:00.000Z'
    },
    questionnaireRevision: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    questionnaire: { name: 'Existing', questions: [], conditionRules: [], keyQuestionIds: [] }
  }
  new AISessionRepository(value, () => sessionId).create(getAiVersionStamp(), 'Integration')
  return value
}

describe('staged research agent integration', () => {
  it('runs planning, literature, web search, extraction, generation and local validation in order', async () => {
    const value = project()
    const captured: AIChatCompletionRequest[] = []
    const stages: string[] = []

    // One scripted Chat Completions transport drives the planner, the evidence extractor and the
    // questionnaire generator, so the test proves the whole pipeline rather than one stage.
    const complete = vi.fn(async (request: AIChatCompletionRequest) => {
      captured.push(request)
      const text = request.messages.map(({ content }) => content).join('\n')
      const content = text.includes('You plan literature searches')
        ? JSON.stringify(PLAN)
        : text.includes('You extract questionnaire design evidence')
          ? JSON.stringify(EVIDENCE)
          : JSON.stringify(ENVELOPE)
      return { content, streamingSupported: false, responseFormatSupported: true }
    })

    const pubmedSearch = vi.fn(async () => ({
      sources: [PUBMED_SOURCE],
      diagnostics: [{
        stage: 'literature' as const,
        protocol: 'pubmed-efetch' as const,
        outcome: 'success' as const,
        sourceCount: 1
      }]
    }))
    const webSearchTransport = vi.fn(async () => ({
      content: 'WHO recommends reducing dietary sodium to less than 5 g per day [1].',
      citations: [{ url: 'https://www.who.int/news-room/fact-sheets/detail/salt-reduction', title: 'WHO salt reduction' }],
      searched: true,
      streamingSupported: false
    }))

    const orchestrator = createAIQuestionnaireOrchestrator({
      persistProject: vi.fn(),
      client: { complete },
      researchPipeline: createAIResearchPipeline({
        planner: createAIResearchPlanner({ client: { complete } }),
        literature: createAILiteratureService({ pubmed: { search: pubmedSearch } }),
        webSearch: createAIWebSearchService({ client: { search: webSearchTransport } }),
        evidence: createAIEvidenceService({ client: { complete } })
      })
    })

    const result = await orchestrator.sendTurn({
      project: value,
      sessionId,
      userText: '为大学生设计一份高血压危险因素调查问卷',
      config: { baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash', apiKey: 'test-key' },
      requestId: 'request-1',
      operationId: 'operation-1',
      runId: 'run-1',
      onProgress: (event: AIProgressEvent) => {
        if (event.type === 'stage_changed') stages.push(event.stage)
      }
    })

    expect(result).toMatchObject({
      ok: true,
      outcome: 'questionnaire',
      researchStatus: 'literature_and_web',
      researchMode: 'medical'
    })
    expect(stages).toEqual(['planning', 'literature', 'web_search', 'extracting'])
    expect(pubmedSearch).toHaveBeenCalledOnce()
    expect(webSearchTransport).toHaveBeenCalledOnce()

    if (!result.ok || result.outcome !== 'questionnaire') throw new Error('expected a questionnaire')
    const artifactValue = result.artifact.value as {
      draft: unknown
      assistantMessage: string
    }

    // The generated draft is legal by the same shared validator the renderer runs.
    const format = validateQuestionnaireFormat(artifactValue.draft)
    expect(format.ok).toBe(true)
    expect(artifactValue.assistantMessage).toBe(ENVELOPE.assistantMessage)

    // Both retrieval layers reached the generator as untrusted quoted data.
    const generatorRequest = captured.find(({ messages }) =>
      messages.some(({ content }) => content.includes('easyepi_questionnaire_assistant') ||
        content.includes('Runtime research context'))
    )
    const generatorText = generatorRequest!.messages.map(({ content }) => content).join('\n')
    expect(generatorText).toContain('pubmed:12345678')
    expect(generatorText).toContain('untrusted quoted data')

    // Protocol guarantees: JSON output only, no tools, no function-calling remnants, no project secrets.
    for (const request of captured) {
      expect(request.outputMode).toBe('json_object')
      const body = JSON.stringify(request)
      expect(body).not.toContain('submit_questionnaire')
      expect(body).not.toContain('tool_choice')
      expect(body).not.toContain('must-not-enter-context')
    }
    const webRequest = webSearchTransport.mock.calls[0]![0] as { instructions?: string; input: string }
    expect(webRequest.instructions).toContain('WHO')
    expect(webRequest.input).toContain('Risk factors for hypertension among university students')
  })

  it('stops without generating when a medical request has no usable evidence', async () => {
    const value = project()
    const complete = vi.fn(async () => ({
      content: JSON.stringify(PLAN),
      streamingSupported: false,
      responseFormatSupported: true
    }))
    const orchestrator = createAIQuestionnaireOrchestrator({
      persistProject: vi.fn(),
      client: { complete },
      researchPipeline: createAIResearchPipeline({
        planner: createAIResearchPlanner({ client: { complete } }),
        literature: { search: async () => ({ sources: [], diagnostics: [] }) },
        webSearch: {
          search: async () => ({
            status: 'unsupported' as const,
            sources: [],
            citations: [],
            supported: false,
            diagnostic: {
              stage: 'web_search' as const,
              protocol: 'responses' as const,
              outcome: 'unsupported' as const
            }
          })
        },
        evidence: createAIEvidenceService({ client: { complete } })
      })
    })

    const result = await orchestrator.sendTurn({
      project: value,
      sessionId,
      userText: '为大学生设计一份高血压危险因素调查问卷',
      config: { baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash', apiKey: 'test-key' },
      requestId: 'request-2',
      operationId: 'operation-2',
      runId: 'run-2'
    })

    expect(result).toMatchObject({ ok: false, errorCode: 'AI_RESEARCH_NO_EVIDENCE' })
    // Only the planner ran; the generator never saw a request.
    expect(complete).toHaveBeenCalledOnce()
    const session = new AISessionRepository(value).get(sessionId)!
    expect(session.state.runs['run-2']).toMatchObject({ status: 'failed' })
    expect(Object.keys(session.artifacts.byId)).toHaveLength(0)
  })
})
