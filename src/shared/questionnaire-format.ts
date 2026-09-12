import {
  isConditionOperator,
  isConstraintType,
  isQuestionType,
  validateQuestionAnswer,
  type ConditionRule,
  type ConstraintDef,
  type QuestionnaireDef,
  type QuestionDef
} from './types/qnaire'
import { DERIVED_VARIABLE_NAME_PATTERN } from './types/derived'

/**
 * Strict structural and semantic validation of a questionnaire definition.
 *
 * This module is deliberately dependency-free and importable from both the main process and the
 * renderer, so the same rules decide whether a questionnaire is legal everywhere. The main-process
 * harness remains authoritative for model output; this module is the shared structural contract that
 * the renderer applies locally before a generated draft can be shown or applied.
 */

export interface QuestionnaireFormatIssue {
  code: string
  path: string
  message: string
}

export type QuestionnaireFormatResult =
  | { ok: true; questionnaire: QuestionnaireDef }
  | { ok: false; issues: QuestionnaireFormatIssue[] }

export interface QuestionnaireFormatOptions {
  /** Variable names owned by derived variables; questions may not reuse them. */
  protectedVariableNames?: readonly string[]
  /** JSON-path root used in issue paths. Defaults to `$`. */
  root?: string
}

export const QUESTIONNAIRE_FORMAT_LIMITS = Object.freeze({
  maxNameLength: 200,
  maxDescriptionLength: 2_000,
  maxQuestions: 500,
  maxOptionsPerQuestion: 500,
  maxRules: 1_000,
  maxConditionsPerRule: 100,
  maxTargetsPerRule: 500,
  maxQuestionContentLength: 10_000,
  maxOptionValueLength: 1_000,
  maxOptionLabelLength: 10_000,
  maxRegexPatternLength: 1_000,
  maxRegexFlagsLength: 16,
  maxIssues: 100,
  maxNodes: 50_000
})

const QUESTIONNAIRE_FIELDS = new Set(['name', 'description', 'questions', 'conditionRules', 'keyQuestionIds'])
const QUESTION_FIELDS = new Set([
  'id', 'content', 'variableName', 'type', 'options', 'constraint', 'defaultValue',
  'isKey', 'allowSkip', 'skipValue', 'order'
])
const QUESTION_REQUIRED_FIELDS = [
  'id', 'content', 'variableName', 'type', 'options', 'constraint', 'isKey', 'allowSkip', 'order'
]
const OPTION_FIELDS = new Set(['value', 'label'])
const CONSTRAINT_FIELDS = new Set([
  'type', 'fixedLength', 'minValue', 'maxValue', 'step', 'regexPattern', 'regexFlags'
])
const RULE_FIELDS = new Set([
  'id', 'sourceQuestionId', 'conditions', 'logic', 'action', 'targetQuestionIds'
])
const CONDITION_FIELDS = new Set(['questionId', 'operator', 'value'])
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

class IssueCollector {
  readonly issues: QuestionnaireFormatIssue[] = []
  private nodes = 0

  constructor(private readonly root: string) {}

  add(code: string, path: string, message: string): void {
    if (this.issues.length < QUESTIONNAIRE_FORMAT_LIMITS.maxIssues) {
      this.issues.push({ code, path, message })
    }
  }

  descend(): boolean {
    this.nodes += 1
    if (this.nodes > QUESTIONNAIRE_FORMAT_LIMITS.maxNodes) {
      this.add('AI_CANDIDATE_LIMIT_EXCEEDED', this.root, 'Questionnaire structure is too complex')
      return false
    }
    return true
  }

  get truncated(): boolean {
    return this.issues.length >= QUESTIONNAIRE_FORMAT_LIMITS.maxIssues
  }
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key))
}

function isFiniteNumberOrUndefined(value: unknown): value is number | undefined {
  return value === undefined || (typeof value === 'number' && Number.isFinite(value))
}

/**
 * Structural pass. Returns `true` when the value is shaped enough for the semantic pass to run.
 */
