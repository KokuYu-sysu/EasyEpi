import { randomUUID } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'

import { QESFieldType } from '@shared/types/epidata'
import type { ImportProgress, QESField } from '@shared/types/epidata'
import type { QuestionnaireDef } from '@shared/types/qnaire'
import type { AnswerValue, RecordData } from '@shared/types/record'

export function readEpiDataText(filePath: string, requestedEncoding?: string): string {
  const buffer = readFileSync(filePath)
  if (requestedEncoding !== undefined && requestedEncoding !== 'auto') {
    const encoding = requestedEncoding.toLowerCase()
    const decoder = encoding === 'latin1' || encoding === 'latin-1' ? 'windows-1252' : encoding
    return new TextDecoder(decoder).decode(buffer)
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch {
    try {
      return new TextDecoder('gbk', { fatal: true }).decode(buffer)
    } catch {
      return new TextDecoder('windows-1252').decode(buffer)
    }
  }
}

export function findSiblingRecFile(qesFilePath: string): string | null {
  const directory = dirname(qesFilePath)
  const stem = basename(qesFilePath, extname(qesFilePath)).toLowerCase()
  const match = readdirSync(directory).find((name) =>
    extname(name).toLowerCase() === '.rec' &&
    basename(name, extname(name)).toLowerCase() === stem
  )
  return match === undefined ? null : join(directory, match)
}

export function mapImportedRecords(
  sourceRecords: Array<Record<string, string>>,
  questionnaire: QuestionnaireDef,
  fields: QESField[],
  sourceFieldNames: string[] = [],
  report?: (progress: ImportProgress) => void
): RecordData[] {
  const fieldsByName = new Map(fields.map((field) => [field.name.toLowerCase(), field]))
  const total = sourceRecords.length
  report?.({
    stage: 'importing_data',
    current: 0,
    total,
    message: total === 0 ? 'No records to import' : `Preparing ${total} record(s)`
  })
  const records = sourceRecords.map((source, index) => {
    const sourceByName = new Map(
      Object.entries(source).map(([name, value]) => [name.toLowerCase(), value])
    )
    const answers: Record<string, AnswerValue> = {}
    for (const [questionIndex, question] of questionnaire.questions.entries()) {
      const sourceFieldName = sourceFieldNames[questionIndex]
      const value = sourceByName.get(question.variableName.toLowerCase()) ??
        (sourceFieldName === undefined ? undefined : sourceByName.get(sourceFieldName.toLowerCase()))
      if (value === undefined || value === '') continue
      answers[question.id] = normalizeValue(
        value,
        fieldsByName.get(question.variableName.toLowerCase())
      )
    }
    const timestamp = new Date().toISOString()
    if ((index + 1) % 500 === 0 || index + 1 === total) {
      report?.({
        stage: 'importing_data',
        current: index + 1,
        total,
        message: `Prepared ${index + 1} of ${total} record(s)`
      })
    }
    return { id: randomUUID(), answers, createdAt: timestamp, updatedAt: timestamp }
  })
  return records
}

function normalizeValue(value: string, field?: QESField): string {
  if (field?.type === QESFieldType.DATE_DMY) {
    const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
    if (match !== null) {
      return `${match[3]}-${match[2]!.padStart(2, '0')}-${match[1]!.padStart(2, '0')}`
    }
  }
  if (field?.type === QESFieldType.DATE_MDY) {
    const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
    if (match !== null) {
      return `${match[3]}-${match[1]!.padStart(2, '0')}-${match[2]!.padStart(2, '0')}`
    }
  }
  return value
}
