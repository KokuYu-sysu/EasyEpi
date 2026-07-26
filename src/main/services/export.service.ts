import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname } from 'node:path'

export type EncodingType = 'multi_category' | 'one_hot' | 'dummy'

export interface ExportQuestion {
  variableName: string
  type: string
  options?: { value: string; label: string }[]
}

export interface ExportOptions {
  records: Record<string, unknown>[]
  questions: ExportQuestion[]
  encoding: EncodingType
  dummyReference?: 'first' | 'last'
  outputPath: string
}

export interface ExportResult {
  success: boolean
  csvPath?: string
  dictionaryPath?: string
  error?: string
}

export class ExportService {
  async exportCSV(options: ExportOptions): Promise<ExportResult> {
    try {
      const { records, questions, encoding, outputPath } = options

      // Ensure output directory exists
      const dir = dirname(outputPath)
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }

      // Transform data based on encoding
      const transformedRecords = this.transformEncoding(records, questions, encoding, options.dummyReference)

      // Generate CSV
      const csv = this.generateCSV(transformedRecords)

      // Add UTF-8 BOM for Excel compatibility
      const bom = '\uFEFF'
      writeFileSync(outputPath, bom + csv, 'utf-8')

      // Generate data dictionary
      const dictionaryPath = outputPath.replace('.csv', '_dictionary.txt')
      const dictionary = this.generateDictionary(questions, encoding)
      writeFileSync(dictionaryPath, dictionary, 'utf-8')

      return { success: true, csvPath: outputPath, dictionaryPath }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  }

  private transformEncoding(
    records: Record<string, unknown>[],
    questions: ExportQuestion[],
    encoding: EncodingType,
    dummyReference?: 'first' | 'last'
  ): Record<string, unknown>[] {
    if (encoding === 'multi_category') {
      return records
    }

    // Find multi-choice questions
    const multiChoiceQuestions = questions.filter(q => q.type === 'multiple_choice')

    return records.map(record => {
      const newRecord = { ...record }

      for (const question of multiChoiceQuestions) {
        const value = record[question.variableName] as string
        if (!value || !question.options) continue

        const selectedValues = value.split(',').map(v => v.trim())
        const options = question.options

        if (encoding === 'one_hot') {
          // One-hot: each option becomes a column
          for (const option of options) {
            const colName = `${question.variableName}_${option.label}`
            newRecord[colName] = selectedValues.includes(option.value) ? 1 : 0
          }
        } else if (encoding === 'dummy') {
          // Dummy: k-1 columns
          const refIndex = dummyReference === 'last' ? options.length - 1 : 0
          const dummyOptions = options.filter((_, i) => i !== refIndex)

          for (const option of dummyOptions) {
            const colName = `${question.variableName}_${option.label}_d`
            newRecord[colName] = selectedValues.includes(option.value) ? 1 : 0
          }
        }

        // Remove original multi-choice column for one_hot and dummy
        if (encoding !== 'multi_category') {
          delete newRecord[question.variableName]
        }
      }

      return newRecord
    })
  }

  private generateCSV(records: Record<string, unknown>[]): string {
    if (records.length === 0) return ''

    const headers = Object.keys(records[0]!)
    const rows = records.map(record =>
      headers.map(header => {
        const value = record[header]
        if (value === null || value === undefined) return ''
        const str = String(value)
        // Escape CSV special characters
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`
        }
        return str
      }).join(',')
    )

    return [headers.join(','), ...rows].join('\n')
  }

  private generateDictionary(
    questions: ExportQuestion[],
    encoding: EncodingType
  ): string {
    const lines = ['变量名\t变量标签\t类型\t取值范围']

    for (const question of questions) {
      const range = question.options
        ? question.options.map(o => `${o.value}=${o.label}`).join(', ')
        : '连续/文本'

      lines.push(`${question.variableName}\t${question.variableName}\t${question.type}\t${range}`)

      // Add expanded columns for one_hot/dummy
      if (encoding === 'one_hot' && question.options) {
        for (const option of question.options) {
          lines.push(`${question.variableName}_${option.label}\t${question.variableName}_${option.label}\t二分类\t0=否, 1=是`)
        }
      } else if (encoding === 'dummy' && question.options) {
        const dummyOptions = question.options.slice(1)
        for (const option of dummyOptions) {
          lines.push(`${question.variableName}_${option.label}_d\t${question.variableName}_${option.label}_d\t二分类\t0=否, 1=是`)
        }
      }
    }

    return lines.join('\n')
  }
}