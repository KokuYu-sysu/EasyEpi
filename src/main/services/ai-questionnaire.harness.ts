import { createHash, randomUUID } from 'node:crypto'

import type {
  AIArtifact,
  AIJsonValue,
  AiVersionStamp,
  AISessionData
} from '@shared/ai-assistant-contract'
import { DERIVED_VARIABLE_NAME_PATTERN } from '@shared/types/derived'
import {
  isConditionOperator,
  isConstraintType,
  isQuestionType,
  validateQuestionAnswer,
  type ConditionDef,
  type ConditionRule,
  type ConstraintDef,
  type OptionItem,
  type QuestionDef,
  type QuestionnaireDef
} from '@shared/types/qnaire'

export const AI_PROMPT_ID = 'easyepi-questionnaire-assistant'
export const AI_PROMPT_VERSION = '1.1.0'
export const HARNESS_VERSION = '1.1.0'
export const QUESTIONNAIRE_SCHEMA_VERSION = 1

const QUESTIONNAIRE_SYSTEM_PROMPT_V1_0_0 = `You are EasyEpi's questionnaire drafting assistant.
You may create or revise only: questionnaire name and description; questions; question types; options; variable names; order; required/allowSkip behavior; skip/default values; constraints; key-question flags; and conditional rules.
Never request, infer, read, or emit derived variables, responses, baseline data, administrator data, files, passwords, credentials, or filesystem paths. Never output a project file or instructions to modify one.
Return exactly one strict JSON object with keys assistantMessage, rollingSummary, and questionnaire. The questionnaire candidate may contain only name, description, questions, conditionRules, and keyQuestionIds. Each question may contain only id, content, variableName, type, options, constraint, defaultValue, isKey, allowSkip, skipValue, and order. Each rule may contain only id, sourceQuestionId, conditions, logic, action, and targetQuestionIds. Do not use markdown except that a single JSON fence is tolerated by the local parser.`

const QUESTIONNAIRE_SYSTEM_PROMPT_V1_1_0 = `You are EasyEpi's questionnaire drafting assistant.
You may create or revise only: questionnaire name and description; questions; question types; options; variable names; order; required/allowSkip behavior; skip/default values; constraints; key-question flags; and conditional rules.
Never create, remove, or modify a regex constraint. An existing regex constraint may only be copied with exactly the same regexPattern and regexFlags.
Never request, infer, read, or emit derived variables, responses, baseline data, administrator data, files, passwords, credentials, or filesystem paths. Never output a project file or instructions to modify one.
Return exactly one strict JSON object with keys assistantMessage, rollingSummary, and questionnaire. The questionnaire candidate may contain only name, description, questions, conditionRules, and keyQuestionIds. Each question may contain only id, content, variableName, type, options, constraint, defaultValue, isKey, allowSkip, skipValue, and order. Each rule may contain only id, sourceQuestionId, conditions, logic, action, and targetQuestionIds. Do not use markdown except that a single JSON fence is tolerated by the local parser.`

export const QUESTIONNAIRE_SYSTEM_PROMPT = QUESTIONNAIRE_SYSTEM_PROMPT_V1_1_0

export interface AIValidationError {
  code: string
  path: string
  message: string
}

export interface QuestionnaireDiffSummary {
  metadata: {
    name: { before: string; after: string } | null
    description: { before: string | null; after: string | null } | null
  }
  questions: {
    added: Array<{ id: string; variableName: string; content: string }>
    removed: Array<{ id: string; variableName: string; content: string }>
    modified: Array<{ id: string; variableName: string; fields: string[] }>
  }
  rules: {
    added: string[]
    removed: string[]
    modified: string[]
  }
}

export interface QuestionnaireHarnessValue {
  draft: QuestionnaireDef
  diff: QuestionnaireDiffSummary
  assistantMessage: string
  rollingSummary: string
  validation: { success: true; errors: [] }
}

export interface QuestionnaireArtifactValue extends QuestionnaireHarnessValue {
  baseQuestionnaireHash: string
  baseQuestionnaire: QuestionnaireDef
}

interface AIRegistryEntryBase {
  versionStamp: AiVersionStamp
  systemPrompt: string
  schemaVersion: number
}

export type AIRegistryEntry = AIRegistryEntryBase & ({
  compatibility: 'supported'
  runHarness(
    responseText: string,
    base?: QuestionnaireDef,
    protectedDerivedVariableNames?: readonly string[]
  ): QuestionnaireHarnessResult
} | {
  compatibility: 'requires-migration'
})

export type QuestionnaireHarnessResult =
  | { ok: true; value: QuestionnaireHarnessValue }
  | { ok: false; errors: AIValidationError[] }

type JsonObject = Record<string, unknown>

const ENVELOPE_FIELDS = new Set(['assistantMessage', 'rollingSummary', 'questionnaire'])
const QUESTIONNAIRE_FIELDS = new Set([
  'name', 'description', 'questions', 'conditionRules', 'keyQuestionIds'
])
const QUESTIONNAIRE_ATTACHMENT_FIELDS = new Set([...QUESTIONNAIRE_FIELDS, 'derivedVariables'])
const QUESTION_FIELDS = new Set([
  'id', 'content', 'variableName', 'type', 'options', 'constraint', 'defaultValue',
  'isKey', 'allowSkip', 'skipValue', 'order'
])
const OPTION_FIELDS = new Set(['value', 'label'])
const CONSTRAINT_FIELDS = new Set([
  'type', 'fixedLength', 'minValue', 'maxValue', 'step', 'regexPattern', 'regexFlags'
])
const RULE_FIELDS = new Set([
  'id', 'sourceQuestionId', 'conditions', 'logic', 'action', 'targetQuestionIds'
])
const CONDITION_FIELDS = new Set(['questionId', 'operator', 'value'])
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const MAX_MODEL_TEXT_LENGTH = 2_000_000
const MAX_SINGLE_STRING_LENGTH = 20_000
const MAX_QUESTIONS = 500
const MAX_OPTIONS_PER_QUESTION = 500
const MAX_RULES = 1_000
const MAX_CONDITIONS_PER_RULE = 100
const MAX_TARGETS_PER_RULE = 500
const MAX_CANDIDATE_NODES = 50_000
const MAX_VALIDATION_ERRORS = 100

function isObject(value: unknown): value is JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function addError(
  errors: AIValidationError[],
  code: string,
  path: string,
  message: string
): void {
  if (errors.length < MAX_VALIDATION_ERRORS) errors.push({ code, path, message })
}

function rejectUnknownFields(
  value: unknown,
  allowed: ReadonlySet<string>,
  path: string,
  errors: AIValidationError[]
): value is JsonObject {
  if (!isObject(value)) {
    addError(errors, 'INVALID_TYPE', path, 'Expected an object')
    return false
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) addError(errors, 'FORBIDDEN_FIELD', `${path}.${key}`, 'Field is not allowed')
  }
  return true
}

function stripJsonFence(text: string): string {
  const trimmed = text.trim()
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed)
  return match?.[1] ?? trimmed
}

