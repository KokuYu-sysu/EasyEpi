import type { AIMainConfig } from '../ai-config.service'
import type { AIChatCompletionRequest, AIChatCompletionResult } from '../openai-compatible.client'

import {
  ResearchContractError,
  parseResearchPlan,
  type ResearchDiagnostic,
  type ResearchPlan
} from './contracts'

export interface ResearchPlannerRequest {
  userText: string
  recentContext?: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }>
  config: AIMainConfig
  signal?: AbortSignal
}

export interface ResearchPlannerResult {
  plan: ResearchPlan
  diagnostic: ResearchDiagnostic
}

export interface AIResearchPlanner {
  plan(request: ResearchPlannerRequest): Promise<ResearchPlannerResult>
}

export interface AIResearchPlannerDependencies {
  client?: { complete(request: AIChatCompletionRequest): Promise<AIChatCompletionResult> }
  now?: () => Date
}

const MAX_CONTEXT_MESSAGES = 6
const MAX_CONTEXT_MESSAGE_CHARS = 4_000

const SYSTEM_PROMPT = `You plan literature searches for an epidemiology questionnaire builder.
Return ONE JSON object and nothing else. Never wrap it in markdown. Never add fields.

The object must have exactly these keys:
{
  "originalLanguage": "BCP-47-ish tag of the request language, for example zh or en",
  "englishResearchQuestion": "the research question written in English",
  "domain": "medical" or "non_medical",
  "searchQueries": ["one to three English Boolean queries for PubMed"],
  "keywords": ["up to twenty English keywords"],
  "meshTerms": ["up to twenty English MeSH terms"],
  "population": "the study population in English, or an empty string",
  "exposureOrIntervention": "the exposure or intervention in English, or an empty string",
  "outcomes": ["the outcomes of interest in English"]
}

Rules:
- englishResearchQuestion, searchQueries, keywords and meshTerms must be written in English only.
  Translate the request meaning into English first; never leave non-English characters in them.
- domain is "medical" when the questionnaire concerns human health, disease, clinical care,
  epidemiology, public health, nursing, or health services research. Use "non_medical" only when the
  subject is clearly outside those areas. If you are unsure, choose "medical".
- searchQueries must be valid PubMed syntax: plain terms joined with AND or OR. No quotes around the
  whole query, no field prefixes you cannot justify, no URLs, no PMIDs, no DOIs.
- Never invent citations, never mention any specific paper, and never write questionnaire fields.
- Translation is only for searching. The questionnaire itself will stay in the user's language.`

function jsonRepairPrompt(errorCode: string, previous: string): string {
  return `The previous JSON object was rejected with code ${errorCode}. ` +
    'Return one corrected JSON object with exactly the declared keys and value types. ' +
    `Previous response:${previous.slice(0, 4_000)}`
}

function boundedContext(
  context: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }> | undefined
): Array<{ role: 'user' | 'assistant'; content: string }> {
  if (context === undefined) return []
  return context
    .filter((message) => message.content.trim().length > 0)
    .slice(-MAX_CONTEXT_MESSAGES)
    .map((message) => ({ role: message.role, content: message.content.slice(0, MAX_CONTEXT_MESSAGE_CHARS) }))
}

export function createAIResearchPlanner(
  dependencies: AIResearchPlannerDependencies = {}
): AIResearchPlanner {
  const now = dependencies.now ?? (() => new Date())

  async function completeJson(
    request: ResearchPlannerRequest,
    messages: AIChatCompletionRequest['messages']
  ): Promise<string> {
    const client = dependencies.client
    if (client === undefined) throw new ResearchContractError('AI_RESEARCH_PLAN_INVALID')
    const result = await client.complete({
      baseUrl: request.config.baseUrl,
      model: request.config.model,
      ...(request.config.apiKey === undefined ? {} : { apiKey: request.config.apiKey }),
      messages,
      outputMode: 'json_object',
      streamingSupported: false,
      responseFormatSupported: true,
      maxOutputTokens: 4_096,
      ...(request.signal === undefined ? {} : { signal: request.signal })
    })
    return result.content
  }

  return {
    async plan(request) {
      const userText = request.userText.trim()
      if (userText.length === 0) throw new ResearchContractError('INVALID_AI_USER_TEXT')
      const today = now().toISOString().slice(0, 10)
      const messages: AIChatCompletionRequest['messages'] = [
        { role: 'system', content: SYSTEM_PROMPT },
        ...boundedContext(request.recentContext),
        { role: 'user', content: `${userText}\n\nCurrent date (ISO): ${today}` }
      ]

      let lastErrorCode = 'AI_RESEARCH_PLAN_INVALID'
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const content = await completeJson(request, messages)
        try {
          const plan = parseResearchPlan(JSON.parse(content))
          return {
            plan,
            diagnostic: { stage: 'planning', protocol: 'chat', outcome: 'success' }
          }
        } catch (error) {
          lastErrorCode = error instanceof ResearchContractError
            ? error.errorCode
            : 'AI_RESEARCH_PLAN_INVALID'
          if (request.signal?.aborted === true) throw new ResearchContractError('AI_CANCELLED')
          messages.push({ role: 'assistant', content: content.slice(0, 4_000) })
          messages.push({ role: 'user', content: jsonRepairPrompt(lastErrorCode, content) })
        }
      }
      throw new ResearchContractError(lastErrorCode)
    }
  }
}