function inspectStructure(value: unknown, collector: IssueCollector, root: string): value is QuestionnaireDef {
  if (!isPlainObject(value)) {
    collector.add('INVALID_TYPE', root, 'Questionnaire must be a JSON object')
    return false
  }
  if (!hasOnlyKeys(value, QUESTIONNAIRE_FIELDS)) {
    for (const key of Object.keys(value)) {
      if (!QUESTIONNAIRE_FIELDS.has(key)) {
        collector.add('FORBIDDEN_FIELD', `${root}.${key}`, 'Field is not allowed on a questionnaire')
      }
    }
    return false
  }
  let ok = true
  if (typeof value.name !== 'string') {
    collector.add('INVALID_TYPE', `${root}.name`, 'name must be a string')
    ok = false
  } else if (value.name.length > QUESTIONNAIRE_FORMAT_LIMITS.maxNameLength) {
    collector.add('INVALID_TYPE', `${root}.name`, 'name is too long')
    ok = false
  }
  if (value.description !== undefined && value.description !== null &&
    typeof value.description !== 'string') {
    collector.add('INVALID_TYPE', `${root}.description`, 'description must be a string or null')
    ok = false
  }
  if (!Array.isArray(value.questions)) {
    collector.add('INVALID_DRAFT', `${root}.questions`, 'questions must be an array')
    ok = false
  }
  if (!Array.isArray(value.conditionRules)) {
    collector.add('INVALID_DRAFT', `${root}.conditionRules`, 'conditionRules must be an array')
    ok = false
  }
  if (!Array.isArray(value.keyQuestionIds)) {
    collector.add('INVALID_DRAFT', `${root}.keyQuestionIds`, 'keyQuestionIds must be an array')
    ok = false
  }
  if (!ok) return false

  const questions = value.questions as unknown[]
  const rules = value.conditionRules as unknown[]
  if (questions.length > QUESTIONNAIRE_FORMAT_LIMITS.maxQuestions) {
    collector.add('AI_CANDIDATE_LIMIT_EXCEEDED', `${root}.questions`, 'Too many questions')
    ok = false
  }
  if (rules.length > QUESTIONNAIRE_FORMAT_LIMITS.maxRules) {
    collector.add('AI_CANDIDATE_LIMIT_EXCEEDED', `${root}.conditionRules`, 'Too many condition rules')
    ok = false
  }
  const questionIds = new Set<string>()
  for (const [index, question] of questions.entries()) {
    if (!inspectQuestion(question, collector, `${root}.questions[${index}]`, index, questionIds)) ok = false
  }
  for (const [index, rule] of rules.entries()) {
    if (!inspectRule(rule, collector, `${root}.conditionRules[${index}]`)) ok = false
  }
  for (const [index, id] of (value.keyQuestionIds as unknown[]).entries()) {
    if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
      collector.add('INVALID_TYPE', `${root}.keyQuestionIds[${index}]`, 'Key question id is invalid')
      ok = false
    }
  }
  return ok
}

