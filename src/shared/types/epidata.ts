export enum QESFieldType {
  INTEGER = 'INTEGER',
  DECIMAL = 'DECIMAL',
  TEXT = 'TEXT',
  UPPERCASE = 'UPPERCASE',
  BOOLEAN = 'BOOLEAN',
  DATE_DMY = 'DATE_DMY',
  DATE_MDY = 'DATE_MDY',
  TODAY_DATE = 'TODAY_DATE',
  SOUNDEX = 'SOUNDEX',
  ID_NUMBER = 'ID_NUM'
}

export interface QESField {
  name: string
  label: string
  type: QESFieldType
  length: number
  decimals: number
  comment: string | null
}

export interface QESBlock {
  type: 'LABEL' | 'JUMPS' | 'RANGE' | 'LEGAL' | 'MUSTENTER' | 'COMMENT' | 'TYPE' | 'VALUELABEL' | 'GOTO' | 'END'
  content: string
}

export interface QESParseResult {
  metadata: { title: string; version?: string }
  fields: QESField[]
  blocks: QESBlock[]
}

export interface RECHeader {
  fileType: string
  fieldCount: number
  fields: RECFieldInfo[]
}

export interface RECFieldInfo {
  name: string
  type: string
  length: number
  decimals: number
}

export interface RECRecord {
  status: 'normal' | 'deleted'
  fields: Record<string, string>
}

export interface RECParseResult {
  header: RECHeader
  records: RECRecord[]
  deletedCount: number
  encoding: string
}

export interface ImportPreview {
  questionnaire: {
    name: string
    description?: string
  }
  fieldCount: number
  recordCount?: number
  encoding?: string
  version?: string
  warnings: string[]
}

export interface ImportProgress {
  stage: 'parsing_qes' | 'parsing_rec' | 'creating_project' | 'importing_data'
  current: number
  total: number
  message: string
}

export interface ImportResult {
  success: boolean
  projectPath: string
  recordCount: number
  warnings: string[]
  errors: string[]
}

export function isQESFieldType(value: string): value is QESFieldType {
  return Object.values(QESFieldType).includes(value as QESFieldType)
}

export function isQESBlockType(value: string): value is QESBlock['type'] {
  return ['LABEL', 'JUMPS', 'RANGE', 'LEGAL', 'MUSTENTER', 'COMMENT', 'TYPE', 'VALUELABEL', 'JUMPS', 'GOTO', 'END'].includes(value)
}