import { ipcRenderer } from 'electron'
import type { DesktopApi, DialogResult } from '@shared/desktop-api'
import {
  parsePreferencesResult,
  parsePreferencesUpdateRequest,
  PREFERENCES_GET_CHANNEL,
  PREFERENCES_UPDATE_CHANNEL,
  type PreferencesResult,
  type PreferencesV1
} from '@shared/preferences-contract'
import type { PingRequest, PingResponse } from '@shared/system-contract'
import { SYSTEM_PING_CHANNEL } from '@shared/system-contract'
import {
  PROJECT_CREATE_CHANNEL,
  PROJECT_OPEN_CHANNEL,
  PROJECT_SAVE_CHANNEL,
  PROJECT_CLOSE_CHANNEL,
  PROJECT_CLOSED_CHANNEL,
  PROJECT_BACKUP_CHANNEL,
  PROJECT_LIST_BACKUPS_CHANNEL,
  PROJECT_RESTORE_CHANNEL,
  QNAIRE_ADD_QUESTION_CHANNEL,
  QNAIRE_UPDATE_QUESTION_CHANNEL,
  QNAIRE_DELETE_QUESTION_CHANNEL,
  QNAIRE_REORDER_QUESTIONS_CHANNEL,
  QNAIRE_ADD_CONDITION_CHANNEL,
  QNAIRE_UPDATE_CONDITION_CHANNEL,
  QNAIRE_DELETE_CONDITION_CHANNEL,
  QNAIRE_GET_DATA_CHANNEL,
  QNAIRE_UPDATE_META_CHANNEL,
  parseProjectResult,
  type ProjectCreateRequest,
  type ProjectOpenRequest,
  type ProjectSaveRequest,
  type ProjectRestoreRequest,
  type ProjectResult,
  type BackupListResult
} from '@shared/qnaire-contract'
import type { QuestionDef, ConditionRule, QuestionnaireDef } from '@shared/types/qnaire'
import {
  DERIVED_GET_ALL_CHANNEL,
  DERIVED_VALIDATE_CHANNEL,
  DERIVED_PREVIEW_CHANNEL,
  DERIVED_ADD_CHANNEL,
  DERIVED_UPDATE_CHANNEL,
  DERIVED_DELETE_CHANNEL,
  DERIVED_REORDER_CHANNEL,
  type DerivedCrudResult,
  type DerivedDraft,
  type DerivedListResult,
  type DerivedValidateRequest,
  type DerivedPreviewRequest
} from '@shared/derived-contract'
import {
  RECORD_SUBMIT_CHANNEL,
  RECORD_LIST_CHANNEL,
  RECORD_DELETE_CHANNEL,
  RECORD_GET_PROGRESS_CHANNEL,
  RECORD_SAVE_PROGRESS_CHANNEL,
  RECORD_CHECK_KEY_CHANNEL,
  type RecordSubmitResult,
  type RecordListResult,
  type EntryProgressResult,
  type KeyDuplicateResult
} from '@shared/record-contract'
import {
  EPIDATA_IMPORT_CHANNEL,
  EPIDATA_PREVIEW_CHANNEL,
  EPIDATA_VALIDATE_CHANNEL,
  EPIDATA_IMPORT_PROGRESS_CHANNEL,
  type EpiDataImportRequest,
  type EpiDataPreviewRequest,
  type EpiDataValidateRequest
} from '@shared/epidata-contract'
import type { ImportResult, ImportPreview, ImportProgress } from '@shared/types/epidata'
import {
  ADMIN_LOGIN_CHANNEL,
  ADMIN_LOGOUT_CHANNEL,
  ADMIN_CHECK_SESSION_CHANNEL,
  ADMIN_CHANGE_PASSWORD_CHANNEL,
  ADMIN_GET_RECORDS_CHANNEL,
  ADMIN_UPDATE_RECORD_CHANNEL,
  ADMIN_DELETE_RECORDS_CHANNEL,
  type AdminLoginRequest,
  type AdminLoginResult,
  type AdminSessionResult,
  type AdminChangePasswordRequest,
  type AdminChangePasswordResult,
  type AdminGetRecordsRequest,
  type AdminRecordsResult,
  type AdminUpdateRecordRequest,
  type AdminDeleteRecordsRequest
} from '@shared/admin-contract'
import {
  EXPORT_CSV_CHANNEL,
  parseExportCsvRequest,
  type ExportCsvRequest,
  type ExportCsvResult
} from '@shared/export-contract'
import {
  BASELINE_EXPORT_CHANNEL,
  BASELINE_GENERATE_CHANNEL,
  parseBaselineExportRequest,
  parseBaselineGenerateRequest,
  type BaselineExportRequest,
  type BaselineExportResult,
  type BaselineGenerateRequest,
  type BaselineTable
} from '@shared/baseline-contract'
import { QUALITY_GET_SUMMARY_CHANNEL } from '@shared/quality-contract'
import {
  DOUBLE_ENTRY_IMPORT_CHANNEL,
  DOUBLE_ENTRY_COMPARE_CHANNEL,
  type DoubleEntryImportRequest,
  type DoubleEntryCompareRequest
} from '@shared/double-entry-contract'

