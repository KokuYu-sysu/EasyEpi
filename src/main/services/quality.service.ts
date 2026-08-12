import type { QuestionDef, QuestionnaireDef } from '@shared/types/qnaire'
import { getVisibleQuestions, validateQuestionAnswer } from '@shared/types/qnaire'
import type { AnswerValue, RecordData } from '@shared/types/record'
import type {
  QualityDuplicate,
  QualityFinding,
  QualitySummary
} from '@shared/types/quality'

function isMissing(value: AnswerValue | undefined, question: QuestionDef): boolean {
  return (
    value === undefined ||
    value === null ||
    value === '' ||
    (Array.isArray(value) && value.length === 0) ||
    (question.allowSkip && String(value) === (question.skipValue ?? '-9'))
  )
}

function answerToString(value: AnswerValue | undefined): string {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) return value.join(',')
  return String(value)
}

function serializeAnswers(
  answers: Record<string, AnswerValue>,
  questionIds: ReadonlySet<string>
): string {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(answers)
        .filter(([key]) => questionIds.has(key))
        .sort(([a], [b]) => a.localeCompare(b))
    )
  )
}

export class QualityService {
  analyze(qnaire: QuestionnaireDef, records: RecordData[]): QualitySummary {
    const questions = qnaire.questions

    const visibleByRecord = new Map(
      records.map((record) => [
        record.id,
        new Set(getVisibleQuestions(qnaire, record.answers).map((question) => question.id))
      ])
    )
    const perQuestion = questions.map((question) => {
      const applicableRecords = records.filter((record) => visibleByRecord.get(record.id)?.has(question.id))
      const answered = applicableRecords.reduce(
        (count, record) => (isMissing(record.answers[question.id], question) ? count : count + 1),
        0
      )
      const applicable = applicableRecords.length
      return {
        questionId: question.id,
        variableName: question.variableName,
        label: question.content,
        answered,
        applicable,
        rate: applicable === 0 ? 1 : answered / applicable
      }
    })
    const totalApplicable = perQuestion.reduce((sum, item) => sum + item.applicable, 0)
    const totalAnswered = perQuestion.reduce((sum, item) => sum + item.answered, 0)
    const overall = perQuestion.length === 0 || records.length === 0
      ? 0
      : totalApplicable === 0 ? 1 : totalAnswered / totalApplicable

    const outliers: QualityFinding[] = []
    const contradictions: QualityFinding[] = []
    for (const record of records) {
      for (const question of questions) {
        const value = record.answers[question.id]
        if (isMissing(value, question)) continue
        const text = answerToString(value)
        const error = validateQuestionAnswer(question, text, false)
        if (error !== null) {
          outliers.push({
            recordId: record.id,
            questionId: question.id,
            variableName: question.variableName,
            label: question.content,
            value: text,
            reason: error
          })
        }
      }

      const visibleIds = new Set(getVisibleQuestions(qnaire, record.answers).map((question) => question.id))
      for (const question of questions) {
        const value = record.answers[question.id]
        if (isMissing(value, question)) continue
        if (!visibleIds.has(question.id)) {
          contradictions.push({
            recordId: record.id,
            questionId: question.id,
            variableName: question.variableName,
            label: question.content,
            value: answerToString(value),
            reason: '答案存在但题目被条件规则隐藏'
          })
        }
      }
    }

    const duplicates = this.findDuplicates(qnaire, records)
    return {
      records: records.length,
      completeness: { overall, perQuestion },
      outliers,
      contradictions,
      duplicates
    }
  }

  private findDuplicates(qnaire: QuestionnaireDef, records: RecordData[]): QualityDuplicate[] {
    if (records.length < 2) return []
    const keyQuestionIds = qnaire.keyQuestionIds
    const keyQuestions = qnaire.questions.filter((question) => keyQuestionIds.includes(question.id))
    const questionIds = new Set(qnaire.questions.map((question) => question.id))

    const groups = new Map<string, RecordData[]>()
    for (const record of records) {
      let key: string
      let keyValues: Record<string, string> | undefined
      if (keyQuestions.length > 0) {
        keyValues = Object.fromEntries(
          keyQuestions.map((question) => [
            question.variableName,
            answerToString(record.answers[question.id])
          ])
        )
        key = JSON.stringify(keyValues)
      } else {
        key = serializeAnswers(record.answers, questionIds)
      }
      const bucket = groups.get(key) ?? []
      bucket.push(record)
      groups.set(key, bucket)
    }

    const duplicates: QualityDuplicate[] = []
    for (const bucket of groups.values()) {
      if (bucket.length < 2) continue
      const first = bucket[0]!
      const keyQuestionIdsUsed = keyQuestions.length > 0
      for (const record of bucket.slice(1)) {
        const identical = keyQuestionIdsUsed
          ? serializeAnswers(record.answers, questionIds) === serializeAnswers(first.answers, questionIds)
          : true
        const keyValues = keyQuestionIdsUsed
          ? Object.fromEntries(
              keyQuestions.map((question) => [
                question.variableName,
                answerToString(record.answers[question.id])
              ])
            )
          : undefined
        duplicates.push({
          recordId: record.id,
          duplicateOf: first.id,
          keyValues,
          identicalAnswers: identical,
          matchSummary: keyQuestionIdsUsed
            ? `Key: ${Object.entries(keyValues ?? {})
                .map(([name, value]) => `${name}=${value}`)
                .join(', ')}`
            : '完全相同'
        })
      }
    }
    return duplicates
  }
}
