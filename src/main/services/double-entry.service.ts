import { readFileSync } from 'node:fs'
import iconv from 'iconv-lite'

import type { QuestionnaireDef } from '@shared/types/qnaire'
import type { RecordData } from '@shared/types/record'
import type {
  DoubleEntryComparison,
  DoubleEntryFieldDiff,
  DoubleEntryMatchedRecord,
  DoubleEntryOnlyRecord
} from '@shared/types/double-entry'

export interface ImportedComparisonCsv {
  headers: string[]
  rows: Array<Record<string, string>>
  encoding: string
}

/**
 * Minimal RFC 4180 CSV parser: quoted fields, "" escapes, embedded commas and
 * newlines. Returns rows of cells.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false
  let index = 0

  const pushCell = (): void => {
    row.push(cell)
    cell = ''
  }
  const pushRow = (): void => {
    pushCell()
    rows.push(row)
    row = []
  }

  while (index < text.length) {
    const char = text[index]!
    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"'
          index += 2
          continue
        }
        inQuotes = false
        index += 1
        continue
      }
      cell += char
      index += 1
      continue
    }
    if (char === '"') {
      inQuotes = true
      index += 1
      continue
    }
    if (char === ',') {
      pushCell()
      index += 1
      continue
    }
    if (char === '\n') {
      pushRow()
      index += 1
      continue
    }
    if (char === '\r') {
      if (text[index + 1] === '\n') index += 1
      pushRow()
      index += 1
      continue
    }
    cell += char
    index += 1
  }
  // Flush trailing cells unless the text ended exactly on a newline.
  if (cell.length > 0 || row.length > 0) pushRow()
  return rows
}

export function detectCsvEncoding(buffer: Buffer): string {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buffer)
    return 'utf-8'
  } catch {
    const gbk = iconv.decode(buffer, 'gbk')
    if (!gbk.includes('�')) return 'gbk'
    return 'windows-1252'
  }
}

export function decodeCsvBuffer(buffer: Buffer, encoding: string): string {
  let text: string
  if (encoding === 'utf-8') {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } else {
    text = iconv.decode(buffer, encoding)
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  }
  return text
}

/**
 * Read and decode a comparison CSV file, mapping the header row to columns and
 * skipping EasyEpi metadata columns (`__easyepi_*`).
 */
export function readComparisonCsv(
  filePath: string,
  requestedEncoding?: string
): ImportedComparisonCsv {
  const buffer = readFileSync(filePath)
  const encoding = requestedEncoding ?? detectCsvEncoding(buffer)
  const text = decodeCsvBuffer(buffer, encoding)
  const cells = parseCsv(text)
  if (cells.length === 0) return { headers: [], rows: [], encoding }
  const headers = cells[0]!.map((header) => header.trim())
  const dataRows = cells.slice(1).filter((cellsRow) => cellsRow.some((cell) => cell.trim().length > 0))
  const rows = dataRows.map((cellsRow) => {
    const row: Record<string, string> = {}
    headers.forEach((header, index) => {
      if (header.length === 0 || header.startsWith('__easyepi_')) return
      row[header] = cellsRow[index] ?? ''
    })
    return row
  })
  return {
    headers: headers.filter((header) => header.length > 0 && !header.startsWith('__easyepi_')),
    rows,
    encoding
  }
}

function answerToString(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) return value.join(',')
  return String(value)
}

function isBlank(value: string): boolean {
  return value.trim().length === 0
}

interface OptionLike {
  value: string
  label: string
}

function optionLabel(value: string, options: OptionLike[]): string | undefined {
  return options.find((option) => option.value === value)?.label
}

/**
 * Normalize a primary stored value to the label form used by the exported CSV,
 * so comparisons are semantic (label vs label) rather than raw vs label.
 */
function normalizePrimaryValue(type: string, value: string, options: OptionLike[]): string {
  if (type === 'single_choice') {
    return optionLabel(value, options) ?? value
  }
  if (type === 'multiple_choice') {
    return value
      .split(',')
      .map((item) => optionLabel(item.trim(), options) ?? item.trim())
      .join(',')
  }
  return value.trim()
}

function buildKeyValues(
  keyFieldNames: string[],
  valueFor: (variableName: string) => string
): Record<string, string> {
  const values: Record<string, string> = {}
  for (const name of keyFieldNames) {
    values[name] = valueFor(name)
  }
  return values
}