function validateCandidateLimits(value: unknown): AIValidationError[] {
  const errors: AIValidationError[] = []
  const questionnaire = isObject(value) && isObject(value.questionnaire)
    ? value.questionnaire
    : isObject(value) ? value : undefined
  if (questionnaire !== undefined) {
    const questions = Array.isArray(questionnaire.questions) ? questionnaire.questions : []
    const rules = Array.isArray(questionnaire.conditionRules) ? questionnaire.conditionRules : []
    if (questions.length > MAX_QUESTIONS) {
      addError(errors, 'AI_CANDIDATE_LIMIT_EXCEEDED', '$.questionnaire.questions', 'Too many questions')
    }
    if (rules.length > MAX_RULES) {
      addError(errors, 'AI_CANDIDATE_LIMIT_EXCEEDED', '$.questionnaire.conditionRules', 'Too many rules')
    }
    if (Array.isArray(questionnaire.keyQuestionIds) && questionnaire.keyQuestionIds.length > MAX_QUESTIONS) {
      addError(errors, 'AI_CANDIDATE_LIMIT_EXCEEDED', '$.questionnaire.keyQuestionIds', 'Too many key questions')
    }
    for (const [index, question] of questions.slice(0, MAX_QUESTIONS).entries()) {
      if (isObject(question) && Array.isArray(question.options) &&
        question.options.length > MAX_OPTIONS_PER_QUESTION) {
        addError(errors, 'AI_CANDIDATE_LIMIT_EXCEEDED', `$.questionnaire.questions[${index}].options`, 'Too many options')
      }
    }
    for (const [index, rule] of rules.slice(0, MAX_RULES).entries()) {
      if (!isObject(rule)) continue
      if (Array.isArray(rule.conditions) && rule.conditions.length > MAX_CONDITIONS_PER_RULE) {
        addError(errors, 'AI_CANDIDATE_LIMIT_EXCEEDED', `$.questionnaire.conditionRules[${index}].conditions`, 'Too many conditions')
      }
      if (Array.isArray(rule.targetQuestionIds) && rule.targetQuestionIds.length > MAX_TARGETS_PER_RULE) {
        addError(errors, 'AI_CANDIDATE_LIMIT_EXCEEDED', `$.questionnaire.conditionRules[${index}].targetQuestionIds`, 'Too many targets')
      }
    }
  }
  if (errors.length > 0) return errors

  const stack: unknown[] = [value]
  let nodes = 0
  while (stack.length > 0) {
    const current = stack.pop()
    nodes += 1
    if (nodes > MAX_CANDIDATE_NODES) {
      addError(errors, 'AI_CANDIDATE_LIMIT_EXCEEDED', '$', 'Candidate is too complex')
      return errors
    }
    if (typeof current === 'string' && current.length > MAX_SINGLE_STRING_LENGTH) {
      addError(errors, 'AI_CANDIDATE_LIMIT_EXCEEDED', '$', 'Candidate contains an oversized string')
      return errors
    }
    const children = Array.isArray(current)
      ? current
      : isObject(current) ? Object.values(current) : []
    if (nodes + stack.length + children.length > MAX_CANDIDATE_NODES) {
      addError(errors, 'AI_CANDIDATE_LIMIT_EXCEEDED', '$', 'Candidate is too complex')
      return errors
    }
    stack.push(...children)
  }
  return errors
}

function parseEnvelope(text: string): { value?: JsonObject; errors: AIValidationError[] } {
  const errors: AIValidationError[] = []
  if (typeof text !== 'string' || text.length === 0 || text.length > MAX_MODEL_TEXT_LENGTH) {
    addError(errors, 'INVALID_ENVELOPE_SIZE', '$', 'Model response is empty or too large')
    return { errors }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(stripJsonFence(text))
  } catch {
    addError(errors, 'INVALID_JSON', '$', 'Response must be strict JSON')
    return { errors }
  }
  const limitErrors = validateCandidateLimits(parsed)
  if (limitErrors.length > 0) return { errors: limitErrors }
  if (!rejectUnknownFields(parsed, ENVELOPE_FIELDS, '$', errors)) return { errors }
  if (typeof parsed.assistantMessage !== 'string' || parsed.assistantMessage.trim().length === 0) {
    addError(errors, 'INVALID_ASSISTANT_MESSAGE', '$.assistantMessage', 'Message must be non-empty')
  } else if (parsed.assistantMessage.length > 20_000) {
    addError(errors, 'INVALID_ASSISTANT_MESSAGE', '$.assistantMessage', 'Message is too long')
  }
  if (typeof parsed.rollingSummary !== 'string') {
    addError(errors, 'INVALID_ROLLING_SUMMARY', '$.rollingSummary', 'Summary must be a string')
  } else if (parsed.rollingSummary.length > 20_000) {
    addError(errors, 'INVALID_ROLLING_SUMMARY', '$.rollingSummary', 'Summary is too long')
  }
  inspectCandidate(parsed.questionnaire, '$.questionnaire', errors)
  return errors.length === 0 ? { value: parsed, errors } : { errors }
}

function inspectCandidate(value: unknown, path: string, errors: AIValidationError[]): void {
  if (!rejectUnknownFields(value, QUESTIONNAIRE_FIELDS, path, errors)) return
  if (typeof value.name !== 'string') addError(errors, 'INVALID_TYPE', `${path}.name`, 'Name must be a string')
  if (value.description !== undefined && value.description !== null && typeof value.description !== 'string') addError(errors, 'INVALID_TYPE', `${path}.description`, 'Description must be a string or null')
  if (value.keyQuestionIds !== undefined && (!Array.isArray(value.keyQuestionIds) || value.keyQuestionIds.some((id) => typeof id !== 'string'))) {
    addError(errors, 'INVALID_TYPE', `${path}.keyQuestionIds`, 'Key question ids must be strings')
  }
  if (value.questions !== undefined && !Array.isArray(value.questions)) {
    addError(errors, 'INVALID_TYPE', `${path}.questions`, 'Questions must be an array')
  } else {
    const rawQuestionIds = new Set<string>()
    for (const [index, question] of (value.questions ?? []).entries()) {
      const questionPath = `${path}.questions[${index}]`
      if (!rejectUnknownFields(question, QUESTION_FIELDS, questionPath, errors)) continue
      for (const field of ['id', 'content', 'variableName', 'defaultValue', 'skipValue'] as const) {
        if (question[field] !== undefined && question[field] !== null && typeof question[field] !== 'string') {
          addError(errors, 'INVALID_TYPE', `${questionPath}.${field}`, `${field} must be a string or null`)
        }
      }
      if (typeof question.type !== 'string' || !isQuestionType(question.type)) {
        addError(errors, 'INVALID_QUESTION_TYPE', `${questionPath}.type`, 'Question type is invalid')
      }
      if (typeof question.id === 'string' && ID_PATTERN.test(question.id)) {
        if (rawQuestionIds.has(question.id)) addError(errors, 'DUPLICATE_QUESTION_ID', `${questionPath}.id`, 'Question id must be unique')
        rawQuestionIds.add(question.id)
      }
      for (const field of ['isKey', 'allowSkip'] as const) {
        if (question[field] !== undefined && typeof question[field] !== 'boolean') {
          addError(errors, 'INVALID_TYPE', `${questionPath}.${field}`, `${field} must be boolean`)
        }
      }
      if (question.order !== undefined && (!Number.isInteger(question.order) || (question.order as number) < 0)) {
        addError(errors, 'INVALID_ORDER', `${questionPath}.order`, 'Order must be a non-negative integer')
      }
      if (question.options !== undefined && !Array.isArray(question.options)) {
        addError(errors, 'INVALID_TYPE', `${questionPath}.options`, 'Options must be an array')
      } else {
        for (const [optionIndex, option] of (question.options ?? []).entries()) {
          const optionPath = `${questionPath}.options[${optionIndex}]`
          if (!rejectUnknownFields(option, OPTION_FIELDS, optionPath, errors)) continue
          if (typeof option.value !== 'string' || typeof option.label !== 'string') {
            addError(errors, 'INVALID_TYPE', optionPath, 'Option value and label must be strings')
          }
        }
      }
      if (question.constraint !== undefined) {
        const constraintPath = `${questionPath}.constraint`
        if (rejectUnknownFields(question.constraint, CONSTRAINT_FIELDS, constraintPath, errors)) {
          if (typeof question.constraint.type !== 'string' || !isConstraintType(question.constraint.type)) {
            addError(errors, 'INVALID_CONSTRAINT_TYPE', `${constraintPath}.type`, 'Constraint type is invalid')
          }
          for (const field of ['fixedLength', 'minValue', 'maxValue', 'step'] as const) {
            if (question.constraint[field] !== undefined && question.constraint[field] !== null && typeof question.constraint[field] !== 'number') {
              addError(errors, 'INVALID_TYPE', `${constraintPath}.${field}`, `${field} must be numeric or null`)
            }
          }
          for (const field of ['regexPattern', 'regexFlags'] as const) {
            if (question.constraint[field] !== undefined && question.constraint[field] !== null && typeof question.constraint[field] !== 'string') {
              addError(errors, 'INVALID_TYPE', `${constraintPath}.${field}`, `${field} must be a string or null`)
            }
          }
        }
      }
    }
  }
  if (value.conditionRules !== undefined && !Array.isArray(value.conditionRules)) {
    addError(errors, 'INVALID_TYPE', `${path}.conditionRules`, 'Rules must be an array')
  } else {
    const rawRuleIds = new Set<string>()
    for (const [index, rule] of (value.conditionRules ?? []).entries()) {
      const rulePath = `${path}.conditionRules[${index}]`
      if (!rejectUnknownFields(rule, RULE_FIELDS, rulePath, errors)) continue
      for (const field of ['id', 'sourceQuestionId'] as const) {
        if (rule[field] !== undefined && typeof rule[field] !== 'string') addError(errors, 'INVALID_TYPE', `${rulePath}.${field}`, `${field} must be a string`)
      }
      if (typeof rule.id === 'string' && ID_PATTERN.test(rule.id)) {
        if (rawRuleIds.has(rule.id)) addError(errors, 'DUPLICATE_RULE_ID', `${rulePath}.id`, 'Rule id must be unique')
        rawRuleIds.add(rule.id)
      }
      if (rule.logic !== 'AND' && rule.logic !== 'OR') addError(errors, 'INVALID_LOGIC', `${rulePath}.logic`, 'Rule logic is invalid')
      if (rule.action !== 'skip' && rule.action !== 'show' && rule.action !== 'require') addError(errors, 'INVALID_ACTION', `${rulePath}.action`, 'Rule action is invalid')
      if (rule.targetQuestionIds !== undefined && (!Array.isArray(rule.targetQuestionIds) || rule.targetQuestionIds.some((id) => typeof id !== 'string'))) {
        addError(errors, 'INVALID_TYPE', `${rulePath}.targetQuestionIds`, 'Targets must be strings')
      }
      if (rule.conditions !== undefined && !Array.isArray(rule.conditions)) {
        addError(errors, 'INVALID_TYPE', `${rulePath}.conditions`, 'Conditions must be an array')
      } else {
        for (const [conditionIndex, condition] of (rule.conditions ?? []).entries()) {
          const conditionPath = `${rulePath}.conditions[${conditionIndex}]`
          if (!rejectUnknownFields(
            condition,
            CONDITION_FIELDS,
            conditionPath,
            errors
          )) continue
          if (typeof condition.questionId !== 'string' || typeof condition.value !== 'string') {
            addError(errors, 'INVALID_TYPE', conditionPath, 'Condition questionId and value must be strings')
          }
          if (typeof condition.operator !== 'string' || !isConditionOperator(condition.operator)) {
            addError(errors, 'INVALID_OPERATOR', `${conditionPath}.operator`, 'Condition operator is invalid')
          }
        }
      }
    }
  }
}