export interface DesktopInvoke {
  (channel: typeof SYSTEM_PING_CHANNEL, request: PingRequest): Promise<PingResponse>
  (channel: typeof PREFERENCES_GET_CHANNEL): Promise<unknown>
  (channel: typeof PREFERENCES_UPDATE_CHANNEL, request: PreferencesV1): Promise<unknown>
  (channel: typeof PROJECT_CREATE_CHANNEL, request: ProjectCreateRequest): Promise<unknown>
  (channel: typeof PROJECT_OPEN_CHANNEL, request: ProjectOpenRequest): Promise<unknown>
  (channel: typeof PROJECT_SAVE_CHANNEL, request: ProjectSaveRequest): Promise<unknown>
  (channel: typeof PROJECT_CLOSE_CHANNEL): Promise<unknown>
  (channel: typeof PROJECT_BACKUP_CHANNEL): Promise<unknown>
  (channel: typeof PROJECT_LIST_BACKUPS_CHANNEL): Promise<unknown>
  (channel: typeof PROJECT_RESTORE_CHANNEL, request: ProjectRestoreRequest): Promise<unknown>
  (channel: typeof QNAIRE_GET_DATA_CHANNEL): Promise<unknown>
  (channel: typeof QNAIRE_ADD_QUESTION_CHANNEL, question: QuestionDef): Promise<unknown>
  (
    channel: typeof QNAIRE_UPDATE_QUESTION_CHANNEL,
    args: { id: string; patch: Partial<QuestionDef> }
  ): Promise<unknown>
  (channel: typeof QNAIRE_DELETE_QUESTION_CHANNEL, id: string): Promise<unknown>
  (channel: typeof QNAIRE_REORDER_QUESTIONS_CHANNEL, ids: string[]): Promise<unknown>
  (channel: typeof QNAIRE_ADD_CONDITION_CHANNEL, rule: ConditionRule): Promise<unknown>
  (
    channel: typeof QNAIRE_UPDATE_CONDITION_CHANNEL,
    args: { id: string; patch: Partial<ConditionRule> }
  ): Promise<unknown>
  (channel: typeof QNAIRE_DELETE_CONDITION_CHANNEL, id: string): Promise<unknown>
  (
    channel: typeof QNAIRE_UPDATE_META_CHANNEL,
    args: { name?: string; description?: string }
  ): Promise<unknown>
  (channel: typeof DERIVED_GET_ALL_CHANNEL): Promise<unknown>
  (channel: typeof DERIVED_VALIDATE_CHANNEL, request: DerivedValidateRequest): Promise<unknown>
  (channel: typeof DERIVED_PREVIEW_CHANNEL, request: DerivedPreviewRequest): Promise<unknown>
  (channel: typeof DERIVED_ADD_CHANNEL, request: { variable: DerivedDraft }): Promise<unknown>
  (channel: typeof DERIVED_UPDATE_CHANNEL, request: { id: string; patch: Partial<DerivedDraft> }): Promise<unknown>
  (channel: typeof DERIVED_DELETE_CHANNEL, request: { id: string }): Promise<unknown>
  (channel: typeof DERIVED_REORDER_CHANNEL, request: { ids: string[] }): Promise<unknown>
  (channel: typeof RECORD_SUBMIT_CHANNEL, answers: Record<string, unknown>): Promise<unknown>
  (
    channel: typeof RECORD_LIST_CHANNEL,
    request: { offset?: number; limit?: number }
  ): Promise<unknown>
  (channel: typeof RECORD_DELETE_CHANNEL, request: { recordIds: string[] }): Promise<unknown>
  (channel: typeof RECORD_GET_PROGRESS_CHANNEL): Promise<unknown>
  (
    channel: typeof RECORD_SAVE_PROGRESS_CHANNEL,
    data: {
      currentIndex?: number
      batchStartTime?: number
      currentAnswers?: Record<string, unknown>
    }
  ): Promise<unknown>
  (
    channel: typeof RECORD_CHECK_KEY_CHANNEL,
    request: { keyValues: Record<string, unknown>; excludeRecordId?: string }
  ): Promise<unknown>
  (channel: 'dialog:selectFolder'): Promise<unknown>
  (
    channel: 'dialog:selectFile',
    filters?: { name: string; extensions: string[] }[]
  ): Promise<unknown>
  (channel: typeof EPIDATA_IMPORT_CHANNEL, request: EpiDataImportRequest): Promise<unknown>
  (channel: typeof EPIDATA_PREVIEW_CHANNEL, request: EpiDataPreviewRequest): Promise<unknown>
  (channel: typeof EPIDATA_VALIDATE_CHANNEL, request: EpiDataValidateRequest): Promise<unknown>
  (channel: typeof ADMIN_LOGIN_CHANNEL, request: AdminLoginRequest): Promise<unknown>
  (channel: typeof ADMIN_LOGOUT_CHANNEL): Promise<unknown>
  (channel: typeof ADMIN_CHECK_SESSION_CHANNEL): Promise<unknown>
  (channel: typeof ADMIN_CHANGE_PASSWORD_CHANNEL, request: AdminChangePasswordRequest): Promise<unknown>
  (channel: typeof ADMIN_GET_RECORDS_CHANNEL, request: AdminGetRecordsRequest): Promise<unknown>
  (channel: typeof ADMIN_UPDATE_RECORD_CHANNEL, request: AdminUpdateRecordRequest): Promise<unknown>
  (channel: typeof ADMIN_DELETE_RECORDS_CHANNEL, request: AdminDeleteRecordsRequest): Promise<unknown>
  (channel: typeof EXPORT_CSV_CHANNEL, request: ExportCsvRequest): Promise<unknown>
  (channel: typeof BASELINE_GENERATE_CHANNEL, request: BaselineGenerateRequest): Promise<unknown>
  (channel: typeof BASELINE_EXPORT_CHANNEL, request: BaselineExportRequest): Promise<unknown>
  (channel: typeof QUALITY_GET_SUMMARY_CHANNEL): Promise<unknown>
  (channel: typeof DOUBLE_ENTRY_IMPORT_CHANNEL, request: DoubleEntryImportRequest): Promise<unknown>
  (channel: typeof DOUBLE_ENTRY_COMPARE_CHANNEL, request: DoubleEntryCompareRequest): Promise<unknown>
}

