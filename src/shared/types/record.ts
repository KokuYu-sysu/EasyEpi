export type AnswerValue = string | number | string[] | null

export interface RecordData {
  id: string
  answers: Record<string, AnswerValue>
  createdAt: string
  updatedAt: string
}

export interface EntryProgress {
  currentIndex: number
  batchCount: number
  batchStartTime: number
  currentRecordId?: string
}

export interface EntrySession {
  projectPath: string
  currentIndex: number
  batchCount: number
  batchStartTime: number
  autoSavedAt: string
}