function inspectQuestion(
  value: unknown,
  collector: IssueCollector,
  path: string,
  index: number,
  questionIds: Set<string>
): boolean {
  if (!collector.descend()) return false
  if (!isPlainObject(value)) {
    collector.add('INVALID_TYPE', path, 'Question must be a JSON object')
    return false
  }
  if (!hasOnlyKeys(value, QUESTION_FIELDS)) {
    for (const key of Object.keys(value)) {
      if (!QUESTION_FIELDS.has(key)) {
        collector.add('FORBIDDEN_FIELD', `${path}.${key}`, 'Field is not allowed on a question')
      }
    }
    return false
  }
  let ok = true
  for (const field of QUESTION_REQUIRED_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      collector.add('INVALID_TYPE', `${path}.${field}`, `${field} is required`)
      ok = false
    }
  }
  if (!ok) return false

  if (typeof value.id !== 'string' || !ID_PATTERN.test(value.id)) {
    collector.add('INVALID_QUESTION_ID', `${path}.id`, 'Question id is invalid')
    ok = false
  } else if (questionIds.has(value.id)) {
    collector.add('DUPLICATE_QUESTION_ID', `${path}.id`, 'Question id must be unique')
    ok = false
  } else {
    questionIds.add(value.id)
  }
  if (typeof value.content !== 'string') {
    collector.add('INVALID_TYPE', `${path}.content`, 'content must be a string')
    ok = false
  }
  if (typeof value.variableName !== 'string') {
    collector.add('INVALID_TYPE', `${path}.variableName`, 'variableName must be a string')
    ok = false
  }
  if (!isQuestionType(value.type as string)) {
    collector.add('INVALID_QUESTION_TYPE', `${path}.type`, 'Question type is invalid')
    ok = false
  }
  if (typeof value.isKey !== 'boolean') {
    collector.add('INVALID_TYPE', `${path}.isKey`, 'isKey must be a boolean')
    ok = false
  }
  if (typeof value.allowSkip !== 'boolean') {
    collector.add('INVALID_TYPE', `${path}.allowSkip`, 'allowSkip must be a boolean')
    ok = false
  }
  if (!Number.isSafeInteger(value.order) || Number(value.order) !== index) {
    collector.add('INVALID_ORDER', `${path}.order`, 'Question order must equal its array index')
    ok = false
  }
  if (value.defaultValue !== undefined && value.defaultValue !== null &&
    typeof value.defaultValue !== 'string') {
    collector.add('INVALID_TYPE', `${path}.defaultValue`, 'defaultValue must be a string or null')
    ok = false
  }
  if (value.skipValue !== undefined && value.skipValue !== null && typeof value.skipValue !== 'string') {
    collector.add('INVALID_TYPE', `${path}.skipValue`, 'skipValue must be a string or null')
    ok = false
  }
  const options = value.options
  if (!Array.isArray(options)) {
    collector.add('INVALID_TYPE', `${path}.options`, 'options must be an array')
    ok = false
  } else {
    if (options.length > QUESTIONNAIRE_FORMAT_LIMITS.maxOptionsPerQuestion) {
      collector.add('AI_CANDIDATE_LIMIT_EXCEEDED', `${path}.options`, 'Too many options')
      ok = false
    }
    for (const [optionIndex, option] of options.entries()) {
      if (!collector.descend()) { ok = false; break }
      if (!isPlainObject(option) || !hasOnlyKeys(option, OPTION_FIELDS)) {
        collector.add('INVALID_TYPE', `${path}.options[${optionIndex}]`, 'Option must be an object with value and label')
        ok = false
        continue
      }
      if (typeof option.value !== 'string' || typeof option.label !== 'string') {
        collector.add('INVALID_TYPE', `${path}.options[${optionIndex}]`, 'Option value and label must be strings')
        ok = false
      }
    }
  }
  const constraint = value.constraint
  if (!isPlainObject(constraint) || !hasOnlyKeys(constraint, CONSTRAINT_FIELDS)) {
    collector.add('INVALID_TYPE', `${path}.constraint`, 'constraint must be an object with only declared fields')
    ok = false
  } else {
    if (!isConstraintType(constraint.type as string)) {
      collector.add('INVALID_CONSTRAINT_TYPE', `${path}.constraint.type`, 'Constraint type is invalid')
      ok = false
    }
    if (constraint.fixedLength !== undefined && constraint.fixedLength !== null &&
      !Number.isInteger(constraint.fixedLength)) {
      collector.add('INVALID_TYPE', `${path}.constraint.fixedLength`, 'fixedLength must be an integer or null')
      ok = false
    }
    for (const field of ['minValue', 'maxValue', 'step'] as const) {
      const fieldValue = constraint[field]
      if (fieldValue !== undefined && fieldValue !== null && !isFiniteNumberOrUndefined(fieldValue)) {
        collector.add('INVALID_TYPE', `${path}.constraint.${field}`, `${field} must be a finite number or null`)
        ok = false
      }
    }
    for (const field of ['regexPattern', 'regexFlags'] as const) {
      const fieldValue = constraint[field]
      if (fieldValue !== undefined && fieldValue !== null && typeof fieldValue !== 'string') {
        collector.add('INVALID_TYPE', `${path}.constraint.${field}`, `${field} must be a string or null`)
        ok = false
      }
    }
  }
  return ok
}

