import { createHash, randomUUID } from 'node:crypto'

import type { AIJsonValue, AiVersionStamp, AISessionData } from '@shared/ai-assistant-contract'
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

import { detectConflicts } from './qnaire.service'

export const AI_PROMPT_ID = 'easyepi-questionnaire-assistant'
export const AI_PROMPT_VERSION = '1.0.0'
export const HARNESS_VERSION = '1.0.0'
export const QUESTIONNAIRE_SCHEMA_VERSION = 1

export const QUESTIONNAIRE_SYSTEM_PROMPT = `You are EasyEpi's questionnaire drafting assistant.
You may create or revise only: questionnaire name and description; questions; question types; options; variable names; order; required/allowSkip behavior; skip/default values; constraints; key-question flags; and conditional rules.
Never request, infer, read, or emit derived variables, responses, baseline data, administrator data, files, passwords, credentials, or filesystem paths. Never output a project file or instructions to modify one.
Return exactly one strict JSON object with keys assistantMessage, rollingSummary, and questionnaire. The questionnaire candidate may contain only name, description, questions, conditionRules, and keyQuestionIds. Each question may contain only id, content, variableName, type, options, constraint, defaultValue, isKey, allowSkip, skipValue, and order. Each rule may contain only id, sourceQuestionId, conditions, logic, action, and targetQuestionIds. Do not use markdown except that a single JSON fence is tolerated by the local parser.`

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

export interface QuestionnaireArtifactValue {
  draft: QuestionnaireDef
  diff: QuestionnaireDiffSummary
  assistantMessage: string
  rollingSummary: string
  validation: { success: true; errors: [] }
}

export type QuestionnaireHarnessResult =
  | { ok: true; value: QuestionnaireArtifactValue }
  | { ok: false; errors: AIValidationError[] }

type JsonObject = Record<string, unknown>

const ENVELOPE_FIELDS = new Set(['assistantMessage', 'rollingSummary', 'questionnaire'])
const QUESTIONNAIRE_FIELDS = new Set([
  'name', 'description', 'questions', 'conditionRules', 'keyQuestionIds'
])
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

function isObject(value: unknown): value is JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function addError(
  errors: AIValidationError[],
  code: string,
  path: string,
  message: string
): void {
  errors.push({ code, path, message })
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
    const matched = baseByVariable.get(variableName)
    const requestedId = typeof input.id === 'string' && ID_PATTERN.test(input.id) ? input.id : undefined
    const id = requestedId !== undefined && !usedIds.has(requestedId)
      ? requestedId
      : matched !== undefined && !usedIds.has(matched.id)
        ? matched.id
        : randomUUID()
    usedIds.add(id)
    if (typeof input.id === 'string') referenceMap.set(input.id, id)
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
  const usedRuleIds = new Set<string>()
  const conditionRules: ConditionRule[] = (Array.isArray(value.conditionRules)
    ? value.conditionRules
    : []).map((raw) => {
      const input = isObject(raw) ? raw : {}
      const requestedId = typeof input.id === 'string' && ID_PATTERN.test(input.id) ? input.id : undefined
      const id = requestedId !== undefined && !usedRuleIds.has(requestedId) ? requestedId : randomUUID()
      usedRuleIds.add(id)
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
      return {
        id,
        sourceQuestionId: mapReference(input.sourceQuestionId),
        conditions,
        logic: input.logic === 'OR' ? 'OR' : 'AND',
        action: input.action === 'show' || input.action === 'require' ? input.action : 'skip',
        targetQuestionIds: Array.isArray(input.targetQuestionIds)
          ? input.targetQuestionIds.map(mapReference)
          : []
      }
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
  for (const conflict of detectConflicts(draft)) {
    addError(errors, 'CONDITION_RULE_CONFLICT', '$.questionnaire.conditionRules', conflict)
  }
  return errors
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
  const draft = normalizeQuestionnaire(parsed.value.questionnaire as JsonObject, base)
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
    errors.push(...validateQuestionnaire(draft as unknown as QuestionnaireDef, protectedDerivedVariableNames))
  } catch {
    addError(errors, 'INVALID_DRAFT', '$.draft', 'Draft contains invalid values')
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors }
}

export function getAiVersionStamp(): AiVersionStamp {
  return {
    promptId: AI_PROMPT_ID,
    promptVersion: AI_PROMPT_VERSION,
    promptHash: `sha256:${createHash('sha256').update(QUESTIONNAIRE_SYSTEM_PROMPT).digest('hex')}`,
    harnessVersion: HARNESS_VERSION,
    schemaVersion: QUESTIONNAIRE_SCHEMA_VERSION
  }
}

export function stripDerivedVariables(questionnaire: QuestionnaireDef): QuestionnaireDef {
  const allowed = clone(questionnaire)
  delete allowed.derivedVariables
  return allowed
}

export function buildQuestionnaireContext(
  session: AISessionData,
  activeArtifactDraft?: QuestionnaireDef,
  explicitAttachedQuestionnaire?: QuestionnaireDef,
  maxCharacters = 60_000
): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  const summary = typeof session.state.values.rollingSummary === 'string'
    ? session.state.values.rollingSummary
    : ''
  const fixed: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: QUESTIONNAIRE_SYSTEM_PROMPT }
  ]
  if (summary.length > 0) fixed.push({ role: 'system', content: `Rolling summary:\n${summary}` })
  if (activeArtifactDraft !== undefined) {
    fixed.push({ role: 'system', content: `Active draft artifact:\n${JSON.stringify(stripDerivedVariables(activeArtifactDraft))}` })
  }
  if (explicitAttachedQuestionnaire !== undefined) {
    fixed.push({ role: 'system', content: `Explicitly attached questionnaire:\n${JSON.stringify(stripDerivedVariables(explicitAttachedQuestionnaire))}` })
  }
  if (fixed.reduce((sum, message) => sum + message.content.length, 0) > maxCharacters) {
    throw new Error('AI_CONTEXT_TOO_LARGE')
  }
  const budget = Math.max(0, maxCharacters - fixed.reduce((sum, message) => sum + message.content.length, 0))
  const recent: Array<{ role: 'user' | 'assistant'; content: string }> = []
  let used = 0
  for (const message of [...session.conversation.messages].reverse()) {
    if (message.role !== 'user' && message.role !== 'assistant') continue
    if (used + message.content.length > budget) break
    recent.unshift({ role: message.role, content: message.content })
    used += message.content.length
  }
  return [...fixed, ...recent]
}

export function buildAIContentCacheKey(input: {
  projectName: string
  projectCreatedAt: string
  sessionId: string
  promptHash: string
  schemaVersion: number
  baseUrl: string
  model: string
}): string {
  const projectId = createHash('sha256')
    .update(`${input.projectCreatedAt}\0${input.projectName}`)
    .digest('hex')
  return createHash('sha256').update(JSON.stringify({
    projectId,
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
