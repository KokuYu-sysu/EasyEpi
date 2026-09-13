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

const SYSTEM_PROMPT = `You plan questionnaire design for an epidemiology tool.
Return ONE JSON object and nothing else. Never wrap it in markdown.

The object carries these keys (extra keys are ignored, missing keys are tolerated):
{
  "originalLanguage": "tag of the request language, for example zh or en",
  "englishResearchQuestion": "the research question written in English",
  "domain": "medical" or "non_medical",
  "searchQueries": ["one to five English Boolean queries for PubMed"],
  "keywords": ["up to twenty English keywords"],
  "meshTerms": ["up to twenty English MeSH terms"],
  "population": "the study population in English, or an empty string",
  "exposureOrIntervention": "the exposure or intervention in English, or an empty string",
  "outcomes": ["the outcomes of interest in English"],
  "riskFactors": [
    { "factor": "English name of one risk factor or characteristic",
      "label": "the same factor in the language of the request",
      "category": "dietary, lifestyle, clinical, reproductive, physiological, psychosocial, demographic, environmental, or health-services" }
  ],
  "questionnaireDomains": [
    { "domain": "a questionnaire section name in the language of the request",
      "items": ["concrete question topics for that section, in the language of the request"] }
  ]
}

What this plan is used for:
- The questionnaire is built from the riskFactors and questionnaireDomains you list, informed by
  whatever evidence the search stages can retrieve for each factor separately.
- Do NOT try to find one published questionnaire that matches the request and reproduce it. There is
  usually no such paper. Enumerate the factors, exposures, and questionnaire domains that standard
  epidemiological practice covers for this topic, so each one can be searched for evidence.
- List what a domain expert would actually measure: dietary intake, lifestyle and behaviour, clinical
  history and medication, and for topics involving women also reproductive history (parity, age at
  menarche and menopause, breastfeeding) and sex-specific physiology. Include psychosocial and
  demographic factors when they are plausible confounders or effect modifiers.
- Give eight to twenty five riskFactors for a broad topic, and four to ten questionnaireDomains with
  two to six concrete items each.

Rules:
- englishResearchQuestion, searchQueries, keywords, meshTerms and every riskFactors[].factor must be
  written in English. Translate the request meaning into English first.
- riskFactors[].label, questionnaireDomains[].domain and questionnaireDomains[].items must be in the
  language of the user's request, because they become questionnaire text.
- domain is "medical" when the questionnaire concerns human health, disease, clinical care,
  epidemiology, public health, nursing, or health services research. Use "non_medical" only when the
  subject is clearly outside those areas. If you are unsure, choose "medical".
- searchQueries must be valid PubMed syntax: plain terms joined with AND or OR. No URLs, no PMIDs,
  no DOIs, no question marks.
- Never invent citations, never name a specific paper, and never write final questionnaire wording.`

function jsonRepairPrompt(errorCode: string, previous: string): string {
  return `The previous JSON object could not be used (code ${errorCode}). ` +
    'Return one corrected JSON object using the keys described in the system message. ' +
    'Keep every value in the required language: English for search keys, the request language for labels and domains. ' +
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
      maxOutputTokens: 16_384,
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
          // The previous answer is echoed inside the *user* turn rather than as an assistant turn.
          // DeepSeek's reasoning models require assistant messages to carry their reasoning content,
          // so replaying a bare assistant message can be rejected with a 400 and would turn a
          // repairable rejection into a hard provider error.
          messages.push({ role: 'user', content: jsonRepairPrompt(lastErrorCode, content) })
        }
      }
      throw new ResearchContractError(lastErrorCode)
    }
  }
}
