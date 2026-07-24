import type { PreferencesResult, PreferencesV1 } from './preferences-contract'
import type { PingRequest, PingResponse } from './system-contract'
import type { ProjectCreateRequest, ProjectOpenRequest, ProjectSaveRequest, ProjectResult } from './qnaire-contract'
import type { QuestionDef, ConditionRule, QuestionnaireDef } from './types/qnaire'

export interface DesktopApi {
  system: {
    ping(request: PingRequest): Promise<PingResponse>
  }
  preferences: {
    get(): Promise<PreferencesResult>
    update(preferences: PreferencesV1): Promise<PreferencesResult>
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
}

export type SystemDesktopApi = Pick<DesktopApi, 'system'>