function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() : undefined
}

function normalizeConstraint(value: unknown): ConstraintDef {
  const input = isObject(value) ? value : {}
  return {
    type: typeof input.type === 'string' && isConstraintType(input.type) ? input.type : 'none',
    ...(typeof input.fixedLength === 'number' ? { fixedLength: input.fixedLength } : {}),
    ...(typeof input.minValue === 'number' ? { minValue: input.minValue } : {}),
    ...(typeof input.maxValue === 'number' ? { maxValue: input.maxValue } : {}),
    ...(typeof input.step === 'number' ? { step: input.step } : {}),
    ...(typeof input.regexPattern === 'string' ? { regexPattern: input.regexPattern } : {}),
    ...(typeof input.regexFlags === 'string' ? { regexFlags: input.regexFlags } : {})
  }
}

function normalizeQuestionnaire(value: JsonObject, base?: QuestionnaireDef): QuestionnaireDef {
  const rawQuestions = Array.isArray(value.questions) ? value.questions : []
  const baseByVariable = new Map(base?.questions.map((question) => [question.variableName, question]))
  const usedIds = new Set<string>()
  const referenceMap = new Map<string, string>()
  const questions: QuestionDef[] = rawQuestions.map((raw, order) => {
    const input = isObject(raw) ? raw : {}
    const variableName = stringValue(input.variableName)
    const matched = base?.questions.find((question) => question.id === input.id) ??
      baseByVariable.get(variableName)
    const id = matched !== undefined && !usedIds.has(matched.id) ? matched.id : randomUUID()
    usedIds.add(id)
    if (typeof input.id === 'string') referenceMap.set(input.id, id)
    if (variableName.length > 0) referenceMap.set(variableName, id)
    const options: OptionItem[] = Array.isArray(input.options)
      ? input.options.map((rawOption) => {
          const option = isObject(rawOption) ? rawOption : {}
          return { value: stringValue(option.value), label: stringValue(option.label) }
        })
      : []
    const defaultValue = optionalString(input.defaultValue)
    const skipValue = optionalString(input.skipValue)
    return {
      id,
      content: stringValue(input.content),
      variableName,
      type: typeof input.type === 'string' && isQuestionType(input.type) ? input.type : 'free_text',
      options,
      constraint: normalizeConstraint(input.constraint),
      ...(defaultValue === undefined ? {} : { defaultValue }),
      isKey: input.isKey === true,
      allowSkip: input.allowSkip === true,
      ...(skipValue === undefined ? {} : { skipValue }),
      order
    }
  })
  const mapReference = (value: unknown): string => {
    const raw = stringValue(value)
    return referenceMap.get(raw) ?? raw
  }
  const semanticKey = (rule: Omit<ConditionRule, 'id'> | ConditionRule): string => JSON.stringify({
    sourceQuestionId: rule.sourceQuestionId,
    conditions: [...rule.conditions].sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right))
    ),
    logic: rule.logic,
    action: rule.action,
    targetQuestionIds: [...rule.targetQuestionIds].sort()
  })
  const baseRulesBySemantic = new Map<string, ConditionRule[]>()
  const baseRules = base?.conditionRules ?? []
  for (let index = baseRules.length - 1; index >= 0; index -= 1) {
    const rule = baseRules[index]!
    const key = semanticKey(rule)
    const bucket = baseRulesBySemantic.get(key) ?? []
    bucket.push(rule)
    baseRulesBySemantic.set(key, bucket)
  }
  const conditionRules: ConditionRule[] = (Array.isArray(value.conditionRules)
    ? value.conditionRules
    : []).map((raw) => {
      const input = isObject(raw) ? raw : {}
      const conditions: ConditionDef[] = (Array.isArray(input.conditions) ? input.conditions : [])
        .map((rawCondition) => {
          const condition = isObject(rawCondition) ? rawCondition : {}
          return {
            questionId: mapReference(condition.questionId),
            operator: typeof condition.operator === 'string' && isConditionOperator(condition.operator)
              ? condition.operator
              : 'equals',
            value: typeof condition.value === 'string' ? condition.value : ''
          }
        })
      const normalized: Omit<ConditionRule, 'id'> = {
        sourceQuestionId: mapReference(input.sourceQuestionId),
        conditions,
        logic: input.logic === 'OR' ? 'OR' : 'AND',
        action: input.action === 'show' || input.action === 'require' ? input.action : 'skip',
        targetQuestionIds: Array.isArray(input.targetQuestionIds)
          ? input.targetQuestionIds.map(mapReference)
          : []
      }
      const matched = baseRulesBySemantic.get(semanticKey(normalized))?.pop()
      return { id: matched?.id ?? randomUUID(), ...normalized }
    })
  const explicitKeys = Array.isArray(value.keyQuestionIds)
    ? value.keyQuestionIds.map(mapReference)
    : questions.filter((question) => question.isKey).map((question) => question.id)
  return {
    name: stringValue(value.name),
    ...(typeof value.description === 'string' && value.description.trim().length > 0
      ? { description: value.description.trim() }
      : {}),
    questions,
    conditionRules,
    keyQuestionIds: explicitKeys
  }
}