export class DoubleEntryService {
  /**
   * Compare primary records (from the encrypted data file) against imported
   * secondary rows. Records are matched by Key field values; matched pairs are
   * diffed field-by-field on raw values.
   */
  compare(
    primary: RecordData[],
    secondary: Array<Record<string, string>>,
    qnaire: QuestionnaireDef,
    keyFieldNames: string[]
  ): DoubleEntryComparison {
    const questionByVariableName = new Map(
      qnaire.questions.map((question) => [question.variableName, question])
    )
    const primaryKeyValue = (record: RecordData, name: string): string => {
      const question = questionByVariableName.get(name)
      const raw = answerToString(
        question === undefined ? undefined : record.answers[question.id]
      )
      if (question !== undefined) {
        return normalizePrimaryValue(question.type, raw, question.options)
      }
      return raw.trim()
    }

    const primaryBySignature = new Map<string, RecordData[]>()
    for (const record of primary) {
      const signature = JSON.stringify(
        buildKeyValues(keyFieldNames, (name) => primaryKeyValue(record, name))
      )
      const bucket = primaryBySignature.get(signature) ?? []
      bucket.push(record)
      primaryBySignature.set(signature, bucket)
    }

    const secondaryBySignature = new Map<string, Array<Record<string, string>>>()
    for (const row of secondary) {
      const signature = JSON.stringify(
        buildKeyValues(keyFieldNames, (name) => row[name] ?? '')
      )
      const bucket = secondaryBySignature.get(signature) ?? []
      bucket.push(row)
      secondaryBySignature.set(signature, bucket)
    }

    const matched: DoubleEntryMatchedRecord[] = []
    const onlyInPrimary: DoubleEntryOnlyRecord[] = []
    const onlyInSecondary: DoubleEntryOnlyRecord[] = []

    const matchedSignatures = new Set<string>()

    for (const [signature, records] of primaryBySignature) {
      const secondaryBucket = secondaryBySignature.get(signature) ?? []
      const hasBlankKey = keyFieldNames.some((name) => isBlank(primaryKeyValue(records[0]!, name)))
      if (hasBlankKey || secondaryBucket.length === 0) {
        for (const record of records) {
          onlyInPrimary.push({
            keyValues: buildKeyValues(keyFieldNames, (name) => primaryKeyValue(record, name)),
            primaryRecordId: record.id
          })
        }
        continue
      }

      records.forEach((record, index) => {
        const secondaryRow = secondaryBucket[index]
        if (secondaryRow === undefined) {
          onlyInPrimary.push({
            keyValues: buildKeyValues(keyFieldNames, (name) => primaryKeyValue(record, name)),
            primaryRecordId: record.id
          })
          return
        }
        matchedSignatures.add(signature)
        const diffs: DoubleEntryFieldDiff[] = []
        for (const question of qnaire.questions) {
          const primaryValue = answerToString(record.answers[question.id])
          const secondaryValue = secondaryRow[question.variableName] ?? ''
          if (isBlank(primaryValue) && isBlank(secondaryValue)) continue
          const primaryNormalized = normalizePrimaryValue(question.type, primaryValue, question.options)
          const secondaryNormalized = secondaryValue.trim()
          if (primaryNormalized !== secondaryNormalized) {
            diffs.push({
              variableName: question.variableName,
              label: question.content,
              oldValue: normalizePrimaryValue(question.type, primaryValue, question.options),
              newValue: secondaryValue
            })
          }
        }
        matched.push({
          keyValues: buildKeyValues(keyFieldNames, (name) => primaryKeyValue(record, name)),
          primaryRecordId: record.id,
          diffs
        })
      })

      for (let index = records.length; index < secondaryBucket.length; index += 1) {
        onlyInSecondary.push({
          keyValues: buildKeyValues(keyFieldNames, (name) => secondaryBucket[index]![name] ?? '')
        })
      }
    }

    for (const [signature, rows] of secondaryBySignature) {
      if (matchedSignatures.has(signature)) continue
      const hasBlankKey = keyFieldNames.some((name) => isBlank(rows[0]![name] ?? ''))
      if (hasBlankKey) {
        for (const row of rows) {
          onlyInSecondary.push({ keyValues: buildKeyValues(keyFieldNames, (name) => row[name] ?? '') })
        }
        continue
      }
      for (const row of rows) {
        onlyInSecondary.push({ keyValues: buildKeyValues(keyFieldNames, (name) => row[name] ?? '') })
      }
    }

    const matchedWithDiffs = matched.filter((entry) => entry.diffs.length > 0)
    return {
      secondaryFileName: '',
      encoding: '',
      primaryCount: primary.length,
      secondaryCount: secondary.length,
      matchedIdentical: matched.length - matchedWithDiffs.length,
      matchedWithDiffs: matchedWithDiffs.length,
      recordsOnlyInPrimary: onlyInPrimary.length,
      recordsOnlyInSecondary: onlyInSecondary.length,
      matched,
      onlyInPrimary,
      onlyInSecondary
    }
  }
}
