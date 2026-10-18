export const QUESTIONNAIRE_EXPORT_CHANNEL = 'qnaire:exportDocument' as const
export type QuestionnaireExportFormat = 'pdf' | 'docx'
export const QUESTIONNAIRE_EXPORT_MAX_CELLS_PER_QUESTION = 1000
export const QUESTIONNAIRE_EXPORT_MAX_TOTAL_CELLS = 10000

export interface QuestionnaireExportRequest {
  format: QuestionnaireExportFormat
}

export type QuestionnaireExportError =
  | 'NO_PROJECT_OPEN'
  | 'PROJECT_NOT_UNLOCKED'
  | 'EMPTY_QUESTIONNAIRE'
  | 'INVALID_QUESTIONNAIRE'
  | 'QUESTIONNAIRE_TOO_LARGE'
  | 'PROJECT_CHANGED'
  | 'EXPORT_IN_PROGRESS'
  | 'EXPORT_FAILED'

export type QuestionnaireExportResult =
  | { success: true; filePath: string }
  | { success: false; canceled: true }
  | { success: false; error: QuestionnaireExportError }

export function parseQuestionnaireExportRequest(value: unknown): QuestionnaireExportRequest {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length !== 1 ||
    !Object.hasOwn(value, 'format') ||
    !('format' in value) ||
    (value.format !== 'pdf' && value.format !== 'docx')
  ) {
    throw new Error('INVALID_QUESTIONNAIRE_EXPORT_REQUEST')
  }
  return { format: value.format }
}