function validateStableQuestionReferences(
  value: JsonObject,
  base?: QuestionnaireDef
): AIValidationError[] {
  if (base === undefined || !Array.isArray(value.questions)) return []
  const errors: AIValidationError[] = []
  const claimed = new Set<string>()
  for (const [index, raw] of value.questions.entries()) {
    if (!isObject(raw)) continue
    const byRef = typeof raw.id === 'string'
      ? base.questions.find((question) => question.id === raw.id)
      : undefined
    const rawVariableName = typeof raw.variableName === 'string' ? raw.variableName.trim() : undefined
    const byVariable = rawVariableName !== undefined
      ? base.questions.find((question) => question.variableName === rawVariableName)
      : undefined
    if (byRef !== undefined && byVariable !== undefined && byRef.id !== byVariable.id) {
      addError(
        errors,
        'AMBIGUOUS_QUESTION_REFERENCE',
        `$.questionnaire.questions[${index}]`,
        'Question reference and variable name identify different local questions'
      )
      continue
    }
    const matched = byRef ?? byVariable
    if (matched !== undefined) {
      if (claimed.has(matched.id)) {
        addError(
          errors,
          'DUPLICATE_BASE_QUESTION_REFERENCE',
          `$.questionnaire.questions[${index}]`,
          'Multiple candidate questions identify the same local question'
        )
      }
      claimed.add(matched.id)
    }
  }
  return errors
}

function validateRegexChanges(
  base: QuestionnaireDef | undefined,
  draft: QuestionnaireDef
): AIValidationError[] {
  const errors: AIValidationError[] = []
  const baseById = new Map(base?.questions.map((question) => [question.id, question]))
  const draftById = new Map(draft.questions.map((question) => [question.id, question]))
  const reported = new Set<string>()
  const sameRegex = (left: ConstraintDef, right: ConstraintDef): boolean =>
    left.type === 'regex' && right.type === 'regex' &&
    left.regexPattern === right.regexPattern && left.regexFlags === right.regexFlags &&
    left.fixedLength === right.fixedLength && left.minValue === right.minValue &&
    left.maxValue === right.maxValue && left.step === right.step
  for (const [index, question] of draft.questions.entries()) {
    const original = baseById.get(question.id)
    const touchesRegex = question.constraint.type === 'regex' ||
      question.constraint.regexPattern !== undefined || question.constraint.regexFlags !== undefined
    if (touchesRegex && (original === undefined || !sameRegex(original.constraint, question.constraint))) {
      reported.add(question.id)
      addError(
        errors,
        'AI_REGEX_GENERATION_NOT_ALLOWED',
        `$.questionnaire.questions[${index}].constraint`,
        'Regex constraints may only be preserved unchanged from the base questionnaire'
      )
    }
  }
  for (const original of base?.questions ?? []) {
    if (original.constraint.type !== 'regex' || reported.has(original.id)) continue
    const candidate = draftById.get(original.id)
    if (candidate === undefined || !sameRegex(original.constraint, candidate.constraint)) {
      addError(
        errors,
        'AI_REGEX_GENERATION_NOT_ALLOWED',
        '$.questionnaire.questions',
        'Existing regex constraints may not be removed or modified'
      )
    }
  }
  return errors
}

function validateQuestionnaire(
  draft: QuestionnaireDef,
  protectedDerivedVariableNames: readonly string[]
): AIValidationError[] {
  const errors: AIValidationError[] = []
  if (draft.name.trim().length === 0) addError(errors, 'EMPTY_NAME', '$.questionnaire.name', 'Name is required')
  const ids = new Set<string>()
  const variableNames = new Set<string>(protectedDerivedVariableNames)
  for (const [index, question] of draft.questions.entries()) {
    const path = `$.questionnaire.questions[${index}]`
    if (!ID_PATTERN.test(question.id) || ids.has(question.id)) {
      addError(errors, 'INVALID_QUESTION_ID', `${path}.id`, 'Question id must be legal and unique')
    }
    ids.add(question.id)
    if (question.content.length === 0) addError(errors, 'EMPTY_QUESTION', `${path}.content`, 'Question content is required')
    if (question.content.length > 10_000) addError(errors, 'QUESTION_TOO_LONG', `${path}.content`, 'Question content is too long')
    if (!DERIVED_VARIABLE_NAME_PATTERN.test(question.variableName)) {
      addError(errors, 'INVALID_VARIABLE_NAME', `${path}.variableName`, 'Variable name is invalid')
    } else if (variableNames.has(question.variableName)) {
      addError(errors, 'DUPLICATE_VARIABLE_NAME', `${path}.variableName`, 'Variable name conflicts with another variable')
    }
    variableNames.add(question.variableName)
    const optionValues = new Set<string>()
    for (const [optionIndex, option] of question.options.entries()) {
      const optionPath = `${path}.options[${optionIndex}]`
      if (option.value.length === 0 || option.label.length === 0) {
        addError(errors, 'EMPTY_OPTION', optionPath, 'Option value and label are required')
      }
      if (option.value.length > 1_000 || option.label.length > 10_000) {
        addError(errors, 'OPTION_TOO_LONG', optionPath, 'Option value or label is too long')
      }
      if (optionValues.has(option.value)) {
        addError(errors, 'DUPLICATE_OPTION_VALUE', `${optionPath}.value`, 'Option values must be unique')
      }
      optionValues.add(option.value)
    }
    const choice = question.type === 'single_choice' || question.type === 'multiple_choice'
    if (choice && question.options.length === 0) {
      addError(errors, 'MISSING_OPTIONS', `${path}.options`, 'Choice questions require options')
    }
    if (!choice && question.options.length > 0) {
      addError(errors, 'UNEXPECTED_OPTIONS', `${path}.options`, 'Non-choice questions cannot have options')
    }
    validateConstraint(question.constraint, path, errors)
    if (question.type === 'fixed_length' && question.constraint.fixedLength === undefined) {
      addError(errors, 'MISSING_FIXED_LENGTH', `${path}.constraint.fixedLength`, 'Fixed-length questions require fixedLength')
    }
    if (question.defaultValue !== undefined && validateQuestionAnswer(question, question.defaultValue, false) !== null) {
      addError(errors, 'INVALID_DEFAULT_VALUE', `${path}.defaultValue`, 'Default value violates the question definition')
    }
    if (!question.allowSkip && question.skipValue !== undefined) {
      addError(errors, 'UNEXPECTED_SKIP_VALUE', `${path}.skipValue`, 'Skip value requires allowSkip')
    }
  }
  const expectedKeys = draft.questions.filter((question) => question.isKey).map((question) => question.id).sort()
  const actualKeys = [...draft.keyQuestionIds].sort()
  if (new Set(actualKeys).size !== actualKeys.length || JSON.stringify(expectedKeys) !== JSON.stringify(actualKeys)) {
    addError(errors, 'KEY_QUESTION_MISMATCH', '$.questionnaire.keyQuestionIds', 'keyQuestionIds must exactly match isKey flags')
  }
  validateRules(draft, ids, errors)
  validateRuleGraph(draft, errors)
  return errors
}

