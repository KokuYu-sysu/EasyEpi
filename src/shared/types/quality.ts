export interface QualityPerQuestion {
  questionId: string
  variableName: string
  label: string
  answered: number
  applicable: number
  rate: number
}

export interface QualityFinding {
  recordId: string
  questionId: string
  variableName: string
  label: string
  value?: unknown
  reason: string
}

export interface QualityDuplicate {
  recordId: string
  duplicateOf: string
  keyValues?: Record<string, string>
  identicalAnswers: boolean
  matchSummary: string
}

export interface QualitySummary {
  records: number
  completeness: {
    overall: number
    perQuestion: QualityPerQuestion[]
  }
  outliers: QualityFinding[]
  contradictions: QualityFinding[]
  duplicates: QualityDuplicate[]
}
