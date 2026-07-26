import type { PreferencesResult, PreferencesV1 } from './preferences-contract'
import type { PingRequest, PingResponse } from './system-contract'
import type {
  ProjectCreateRequest,
  ProjectOpenRequest,
  ProjectSaveRequest,
  ProjectResult
} from './qnaire-contract'
import type { QuestionDef, ConditionRule, QuestionnaireDef } from './types/qnaire'
import type {
  RecordSubmitResult,
  RecordListResult,
  EntryProgressResult,
  KeyDuplicateResult
} from './record-contract'

export interface DialogResult {
  canceled: boolean
  filePaths: string[]
}

export interface DesktopApi {
  system: {
    ping(request: PingRequest): Promise<PingResponse>
  }
  preferences: {
    get(): Promise<PreferencesResult>
    update(preferences: PreferencesV1): Promise<PreferencesResult>
  }
  dialog: {
    selectFolder(): Promise<DialogResult>
    selectFile(filters?: { name: string; extensions: string[] }[]): Promise<DialogResult>
  }
  project: {
    create(request: ProjectCreateRequest): Promise<ProjectResult>
    open(request: ProjectOpenRequest): Promise<ProjectResult>
    save(request: ProjectSaveRequest): Promise<ProjectResult>
    close(): Promise<{ ok: boolean }>
  }
  qnaire: {
    getData(): Promise<QuestionnaireDef>
    addQuestion(question: QuestionDef): Promise<{ ok: boolean; question: QuestionDef }>
    updateQuestion(id: string, patch: Partial<QuestionDef>): Promise<{ ok: boolean }>
    deleteQuestion(id: string): Promise<{ ok: boolean }>
    reorderQuestions(ids: string[]): Promise<{ ok: boolean }>
    addConditionRule(rule: ConditionRule): Promise<{ ok: boolean; rule: ConditionRule }>
    updateConditionRule(id: string, patch: Partial<ConditionRule>): Promise<{ ok: boolean }>
    deleteConditionRule(id: string): Promise<{ ok: boolean }>
    updateMeta(name?: string, description?: string): Promise<{ ok: boolean }>
  }
  record: {
    submit(answers: Record<string, unknown>): Promise<RecordSubmitResult>
    list(offset?: number, limit?: number): Promise<RecordListResult>
    delete(recordIds: string[]): Promise<{ ok: boolean }>
    getProgress(): Promise<EntryProgressResult>
    saveProgress(data: {
      hasDraft?: boolean
      currentIndex?: number
      batchStartTime?: number
      currentAnswers?: Record<string, unknown>
    }): Promise<{ ok: boolean }>
    checkKeyDuplicate(
      keyValues: Record<string, unknown>,
      excludeRecordId?: string
    ): Promise<KeyDuplicateResult>
  }
}

export type SystemDesktopApi = Pick<DesktopApi, 'system'>