function parsePublicPreferencesResult(value: unknown): PreferencesResult {
  try {
    return parsePreferencesResult(value)
  } catch {
    throw new Error('INVALID_PREFERENCES_RESPONSE')
  }
}

function parseProjectResultSafe(value: unknown): ProjectResult {
  try {
    return parseProjectResult(value)
  } catch {
    throw new Error('INVALID_PROJECT_RESPONSE')
  }
}

function parseQuestionnaireDef(value: unknown): QuestionnaireDef {
  if (typeof value !== 'object' || value === null) {
    throw new Error('INVALID_QUESTIONNAIRE_RESPONSE')
  }
  return value as QuestionnaireDef
}

export function createDesktopApi(invoke: DesktopInvoke): DesktopApi {
  const system = Object.freeze({
    ping: (request: PingRequest) => invoke(SYSTEM_PING_CHANNEL, request)
  })

  const preferences = Object.freeze({
    get: async () => parsePublicPreferencesResult(await invoke(PREFERENCES_GET_CHANNEL)),
    update: async (preferences: PreferencesV1) =>
      parsePublicPreferencesResult(
        await invoke(PREFERENCES_UPDATE_CHANNEL, parsePreferencesUpdateRequest(preferences))
      )
  })

  const project = Object.freeze({
    create: async (request: ProjectCreateRequest) =>
      parseProjectResultSafe(await invoke(PROJECT_CREATE_CHANNEL, request)),
    open: async (request: ProjectOpenRequest) =>
      parseProjectResultSafe(await invoke(PROJECT_OPEN_CHANNEL, request)),
    save: async (request: ProjectSaveRequest) =>
      parseProjectResultSafe(await invoke(PROJECT_SAVE_CHANNEL, request)),
    close: async () => (await invoke(PROJECT_CLOSE_CHANNEL)) as { ok: boolean },
    onClosed: (callback: () => void) => {
      const listener = () => callback()
      ipcRenderer.on(PROJECT_CLOSED_CHANNEL, listener)
      return () => ipcRenderer.removeListener(PROJECT_CLOSED_CHANNEL, listener)
    },
    backup: async () => parseProjectResultSafe(await invoke(PROJECT_BACKUP_CHANNEL)),
    listBackups: async () => (await invoke(PROJECT_LIST_BACKUPS_CHANNEL)) as BackupListResult,
    restore: async (request: ProjectRestoreRequest) =>
      parseProjectResultSafe(await invoke(PROJECT_RESTORE_CHANNEL, request))
  })

  const qnaire = Object.freeze({
    getData: async () => parseQuestionnaireDef(await invoke(QNAIRE_GET_DATA_CHANNEL)),
    addQuestion: async (question: QuestionDef) =>
      (await invoke(QNAIRE_ADD_QUESTION_CHANNEL, question)) as {
        ok: boolean
        question: QuestionDef
      },
    updateQuestion: async (id: string, patch: Partial<QuestionDef>) =>
      (await invoke(QNAIRE_UPDATE_QUESTION_CHANNEL, { id, patch })) as { ok: boolean },
    deleteQuestion: async (id: string) =>
      (await invoke(QNAIRE_DELETE_QUESTION_CHANNEL, id)) as { ok: boolean },
    reorderQuestions: async (ids: string[]) =>
      (await invoke(QNAIRE_REORDER_QUESTIONS_CHANNEL, ids)) as { ok: boolean },
    addConditionRule: async (rule: ConditionRule) =>
      (await invoke(QNAIRE_ADD_CONDITION_CHANNEL, rule)) as { ok: boolean; rule: ConditionRule },
    updateConditionRule: async (id: string, patch: Partial<ConditionRule>) =>
      (await invoke(QNAIRE_UPDATE_CONDITION_CHANNEL, { id, patch })) as { ok: boolean },
    deleteConditionRule: async (id: string) =>
      (await invoke(QNAIRE_DELETE_CONDITION_CHANNEL, id)) as { ok: boolean },
    updateMeta: async (name?: string, description?: string) =>
      (await invoke(QNAIRE_UPDATE_META_CHANNEL, { name, description })) as { ok: boolean }
  })

  const derived = Object.freeze({
    getAll: async () => (await invoke(DERIVED_GET_ALL_CHANNEL)) as DerivedListResult,
    validate: async (request: DerivedValidateRequest) =>
      (await invoke(DERIVED_VALIDATE_CHANNEL, request)) as Awaited<
        ReturnType<DesktopApi['derived']['validate']>
      >,
    preview: async (request: DerivedPreviewRequest) =>
      (await invoke(DERIVED_PREVIEW_CHANNEL, request)) as Awaited<
        ReturnType<DesktopApi['derived']['preview']>
      >,
    add: async (variable: DerivedDraft) =>
      (await invoke(DERIVED_ADD_CHANNEL, { variable })) as DerivedCrudResult,
    update: async (id: string, patch: Partial<DerivedDraft>) =>
      (await invoke(DERIVED_UPDATE_CHANNEL, { id, patch })) as DerivedCrudResult,
    delete: async (id: string) =>
      (await invoke(DERIVED_DELETE_CHANNEL, { id })) as DerivedCrudResult,
    reorder: async (ids: string[]) =>
      (await invoke(DERIVED_REORDER_CHANNEL, { ids })) as DerivedCrudResult
  })

  const dialog = Object.freeze({
    selectFolder: async () => (await invoke('dialog:selectFolder')) as DialogResult,
    selectFile: async (filters?: { name: string; extensions: string[] }[]) =>
      (await invoke('dialog:selectFile', filters)) as DialogResult
  })

  const record = Object.freeze({
    submit: async (answers: Record<string, unknown>) =>
      (await invoke(RECORD_SUBMIT_CHANNEL, { answers })) as RecordSubmitResult,
    list: async (offset?: number, limit?: number) =>
      (await invoke(RECORD_LIST_CHANNEL, { offset, limit })) as RecordListResult,
    delete: async (recordIds: string[]) =>
      (await invoke(RECORD_DELETE_CHANNEL, { recordIds })) as { ok: boolean },
    getProgress: async () => (await invoke(RECORD_GET_PROGRESS_CHANNEL)) as EntryProgressResult,
    saveProgress: async (data: {
      hasDraft?: boolean
      currentIndex?: number
      batchStartTime?: number
      currentAnswers?: Record<string, unknown>
    }) => (await invoke(RECORD_SAVE_PROGRESS_CHANNEL, data)) as { ok: boolean },
    checkKeyDuplicate: async (keyValues: Record<string, unknown>, excludeRecordId?: string) =>
      (await invoke(RECORD_CHECK_KEY_CHANNEL, {
        keyValues,
        excludeRecordId
      })) as KeyDuplicateResult
  })

  const epidata = Object.freeze({
    import: async (request: EpiDataImportRequest) =>
      (await invoke(EPIDATA_IMPORT_CHANNEL, request)) as unknown as ImportResult,
    preview: async (request: EpiDataPreviewRequest) =>
      (await invoke(EPIDATA_PREVIEW_CHANNEL, request)) as unknown as ImportPreview,
    validate: async (request: EpiDataValidateRequest) =>
      (await invoke(EPIDATA_VALIDATE_CHANNEL, request)) as unknown as { valid: boolean; errors: string[] },
    onImportProgress: (callback: (progress: ImportProgress) => void) => {
      ipcRenderer.on(EPIDATA_IMPORT_PROGRESS_CHANNEL, (_event, progress) => {
        callback(progress as ImportProgress)
      })
    },
    offImportProgress: () => {
      ipcRenderer.removeAllListeners(EPIDATA_IMPORT_PROGRESS_CHANNEL)
    }
  })

  const admin = Object.freeze({
    login: async (request: AdminLoginRequest) =>
      (await invoke(ADMIN_LOGIN_CHANNEL, request)) as unknown as AdminLoginResult,
    logout: async () =>
      (await invoke(ADMIN_LOGOUT_CHANNEL)) as unknown as void,
    checkSession: async () =>
      (await invoke(ADMIN_CHECK_SESSION_CHANNEL)) as unknown as AdminSessionResult,
    changePassword: async (request: AdminChangePasswordRequest) =>
      (await invoke(ADMIN_CHANGE_PASSWORD_CHANNEL, request)) as unknown as AdminChangePasswordResult,
    getRecords: async (request: AdminGetRecordsRequest) =>
      (await invoke(ADMIN_GET_RECORDS_CHANNEL, request)) as unknown as AdminRecordsResult,
    updateRecord: async (request: AdminUpdateRecordRequest) =>
      (await invoke(ADMIN_UPDATE_RECORD_CHANNEL, request)) as unknown as { ok: boolean },
    deleteRecords: async (request: AdminDeleteRecordsRequest) =>
      (await invoke(ADMIN_DELETE_RECORDS_CHANNEL, request)) as unknown as { ok: boolean }
  })

  const exportData = Object.freeze({
    csv: async (request: ExportCsvRequest) =>
      (await invoke(
        EXPORT_CSV_CHANNEL,
        parseExportCsvRequest(request)
      )) as unknown as ExportCsvResult
  })

  const baseline = Object.freeze({
    generate: async (request: BaselineGenerateRequest = {}) =>
      (await invoke(
        BASELINE_GENERATE_CHANNEL,
        parseBaselineGenerateRequest(request)
      )) as unknown as BaselineTable,
    export: async (request: BaselineExportRequest) =>
      (await invoke(
        BASELINE_EXPORT_CHANNEL,
        parseBaselineExportRequest(request)
      )) as unknown as BaselineExportResult
  })

  const quality = Object.freeze({
    getSummary: async () => (await invoke(QUALITY_GET_SUMMARY_CHANNEL)) as Awaited<
      ReturnType<DesktopApi['quality']['getSummary']>
    >
  })

  const doubleEntry = Object.freeze({
    import: async (request: DoubleEntryImportRequest) =>
      (await invoke(DOUBLE_ENTRY_IMPORT_CHANNEL, request)) as Awaited<
        ReturnType<DesktopApi['doubleEntry']['import']>
      >,
    compare: async (request: DoubleEntryCompareRequest) =>
      (await invoke(DOUBLE_ENTRY_COMPARE_CHANNEL, request)) as Awaited<
        ReturnType<DesktopApi['doubleEntry']['compare']>
      >
  })

  const desktopApi = {
    system,
    preferences,
    dialog,
    project,
    qnaire,
    derived,
    record,
    epidata,
    admin,
    exportData,
    baseline,
    quality,
    doubleEntry
  } satisfies DesktopApi
  return Object.freeze(desktopApi)
}
