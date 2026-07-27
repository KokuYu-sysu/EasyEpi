import type { QuestionDef } from '@shared/types/qnaire'
import type { AnswerValue, RecordData } from '@shared/types/record'

export interface BaselineOptions {
  records: RecordData[]
  questions: QuestionDef[]
  selectedQuestionIds?: string[]
  groupQuestionId?: string
  statisticalMethod?: 'auto' | 'manual'
  continuousTest?: 'welch_t' | 'none'
  categoricalTest?: 'chi_square' | 'none'
}

export interface BaselineHeader {
  key: string
  label: string
}

export interface BaselineRow {
  variable: string
  label: string
  total: string
  groups?: Record<string, string>
  pValue?: number
  testUsed?: string
}

export interface BaselineTable {
  headers: BaselineHeader[]
  rows: BaselineRow[]
}

function isMissing(value: AnswerValue | undefined, question: QuestionDef): boolean {
  return (
    value === undefined ||
    value === null ||
    value === '' ||
    (question.allowSkip && String(value) === (question.skipValue ?? '-9'))
  )
}

function numericValues(records: RecordData[], question: QuestionDef): number[] {
  return records.flatMap((record) => {
    const value = record.answers[question.id]
    if (isMissing(value, question)) return []
    const numeric = typeof value === 'number' ? value : Number(value)
    return Number.isFinite(numeric) ? [numeric] : []
  })
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function sampleStandardDeviation(values: number[]): number {
  if (values.length < 2) return 0
  const average = mean(values)
  const sumSquares = values.reduce((sum, value) => sum + (value - average) ** 2, 0)
  return Math.sqrt(sumSquares / (values.length - 1))
}

function formatContinuous(values: number[]): string {
  if (values.length === 0) return '—'
  return `${mean(values).toFixed(2)} ± ${sampleStandardDeviation(values).toFixed(2)}`
}

function logGamma(value: number): number {
  const coefficients = [
    676.5203681218851,
    -1259.1392167224028,
    771.3234287776531,
    -176.6150291621406,
    12.507343278686905,
    -0.13857109526572012,
    9.984369578019572e-6,
    1.5056327351493116e-7
  ]
  if (value < 0.5) return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * value)) - logGamma(1 - value)
  const adjusted = value - 1
  let series = 0.9999999999998099
  for (let index = 0; index < coefficients.length; index += 1) {
    series += coefficients[index]! / (adjusted + index + 1)
  }
  const t = adjusted + coefficients.length - 0.5
  return 0.5 * Math.log(2 * Math.PI) + (adjusted + 0.5) * Math.log(t) - t + Math.log(series)
}

function betaContinuedFraction(x: number, a: number, b: number): number {
  const maxIterations = 200
  const epsilon = 3e-12
  const floor = 1e-30
  const qab = a + b
  const qap = a + 1
  const qam = a - 1
  let c = 1
  let d = 1 - (qab * x) / qap
  if (Math.abs(d) < floor) d = floor
  d = 1 / d
  let result = d
  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    const twice = 2 * iteration
    let aa = (iteration * (b - iteration) * x) / ((qam + twice) * (a + twice))
    d = 1 + aa * d
    if (Math.abs(d) < floor) d = floor
    c = 1 + aa / c
    if (Math.abs(c) < floor) c = floor
    d = 1 / d
    result *= d * c
    aa = (-(a + iteration) * (qab + iteration) * x) / ((a + twice) * (qap + twice))
    d = 1 + aa * d
    if (Math.abs(d) < floor) d = floor
    c = 1 + aa / c
    if (Math.abs(c) < floor) c = floor
    d = 1 / d
    const delta = d * c
    result *= delta
    if (Math.abs(delta - 1) < epsilon) break
  }
  return result
}

function regularizedBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const factor = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x))
  return x < (a + 1) / (a + b + 2)
    ? (factor * betaContinuedFraction(x, a, b)) / a
    : 1 - (factor * betaContinuedFraction(1 - x, b, a)) / b
}

