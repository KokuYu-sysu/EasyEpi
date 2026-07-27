import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, basename } from 'node:path'
import iconv from 'iconv-lite'

export type EncodingType = 'multi_category' | 'one_hot' | 'dummy'

export interface ExportQuestion {
  variableName: string
  label?: string
  type: string
  options?: { value: string; label: string }[]
}

export interface ExportOptions {
  records: Record<string, unknown>[]
  questions: ExportQuestion[]
  metadataHeaders?: string[]
  encoding: EncodingType
  fileEncoding?: 'utf8_bom' | 'gbk'
  dummyReference?: 'first' | 'last'
  outputPath: string
}

export interface ExportResult {
  success: boolean
  csvPath?: string
  dictionaryPath?: string
  recordCount?: number
  columnCount?: number
  error?: string
}

function selectedValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string')
  if (typeof value !== 'string' || value.trim() === '') return []
  return value.split(',').map((item) => item.trim()).filter(Boolean)
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  const text = Array.isArray(value) ? value.join(',') : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function encodedFile(contents: string, encoding: 'utf8_bom' | 'gbk'): Buffer {
  return encoding === 'gbk'
    ? iconv.encode(contents, 'gbk')
    : Buffer.from(`\uFEFF${contents}`, 'utf8')
}

function displayChoice(value: unknown, question: ExportQuestion): unknown {
  if (value === null || value === undefined) return value
  const labels = new Map((question.options ?? []).map((option) => [option.value, option.label]))
  if (question.type === 'multiple_choice') {
    return selectedValues(value).map((item) => labels.get(item) ?? item)
  }
  if (question.type === 'single_choice') {
    return labels.get(String(value)) ?? value
  }
  return value
}