function validateRuleGraph(draft: QuestionnaireDef, errors: AIValidationError[]): void {
  const edges = new Map<string, Set<string>>()
  const actionsByTarget = new Map<string, Set<string>>()
  const showTargets = new Set<string>()
  for (const rule of draft.conditionRules) {
    const sources = new Set([rule.sourceQuestionId, ...rule.conditions.map((item) => item.questionId)])
    for (const target of rule.targetQuestionIds) {
      const actions = actionsByTarget.get(target) ?? new Set<string>()
      actions.add(rule.action)
      actionsByTarget.set(target, actions)
      if (rule.action === 'show') showTargets.add(target)
      for (const source of sources) {
        const targets = edges.get(source) ?? new Set<string>()
        targets.add(target)
        edges.set(source, targets)
      }
    }
  }
  for (const [target, actions] of actionsByTarget) {
    if (actions.size > 1) {
      addError(errors, 'CONDITION_ACTION_CONFLICT', '$.questionnaire.conditionRules', `Conflicting actions target ${target}`)
    }
  }
  const indegree = new Map(draft.questions.map((question) => [question.id, 0]))
  for (const [source, targets] of edges) {
    if (!indegree.has(source)) continue
    for (const target of targets) {
      if (indegree.has(target)) indegree.set(target, (indegree.get(target) ?? 0) + 1)
    }
  }
  const pending = [...indegree].filter(([, count]) => count === 0).map(([id]) => id)
  let processed = 0
  while (pending.length > 0) {
    const source = pending.pop()!
    processed += 1
    for (const target of edges.get(source) ?? []) {
      if (!indegree.has(target)) continue
      const next = (indegree.get(target) ?? 0) - 1
      indegree.set(target, next)
      if (next === 0) pending.push(target)
    }
  }
  if (processed !== indegree.size) {
    addError(errors, 'CONDITION_RULE_CYCLE', '$.questionnaire.conditionRules', 'Conditional rules contain a cycle')
  }
  const reachable = new Set(draft.questions.filter((question) => !showTargets.has(question.id)).map((question) => question.id))
  let changed = true
  while (changed) {
    changed = false
    for (const rule of draft.conditionRules.filter((item) => item.action === 'show')) {
      const conditionIds = rule.conditions.map((condition) => condition.questionId)
      const triggerReachable = rule.logic === 'AND'
        ? conditionIds.every((id) => reachable.has(id))
        : conditionIds.some((id) => reachable.has(id))
      if (!triggerReachable) continue
      for (const target of rule.targetQuestionIds) {
        if (!reachable.has(target)) {
          reachable.add(target)
          changed = true
        }
      }
    }
  }
  if ([...showTargets].some((target) => !reachable.has(target))) {
    addError(errors, 'UNREACHABLE_SHOW_CHAIN', '$.questionnaire.conditionRules', 'Show-controlled questions have no reachable root')
  }
}

function validateConstraint(
  constraint: ConstraintDef,
  questionPath: string,
  errors: AIValidationError[]
): void {
  const path = `${questionPath}.constraint`
  if (!isConstraintType(constraint.type)) addError(errors, 'INVALID_CONSTRAINT_TYPE', `${path}.type`, 'Constraint type is invalid')
  if (constraint.fixedLength !== undefined && (!Number.isInteger(constraint.fixedLength) || constraint.fixedLength <= 0)) {
    addError(errors, 'INVALID_FIXED_LENGTH', `${path}.fixedLength`, 'fixedLength must be a positive integer')
  }
  for (const field of ['minValue', 'maxValue', 'step'] as const) {
    const value = constraint[field]
    if (value !== undefined && !Number.isFinite(value)) addError(errors, 'INVALID_NUMBER', `${path}.${field}`, `${field} must be finite`)
  }
  if (constraint.minValue !== undefined && constraint.maxValue !== undefined && constraint.minValue > constraint.maxValue) {
    addError(errors, 'INVALID_RANGE', path, 'minValue cannot exceed maxValue')
  }
  if (constraint.step !== undefined && constraint.step <= 0) {
    addError(errors, 'INVALID_STEP', `${path}.step`, 'step must be positive')
  }
  if (constraint.type === 'regex') {
    if ((constraint.regexPattern?.length ?? 0) > 1_000 || (constraint.regexFlags?.length ?? 0) > 16) {
      addError(errors, 'INVALID_REGEX', path, 'Regex pattern or flags are too long')
    } else if (!constraint.regexPattern) {
      addError(errors, 'MISSING_REGEX', `${path}.regexPattern`, 'Regex constraint requires a pattern')
    } else {
      try {
        new RegExp(constraint.regexPattern, constraint.regexFlags)
      } catch {
        addError(errors, 'INVALID_REGEX', `${path}.regexPattern`, 'Regex pattern or flags are invalid')
      }
    }
  } else if (constraint.regexPattern !== undefined || constraint.regexFlags !== undefined) {
    addError(errors, 'UNEXPECTED_REGEX', path, 'Regex fields require regex constraint type')
  }
}

function validateRules(
  draft: QuestionnaireDef,
  questionIds: ReadonlySet<string>,
  errors: AIValidationError[]
): void {
  const ruleIds = new Set<string>()
  const questionById = new Map(draft.questions.map((question) => [question.id, question]))
  for (const [index, rule] of draft.conditionRules.entries()) {
    const path = `$.questionnaire.conditionRules[${index}]`
    if (!ID_PATTERN.test(rule.id) || ruleIds.has(rule.id)) addError(errors, 'INVALID_RULE_ID', `${path}.id`, 'Rule id must be legal and unique')
    ruleIds.add(rule.id)
    if (!questionIds.has(rule.sourceQuestionId)) addError(errors, 'UNKNOWN_SOURCE', `${path}.sourceQuestionId`, 'Source question does not exist')
    if (rule.logic !== 'AND' && rule.logic !== 'OR') addError(errors, 'INVALID_LOGIC', `${path}.logic`, 'Rule logic is invalid')
    if (rule.action !== 'skip' && rule.action !== 'show' && rule.action !== 'require') addError(errors, 'INVALID_ACTION', `${path}.action`, 'Rule action is invalid')
    if (rule.conditions.length === 0) addError(errors, 'EMPTY_CONDITIONS', `${path}.conditions`, 'Rule requires at least one condition')
    for (const [conditionIndex, condition] of rule.conditions.entries()) {
      const conditionPath = `${path}.conditions[${conditionIndex}]`
      const question = questionById.get(condition.questionId)
      if (question === undefined) addError(errors, 'UNKNOWN_CONDITION_QUESTION', `${conditionPath}.questionId`, 'Condition question does not exist')
      if (!isConditionOperator(condition.operator)) addError(errors, 'INVALID_OPERATOR', `${conditionPath}.operator`, 'Condition operator is invalid')
      const emptyOperator = condition.operator === 'is_empty' || condition.operator === 'is_not_empty'
      if (emptyOperator && condition.value !== '') addError(errors, 'UNEXPECTED_CONDITION_VALUE', `${conditionPath}.value`, 'Empty operators cannot have a value')
      if (!emptyOperator && condition.value.trim().length === 0) addError(errors, 'EMPTY_CONDITION_VALUE', `${conditionPath}.value`, 'Condition value is required')
      if ((condition.operator === 'greater_than' || condition.operator === 'less_than') && !Number.isFinite(Number(condition.value))) {
        addError(errors, 'INVALID_CONDITION_VALUE', `${conditionPath}.value`, 'Numeric comparison requires a number')
      }
      if (question !== undefined && (condition.operator === 'equals' || condition.operator === 'not_equals') && validateQuestionAnswer(question, condition.value, false) !== null) {
        addError(errors, 'INVALID_CONDITION_VALUE', `${conditionPath}.value`, 'Condition value is invalid for its question')
      }
    }
    if (rule.targetQuestionIds.length === 0) addError(errors, 'EMPTY_TARGETS', `${path}.targetQuestionIds`, 'Rule requires a target')
    if (new Set(rule.targetQuestionIds).size !== rule.targetQuestionIds.length) addError(errors, 'DUPLICATE_TARGET', `${path}.targetQuestionIds`, 'Targets must be unique')
    for (const [targetIndex, targetId] of rule.targetQuestionIds.entries()) {
      if (!questionIds.has(targetId)) addError(errors, 'UNKNOWN_TARGET', `${path}.targetQuestionIds[${targetIndex}]`, 'Target question does not exist')
      if (targetId === rule.sourceQuestionId || rule.conditions.some((condition) => condition.questionId === targetId)) {
        addError(errors, 'SELF_REFERENTIAL_RULE', `${path}.targetQuestionIds[${targetIndex}]`, 'Rule cannot target a question used as its condition')
      }
    }
  }
}