function welchPValue(left: number[], right: number[]): number | undefined {
  if (left.length < 2 || right.length < 2) return undefined
  const leftVariance = sampleStandardDeviation(left) ** 2
  const rightVariance = sampleStandardDeviation(right) ** 2
  const leftTerm = leftVariance / left.length
  const rightTerm = rightVariance / right.length
  const denominator = leftTerm + rightTerm
  if (denominator === 0) return mean(left) === mean(right) ? 1 : 0
  const statistic = (mean(left) - mean(right)) / Math.sqrt(denominator)
  const degrees = denominator ** 2 / (
    leftTerm ** 2 / (left.length - 1) + rightTerm ** 2 / (right.length - 1)
  )
  return regularizedBeta(degrees / (degrees + statistic ** 2), degrees / 2, 0.5)
}

function regularizedGammaQ(a: number, x: number): number {
  if (x <= 0) return 1
  const epsilon = 1e-14
  if (x < a + 1) {
    let term = 1 / a
    let sum = term
    let ap = a
    for (let index = 1; index <= 200; index += 1) {
      ap += 1
      term *= x / ap
      sum += term
      if (Math.abs(term) < Math.abs(sum) * epsilon) break
    }
    const p = sum * Math.exp(-x + a * Math.log(x) - logGamma(a))
    return 1 - p
  }
  let b = x + 1 - a
  let c = 1 / 1e-30
  let d = 1 / b
  let h = d
  for (let index = 1; index <= 200; index += 1) {
    const an = -index * (index - a)
    b += 2
    d = an * d + b
    if (Math.abs(d) < 1e-30) d = 1e-30
    c = b + an / c
    if (Math.abs(c) < 1e-30) c = 1e-30
    d = 1 / d
    const delta = d * c
    h *= delta
    if (Math.abs(delta - 1) < epsilon) break
  }
  return Math.exp(-x + a * Math.log(x) - logGamma(a)) * h
}

function chiSquarePValue(table: number[][]): number | undefined {
  if (table.length < 2 || (table[0]?.length ?? 0) < 2) return undefined
  const rowTotals = table.map((row) => row.reduce((sum, value) => sum + value, 0))
  const columnTotals = table[0]!.map((_, column) => table.reduce((sum, row) => sum + row[column]!, 0))
  const total = rowTotals.reduce((sum, value) => sum + value, 0)
  if (total === 0 || rowTotals.some((value) => value === 0) || columnTotals.some((value) => value === 0)) return undefined
  let statistic = 0
  for (let row = 0; row < table.length; row += 1) {
    for (let column = 0; column < table[row]!.length; column += 1) {
      const expected = (rowTotals[row]! * columnTotals[column]!) / total
      statistic += (table[row]![column]! - expected) ** 2 / expected
    }
  }
  const degrees = (table.length - 1) * (table[0]!.length - 1)
  return regularizedGammaQ(degrees / 2, statistic / 2)
}

function answerCategories(question: QuestionDef, records: RecordData[]): { value: string; label: string }[] {
  if (question.options.length > 0) return question.options
  return [...new Set(records.flatMap((record) => {
    const value = record.answers[question.id]
    return isMissing(value, question) || Array.isArray(value) ? [] : [String(value)]
  }))].sort().map((value) => ({ value, label: value }))
}

