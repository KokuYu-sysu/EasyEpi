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
  type ProjectResult
} from '@shared/qnaire-contract'
import type { QuestionDef, ConditionRule, QuestionnaireDef } from '@shared/types/qnaire'

export interface DesktopInvoke {
  (channel: typeof SYSTEM_PING_CHANNEL, request: PingRequest): Promise<PingResponse>
  (channel: typeof PREFERENCES_GET_CHANNEL): Promise<unknown>
  (channel: typeof PREFERENCES_UPDATE_CHANNEL, request: PreferencesV1): Promise<unknown>
  (channel: typeof PROJECT_CREATE_CHANNEL, request: ProjectCreateRequest): Promise<unknown>
  (channel: typeof PROJECT_OPEN_CHANNEL, request: ProjectOpenRequest): Promise<unknown>
  (channel: typeof PROJECT_SAVE_CHANNEL, request: ProjectSaveRequest): Promise<unknown>
  (channel: typeof PROJECT_CLOSE_CHANNEL): Promise<unknown>
  (channel: typeof QNAIRE_GET_DATA_CHANNEL): Promise<unknown>
  (channel: typeof QNAIRE_ADD_QUESTION_CHANNEL, question: QuestionDef): Promise<unknown>
  (channel: typeof QNAIRE_UPDATE_QUESTION_CHANNEL, args: { id: string; patch: Partial<QuestionDef> }): Promise<unknown>
  (channel: typeof QNAIRE_DELETE_QUESTION_CHANNEL, id: string): Promise<unknown>
  (channel: typeof QNAIRE_REORDER_QUESTIONS_CHANNEL, ids: string[]): Promise<unknown>
  (channel: typeof QNAIRE_ADD_CONDITION_CHANNEL, rule: ConditionRule): Promise<unknown>
  (channel: typeof QNAIRE_UPDATE_CONDITION_CHANNEL, args: { id: string; patch: Partial<ConditionRule> }): Promise<unknown>
  (channel: typeof QNAIRE_DELETE_CONDITION_CHANNEL, id: string): Promise<unknown>
  (channel: typeof QNAIRE_UPDATE_META_CHANNEL, args: { name?: string; description?: string }): Promise<unknown>
  (channel: 'dialog:selectFolder'): Promise<unknown>
  (channel: 'dialog:selectFile', filters?: { name: string; extensions: string[] }[]): Promise<unknown>
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
    close: async () => (await invoke(PROJECT_CLOSE_CHANNEL)) as { ok: boolean }
  })

  const qnaire = Object.freeze({
    getData: async () => parseQuestionnaireDef(await invoke(QNAIRE_GET_DATA_CHANNEL)),
    addQuestion: async (question: QuestionDef) =>
      (await invoke(QNAIRE_ADD_QUESTION_CHANNEL, question)) as { ok: boolean; question: QuestionDef },
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

  const dialog = Object.freeze({
    selectFolder: async () => (await invoke('dialog:selectFolder')) as DialogResult,
    selectFile: async (filters?: { name: string; extensions: string[] }[]) =>
      (await invoke('dialog:selectFile', filters)) as DialogResult
  })

  const desktopApi = { system, preferences, dialog, project, qnaire } satisfies DesktopApi
  return Object.freeze(desktopApi)
}