function inspectRule(value: unknown, collector: IssueCollector, path: string): boolean {
  if (!collector.descend()) return false
  if (!isPlainObject(value)) {
    collector.add('INVALID_TYPE', path, 'Condition rule must be a JSON object')
    return false
  }
  if (!hasOnlyKeys(value, RULE_FIELDS)) {
    for (const key of Object.keys(value)) {
      if (!RULE_FIELDS.has(key)) {
        collector.add('FORBIDDEN_FIELD', `${path}.${key}`, 'Field is not allowed on a condition rule')
      }
    }
    return false
  }
  let ok = true
  if (typeof value.id !== 'string' || !ID_PATTERN.test(value.id)) {
    collector.add('INVALID_RULE_ID', `${path}.id`, 'Rule id is invalid')
    ok = false
  }
  if (typeof value.sourceQuestionId !== 'string' || !ID_PATTERN.test(value.sourceQuestionId)) {
    collector.add('INVALID_TYPE', `${path}.sourceQuestionId`, 'sourceQuestionId must be a legal id')
    ok = false
  }
  if (value.logic !== 'AND' && value.logic !== 'OR') {
    collector.add('INVALID_LOGIC', `${path}.logic`, 'Rule logic is invalid')
    ok = false
  }
  if (value.action !== 'skip' && value.action !== 'show' && value.action !== 'require') {
    collector.add('INVALID_ACTION', `${path}.action`, 'Rule action is invalid')
    ok = false
  }
  const conditions = value.conditions
  if (!Array.isArray(conditions)) {
    collector.add('INVALID_TYPE', `${path}.conditions`, 'conditions must be an array')
    ok = false
  } else {
    if (conditions.length > QUESTIONNAIRE_FORMAT_LIMITS.maxConditionsPerRule) {
      collector.add('AI_CANDIDATE_LIMIT_EXCEEDED', `${path}.conditions`, 'Too many conditions')
      ok = false
    }
    for (const [index, condition] of conditions.entries()) {
      if (!collector.descend()) { ok = false; break }
      const conditionPath = `${path}.conditions[${index}]`
      if (!isPlainObject(condition) || !hasOnlyKeys(condition, CONDITION_FIELDS)) {
        collector.add('INVALID_TYPE', conditionPath, 'Condition must be an object with questionId, operator, value')
        ok = false
        continue
      }
      if (typeof condition.questionId !== 'string' || !ID_PATTERN.test(condition.questionId)) {
        collector.add('INVALID_TYPE', `${conditionPath}.questionId`, 'Condition questionId is invalid')
        ok = false
      }
      if (!isConditionOperator(condition.operator as string)) {
        collector.add('INVALID_OPERATOR', `${conditionPath}.operator`, 'Condition operator is invalid')
        ok = false
      }
      if (typeof condition.value !== 'string') {
        collector.add('INVALID_TYPE', `${conditionPath}.value`, 'Condition value must be a string')
        ok = false
      }
    }
  }
  const targets = value.targetQuestionIds
  if (!Array.isArray(targets)) {
    collector.add('INVALID_TYPE', `${path}.targetQuestionIds`, 'targetQuestionIds must be an array')
    ok = false
  } else {
    if (targets.length > QUESTIONNAIRE_FORMAT_LIMITS.maxTargetsPerRule) {
      collector.add('AI_CANDIDATE_LIMIT_EXCEEDED', `${path}.targetQuestionIds`, 'Too many targets')
      ok = false
    }
    for (const [index, target] of targets.entries()) {
      if (typeof target !== 'string' || !ID_PATTERN.test(target)) {
        collector.add('INVALID_TYPE', `${path}.targetQuestionIds[${index}]`, 'Target question id is invalid')
        ok = false
      }
    }
  }
  return ok
}

