import { randomUUID } from 'node:crypto'

import type {
  QuestionDef,
  QuestionnaireDef,
  ConditionRule,
  ConditionDef,
  ConditionLogic,
  ConditionAction,
  QuestionType
} from '@shared/types/qnaire'

export function createQuestionnaireDef(name: string): QuestionnaireDef {
  return {
    name,
    questions: [],
    conditionRules: [],
    keyQuestionIds: []
  }
}

export function createQuestion(
  content: string,
  variableName: string,
  type: QuestionType,
  order: number
): QuestionDef {
  return {
    id: randomUUID(),
    content,
    variableName,
    type,
    options: [],
    constraint: { type: 'none' },
    isKey: false,
    allowSkip: false,
    order
  }
}

export function addQuestion(
  qnaire: QuestionnaireDef,
  question: QuestionDef
): QuestionnaireDef {
  if (qnaire.questions.some((q) => q.variableName === question.variableName)) {
    throw new Error('DUPLICATE_VARIABLE_NAME')
  }
  return {
    ...qnaire,
    questions: [...qnaire.questions, { ...question }],
    keyQuestionIds: question.isKey
      ? [...new Set([...qnaire.keyQuestionIds, question.id])]
      : qnaire.keyQuestionIds
  }
}

export function updateQuestion(
  qnaire: QuestionnaireDef,
  questionId: string,
  patch: Partial<QuestionDef>
): QuestionnaireDef {
  const index = qnaire.questions.findIndex((q) => q.id === questionId)
  if (index < 0) throw new Error('QUESTION_NOT_FOUND')

  if (patch.variableName) {
    const duplicate = qnaire.questions.some(
      (q) => q.id !== questionId && q.variableName === patch.variableName
    )
    if (duplicate) throw new Error('DUPLICATE_VARIABLE_NAME')
  }

  const questions = [...qnaire.questions]
  questions[index] = { ...questions[index]!, ...patch, id: questionId }
  const keyQuestionIds =
    patch.isKey === undefined
      ? qnaire.keyQuestionIds
      : patch.isKey
        ? [...new Set([...qnaire.keyQuestionIds, questionId])]
        : qnaire.keyQuestionIds.filter((id) => id !== questionId)
  return { ...qnaire, questions, keyQuestionIds }
}

export function deleteQuestion(
  qnaire: QuestionnaireDef,
  questionId: string
): QuestionnaireDef {
  const questions = qnaire.questions.filter((q) => q.id !== questionId)
  const keyQuestionIds = qnaire.keyQuestionIds.filter((id) => id !== questionId)
  const conditionRules = qnaire.conditionRules
    .filter(
      (r) =>
        r.sourceQuestionId !== questionId &&
        !r.conditions.some((condition) => condition.questionId === questionId)
    )
    .map((r) => ({
      ...r,
      targetQuestionIds: r.targetQuestionIds.filter((id) => id !== questionId)
    }))
    .filter((r) => r.targetQuestionIds.length > 0)
  return { ...qnaire, questions, keyQuestionIds, conditionRules }
}

export function reorderQuestions(
  qnaire: QuestionnaireDef,
  questionIds: string[]
): QuestionnaireDef {
  if (questionIds.length !== qnaire.questions.length) {
    throw new Error('REORDER_LENGTH_MISMATCH')
  }
  if (new Set(questionIds).size !== questionIds.length) {
    throw new Error('REORDER_DUPLICATE_ID')
  }
  const questionMap = new Map(qnaire.questions.map((q) => [q.id, q]))
  const questions = questionIds.map((id, index) => {
    const q = questionMap.get(id)
    if (!q) throw new Error('QUESTION_NOT_FOUND_IN_REORDER')
    return { ...q, order: index }
  })
  return { ...qnaire, questions }
}

export function createConditionRule(
  sourceQuestionId: string,
  conditions: ConditionDef[],
  logic: ConditionLogic,
  action: ConditionAction,
  targetQuestionIds: string[]
): ConditionRule {
  return {
    id: randomUUID(),
    sourceQuestionId,
    conditions,
    logic,
    action,
    targetQuestionIds
  }
}

export function addConditionRule(
  qnaire: QuestionnaireDef,
  rule: ConditionRule
): QuestionnaireDef {
  return {
    ...qnaire,
    conditionRules: [...qnaire.conditionRules, { ...rule }]
  }
}

export function updateConditionRule(
  qnaire: QuestionnaireDef,
  ruleId: string,
  patch: Partial<ConditionRule>
): QuestionnaireDef {
  const index = qnaire.conditionRules.findIndex((r) => r.id === ruleId)
  if (index < 0) throw new Error('CONDITION_RULE_NOT_FOUND')
  const rules = [...qnaire.conditionRules]
  rules[index] = { ...rules[index]!, ...patch, id: ruleId }
  return { ...qnaire, conditionRules: rules }
}

export function deleteConditionRule(
  qnaire: QuestionnaireDef,
  ruleId: string
): QuestionnaireDef {
  return {
    ...qnaire,
    conditionRules: qnaire.conditionRules.filter((r) => r.id !== ruleId)
  }
}

export function setKeyQuestion(
  qnaire: QuestionnaireDef,
  questionId: string,
  isKey: boolean
): QuestionnaireDef {
  if (!qnaire.questions.some((question) => question.id === questionId)) {
    throw new Error('QUESTION_NOT_FOUND')
  }
  const keyQuestionIds = isKey
    ? [...new Set([...qnaire.keyQuestionIds, questionId])]
    : qnaire.keyQuestionIds.filter((id) => id !== questionId)
  const questions = qnaire.questions.map((question) =>
    question.id === questionId ? { ...question, isKey } : question
  )
  return { ...qnaire, questions, keyQuestionIds }
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
    .filter(
      (q) =>
        !skippedIds.has(q.id) &&
        (!showControlledIds.has(q.id) || shownIds.has(q.id))
    )
    .sort((a, b) => a.order - b.order)
}

export function evaluateConditions(
  conditions: ConditionDef[],
  logic: ConditionLogic,
  answers: Record<string, unknown>
): boolean {
  if (conditions.length === 0) return true

  const results = conditions.map((c) => evaluateSingleCondition(c, answers))
  return logic === 'AND' ? results.every(Boolean) : results.some(Boolean)
}

function evaluateSingleCondition(
  condition: ConditionDef,
  answers: Record<string, unknown>
): boolean {
  const answer = answers[condition.questionId]
  const value = condition.value

  switch (condition.operator) {
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
}

export function detectConflicts(qnaire: QuestionnaireDef): string[] {
  const conflicts: string[] = []

  for (const rule of qnaire.conditionRules) {
    for (const targetId of rule.targetQuestionIds) {
      for (const otherRule of qnaire.conditionRules) {
        if (rule.id === otherRule.id) continue
        if (!otherRule.targetQuestionIds.includes(targetId)) continue

        if (rule.action === 'skip' && otherRule.action === 'require') {
          const question = qnaire.questions.find((q) => q.id === targetId)
          const name = question?.variableName ?? targetId
          conflicts.push(
            `题目 "${name}" 在规则中被跳过，但在另一条规则中被设为必填`
          )
        }
      }
    }
  }

  return conflicts
}