function changedFields<T extends object>(before: T, after: T, omitted: ReadonlySet<string>): string[] {
  const fields = new Set([...Object.keys(before), ...Object.keys(after)])
  return [...fields].filter((field) => !omitted.has(field) && JSON.stringify(before[field as keyof T]) !== JSON.stringify(after[field as keyof T]))
}

export function diffQuestionnaires(base: QuestionnaireDef, draft: QuestionnaireDef): QuestionnaireDiffSummary {
  const beforeQuestions = new Map(base.questions.map((question) => [question.id, question]))
  const afterQuestions = new Map(draft.questions.map((question) => [question.id, question]))
  const beforeRules = new Map(base.conditionRules.map((rule) => [rule.id, rule]))
  const afterRules = new Map(draft.conditionRules.map((rule) => [rule.id, rule]))
  return {
    metadata: {
      name: base.name === draft.name ? null : { before: base.name, after: draft.name },
      description: base.description === draft.description
        ? null
        : { before: base.description ?? null, after: draft.description ?? null }
    },
    questions: {
      added: draft.questions.filter((question) => !beforeQuestions.has(question.id)).map(({ id, variableName, content }) => ({ id, variableName, content })),
      removed: base.questions.filter((question) => !afterQuestions.has(question.id)).map(({ id, variableName, content }) => ({ id, variableName, content })),
      modified: draft.questions.flatMap((question) => {
        const before = beforeQuestions.get(question.id)
        if (before === undefined) return []
        const fields = changedFields(before, question, new Set(['id']))
        return fields.length === 0 ? [] : [{ id: question.id, variableName: question.variableName, fields }]
      })
    },
    rules: {
      added: draft.conditionRules.filter((rule) => !beforeRules.has(rule.id)).map((rule) => rule.id),
      removed: base.conditionRules.filter((rule) => !afterRules.has(rule.id)).map((rule) => rule.id),
      modified: draft.conditionRules.filter((rule) => {
        const before = beforeRules.get(rule.id)
        return before !== undefined && changedFields(before, rule, new Set(['id'])).length > 0
      }).map((rule) => rule.id)
    }
  }
}

export function runQuestionnaireHarness(
  responseText: string,
  base?: QuestionnaireDef,
  protectedDerivedVariableNames: readonly string[] = []
): QuestionnaireHarnessResult {
  const parsed = parseEnvelope(responseText)
  if (parsed.value === undefined) return { ok: false, errors: parsed.errors }
  const candidate = parsed.value.questionnaire as JsonObject
  const referenceErrors = validateStableQuestionReferences(candidate, base)
  if (referenceErrors.length > 0) return { ok: false, errors: referenceErrors }
  const draft = normalizeQuestionnaire(candidate, base)
  const regexErrors = validateRegexChanges(base, draft)
  if (regexErrors.length > 0) return { ok: false, errors: regexErrors }
  const errors = validateQuestionnaire(draft, protectedDerivedVariableNames)
  if (errors.length > 0) return { ok: false, errors }
  const emptyBase: QuestionnaireDef = { name: '', questions: [], conditionRules: [], keyQuestionIds: [] }
  return {
    ok: true,
    value: {
      draft,
      diff: diffQuestionnaires(base ?? emptyBase, draft),
      assistantMessage: (parsed.value.assistantMessage as string).trim(),
      rollingSummary: parsed.value.rollingSummary as string,
      validation: { success: true, errors: [] }
    }
  }
}

export function validateQuestionnaireDraft(
  draft: unknown,
  protectedDerivedVariableNames: readonly string[] = []
): { ok: true } | { ok: false; errors: AIValidationError[] } {
  const errors: AIValidationError[] = []
  if (!isObject(draft)) {
    return { ok: false, errors: [{ code: 'INVALID_DRAFT', path: '$.draft', message: 'Draft must be an object' }] }
  }
  const limitErrors = validateCandidateLimits(draft)
  if (limitErrors.length > 0) return { ok: false, errors: limitErrors }
  inspectCandidate(draft, '$.draft', errors)
  if (Object.prototype.hasOwnProperty.call(draft, 'derivedVariables')) {
    addError(errors, 'FORBIDDEN_FIELD', '$.draft.derivedVariables', 'Derived variables are forbidden')
  }
  if (
    typeof draft.name !== 'string' ||
    !Array.isArray(draft.questions) ||
    !Array.isArray(draft.conditionRules) ||
    !Array.isArray(draft.keyQuestionIds)
  ) {
    addError(errors, 'INVALID_DRAFT', '$.draft', 'Draft has an invalid questionnaire shape')
    return { ok: false, errors }
  }
  try {
    for (const error of validateQuestionnaire(
      draft as unknown as QuestionnaireDef,
      protectedDerivedVariableNames
    )) addError(errors, error.code, error.path, error.message)
  } catch {
    addError(errors, 'INVALID_DRAFT', '$.draft', 'Draft contains invalid values')
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors }
}

export function getAiVersionStamp(): AiVersionStamp {
  return {
    promptId: AI_PROMPT_ID,
    promptVersion: AI_PROMPT_VERSION,
    promptHash: `sha256:${createHash('sha256').update(QUESTIONNAIRE_SYSTEM_PROMPT_V1_1_0).digest('hex')}`,
    harnessVersion: HARNESS_VERSION,
    schemaVersion: QUESTIONNAIRE_SCHEMA_VERSION
  }
}

const historicalV1Stamp: AiVersionStamp = Object.freeze({
  promptId: AI_PROMPT_ID,
  promptVersion: '1.0.0',
  promptHash: `sha256:${createHash('sha256').update(QUESTIONNAIRE_SYSTEM_PROMPT_V1_0_0).digest('hex')}`,
  harnessVersion: '1.0.0',
  schemaVersion: QUESTIONNAIRE_SCHEMA_VERSION
})
const legacyHarnessV1_1Stamp: AiVersionStamp = Object.freeze({
  ...historicalV1Stamp,
  harnessVersion: '1.1.0'
})
const currentV1Stamp: AiVersionStamp = Object.freeze(getAiVersionStamp())
const historicalV1RegistryEntry: AIRegistryEntry = Object.freeze({
  versionStamp: historicalV1Stamp,
  systemPrompt: QUESTIONNAIRE_SYSTEM_PROMPT_V1_0_0,
  schemaVersion: QUESTIONNAIRE_SCHEMA_VERSION,
  compatibility: 'requires-migration'
})
const currentV1RegistryEntry: AIRegistryEntry = Object.freeze({
  versionStamp: currentV1Stamp,
  systemPrompt: QUESTIONNAIRE_SYSTEM_PROMPT_V1_1_0,
  schemaVersion: QUESTIONNAIRE_SCHEMA_VERSION,
  compatibility: 'supported',
  runHarness: runQuestionnaireHarness
})
const legacyHarnessV1_1RegistryEntry: AIRegistryEntry = Object.freeze({
  versionStamp: legacyHarnessV1_1Stamp,
  systemPrompt: QUESTIONNAIRE_SYSTEM_PROMPT_V1_0_0,
  schemaVersion: QUESTIONNAIRE_SCHEMA_VERSION,
  compatibility: 'requires-migration'
})

function versionRegistryKey(stamp: AiVersionStamp): string {
  return JSON.stringify({
    promptId: stamp.promptId,
    promptVersion: stamp.promptVersion,
    promptHash: stamp.promptHash,
    harnessVersion: stamp.harnessVersion,
    schemaVersion: stamp.schemaVersion
  })
}

const AI_REGISTRY = new Map<string, AIRegistryEntry>([
  [versionRegistryKey(historicalV1Stamp), historicalV1RegistryEntry],
  [versionRegistryKey(legacyHarnessV1_1Stamp), legacyHarnessV1_1RegistryEntry],
  [versionRegistryKey(currentV1Stamp), currentV1RegistryEntry]
])