function validateSemantics(
  questionnaire: QuestionnaireDef,
  root: string,
  protectedVariableNames: readonly string[],
  collector: IssueCollector
): void {
  const add = (code: string, path: string, message: string): void => collector.add(code, path, message)
  if (questionnaire.name.trim().length === 0) add('EMPTY_NAME', `${root}.name`, 'Name is required')
  const ids = new Set<string>()
  const variableNames = new Set<string>(protectedVariableNames)
  for (const [index, question] of questionnaire.questions.entries()) {
    const path = `${root}.questions[${index}]`
    if (!ID_PATTERN.test(question.id) || ids.has(question.id)) {
      add('INVALID_QUESTION_ID', `${path}.id`, 'Question id must be legal and unique')
    }
    ids.add(question.id)
    if (question.content.length === 0) add('EMPTY_QUESTION', `${path}.content`, 'Question content is required')
    if (question.content.length > QUESTIONNAIRE_FORMAT_LIMITS.maxQuestionContentLength) {
      add('QUESTION_TOO_LONG', `${path}.content`, 'Question content is too long')
    }
    if (!DERIVED_VARIABLE_NAME_PATTERN.test(question.variableName)) {
      add('INVALID_VARIABLE_NAME', `${path}.variableName`, 'Variable name is invalid')
    } else if (variableNames.has(question.variableName)) {
      add('DUPLICATE_VARIABLE_NAME', `${path}.variableName`, 'Variable name conflicts with another variable')
    }
    variableNames.add(question.variableName)
    const optionValues = new Set<string>()
    for (const [optionIndex, option] of question.options.entries()) {
      const optionPath = `${path}.options[${optionIndex}]`
      if (option.value.length === 0 || option.label.length === 0) {
        add('EMPTY_OPTION', optionPath, 'Option value and label are required')
      }
      if (option.value.length > QUESTIONNAIRE_FORMAT_LIMITS.maxOptionValueLength ||
        option.label.length > QUESTIONNAIRE_FORMAT_LIMITS.maxOptionLabelLength) {
        add('OPTION_TOO_LONG', optionPath, 'Option value or label is too long')
      }
      if (optionValues.has(option.value)) {
        add('DUPLICATE_OPTION_VALUE', `${optionPath}.value`, 'Option values must be unique')
      }
      optionValues.add(option.value)
    }
    const choice = question.type === 'single_choice' || question.type === 'multiple_choice'
    if (choice && question.options.length === 0) {
      add('MISSING_OPTIONS', `${path}.options`, 'Choice questions require options')
    }
    if (!choice && question.options.length > 0) {
      add('UNEXPECTED_OPTIONS', `${path}.options`, 'Non-choice questions cannot have options')
    }
    validateConstraint(question.constraint, path, add)
    if (question.type === 'fixed_length' && question.constraint.fixedLength === undefined) {
      add('MISSING_FIXED_LENGTH', `${path}.constraint.fixedLength`, 'Fixed-length questions require fixedLength')
    }
    if (question.defaultValue !== undefined &&
      validateQuestionAnswer(question, question.defaultValue, false) !== null) {
      add('INVALID_DEFAULT_VALUE', `${path}.defaultValue`, 'Default value violates the question definition')
    }
    if (!question.allowSkip && question.skipValue !== undefined) {
      add('UNEXPECTED_SKIP_VALUE', `${path}.skipValue`, 'Skip value requires allowSkip')
    }
  }
  const expectedKeys = questionnaire.questions.filter((question) => question.isKey)
    .map((question) => question.id).sort()
  const actualKeys = [...questionnaire.keyQuestionIds].sort()
  if (new Set(actualKeys).size !== actualKeys.length ||
    JSON.stringify(expectedKeys) !== JSON.stringify(actualKeys)) {
    add('KEY_QUESTION_MISMATCH', `${root}.keyQuestionIds`, 'keyQuestionIds must exactly match isKey flags')
  }
  validateRules(questionnaire, ids, root, add)
  validateRuleGraph(questionnaire, root, add)
}

function validateConstraint(
  constraint: ConstraintDef,
  questionPath: string,
  add: (code: string, path: string, message: string) => void
): void {
  const path = `${questionPath}.constraint`
  if (!isConstraintType(constraint.type)) add('INVALID_CONSTRAINT_TYPE', `${path}.type`, 'Constraint type is invalid')
  if (constraint.fixedLength !== undefined && (!Number.isInteger(constraint.fixedLength) || constraint.fixedLength <= 0)) {
    add('INVALID_FIXED_LENGTH', `${path}.fixedLength`, 'fixedLength must be a positive integer')
  }
  for (const field of ['minValue', 'maxValue', 'step'] as const) {
    const value = constraint[field]
    if (value !== undefined && !Number.isFinite(value)) add('INVALID_NUMBER', `${path}.${field}`, `${field} must be finite`)
  }
  if (constraint.minValue !== undefined && constraint.maxValue !== undefined && constraint.minValue > constraint.maxValue) {
    add('INVALID_RANGE', path, 'minValue cannot exceed maxValue')
  }
  if (constraint.step !== undefined && constraint.step <= 0) {
    add('INVALID_STEP', `${path}.step`, 'step must be positive')
  }
  if (constraint.type === 'regex') {
    if ((constraint.regexPattern?.length ?? 0) > QUESTIONNAIRE_FORMAT_LIMITS.maxRegexPatternLength ||
      (constraint.regexFlags?.length ?? 0) > QUESTIONNAIRE_FORMAT_LIMITS.maxRegexFlagsLength) {
      add('INVALID_REGEX', path, 'Regex pattern or flags are too long')
    } else if (!constraint.regexPattern) {
      add('MISSING_REGEX', `${path}.regexPattern`, 'Regex constraint requires a pattern')
    } else {
      try {
        new RegExp(constraint.regexPattern, constraint.regexFlags)
      } catch {
        add('INVALID_REGEX', `${path}.regexPattern`, 'Regex pattern or flags are invalid')
      }
    }
  } else if (constraint.regexPattern !== undefined || constraint.regexFlags !== undefined) {
    add('UNEXPECTED_REGEX', path, 'Regex fields require regex constraint type')
  }
}

