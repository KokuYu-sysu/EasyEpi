export interface DoubleEntryFieldDiff {
  variableName: string
  label: string
  oldValue: unknown
  newValue: unknown
}

export interface DoubleEntryMatchedRecord {
  keyValues: Record<string, string>
  primaryRecordId: string
  diffs: DoubleEntryFieldDiff[]
}

export interface DoubleEntryOnlyRecord {
  keyValues: Record<string, string>
  primaryRecordId?: string
}

export interface DoubleEntryComparison {
  secondaryFileName: string
  encoding: string
  primaryCount: number
  secondaryCount: number
  matchedIdentical: number
  matchedWithDiffs: number
  recordsOnlyInPrimary: number
  recordsOnlyInSecondary: number
  matched: DoubleEntryMatchedRecord[]
  onlyInPrimary: DoubleEntryOnlyRecord[]
  onlyInSecondary: DoubleEntryOnlyRecord[]
}