export function resolveAIRegistryEntry(stamp: AiVersionStamp): AIRegistryEntry {
  const entry = AI_REGISTRY.get(versionRegistryKey(stamp))
  if (entry === undefined) throw new Error('AI_VERSION_NOT_REGISTERED')
  return entry
}

export function migrateAISessionVersion(from: AiVersionStamp, to: AiVersionStamp): void {
  resolveAIRegistryEntry(from)
  const major = (version: string): number => Number.parseInt(version.split('.')[0] ?? '', 10)
  if (from.promptId !== to.promptId ||
    major(from.promptVersion) !== major(to.promptVersion) ||
    major(from.harnessVersion) !== major(to.harnessVersion) ||
    from.schemaVersion !== to.schemaVersion) {
    throw new Error('AI_MAJOR_VERSION_MIGRATION_REQUIRED')
  }
  const target = resolveAIRegistryEntry(to)
  if (target.compatibility !== 'supported') throw new Error('AI_VERSION_MIGRATION_REQUIRED')
}

export function stripDerivedVariables(questionnaire: QuestionnaireDef): QuestionnaireDef {
  if (!isObject(questionnaire)) throw new Error('AI_QUESTIONNAIRE_DTO_INVALID')
  for (const key of Object.keys(questionnaire)) {
    if (!QUESTIONNAIRE_ATTACHMENT_FIELDS.has(key)) throw new Error('AI_QUESTIONNAIRE_DTO_INVALID')
  }
  const candidate = {
    name: questionnaire.name,
    ...(questionnaire.description === undefined ? {} : { description: questionnaire.description }),
    questions: questionnaire.questions,
    conditionRules: questionnaire.conditionRules,
    keyQuestionIds: questionnaire.keyQuestionIds
  }
  if (!validateQuestionnaireDraft(candidate).ok) throw new Error('AI_QUESTIONNAIRE_DTO_INVALID')
  return {
    name: candidate.name,
    ...(candidate.description === undefined ? {} : { description: candidate.description }),
    questions: candidate.questions.map((question) => ({
      id: question.id,
      content: question.content,
      variableName: question.variableName,
      type: question.type,
      options: question.options.map((option) => ({ value: option.value, label: option.label })),
      constraint: {
        type: question.constraint.type,
        ...(question.constraint.fixedLength === undefined ? {} : { fixedLength: question.constraint.fixedLength }),
        ...(question.constraint.minValue === undefined ? {} : { minValue: question.constraint.minValue }),
        ...(question.constraint.maxValue === undefined ? {} : { maxValue: question.constraint.maxValue }),
        ...(question.constraint.step === undefined ? {} : { step: question.constraint.step }),
        ...(question.constraint.regexPattern === undefined ? {} : { regexPattern: question.constraint.regexPattern }),
        ...(question.constraint.regexFlags === undefined ? {} : { regexFlags: question.constraint.regexFlags })
      },
      ...(question.defaultValue === undefined ? {} : { defaultValue: question.defaultValue }),
      isKey: question.isKey,
      allowSkip: question.allowSkip,
      ...(question.skipValue === undefined ? {} : { skipValue: question.skipValue }),
      order: question.order
    })),
    conditionRules: candidate.conditionRules.map((rule) => ({
      id: rule.id,
      sourceQuestionId: rule.sourceQuestionId,
      conditions: rule.conditions.map((condition) => ({
        questionId: condition.questionId,
        operator: condition.operator,
        value: condition.value
      })),
      logic: rule.logic,
      action: rule.action,
      targetQuestionIds: [...rule.targetQuestionIds]
    })),
    keyQuestionIds: [...candidate.keyQuestionIds]
  }
}

function canonicalizeUnknown(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeUnknown)
  if (!isObject(value)) return value
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalizeUnknown(value[key])]))
}

export function hashAIQuestionnaire(questionnaire: QuestionnaireDef): string {
  return `sha256:${createHash('sha256')
    .update(JSON.stringify(canonicalizeUnknown(stripDerivedVariables(questionnaire))))
    .digest('hex')}`
}

function hasExactKeys(value: JsonObject, required: readonly string[], optional: readonly string[] = []): boolean {
  const allowed = new Set([...required, ...optional])
  return required.every((key) => Object.prototype.hasOwnProperty.call(value, key)) &&
    Object.keys(value).every((key) => allowed.has(key))
}

export function validateStrictQuestionnaireDto(
  value: unknown,
  protectedDerivedVariableNames: readonly string[] = []
): QuestionnaireDef {
  if (validateCandidateLimits(value).length > 0) throw new Error('AI_ARTIFACT_INVALID')
  if (!isObject(value) || !hasExactKeys(
    value,
    ['name', 'questions', 'conditionRules', 'keyQuestionIds'],
    ['description']
  ) || typeof value.name !== 'string' ||
    (Object.prototype.hasOwnProperty.call(value, 'description') && typeof value.description !== 'string') ||
    !Array.isArray(value.questions) || !Array.isArray(value.conditionRules) ||
    !Array.isArray(value.keyQuestionIds) || value.keyQuestionIds.some((id) => typeof id !== 'string')) {
    throw new Error('AI_ARTIFACT_INVALID')
  }
  for (const [index, rawQuestion] of value.questions.entries()) {
    if (!isObject(rawQuestion) || !hasExactKeys(
      rawQuestion,
      ['id', 'content', 'variableName', 'type', 'options', 'constraint', 'isKey', 'allowSkip', 'order'],
      ['defaultValue', 'skipValue']
    ) || typeof rawQuestion.id !== 'string' || !ID_PATTERN.test(rawQuestion.id) ||
      typeof rawQuestion.content !== 'string' || typeof rawQuestion.variableName !== 'string' ||
      typeof rawQuestion.type !== 'string' || !isQuestionType(rawQuestion.type) ||
      typeof rawQuestion.isKey !== 'boolean' || typeof rawQuestion.allowSkip !== 'boolean' ||
      rawQuestion.order !== index ||
      (Object.prototype.hasOwnProperty.call(rawQuestion, 'defaultValue') &&
        typeof rawQuestion.defaultValue !== 'string') ||
      (Object.prototype.hasOwnProperty.call(rawQuestion, 'skipValue') &&
        typeof rawQuestion.skipValue !== 'string') ||
      !Array.isArray(rawQuestion.options) || !isObject(rawQuestion.constraint)) {
      throw new Error('AI_ARTIFACT_INVALID')
    }
    for (const option of rawQuestion.options) {
      if (!isObject(option) || !hasExactKeys(option, ['value', 'label']) ||
        typeof option.value !== 'string' || typeof option.label !== 'string') {
        throw new Error('AI_ARTIFACT_INVALID')
      }
    }
    if (!hasExactKeys(rawQuestion.constraint, ['type'], [
      'fixedLength', 'minValue', 'maxValue', 'step', 'regexPattern', 'regexFlags'
    ]) || typeof rawQuestion.constraint.type !== 'string' ||
      !isConstraintType(rawQuestion.constraint.type)) {
      throw new Error('AI_ARTIFACT_INVALID')
    }
    for (const field of ['fixedLength', 'minValue', 'maxValue', 'step'] as const) {
      const item = rawQuestion.constraint[field]
      if (Object.prototype.hasOwnProperty.call(rawQuestion.constraint, field) &&
        (typeof item !== 'number' || !Number.isFinite(item))) {
        throw new Error('AI_ARTIFACT_INVALID')
      }
    }
    for (const field of ['regexPattern', 'regexFlags'] as const) {
      const item = rawQuestion.constraint[field]
      if (Object.prototype.hasOwnProperty.call(rawQuestion.constraint, field) && typeof item !== 'string') {
        throw new Error('AI_ARTIFACT_INVALID')
      }
    }
  }
  for (const rawRule of value.conditionRules) {
    if (!isObject(rawRule) || !hasExactKeys(rawRule, [
      'id', 'sourceQuestionId', 'conditions', 'logic', 'action', 'targetQuestionIds'
    ]) || typeof rawRule.id !== 'string' || !ID_PATTERN.test(rawRule.id) ||
      typeof rawRule.sourceQuestionId !== 'string' || !Array.isArray(rawRule.conditions) ||
      (rawRule.logic !== 'AND' && rawRule.logic !== 'OR') ||
      (rawRule.action !== 'skip' && rawRule.action !== 'show' && rawRule.action !== 'require') ||
      !Array.isArray(rawRule.targetQuestionIds) ||
      rawRule.targetQuestionIds.some((id) => typeof id !== 'string')) {
      throw new Error('AI_ARTIFACT_INVALID')
    }
    for (const condition of rawRule.conditions) {
      if (!isObject(condition) || !hasExactKeys(condition, ['questionId', 'operator', 'value']) ||
        typeof condition.questionId !== 'string' || typeof condition.operator !== 'string' ||
        !isConditionOperator(condition.operator) || typeof condition.value !== 'string') {
        throw new Error('AI_ARTIFACT_INVALID')
      }
    }
  }
  const validation = validateQuestionnaireDraft(value, protectedDerivedVariableNames)
  if (!validation.ok) throw new Error('AI_ARTIFACT_INVALID')
  return stripDerivedVariables(value as unknown as QuestionnaireDef)
}