function validateRules(
  questionnaire: QuestionnaireDef,
  questionIds: ReadonlySet<string>,
  root: string,
  add: (code: string, path: string, message: string) => void
): void {
  const ruleIds = new Set<string>()
  const questionById = new Map(questionnaire.questions.map((question) => [question.id, question]))
  for (const [index, rule] of questionnaire.conditionRules.entries()) {
    const path = `${root}.conditionRules[${index}]`
    if (!ID_PATTERN.test(rule.id) || ruleIds.has(rule.id)) add('INVALID_RULE_ID', `${path}.id`, 'Rule id must be legal and unique')
    ruleIds.add(rule.id)
    if (!questionIds.has(rule.sourceQuestionId)) add('UNKNOWN_SOURCE', `${path}.sourceQuestionId`, 'Source question does not exist')
    if (rule.logic !== 'AND' && rule.logic !== 'OR') add('INVALID_LOGIC', `${path}.logic`, 'Rule logic is invalid')
    if (rule.action !== 'skip' && rule.action !== 'show' && rule.action !== 'require') {
      add('INVALID_ACTION', `${path}.action`, 'Rule action is invalid')
    }
    if (rule.conditions.length === 0) add('EMPTY_CONDITIONS', `${path}.conditions`, 'Rule requires at least one condition')
    for (const [conditionIndex, condition] of rule.conditions.entries()) {
      const conditionPath = `${path}.conditions[${conditionIndex}]`
      const question = questionById.get(condition.questionId)
      if (question === undefined) {
        add('UNKNOWN_CONDITION_QUESTION', `${conditionPath}.questionId`, 'Condition question does not exist')
      }
      if (!isConditionOperator(condition.operator)) {
        add('INVALID_OPERATOR', `${conditionPath}.operator`, 'Condition operator is invalid')
      }
      const emptyOperator = condition.operator === 'is_empty' || condition.operator === 'is_not_empty'
      if (emptyOperator && condition.value !== '') {
        add('UNEXPECTED_CONDITION_VALUE', `${conditionPath}.value`, 'Empty operators cannot have a value')
      }
      if (!emptyOperator && condition.value.trim().length === 0) {
        add('EMPTY_CONDITION_VALUE', `${conditionPath}.value`, 'Condition value is required')
      }
      if ((condition.operator === 'greater_than' || condition.operator === 'less_than') &&
        !Number.isFinite(Number(condition.value))) {
        add('INVALID_CONDITION_VALUE', `${conditionPath}.value`, 'Numeric comparison requires a number')
      }
      if (question !== undefined && (condition.operator === 'equals' || condition.operator === 'not_equals') &&
        validateQuestionAnswer(question, condition.value, false) !== null) {
        add('INVALID_CONDITION_VALUE', `${conditionPath}.value`, 'Condition value is invalid for its question')
      }
    }
    if (rule.targetQuestionIds.length === 0) add('EMPTY_TARGETS', `${path}.targetQuestionIds`, 'Rule requires a target')
    if (new Set(rule.targetQuestionIds).size !== rule.targetQuestionIds.length) {
      add('DUPLICATE_TARGET', `${path}.targetQuestionIds`, 'Targets must be unique')
    }
    for (const [targetIndex, targetId] of rule.targetQuestionIds.entries()) {
      if (!questionIds.has(targetId)) {
        add('UNKNOWN_TARGET', `${path}.targetQuestionIds[${targetIndex}]`, 'Target question does not exist')
      }
      if (targetId === rule.sourceQuestionId ||
        rule.conditions.some((condition) => condition.questionId === targetId)) {
        add('SELF_REFERENTIAL_RULE', `${path}.targetQuestionIds[${targetIndex}]`, 'Rule cannot target a question used as its condition')
      }
    }
  }
}