export class ExportService {
  async exportCSV(options: ExportOptions): Promise<ExportResult> {
    try {
      if (options.outputPath.trim() === '') throw new Error('INVALID_OUTPUT_PATH')
      if (!['multi_category', 'one_hot', 'dummy'].includes(options.encoding)) {
        throw new Error('INVALID_ENCODING')
      }
      const csvPath = extname(options.outputPath).toLowerCase() === '.csv'
        ? options.outputPath
        : `${options.outputPath}.csv`
      const outputDirectory = dirname(csvPath)
      if (!existsSync(outputDirectory)) mkdirSync(outputDirectory, { recursive: true })

      const records = this.transformEncoding(
        options.records,
        options.questions,
        options.encoding,
        options.dummyReference
      )
      const headers = this.collectHeaders(
        records,
        options.questions,
        options.encoding,
        options.dummyReference,
        options.metadataHeaders
      )
      const fileEncoding = options.fileEncoding ?? 'utf8_bom'
      writeFileSync(csvPath, encodedFile(this.generateCSV(records, headers), fileEncoding))

      const dictionaryPath = join(
        outputDirectory,
        `${basename(csvPath, extname(csvPath))}_dictionary.txt`
      )
      writeFileSync(dictionaryPath, encodedFile(
        this.generateDictionary(options.questions, options.encoding, options.dummyReference),
        fileEncoding
      ))
      return {
        success: true,
        csvPath,
        dictionaryPath,
        recordCount: records.length,
        columnCount: headers.length
      }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'EXPORT_FAILED' }
    }
  }

  private transformEncoding(
    records: Record<string, unknown>[],
    questions: ExportQuestion[],
    encoding: EncodingType,
    dummyReference: 'first' | 'last' = 'first'
  ): Record<string, unknown>[] {
    const multipleChoiceQuestions = questions.filter((question) => question.type === 'multiple_choice')
    return records.map((record) => {
      const transformed = { ...record }
      for (const question of questions) {
        if (question.type === 'single_choice') {
          transformed[question.variableName] = displayChoice(record[question.variableName], question)
        }
        if (question.type === 'multiple_choice' && encoding === 'multi_category') {
          transformed[question.variableName] = displayChoice(record[question.variableName], question)
        }
      }
      if (encoding === 'multi_category') return transformed
      for (const question of multipleChoiceQuestions) {
        const values = selectedValues(record[question.variableName])
        const options = question.options ?? []
        if (options.length === 0 || (encoding === 'dummy' && options.length < 2)) continue
        const referenceIndex = dummyReference === 'last' ? options.length - 1 : 0
        options.forEach((option, index) => {
          if (encoding === 'dummy' && index === referenceIndex) return
          const suffix = encoding === 'dummy' ? '_d' : ''
          transformed[`${question.variableName}_${option.label}${suffix}`] = values.includes(option.value) ? 1 : 0
        })
        delete transformed[question.variableName]
      }
      return transformed
    })
  }

  private expectedQuestionHeaders(
    questions: ExportQuestion[],
    encoding: EncodingType,
    dummyReference: 'first' | 'last' = 'first'
  ): string[] {
    return questions.flatMap((question) => {
      if (question.type !== 'multiple_choice' || encoding === 'multi_category') {
        return [question.variableName]
      }
      const options = question.options ?? []
      if (options.length === 0 || (encoding === 'dummy' && options.length < 2)) {
        return [question.variableName]
      }
      const referenceIndex = dummyReference === 'last' ? options.length - 1 : 0
      return options.flatMap((option, index) => {
        if (encoding === 'dummy' && index === referenceIndex) return []
        return [`${question.variableName}_${option.label}${encoding === 'dummy' ? '_d' : ''}`]
      })
    })
  }

  private collectHeaders(
    records: Record<string, unknown>[],
    questions: ExportQuestion[],
    encoding: EncodingType,
    dummyReference: 'first' | 'last' = 'first',
    metadataHeaders: string[] = []
  ): string[] {
    const headers: string[] = []
    const seen = new Set<string>()
    for (const record of records) {
      for (const key of Object.keys(record)) {
        if (!seen.has(key)) {
          seen.add(key)
          headers.push(key)
        }
      }
    }
    for (const header of metadataHeaders) {
      if (!seen.has(header)) {
        seen.add(header)
        headers.push(header)
      }
    }
    for (const header of this.expectedQuestionHeaders(questions, encoding, dummyReference)) {
      if (!seen.has(header)) {
        seen.add(header)
        headers.push(header)
      }
    }
    return headers
  }

  private generateCSV(records: Record<string, unknown>[], headers: string[]): string {
    if (headers.length === 0) return ''
    return [
      headers.map(csvCell).join(','),
      ...records.map((record) => headers.map((header) => csvCell(record[header])).join(','))
    ].join('\n')
  }

  private generateDictionary(
    questions: ExportQuestion[],
    encoding: EncodingType,
    dummyReference: 'first' | 'last' = 'first'
  ): string {
    const lines = ['变量名\t变量标签\t类型\t取值范围']
    for (const question of questions) {
      const options = question.options ?? []
      const range = options.length > 0
        ? options.map((option) => `${option.value}=${option.label}`).join(', ')
        : '连续/文本'
      lines.push(`${question.variableName}\t${question.label ?? question.variableName}\t${question.type}\t${range}`)
      if (question.type !== 'multiple_choice' || encoding === 'multi_category') continue

      const referenceIndex = dummyReference === 'last' ? options.length - 1 : 0
      options.forEach((option, index) => {
        if (encoding === 'dummy' && index === referenceIndex) return
        const suffix = encoding === 'dummy' ? '_d' : ''
        lines.push(`${question.variableName}_${option.label}${suffix}\t${question.label ?? question.variableName}：${option.label}\t二分类\t0=否, 1=是`)
      })
      if (encoding === 'dummy' && options[referenceIndex]) {
        const reference = options[referenceIndex]!
        lines.push(`# ${question.variableName} 参考组：${reference.label} (${reference.value})`)
      }
    }
    return lines.join('\n')
  }
}
