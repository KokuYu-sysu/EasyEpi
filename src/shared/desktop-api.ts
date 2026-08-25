import type { PreferencesResult, PreferencesV1 } from './preferences-contract'
import type { PingRequest, PingResponse } from './system-contract'
import type {
  ProjectCreateRequest,
  ProjectOpenRequest,
  ProjectSaveRequest,
  ProjectRestoreRequest,
  ProjectResult,
  BackupListResult
} from './qnaire-contract'
import type { QuestionDef, ConditionRule, QuestionnaireDef } from './types/qnaire'
import type {
  DerivedValidateRequest,
  DerivedValidateResult,
  DerivedPreviewRequest,
  DerivedPreviewResult,
  DerivedListResult,
  DerivedCrudResult,
  DerivedDraft
} from './derived-contract'
import type {
  RecordSubmitResult,
  RecordListResult,
  EntryProgressResult,
  KeyDuplicateResult
} from './record-contract'
import type {
  EpiDataImportRequest,
  EpiDataPreviewRequest,
  EpiDataValidateRequest
} from './epidata-contract'
import type { ImportResult, ImportPreview, ImportProgress } from './types/epidata'
import type {
  AdminLoginRequest,
  AdminLoginResult,
  AdminSessionResult,
  AdminChangePasswordRequest,
  AdminChangePasswordResult,
  AdminGetRecordsRequest,
  AdminRecordsResult,
  AdminUpdateRecordRequest,
  AdminDeleteRecordsRequest
} from './admin-contract'
import type { ExportCsvRequest, ExportCsvResult } from './export-contract'
import type {
  BaselineExportRequest,
  BaselineExportResult,
  BaselineGenerateRequest,
  BaselineTable
} from './baseline-contract'
import type { QualityGetSummaryResult } from './quality-contract'
import type {
  DoubleEntryImportRequest,
  DoubleEntryImportResult,
  DoubleEntryCompareRequest,
  DoubleEntryCompareResult
} from './double-entry-contract'
import type {
  AIArtifactApplyRequest,
  AIArtifactApplyResult,
  AIArtifactPreviewResult,
  AICancelRequest,
  AICancelResult,
  AIConfigIpcResult,
  AIConfigUpdateRequest,
  AIConnectionTestResult,
  AIPrivacyStatusResult,
  AISendRequest,
  AISendResult,
  AISessionCreateRequest,
  AISessionDeleteResult,
  AISessionIdRequest,
  AISessionListResult,
  AISessionMigrateResult,
  AISessionResult,
  AISessionUpdateRequest,
  AIArtifactRequest
} from './ai-assistant-contract'

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
  ai: {
    config: {
      get(): Promise<AIConfigIpcResult>
      update(request: AIConfigUpdateRequest): Promise<AIConfigIpcResult>
      clear(): Promise<AIConfigIpcResult>
      testConnection(): Promise<AIConnectionTestResult>
    }
    privacy: {
      status(): Promise<AIPrivacyStatusResult>
      accept(): Promise<AIPrivacyStatusResult>
    }
    session: {
      create(request?: AISessionCreateRequest): Promise<AISessionResult>
      list(): Promise<AISessionListResult>
      get(request: AISessionIdRequest): Promise<AISessionResult>
      update(request: AISessionUpdateRequest): Promise<AISessionResult>
      delete(request: AISessionIdRequest): Promise<AISessionDeleteResult>
      migrate(request: AISessionIdRequest): Promise<AISessionMigrateResult>
    }
    send(request: AISendRequest): Promise<AISendResult>
    cancel(request: AICancelRequest): Promise<AICancelResult>
    artifact: {
      preview(request: AIArtifactRequest): Promise<AIArtifactPreviewResult>
      apply(request: AIArtifactApplyRequest): Promise<AIArtifactApplyResult>
    }
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
    onClosed?(callback: () => void): () => void
    backup(): Promise<ProjectResult>
    listBackups(): Promise<BackupListResult>
    restore(request: ProjectRestoreRequest): Promise<ProjectResult>
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
  derived: {
    getAll(): Promise<DerivedListResult>
    validate(request: DerivedValidateRequest): Promise<DerivedValidateResult>
    preview(request: DerivedPreviewRequest): Promise<DerivedPreviewResult>
    add(variable: DerivedDraft): Promise<DerivedCrudResult>
    update(id: string, patch: Partial<DerivedDraft>): Promise<DerivedCrudResult>
    delete(id: string): Promise<DerivedCrudResult>
    reorder(ids: string[]): Promise<DerivedCrudResult>
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
  epidata: {
    import(request: EpiDataImportRequest): Promise<ImportResult>
    preview(request: EpiDataPreviewRequest): Promise<ImportPreview>
    validate(request: EpiDataValidateRequest): Promise<{ valid: boolean; errors: string[] }>
    onImportProgress(callback: (progress: ImportProgress) => void): void
    offImportProgress(): void
  }
  admin: {
    login(request: AdminLoginRequest): Promise<AdminLoginResult>
    logout(): Promise<void>
    checkSession(): Promise<AdminSessionResult>
    changePassword(request: AdminChangePasswordRequest): Promise<AdminChangePasswordResult>
    getRecords(request: AdminGetRecordsRequest): Promise<AdminRecordsResult>
    updateRecord(request: AdminUpdateRecordRequest): Promise<{ ok: boolean }>
    deleteRecords(request: AdminDeleteRecordsRequest): Promise<{ ok: boolean }>
  }
  exportData: {
    csv(request: ExportCsvRequest): Promise<ExportCsvResult>
  }
  baseline: {
    generate(request?: BaselineGenerateRequest): Promise<BaselineTable>
    export(request: BaselineExportRequest): Promise<BaselineExportResult>
  }
  quality: {
    getSummary(): Promise<QualityGetSummaryResult>
  }
  doubleEntry: {
    import(request: DoubleEntryImportRequest): Promise<DoubleEntryImportResult>
    compare(request: DoubleEntryCompareRequest): Promise<DoubleEntryCompareResult>
  }
}

export type SystemDesktopApi = Pick<DesktopApi, 'system'>
