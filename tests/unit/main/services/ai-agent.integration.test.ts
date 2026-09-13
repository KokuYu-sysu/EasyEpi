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
  outcomes: ['hypertension prevalence'],
  riskFactors: [
    { factor: 'dietary sodium intake', label: '膳食钠摄入', category: 'dietary' },
    { factor: 'physical activity', label: '体力活动', category: 'lifestyle' },
    { factor: 'family history of hypertension', label: '高血压家族史', category: 'clinical' }
  ],
  questionnaireDomains: [
    { domain: '一般情况', items: ['年龄', '性别', '年级'] },
    { domain: '饮食与生活方式', items: ['每日食盐摄入量', '体力活动', '吸烟', '饮酒'] },
    { domain: '疾病家族史', items: ['直系亲属高血压史'] }
  ]
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

/**
 * The extractor now maps the plan's factor inventory onto the retrieved records instead of asserting
 * free-form claims: one factor cites the record that supports it, the others are kept with
 * `evidence: 'none'` so the questionnaire still covers them without presenting them as findings.
 */
const EVIDENCE = {
  researchQuestion: PLAN.englishResearchQuestion,
  factors: [
    {
      factor: 'dietary sodium intake',
      label: '膳食钠摄入',
      category: 'dietary',
      evidence: 'supported',
      sourceIds: [PUBMED_SOURCE.sourceId],
      note: 'About 12% of first-year university students had hypertension; dietary sodium was the exposure examined.'
    },
    {
      factor: 'physical activity',
      label: '体力活动',
      category: 'lifestyle',
      evidence: 'none',
      sourceIds: [],
      note: '没有检索到在该人群中测量体力活动的记录。'
    },
    {
      factor: 'family history of hypertension',
      label: '高血压家族史',
      category: 'clinical',
      evidence: 'none',
      sourceIds: [],
      note: '没有检索到报告高血压家族史的记录。'
    }
  ],
  questionnaireDomains: PLAN.questionnaireDomains,
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
      const content = text.includes('You plan questionnaire design')
        ? JSON.stringify(PLAN)
        : text.includes('You map retrieved records onto the questionnaire factor inventory')
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
    const webSearchTransport = vi.fn(async (_request: {
      instructions?: string
      input: string
      baseUrl: string
      model: string
    }) => ({
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
    // The blueprint instruction and the research context both carry the factor inventory and the
    // questionnaire domains, so the questionnaire is designed from the plan rather than from one paper.
    expect(generatorText).toContain('factorInventory')
    expect(generatorText).toContain('"questionnaireBlueprint"')
    expect(generatorText).toContain('膳食钠摄入')
    expect(generatorText).toContain('饮食与生活方式')
    expect(generatorText).toContain('高血压家族史')
    // A factor with no supporting record stays in the inventory, marked as not evidence-backed.
    expect(generatorText).toContain('"evidence":"none"')

    // Protocol guarantees: JSON output only, no tools, no function-calling remnants, no project secrets.
    for (const request of captured) {
      expect(request.outputMode).toBe('json_object')
      const body = JSON.stringify(request)
      expect(body).not.toContain('submit_questionnaire')
      expect(body).not.toContain('tool_choice')
      expect(body).not.toContain('must-not-enter-context')
    }
    const webRequest = webSearchTransport.mock.calls[0]![0]
    expect(webRequest.instructions).toContain('WHO')
    expect(webRequest.input).toContain('Risk factors for hypertension among university students')
  })

  it('builds a knowledge-only questionnaire when a medical request retrieves nothing', async () => {
    const value = project()
    const captured: AIChatCompletionRequest[] = []
    const complete = vi.fn(async (request: AIChatCompletionRequest) => {
      captured.push(request)
      const text = request.messages.map(({ content }) => content).join('\n')
      return {
        content: text.includes('You plan questionnaire design')
          ? JSON.stringify(PLAN)
          : JSON.stringify(ENVELOPE),
        streamingSupported: false,
        responseFormatSupported: true
      }
    })
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

    // Empty retrieval is no longer a hard stop: the run succeeds from the planner's factor inventory.
    expect(result).toMatchObject({
      ok: true,
      outcome: 'questionnaire',
      researchStatus: 'none',
      researchMode: 'medical',
      citations: []
    })
    // The planner and the generator each ran once; the extractor never did, because there was
    // nothing to extract.
    expect(complete).toHaveBeenCalledTimes(2)
    expect(captured[1]!.messages.map(({ content }) => content).join('\n'))
      .not.toContain('You map retrieved records')

    if (!result.ok || result.outcome !== 'questionnaire') throw new Error('expected a questionnaire')
    const artifactValue = result.artifact.value as { assistantMessage: string }
    expect(artifactValue.assistantMessage.startsWith('【本次未检索到外部证据】')).toBe(true)
    expect(artifactValue.assistantMessage).toContain('PubMed / Europe PMC 未返回可用记录')
    expect(artifactValue.assistantMessage).toContain('当前模型不支持内置联网搜索')

    const context = captured[1]!.messages
      .find(({ content }) => content.includes('Runtime research context'))!.content
    expect(context).toContain('"factorInventory"')
    expect(context).toContain('"questionnaireBlueprint"')
    expect(context).toContain('膳食钠摄入')
    expect(context).toContain('"evidence":"none"')
    expect(context).toContain('"citations":[]')
    expect(context).not.toContain('pubmed:')

    const session = new AISessionRepository(value).get(sessionId)!
    expect(session.state.runs['run-2']).toMatchObject({
      status: 'completed',
      result: { kind: 'questionnaire', researchStatus: 'none', researchMode: 'medical', citations: [] }
    })
    expect(Object.keys(session.artifacts.byId)).toHaveLength(1)
  })
})