function validateRuleGraph(
  questionnaire: QuestionnaireDef,
  root: string,
  add: (code: string, path: string, message: string) => void
): void {
  const edges = new Map<string, Set<string>>()
  const actionsByTarget = new Map<string, Set<string>>()
  const showTargets = new Set<string>()
  const rules: ConditionRule[] = questionnaire.conditionRules
  for (const rule of rules) {
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
      add('CONDITION_ACTION_CONFLICT', `${root}.conditionRules`, `Conflicting actions target ${target}`)
    }
  }
  const indegree = new Map(questionnaire.questions.map((question) => [question.id, 0]))
  for (const [source, targets] of edges) {
    if (!indegree.has(source)) continue
    for (const target of targets) {
      if (indegree.has(target)) indegree.set(target, (indegree.get(target) ?? 0) + 1)
    }
  }
  const pending = [...indegree].filter(([, count]) => count === 0).map(([id]) => id)
  let processed = 0
  while (pending.length > 0) {
    const source = pending.pop() as string
    processed += 1
    for (const target of edges.get(source) ?? []) {
      if (!indegree.has(target)) continue
      const next = (indegree.get(target) ?? 0) - 1
      indegree.set(target, next)
      if (next === 0) pending.push(target)
    }
  }
  if (processed !== indegree.size) {
    add('CONDITION_RULE_CYCLE', `${root}.conditionRules`, 'Conditional rules contain a cycle')
  }
  const reachable = new Set(
    questionnaire.questions.filter((question) => !showTargets.has(question.id)).map((question) => question.id)
  )
  let changed = true
  while (changed) {
    changed = false
    for (const rule of rules.filter((item) => item.action === 'show')) {
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
    add('UNREACHABLE_SHOW_CHAIN', `${root}.conditionRules`, 'Show-controlled questions have no reachable root')
  }
}

function cloneQuestionnaire(questionnaire: QuestionnaireDef): QuestionnaireDef {
  return {
    name: questionnaire.name,
    ...(questionnaire.description === undefined || questionnaire.description === null
      ? {}
      : { description: questionnaire.description }),
    questions: questionnaire.questions.map((question): QuestionDef => ({
      id: question.id,
      content: question.content,
      variableName: question.variableName,
      type: question.type,
      options: question.options.map((option) => ({ value: option.value, label: option.label })),
      constraint: { ...question.constraint },
      isKey: question.isKey,
      allowSkip: question.allowSkip,
      order: question.order,
      ...(question.defaultValue === undefined || question.defaultValue === null
        ? {}
        : { defaultValue: question.defaultValue }),
      ...(question.skipValue === undefined || question.skipValue === null
        ? {}
        : { skipValue: question.skipValue })
    })),
    conditionRules: questionnaire.conditionRules.map((rule): ConditionRule => ({
      id: rule.id,
      sourceQuestionId: rule.sourceQuestionId,
      conditions: rule.conditions.map((condition) => ({ ...condition })),
      logic: rule.logic,
      action: rule.action,
      targetQuestionIds: [...rule.targetQuestionIds]
    })),
    keyQuestionIds: [...questionnaire.keyQuestionIds]
  }
}

/**
 * Validates a questionnaire definition and returns a normalized clone when it is legal.
 * An empty issue list means the definition is usable by the app.
 */
export function validateQuestionnaireFormat(
  value: unknown,
  options: QuestionnaireFormatOptions = {}
): QuestionnaireFormatResult {
  const root = options.root ?? '$'
  const collector = new IssueCollector(root)
  const structurallyValid = inspectStructure(value, collector, root)
  if (collector.issues.length > 0) return { ok: false, issues: collector.issues }
  if (!structurallyValid) {
    return { ok: false, issues: [{ code: 'INVALID_DRAFT', path: root, message: 'Questionnaire structure is invalid' }] }
  }
  validateSemantics(value as QuestionnaireDef, root, options.protectedVariableNames ?? [], collector)
  if (collector.issues.length > 0) return { ok: false, issues: collector.issues }
  return { ok: true, questionnaire: cloneQuestionnaire(value as QuestionnaireDef) }
}
