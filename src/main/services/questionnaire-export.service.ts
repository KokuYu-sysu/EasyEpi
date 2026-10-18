import { extname } from 'node:path'
import type {
  QuestionnaireExportFormat,
  QuestionnaireExportResult
} from '@shared/questionnaire-export-contract'
import type { QuestionnaireDef } from '@shared/types/qnaire'
import { buildQuestionnaireDocument, renderQuestionnaireHtml } from './questionnaire-document'
import { createQuestionnaireDocx } from './questionnaire-docx'

export interface QuestionnaireExportDependencies {
  choosePath(suggestedName: string, format: QuestionnaireExportFormat): Promise<string | undefined>
  printPdf(html: string): Promise<Buffer>
  fileExists(path: string): boolean
  confirmOverwrite(path: string): Promise<boolean>
  writeFile(path: string, data: Buffer): Promise<void>
}

function suggestedFileName(name: string, format: QuestionnaireExportFormat): string {
  const cleaned = [...name]
    .map((char) => (char.charCodeAt(0) < 32 || /[<>:"/\\|?*]/.test(char) ? '_' : char))
    .join('')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, 100)
  const base =
    !cleaned || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(cleaned) ? '问卷' : cleaned
  return `${base}.${format}`
}

export async function exportQuestionnaireDocument(
  questionnaire: QuestionnaireDef,
  format: QuestionnaireExportFormat,
  dependencies: QuestionnaireExportDependencies,
  assertCurrent: () => void
): Promise<QuestionnaireExportResult> {
  const model = buildQuestionnaireDocument(questionnaire)
  const selected = await dependencies.choosePath(suggestedFileName(model.name, format), format)
  if (!selected) return { success: false, canceled: true }
  assertCurrent()
  const extension = extname(selected)
  const filePath =
    extension.toLowerCase() === `.${format}`
      ? selected
      : `${selected.slice(0, extension ? -extension.length : undefined)}.${format}`
  // The native dialog confirmed only the path the user typed, so a corrected
  // existing path needs its own confirmation before rendering or writing.
  if (filePath !== selected && dependencies.fileExists(filePath)) {
    if (!(await dependencies.confirmOverwrite(filePath))) return { success: false, canceled: true }
    assertCurrent()
  }
  const bytes =
    format === 'pdf'
      ? await dependencies.printPdf(renderQuestionnaireHtml(model))
      : await createQuestionnaireDocx(model)
  assertCurrent()
  await dependencies.writeFile(filePath, bytes)
  return { success: true, filePath }
}