function sameVersionStamp(left: AiVersionStamp, right: AiVersionStamp): boolean {
  return versionRegistryKey(left) === versionRegistryKey(right)
}

function structurallyEqualUnknown(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalizeUnknown(left)) === JSON.stringify(canonicalizeUnknown(right))
}

export function validateQuestionnaireArtifact(
  artifact: AIArtifact | undefined,
  expectedVersionStamp: AiVersionStamp,
  protectedDerivedVariableNames: readonly string[] = []
): QuestionnaireArtifactValue {
  if (artifact?.kind !== 'questionnaire-draft' || artifact.status !== 'completed' ||
    artifact.errorCode !== undefined ||
    !sameVersionStamp(artifact.versionStamp, expectedVersionStamp)) {
    throw new Error('AI_ARTIFACT_INVALID')
  }
  resolveAIRegistryEntry(artifact.versionStamp)
  if (!isObject(artifact.value) || !hasExactKeys(artifact.value, [
    'draft', 'diff', 'assistantMessage', 'rollingSummary', 'baseQuestionnaireHash',
    'baseQuestionnaire', 'validation'
  ]) || typeof artifact.value.assistantMessage !== 'string' ||
    artifact.value.assistantMessage.trim().length === 0 ||
    artifact.value.assistantMessage.length > 20_000 ||
    typeof artifact.value.rollingSummary !== 'string' || artifact.value.rollingSummary.length > 20_000 ||
    typeof artifact.value.baseQuestionnaireHash !== 'string' ||
    !/^sha256:[a-f0-9]{64}$/.test(artifact.value.baseQuestionnaireHash) ||
    !isObject(artifact.value.validation) ||
    !hasExactKeys(artifact.value.validation, ['success', 'errors']) ||
    artifact.value.validation.success !== true || !Array.isArray(artifact.value.validation.errors) ||
    artifact.value.validation.errors.length !== 0) {
    throw new Error('AI_ARTIFACT_INVALID')
  }
  const baseQuestionnaire = validateStrictQuestionnaireDto(artifact.value.baseQuestionnaire)
  const draft = validateStrictQuestionnaireDto(artifact.value.draft, protectedDerivedVariableNames)
  if (validateRegexChanges(baseQuestionnaire, draft).length > 0) {
    throw new Error('AI_ARTIFACT_INVALID')
  }
  if (hashAIQuestionnaire(baseQuestionnaire) !== artifact.value.baseQuestionnaireHash) {
    throw new Error('AI_ARTIFACT_INVALID')
  }
  const expectedDiff = diffQuestionnaires(baseQuestionnaire, draft)
  if (!structurallyEqualUnknown(artifact.value.diff, expectedDiff)) {
    throw new Error('AI_ARTIFACT_INVALID')
  }
  return {
    draft,
    diff: expectedDiff,
    assistantMessage: artifact.value.assistantMessage,
    rollingSummary: artifact.value.rollingSummary,
    baseQuestionnaireHash: artifact.value.baseQuestionnaireHash,
    baseQuestionnaire,
    validation: { success: true, errors: [] }
  }
}

export function buildQuestionnaireContext(
  session: AISessionData,
  activeArtifactDraft?: QuestionnaireDef,
  explicitAttachedQuestionnaire?: QuestionnaireDef,
  maxCharacters = 60_000,
  registryEntry: AIRegistryEntry = resolveAIRegistryEntry(session.manifest.versionStamp)
): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  const summary = typeof session.state.values.rollingSummary === 'string'
    ? session.state.values.rollingSummary
    : ''
  const required: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: registryEntry.systemPrompt }
  ]
  if (activeArtifactDraft !== undefined) {
    required.push({ role: 'system', content: `Active draft artifact:\n${JSON.stringify(stripDerivedVariables(activeArtifactDraft))}` })
  }
  if (explicitAttachedQuestionnaire !== undefined) {
    required.push({ role: 'system', content: `Explicitly attached questionnaire:\n${JSON.stringify(stripDerivedVariables(explicitAttachedQuestionnaire))}` })
  }
  const turns: Array<Array<{ role: 'user' | 'assistant'; content: string }>> = []
  let turn: Array<{ role: 'user' | 'assistant'; content: string }> | undefined
  for (const message of session.conversation.messages) {
    if (message.role === 'user') {
      if (turn !== undefined) turns.push(turn)
      turn = [{ role: 'user', content: message.content }]
    } else if (turn !== undefined && (message.role === 'assistant' || message.role === 'tool')) {
      turn.push({
        role: 'assistant',
        content: message.role === 'tool' ? `[tool]\n${message.content}` : message.content
      })
    }
  }
  if (turn !== undefined) turns.push(turn)
  const currentTurn = turns.at(-1)
  if (currentTurn === undefined) throw new Error('AI_CONTEXT_MISSING_CURRENT_USER')
  const lengthOf = (messages: ReadonlyArray<{ content: string }>): number =>
    messages.reduce((sum, message) => sum + message.content.length, 0)
  let used = lengthOf(required) + lengthOf(currentTurn)
  if (used > maxCharacters) throw new Error('AI_CONTEXT_TOO_LARGE')
  const optionalFixed: Array<{ role: 'system'; content: string }> = []
  if (summary.length > 0) {
    const summaryMessage = { role: 'system' as const, content: `Rolling summary:\n${summary}` }
    if (used + summaryMessage.content.length <= maxCharacters) {
      optionalFixed.push(summaryMessage)
      used += summaryMessage.content.length
    }
  }
  const recentTurns: typeof turns = []
  for (const previousTurn of turns.slice(0, -1).reverse()) {
    const turnLength = lengthOf(previousTurn)
    if (used + turnLength > maxCharacters) break
    recentTurns.unshift(previousTurn)
    used += turnLength
  }
  return [...required, ...optionalFixed, ...recentTurns.flat(), ...currentTurn]
}

export function buildAIContentCacheKey(input: {
  projectId: string
  sessionId: string
  promptHash: string
  schemaVersion: number
  baseUrl: string
  model: string
}): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.projectId)) {
    throw new Error('INVALID_PROJECT_ID')
  }
  return createHash('sha256').update(JSON.stringify({
    projectId: input.projectId,
    sessionId: input.sessionId,
    promptHash: input.promptHash,
    schemaVersion: input.schemaVersion,
    baseUrl: input.baseUrl,
    model: input.model
  })).digest('hex')
}

export function artifactValueAsJson(value: QuestionnaireArtifactValue): AIJsonValue {
  return value as unknown as AIJsonValue
}
