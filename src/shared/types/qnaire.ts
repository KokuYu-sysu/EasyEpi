export type QuestionType =
  'single_choice' | 'multiple_choice' | 'fixed_length' | 'free_text' | 'numeric_range' | 'date'

export type ConstraintType =
  'none' | 'integer' | 'decimal' | 'chinese' | 'english' | 'alphanumeric' | 'date' | 'regex'

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
  return [
    'none',
    'integer',
    'decimal',
    'chinese',
    'english',
    'alphanumeric',
    'date',
    'regex'
  ].includes(value)
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
  const showControlledIds = new Set<string>()
  const shownIds = new Set<string>()

  for (const rule of qnaire.conditionRules) {
    const conditionsMet = evaluateConditions(rule.conditions, rule.logic, answers)
    if (rule.action === 'show') {
      for (const targetId of rule.targetQuestionIds) {
        showControlledIds.add(targetId)
        if (conditionsMet) shownIds.add(targetId)
      }
    } else if (rule.action === 'skip' && conditionsMet) {
      for (const targetId of rule.targetQuestionIds) {
        skippedIds.add(targetId)
      }
    }
  }

  return qnaire.questions
    .filter((q) => !skippedIds.has(q.id) && (!showControlledIds.has(q.id) || shownIds.has(q.id)))
    .sort((a, b) => a.order - b.order)
}

export function normalizeVisibleAnswers(
  qnaire: QuestionnaireDef,
  answers: Record<string, unknown>
): { visibleQuestions: QuestionDef[]; answers: Record<string, unknown> } {
  const knownIds = new Set(qnaire.questions.map((question) => question.id))
  let normalized = Object.fromEntries(
    Object.entries(answers).filter(([questionId]) => knownIds.has(questionId))
  )

  // Removing a hidden answer can hide another question. Iterate until no more
  // stale answers remain; the number of questions is a safe upper bound.
  for (let iteration = 0; iteration <= qnaire.questions.length; iteration += 1) {
    const visibleQuestions = getVisibleQuestions(qnaire, normalized)
    const visibleIds = new Set(visibleQuestions.map((question) => question.id))
    const nextAnswers = Object.fromEntries(
      Object.entries(normalized).filter(([questionId]) => visibleIds.has(questionId))
    )
    if (Object.keys(nextAnswers).length === Object.keys(normalized).length) {
      return { visibleQuestions, answers: nextAnswers }
    }
    normalized = nextAnswers
  }

  return { visibleQuestions: getVisibleQuestions(qnaire, normalized), answers: normalized }
}

export function validateQuestionAnswer(
  question: QuestionDef,
  answer: string | undefined,
  required = !question.allowSkip
): string | null {
  const value = answer?.trim() ?? ''
  if (value.length === 0) {
    return required ? '请回答当前题目' : null
  }

  if (question.type === 'single_choice') {
    return question.options.some((option) => option.value === value) ? null : '请选择有效选项'
  }

  if (question.type === 'multiple_choice') {
    const selected = value.split(',').filter(Boolean)
    const allowed = new Set(question.options.map((option) => option.value))
    return selected.length > 0 && selected.every((item) => allowed.has(item))
      ? null
      : '请选择有效选项'
  }

  if (
    question.constraint.fixedLength !== undefined &&
    value.length !== question.constraint.fixedLength
  ) {
    return `请输入 ${question.constraint.fixedLength} 个字符`
  }

  if (question.type === 'numeric_range') {
    const numericValue = Number(value)
    if (!Number.isFinite(numericValue)) return '请输入有效数字'
    if (question.constraint.type === 'integer' && !Number.isInteger(numericValue)) {
      return '请输入整数'
    }
    if (question.constraint.minValue !== undefined && numericValue < question.constraint.minValue) {
      return `数值不能小于 ${question.constraint.minValue}`
    }
    if (question.constraint.maxValue !== undefined && numericValue > question.constraint.maxValue) {
      return `数值不能大于 ${question.constraint.maxValue}`
    }
  }

  const patterns: Partial<Record<ConstraintType, RegExp>> = {
    integer: /^-?\d+$/,
    decimal: /^-?(?:\d+\.?\d*|\.\d+)$/,
    chinese: /^[\u3400-\u9fff]+$/u,
    english: /^[A-Za-z]+$/,
    alphanumeric: /^[A-Za-z0-9]+$/,
    date: /^\d{4}-\d{2}-\d{2}$/
  }
  const pattern = patterns[question.constraint.type]
  if (pattern !== undefined && !pattern.test(value)) {
    return '输入内容不符合题目约束'
  }

  if (question.constraint.type === 'regex' && question.constraint.regexPattern) {
    try {
      const regex = new RegExp(question.constraint.regexPattern, question.constraint.regexFlags)
      if (!regex.test(value)) return '输入内容不符合题目约束'
    } catch {
      return '题目的正则表达式无效'
    }
  }

  return null
}
