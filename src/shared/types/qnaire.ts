export type QuestionType =
  | 'single_choice'
  | 'multiple_choice'
  | 'fixed_length'
  | 'free_text'
  | 'numeric_range'
  | 'date'

export type ConstraintType =
  | 'none'
  | 'integer'
  | 'decimal'
  | 'chinese'
  | 'english'
  | 'alphanumeric'
  | 'date'
  | 'regex'

export type ConditionOperator =
  | 'equals'
  | 'not_equals'
  | 'greater_than'
  | 'less_than'
  | 'contains'
  | 'not_contains'
  | 'is_empty'
  | 'is_not_empty'

export type ConditionLogic = 'AND' | 'OR'

export type ConditionAction = 'skip' | 'show' | 'require'

export interface OptionItem {
  value: string
  label: string
}

export interface ConstraintDef {
  type: ConstraintType
  fixedLength?: number
  minValue?: number
  maxValue?: number
  step?: number
  regexPattern?: string
  regexFlags?: string
}

export interface QuestionDef {
  id: string
  content: string
  variableName: string
  type: QuestionType
  options: OptionItem[]
  constraint: ConstraintDef
  defaultValue?: string
  isKey: boolean
  allowSkip: boolean
  skipValue?: string
  order: number
}

export interface ConditionDef {
  questionId: string
  operator: ConditionOperator
  value: string
}

export interface ConditionRule {
  id: string
  sourceQuestionId: string
  conditions: ConditionDef[]
  logic: ConditionLogic
  action: ConditionAction
  targetQuestionIds: string[]
}

export interface QuestionnaireDef {
  questions: QuestionDef[]
  conditionRules: ConditionRule[]
  keyQuestionIds: string[]
  name: string
  description?: string
}

export function isQuestionType(value: string): value is QuestionType {
  return [
    'single_choice',
    'multiple_choice',
    'fixed_length',
    'free_text',
    'numeric_range',
    'date'
  ].includes(value)
}

export function isConstraintType(value: string): value is ConstraintType {
  return ['none', 'integer', 'decimal', 'chinese', 'english', 'alphanumeric', 'date', 'regex'].includes(value)
}

export function isConditionOperator(value: string): value is ConditionOperator {
  return [
    'equals',
    'not_equals',
    'greater_than',
    'less_than',
    'contains',
    'not_contains',
    'is_empty',
    'is_not_empty'
  ].includes(value)
}

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  single_choice: '单选题',
  multiple_choice: '多选题',
  fixed_length: '固定长度填空',
  free_text: '自由填空',
  numeric_range: '数字范围',
  date: '日期'
}

export const CONSTRAINT_TYPE_LABELS: Record<ConstraintType, string> = {
  none: '不限',
  integer: '仅数字（整数）',
  decimal: '仅数字（含小数）',
  chinese: '仅文字（中文）',
  english: '仅英文（字母）',
  alphanumeric: '英文+数字',
  date: '日期',
  regex: '正则表达式'
}

export const CONDITION_OPERATOR_LABELS: Record<ConditionOperator, string> = {
  equals: '等于',
  not_equals: '不等于',
  greater_than: '大于',
  less_than: '小于',
  contains: '包含',
  not_contains: '不包含',
  is_empty: '为空',
  is_not_empty: '不为空'
}

export function evaluateConditions(
  conditions: ConditionDef[],
  logic: ConditionLogic,
  answers: Record<string, unknown>
): boolean {
  if (conditions.length === 0) return true

  const results = conditions.map((c) => {
    const answer = answers[c.questionId]
    const value = c.value

    switch (c.operator) {
      case 'equals':
        return String(answer) === value
      case 'not_equals':
        return String(answer) !== value
      case 'greater_than':
        return Number(answer) > Number(value)
      case 'less_than':
        return Number(answer) < Number(value)
      case 'contains':
        return String(answer).includes(value)
      case 'not_contains':
        return !String(answer).includes(value)
      case 'is_empty':
        return answer === undefined || answer === null || String(answer) === ''
      case 'is_not_empty':
        return answer !== undefined && answer !== null && String(answer) !== ''
      default:
        return false
    }
  })

  return logic === 'AND' ? results.every(Boolean) : results.some(Boolean)
}

export function getVisibleQuestions(
  qnaire: QuestionnaireDef,
  answers: Record<string, unknown>
): QuestionDef[] {
  const skippedIds = new Set<string>()

  for (const rule of qnaire.conditionRules) {
    if (rule.action !== 'skip') continue
    const conditionsMet = evaluateConditions(rule.conditions, rule.logic, answers)
    if (conditionsMet) {
      for (const targetId of rule.targetQuestionIds) {
        skippedIds.add(targetId)
      }
    }
  }

  return qnaire.questions
    .filter((q) => !skippedIds.has(q.id))
    .sort((a, b) => a.order - b.order)
}
