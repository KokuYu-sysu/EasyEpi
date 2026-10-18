import {
  QUESTIONNAIRE_EXPORT_CHANNEL,
  parseQuestionnaireExportRequest,
  type QuestionnaireExportFormat,
  type QuestionnaireExportResult,
  type QuestionnaireExportError
} from '@shared/questionnaire-export-contract'
import type { QuestionnaireDef } from '@shared/types/qnaire'
import type { ProjectIpcState } from './project.ipc'
import { assertTrustedSender, type IpcMainLike } from './types'

export interface QuestionnaireExportServices {
  exportDocument(
    questionnaire: QuestionnaireDef,
    format: QuestionnaireExportFormat,
    assertCurrent: () => void
  ): Promise<QuestionnaireExportResult>
}

const PUBLIC_ERRORS = new Set<QuestionnaireExportError>([
  'NO_PROJECT_OPEN',
  'PROJECT_NOT_UNLOCKED',
  'EMPTY_QUESTIONNAIRE',
  'INVALID_QUESTIONNAIRE',
  'QUESTIONNAIRE_TOO_LARGE',
  'PROJECT_CHANGED',
  'EXPORT_IN_PROGRESS'
])

export function registerQuestionnaireExportIpc(
  ipcMain: IpcMainLike,
  state: ProjectIpcState,
  services: QuestionnaireExportServices,
  packagedRendererUrl: string,
  developmentOrigin?: string
): () => void {
  let exporting = false
  ipcMain.handle(QUESTIONNAIRE_EXPORT_CHANNEL, async (event, raw) => {
    assertTrustedSender(event, packagedRendererUrl, developmentOrigin)
    const { format } = parseQuestionnaireExportRequest(raw)
    if (exporting)
      return { success: false, error: 'EXPORT_IN_PROGRESS' } satisfies QuestionnaireExportResult
    try {
      const project = state.currentProject
      const key = state.auth.encryptionKey
      if (!project) throw new Error('NO_PROJECT_OPEN')
      if (!key) throw new Error('PROJECT_NOT_UNLOCKED')
      if (!project.questionnaire.questions.length) throw new Error('EMPTY_QUESTIONNAIRE')
      exporting = true
      const snapshot = structuredClone(project.questionnaire)
      return await services.exportDocument(snapshot, format, () => {
        if (state.currentProject !== project || state.auth.encryptionKey !== key)
          throw new Error('PROJECT_CHANGED')
      })
    } catch (error) {
      const code =
        error instanceof Error ? (error.message as QuestionnaireExportError) : 'EXPORT_FAILED'
      return {
        success: false,
        error: PUBLIC_ERRORS.has(code) ? code : 'EXPORT_FAILED'
      } satisfies QuestionnaireExportResult
    } finally {
      exporting = false
    }
  })
  return () => ipcMain.removeHandler(QUESTIONNAIRE_EXPORT_CHANNEL)
}
