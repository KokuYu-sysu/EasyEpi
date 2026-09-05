import { describe, expect, it } from 'vitest'

import {
  QUESTIONNAIRE_SYSTEM_PROMPT,
  buildQuestionnaireContext,
  getAiVersionStamp,
  migrateAISessionVersion,
  resolveAIRegistryEntry,
  runQuestionnaireHarness,
  stripDerivedVariables
} from '@main/services/ai-questionnaire.harness'
import { createOpenAICompatibleClient } from '@main/services/openai-compatible.client'
import type { AISessionData } from '@shared/ai-assistant-contract'
import type { QuestionnaireDef } from '@shared/types/qnaire'

function envelope(questionnaire: unknown): string {
  return JSON.stringify({
    kind: 'questionnaire',
    assistantMessage: 'Draft ready',
    rollingSummary: 'Created a draft',
    options: [],
    questionnaire
  })
}

function clarification(options: unknown = [{ id: 'adult', label: 'Adults' }]): string {
  return JSON.stringify({
    kind: 'clarification',
    assistantMessage: 'Which population should this questionnaire cover?',
    rollingSummary: 'The study population is not decided.',
    options,
    questionnaire: null
  })
}

describe('questionnaire harness trust boundary', () => {
  it('uses the v2.2 prompt and harness stamp with schema v2', () => {
    const current = getAiVersionStamp()
    expect({
      promptVersion: current.promptVersion,
      harnessVersion: current.harnessVersion,
      schemaVersion: current.schemaVersion
    }).toEqual({ promptVersion: '2.2.0', harnessVersion: '2.2.0', schemaVersion: 2 })
  })

  it('guides authoritative academic retrieval and honest citation reporting', () => {
    const currentEntry = resolveAIRegistryEntry(getAiVersionStamp())
    expect(currentEntry.systemPrompt).toContain('Web Search')
    expect(currentEntry.systemPrompt).toContain('PubMed')
    expect(currentEntry.systemPrompt).toContain('Web of Science')
    expect(currentEntry.systemPrompt).toContain('WHO')
    expect(currentEntry.systemPrompt).toContain('CDC')
    expect(currentEntry.systemPrompt).toContain('国家卫生健康委员会')
    expect(currentEntry.systemPrompt).toMatch(/title and publishing institution when applicable/i)
    expect(currentEntry.systemPrompt).toMatch(/year/i)
    expect(currentEntry.systemPrompt).toMatch(/accessible URL/i)
    expect(currentEntry.systemPrompt).toMatch(/DOI\/PMID when available/i)
    expect(currentEntry.systemPrompt).toMatch(/cross-check/i)
    expect(currentEntry.systemPrompt).toMatch(/separate retrieved evidence from model suggestions.*assistantMessage/i)
    expect(currentEntry.systemPrompt).toMatch(/never fabricate.*DOI.*PMID.*URL/i)
    expect(currentEntry.systemPrompt).toMatch(/search is unavailable or.*evidence is insufficient/i)
  })

  it('retains historical registry stamps for directed migration to v2.2', () => {
    const current = getAiVersionStamp()
    const previous = {
      promptId: current.promptId,
      promptVersion: '1.1.0',
      promptHash: 'sha256:d407a445883fa9a015c8772201af387fdbca41df3f33545a58017ba79d47c832',
      harnessVersion: '1.1.0',
      schemaVersion: 1
    }
    const previousV2 = {
      promptId: current.promptId,
      promptVersion: '2.0.0',
      promptHash: 'sha256:1226be3d706ef0f4d05784d54e67e4e91d3d09d66d179783a72500f2231b1f36',
      harnessVersion: '2.0.0',
      schemaVersion: 2
    }
    const previousV2_1 = {
      promptId: current.promptId,
      promptVersion: '2.1.0',
      promptHash: 'sha256:c3ebc53c12c59795d68c65d53b900f5a4b87f62be8f1eca73f8f0cfde168f6ad',
      harnessVersion: '2.1.0',
      schemaVersion: 2
    }
    expect(resolveAIRegistryEntry(current)).toMatchObject({
      versionStamp: current,
      compatibility: 'supported'
    })
    expect(resolveAIRegistryEntry(previous)).toMatchObject({
      versionStamp: previous,
      compatibility: 'requires-migration'
    })
    expect(resolveAIRegistryEntry(previousV2)).toMatchObject({
      versionStamp: previousV2,
      compatibility: 'requires-migration'
    })
    expect(resolveAIRegistryEntry(previousV2_1)).toMatchObject({
      versionStamp: previousV2_1,
      compatibility: 'requires-migration'
    })
    expect(() => migrateAISessionVersion(previous, current)).not.toThrow()
    expect(() => migrateAISessionVersion(previousV2, current)).not.toThrow()
    expect(() => migrateAISessionVersion(previousV2_1, current)).not.toThrow()
    expect(() => resolveAIRegistryEntry({
      ...getAiVersionStamp(),
      promptHash: 'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
    })).toThrow('AI_VERSION_NOT_REGISTERED')
    expect(() => migrateAISessionVersion({ ...previous, promptVersion: '1.0.0' }, current))
      .toThrow('AI_VERSION_NOT_REGISTERED')
  })

  it('preserves privacy and regex rules while requesting one clarification before questionnaire data', () => {
    expect(QUESTIONNAIRE_SYSTEM_PROMPT).toContain('Never create, remove, or modify a regex constraint')
    expect(QUESTIONNAIRE_SYSTEM_PROMPT).toContain('use built-in non-regex constraints only')
    expect(QUESTIONNAIRE_SYSTEM_PROMPT).toContain('use question type fixed_length')
    expect(QUESTIONNAIRE_SYSTEM_PROMPT).toContain('Never request, infer, read, or emit derived variables')
    expect(QUESTIONNAIRE_SYSTEM_PROMPT).toContain('at most one core clarification question')
    expect(QUESTIONNAIRE_SYSTEM_PROMPT.indexOf('assistantMessage'))
      .toBeLessThan(QUESTIONNAIRE_SYSTEM_PROMPT.indexOf('questionnaire object'))
  })

  it('validates both root branches without running questionnaire validation for clarification', () => {
    const result = runQuestionnaireHarness(clarification())
    expect(result).toEqual({
      ok: true,
      kind: 'clarification',
      value: {
        assistantMessage: 'Which population should this questionnaire cover?',
        rollingSummary: 'The study population is not decided.',
        options: [{ id: 'adult', label: 'Adults' }],
        validation: { success: true, errors: [] }
      }
    })
    expect(runQuestionnaireHarness(JSON.stringify({
      kind: 'clarification',
      assistantMessage: 'Choose one',
      rollingSummary: '',
      options: [],
      questionnaire: { forbidden: true }
    }))).toMatchObject({
      ok: false,
      establishedKind: 'clarification',
      errors: expect.arrayContaining([
        expect.objectContaining({ code: 'INVALID_CLARIFICATION_OPTIONS' }),
        expect.objectContaining({ code: 'INVALID_CLARIFICATION_QUESTIONNAIRE' })
      ])
    })
    expect(runQuestionnaireHarness(JSON.stringify({
      kind: 'questionnaire', assistantMessage: 'Ready', rollingSummary: '',
      options: [{ id: 'x', label: 'X' }], questionnaire: null
    }))).toMatchObject({
      ok: false,
      establishedKind: 'questionnaire',
      errors: expect.arrayContaining([
        expect.objectContaining({ code: 'INVALID_QUESTIONNAIRE_OPTIONS' }),
        expect.objectContaining({ code: 'INVALID_QUESTIONNAIRE' })
      ])
    })
  })

  it('rejects duplicate keys, duplicate or unbounded options, and branch switches during repair', () => {
    expect(runQuestionnaireHarness(
      '{"kind":"clarification","kind":"questionnaire","assistantMessage":"x","rollingSummary":"","options":[],"questionnaire":null}'
    )).toMatchObject({ ok: false, errors: [{ code: 'DUPLICATE_JSON_KEY' }] })
    expect(runQuestionnaireHarness(clarification([
      { id: 'same', label: 'One' }, { id: 'same', label: 'Two' }
    ]))).toMatchObject({ ok: false, establishedKind: 'clarification' })
    expect(runQuestionnaireHarness(clarification([{ id: 'ok', label: 'x'.repeat(201) }])))
      .toMatchObject({ ok: false, establishedKind: 'clarification' })
    expect(runQuestionnaireHarness(clarification(), undefined, [], 'questionnaire')).toMatchObject({
      ok: false,
      establishedKind: 'clarification',
      errors: [{ code: 'AI_RESPONSE_BRANCH_SWITCH' }]
    })
    const malformed = runQuestionnaireHarness('{', undefined, [], undefined)
    expect(malformed).toMatchObject({ ok: false })
    expect(malformed).not.toHaveProperty('establishedKind')
  })

  it('preserves an established branch when a parseable response exceeds candidate limits', () => {
    const oversized = JSON.stringify({
      kind: 'clarification',
      assistantMessage: 'x'.repeat(20_001),
      rollingSummary: '',
      options: [{ id: 'one', label: 'One' }],
      questionnaire: null
    })
    expect(runQuestionnaireHarness(oversized)).toMatchObject({
      ok: false,
      establishedKind: 'clarification',
      errors: [{ code: 'AI_CANDIDATE_LIMIT_EXCEEDED' }]
    })
  })

  it('enforces branch locking through the supported registry harness entry', () => {
    const entry = resolveAIRegistryEntry(getAiVersionStamp())
    if (entry.compatibility !== 'supported') throw new Error('expected supported registry entry')
    expect(entry.runHarness(clarification(), undefined, [], 'questionnaire')).toMatchObject({
      ok: false,
      establishedKind: 'clarification',
      errors: [{ code: 'AI_RESPONSE_BRANCH_SWITCH' }]
    })
  })

  it('selects the registered v2 provider schema with five required nullable-superset fields', async () => {
    let requestBody: {
      response_format: {
        json_schema: {
          schema: {
            type: string
            additionalProperties: boolean
            required: string[]
            anyOf?: unknown
            properties: { questionnaire: { type: string[] } }
          }
        }
      }
    } | undefined
    const client = createOpenAICompatibleClient({
      fetch: async (_input, init) => {
        requestBody = JSON.parse(String(init?.body)) as typeof requestBody
        return new Response(JSON.stringify({
          choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: clarification() } }]
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
    })
    await expect(client.complete({
      baseUrl: 'https://example.test/v1', model: 'model', messages: [], schemaVersion: 2,
      streamingSupported: false
    })).resolves.toMatchObject({ responseFormatSupported: true })
    const schema = requestBody?.response_format.json_schema.schema
    if (schema === undefined) throw new Error('expected response schema')
    expect(schema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'assistantMessage', 'rollingSummary', 'options', 'questionnaire']
    })
    expect(schema.anyOf).toBeUndefined()
    expect(schema.properties.questionnaire.type).toEqual(['object', 'null'])
    await expect(client.complete({
      baseUrl: 'https://example.test/v1', model: 'model', messages: [], schemaVersion: 1
    })).rejects.toThrow('AI_SCHEMA_NOT_REGISTERED')
  })

  it('rejects forbidden fields and invalid references with structured errors', () => {
    const forbidden = runQuestionnaireHarness(envelope({
      name: 'Study',
      questions: [],
      conditionRules: [],
      keyQuestionIds: [],
      derivedVariables: [{ variableName: 'secret' }]
    }))
    expect(forbidden).toMatchObject({
      ok: false,
      establishedKind: 'questionnaire',
      errors: [{ code: 'FORBIDDEN_FIELD', path: '$.questionnaire.derivedVariables' }]
    })

    const brokenReference = runQuestionnaireHarness(envelope({
      name: 'Study',
      questions: [{
        id: 'q1',
        content: 'Age',
        variableName: 'age',
        type: 'numeric_range',
        options: [],
        constraint: { type: 'integer', minValue: 0, maxValue: 120 },
        isKey: false,
        allowSkip: false,
        order: 8
      }],
      conditionRules: [{
        id: 'r1',
        sourceQuestionId: 'q1',
        conditions: [{ questionId: 'missing', operator: 'equals', value: '1' }],
        logic: 'AND',
        action: 'show',
        targetQuestionIds: ['missing']
      }],
      keyQuestionIds: []
    }))
    expect(brokenReference.ok).toBe(false)
    if (!brokenReference.ok) {
      expect(brokenReference.establishedKind).toBe('questionnaire')
      expect(brokenReference.errors.map((error) => error.code)).toEqual(expect.arrayContaining([
        'UNKNOWN_CONDITION_QUESTION', 'UNKNOWN_TARGET'
      ]))
    }
  })

  it('normalizes order and ids while protecting derived-variable names', () => {
    const text = `\`\`\`json\n${envelope({
      name: 'Study',
      questions: [{
        content: 'Participant code',
        variableName: 'participant_code',
        type: 'free_text',
        isKey: true,
        allowSkip: false,
        order: 99
      }],
      conditionRules: [],
      keyQuestionIds: []
    })}\n\`\`\``
    const mismatch = runQuestionnaireHarness(text)
    expect(mismatch).toMatchObject({ ok: false, errors: [{ code: 'KEY_QUESTION_MISMATCH' }] })

    const protectedName = runQuestionnaireHarness(envelope({
      name: 'Study',
      questions: [{
        content: 'BMI', variableName: 'bmi', type: 'free_text', isKey: false, allowSkip: false
      }],
      conditionRules: [],
      keyQuestionIds: []
    }), undefined, ['bmi'])
    expect(protectedName).toMatchObject({ ok: false, errors: [{ code: 'DUPLICATE_VARIABLE_NAME' }] })
    expect(getAiVersionStamp().promptHash).toMatch(/^sha256:[a-f0-9]{64}$/)
  })

  it('never trusts model ids and preserves only semantically stable local ids', () => {
    const base: QuestionnaireDef = {
      name: 'Study',
      questions: [{
        id: 'local-age', content: 'Age', variableName: 'age', type: 'numeric_range',
        options: [], constraint: { type: 'integer' }, isKey: false, allowSkip: false, order: 0
      }, {
        id: 'local-consent', content: 'Consent', variableName: 'consent', type: 'single_choice',
        options: [{ value: '1', label: 'Yes' }], constraint: { type: 'none' },
        isKey: false, allowSkip: false, order: 1
      }],
      conditionRules: [{
        id: 'local-rule', sourceQuestionId: 'local-age',
        conditions: [{ questionId: 'local-age', operator: 'greater_than', value: '17' }],
        logic: 'AND', action: 'show', targetQuestionIds: ['local-consent']
      }],
      keyQuestionIds: []
    }
    const result = runQuestionnaireHarness(envelope({
      name: 'Study',
      questions: [
        {
          id: 'local-age', content: 'Age in years', variableName: 'age_years', type: 'numeric_range',
          options: [], constraint: { type: 'integer' }, isKey: false, allowSkip: false, order: 4
        },
        {
          id: 'model-consent', content: 'Consent', variableName: 'consent', type: 'single_choice',
          options: [{ value: '1', label: 'Yes' }], constraint: { type: 'none' },
          isKey: false, allowSkip: false, order: 5
        },
        {
          id: 'model-sex', content: 'Sex', variableName: 'sex', type: 'free_text', options: [],
          constraint: { type: 'none' }, isKey: false, allowSkip: false, order: 6
        }
      ],
      conditionRules: [{
        id: 'model-rule', sourceQuestionId: 'local-age',
        conditions: [{ questionId: 'local-age', operator: 'greater_than', value: '17' }],
        logic: 'AND', action: 'show', targetQuestionIds: ['model-consent']
      }],
      keyQuestionIds: []
    }), base)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    if (result.kind !== 'questionnaire') throw new Error('expected questionnaire branch')
    expect(result.value.draft.questions[0]?.id).toBe('local-age')
    expect(result.value.draft.questions[1]?.id).toBe('local-consent')
    expect(result.value.draft.questions[2]?.id).not.toBe('model-sex')
    expect(result.value.draft.conditionRules[0]?.id).toBe('local-rule')
  })

  it('requires the current user turn and rejects non-DTO attachment fields', () => {
    const stamp = getAiVersionStamp()
    const session: AISessionData = {
      manifest: {
        sessionId: '123e4567-e89b-42d3-a456-426614174000', title: 'AI', versionStamp: stamp,
        createdAt: '2026-08-25T00:00:00.000Z', updatedAt: '2026-08-25T00:00:00.000Z'
      },
      conversation: {
        messages: [{
          id: 'current', role: 'user', content: 'x'.repeat(200),
          createdAt: '2026-08-25T00:00:00.000Z'
        }],
        attachments: {}
      },
      state: { status: 'idle', runs: {}, values: {} },
      cache: { values: {} }, artifacts: { byId: {} }, temp: { runs: {} }
    }
    expect(() => buildQuestionnaireContext(session, undefined, undefined, 100)).toThrow('AI_CONTEXT_TOO_LARGE')
    session.conversation.messages = [
      { id: 'old-user', role: 'user', content: 'u'.repeat(30_000), createdAt: '2026-08-24T00:00:00.000Z' },
      { id: 'old-assistant', role: 'assistant', content: 'a'.repeat(30_000), createdAt: '2026-08-24T00:01:00.000Z' },
      { id: 'current', role: 'user', content: 'current', createdAt: '2026-08-25T00:00:00.000Z' }
    ]
    const bounded = buildQuestionnaireContext(session, undefined, undefined, 50_000)
    expect(bounded.filter((message) => message.role !== 'system')).toEqual([
      { role: 'user', content: 'current' }
    ])
    expect(() => stripDerivedVariables({
      name: 'Study', questions: [], conditionRules: [], keyQuestionIds: [],
      admin: { password: 'secret' }
    } as unknown as QuestionnaireDef)).toThrow('AI_QUESTIONNAIRE_DTO_INVALID')
    expect(() => stripDerivedVariables({
      name: 'Study', conditionRules: [], keyQuestionIds: [],
      questions: [{
        id: 'q1', content: 'Age', variableName: 'age', type: 'free_text', options: [],
        constraint: { type: 'none' }, isKey: false, allowSkip: false, order: 0,
        responses: ['secret']
      }]
    } as unknown as QuestionnaireDef)).toThrow('AI_QUESTIONNAIRE_DTO_INVALID')
  })

  it('rejects cyclic and conflicting cross-rule dependencies', () => {
    const question = (id: string, variableName: string) => ({
      id, content: variableName, variableName, type: 'free_text', options: [],
      constraint: { type: 'none' }, isKey: false, allowSkip: false, order: 0
    })
    const result = runQuestionnaireHarness(envelope({
      name: 'Study', questions: [question('q1', 'a'), question('q2', 'b')], keyQuestionIds: [],
      conditionRules: [
        {
          id: 'r1', sourceQuestionId: 'q1',
          conditions: [{ questionId: 'q1', operator: 'is_not_empty', value: '' }],
          logic: 'AND', action: 'show', targetQuestionIds: ['q2']
        },
        {
          id: 'r2', sourceQuestionId: 'q2',
          conditions: [{ questionId: 'q2', operator: 'is_not_empty', value: '' }],
          logic: 'AND', action: 'show', targetQuestionIds: ['q1']
        },
        {
          id: 'r3', sourceQuestionId: 'q1',
          conditions: [{ questionId: 'q1', operator: 'is_not_empty', value: '' }],
          logic: 'AND', action: 'skip', targetQuestionIds: ['q2']
        }
      ]
    }))
    expect(result).toMatchObject({ ok: false })
    if (!result.ok) expect(result.errors.map((error) => error.code)).toEqual(expect.arrayContaining([
      'CONDITION_RULE_CYCLE', 'UNREACHABLE_SHOW_CHAIN', 'CONDITION_ACTION_CONFLICT'
    ]))
  })

  it('forbids generated regex constraints and rejects oversized candidates', () => {
    const regexQuestion: QuestionnaireDef['questions'][number] = {
      id: 'local-code', content: 'Code', variableName: 'code', type: 'free_text', options: [],
      constraint: { type: 'regex', regexPattern: '^[A-Z]+$', regexFlags: '' },
      isKey: false, allowSkip: false, order: 0
    }
    const regexCandidate: QuestionnaireDef = {
      name: 'Study', questions: [regexQuestion], conditionRules: [], keyQuestionIds: []
    }
    expect(runQuestionnaireHarness(envelope(regexCandidate))).toMatchObject({
      ok: false,
      errors: [{ code: 'AI_REGEX_GENERATION_NOT_ALLOWED' }]
    })
    const base = structuredClone(regexCandidate)
    expect(runQuestionnaireHarness(envelope(regexCandidate), base).ok).toBe(true)
    const modified = structuredClone(regexCandidate)
    modified.questions[0]!.constraint.regexPattern = '^.*$'
    expect(runQuestionnaireHarness(envelope(modified), base)).toMatchObject({
      ok: false,
      errors: [{ code: 'AI_REGEX_GENERATION_NOT_ALLOWED' }]
    })

    const oversized = runQuestionnaireHarness(envelope({
      name: 'Study', conditionRules: [], keyQuestionIds: [],
      questions: Array.from({ length: 501 }, (_, order) => ({
        content: `Question ${order}`, variableName: `q_${order}`, type: 'free_text',
        options: [], constraint: { type: 'none' }, isKey: false, allowSkip: false, order
      }))
    }))
    expect(oversized).toMatchObject({
      ok: false,
      errors: [{ code: 'AI_CANDIDATE_LIMIT_EXCEEDED' }]
    })

    const performanceBase: QuestionnaireDef = {
      name: 'Performance',
      questions: Array.from({ length: 61 }, (_, order) => ({
        id: `q${order}`, content: `Question ${order}`, variableName: `perf_${order}`,
        type: 'free_text', options: [], constraint: { type: 'none' },
        isKey: false, allowSkip: false, order
      })),
      conditionRules: Array.from({ length: 200 }, (_, index) => ({
        id: `rule${index}`, sourceQuestionId: 'q0',
        conditions: [{ questionId: 'q0', operator: 'contains', value: `value${index}` }],
        logic: 'AND', action: 'show',
        targetQuestionIds: Array.from({ length: 60 }, (_, target) => `q${target + 1}`)
      })),
      keyQuestionIds: []
    }
    const performanceCandidate = structuredClone(performanceBase)
    performanceCandidate.conditionRules.reverse()
    const startedAt = performance.now()
    const performanceResult = runQuestionnaireHarness(envelope(performanceCandidate), performanceBase)
    expect([performanceResult.ok, performance.now() - startedAt < 100]).toEqual([true, true])
  })
})