export class BaselineService {
  generateTable(options: BaselineOptions): BaselineTable {
    const groupQuestion = options.groupQuestionId
      ? options.questions.find((question) => question.id === options.groupQuestionId || question.variableName === options.groupQuestionId)
      : undefined
    if (options.groupQuestionId && !groupQuestion) throw new Error('GROUP_QUESTION_NOT_FOUND')

    const selected = options.selectedQuestionIds
      ? new Set(options.selectedQuestionIds)
      : null
    const questions = options.questions.filter((question) =>
      question.id !== groupQuestion?.id &&
      (selected === null || selected.has(question.id) || selected.has(question.variableName))
    )
    const groupDefinitions = groupQuestion
      ? answerCategories(groupQuestion, options.records)
      : []
    const groupedRecords = Object.fromEntries(groupDefinitions.map(({ value }) => [
      value,
      options.records.filter((record) => String(record.answers[groupQuestion!.id]) === value)
    ]))
    const headers: BaselineHeader[] = [
      { key: 'total', label: `总体 (n=${options.records.length})` },
      ...groupDefinitions.map(({ value, label }) => ({
        key: value,
        label: `${label} (n=${groupedRecords[value]!.length})`
      }))
    ]
    const rows: BaselineRow[] = []

    for (const question of questions) {
      if (question.type === 'numeric_range') {
        const row: BaselineRow = {
          variable: question.variableName,
          label: question.content,
          total: formatContinuous(numericValues(options.records, question))
        }
        if (groupQuestion) {
          row.groups = Object.fromEntries(groupDefinitions.map(({ value }) => [
            value,
            formatContinuous(numericValues(groupedRecords[value]!, question))
          ]))
          if (groupDefinitions.length === 2 && options.continuousTest !== 'none') {
            row.pValue = welchPValue(
              numericValues(groupedRecords[groupDefinitions[0]!.value]!, question),
              numericValues(groupedRecords[groupDefinitions[1]!.value]!, question)
            )
            if (row.pValue !== undefined) row.testUsed = 'Welch t 检验'
          }
        }
        rows.push(row)
        continue
      }

      if (question.type !== 'single_choice' && question.type !== 'multiple_choice') continue
      const categories = answerCategories(question, options.records)
      const totalDenominator = options.records.filter((record) => !isMissing(record.answers[question.id], question)).length
      const contingency = categories.map(({ value }) => groupDefinitions.map(({ value: group }) =>
        groupedRecords[group]!.filter((record) => {
          const answer = record.answers[question.id]
          return Array.isArray(answer) ? answer.includes(value) : String(answer) === value
        }).length
      ))
      const singleChoicePValue = groupQuestion &&
        question.type === 'single_choice' &&
        options.categoricalTest !== 'none'
        ? chiSquarePValue(contingency)
        : undefined

      categories.forEach(({ value, label }, index) => {
        const totalCount = options.records.filter((record) => {
          const answer = record.answers[question.id]
          return Array.isArray(answer) ? answer.includes(value) : String(answer) === value
        }).length
        const row: BaselineRow = {
          variable: `${question.variableName}:${value}`,
          label: `  ${label}`,
          total: `${totalCount} (${totalDenominator === 0 ? '0.0' : ((totalCount / totalDenominator) * 100).toFixed(1)}%)`
        }
        if (groupQuestion) {
          row.groups = Object.fromEntries(groupDefinitions.map(({ value: group }) => {
            const groupRecords = groupedRecords[group]!
            const denominator = groupRecords.filter((record) => !isMissing(record.answers[question.id], question)).length
            const count = groupRecords.filter((record) => {
              const answer = record.answers[question.id]
              return Array.isArray(answer) ? answer.includes(value) : String(answer) === value
            }).length
            return [group, `${count} (${denominator === 0 ? '0.0' : ((count / denominator) * 100).toFixed(1)}%)`]
          }))
          const optionCounts = contingency[index]!
          const pValue = question.type === 'multiple_choice' && options.categoricalTest !== 'none'
            ? chiSquarePValue([
                optionCounts,
                groupDefinitions.map(({ value: group }, groupIndex) => {
                  const denominator = groupedRecords[group]!.filter((record) => !isMissing(record.answers[question.id], question)).length
                  return denominator - optionCounts[groupIndex]!
                })
              ])
            : index === 0
              ? singleChoicePValue
              : undefined
          if (pValue !== undefined) {
            row.pValue = pValue
            row.testUsed = 'Pearson χ² 检验'
          }
        }
        rows.push(row)
      })
    }

    return { headers, rows }
  }
}
