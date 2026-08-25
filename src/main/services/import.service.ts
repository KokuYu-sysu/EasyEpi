import {
  existsSync,
  rmSync
} from 'node:fs'

import type { ImportPreview, ImportProgress, ImportResult } from '@shared/types/epidata'
import type { QuestionType } from '@shared/types/qnaire'

import { EpiDataMapper } from './epidata-mapper'
import { QESParser } from './qes-parser'
import { RECParser } from './rec-parser'
import { findSiblingRecFile, mapImportedRecords, readEpiDataText } from './epidata-import-utils'
import {
  createProject,
  getProjectFilePath,
  saveProject
} from './project.service'
import {
  createDataFile,
  getDataFilePath,
  replaceRecords
} from './record.service'

export interface ImportOptions {
  qesFilePath: string
  recFilePath?: string
  targetProjectPath: string
  projectName: string
  password: string
  encoding?: string
  fieldMappings?: Record<string, QuestionType>
  onProgress?: (progress: ImportProgress) => void
}

export class ImportService {
  private readonly qesParser = new QESParser()
  private readonly recParser = new RECParser()
  private readonly mapper = new EpiDataMapper()

  async previewImport(qesFilePath: string, encoding?: string): Promise<ImportPreview> {
    if (!existsSync(qesFilePath)) throw new Error('QES_FILE_NOT_FOUND')
    const result = this.qesParser.parse(readEpiDataText(qesFilePath, encoding))
    const questionnaire = this.mapper.mapQESToQuestionnaire(result)
    const recFilePath = findSiblingRecFile(qesFilePath)
    const warnings: string[] = []
    let recordCount: number | undefined
    let detectedEncoding: string | undefined

    if (recFilePath !== null) {
      try {
        const recResult = this.recParser.parse(recFilePath, encoding)
        recordCount = recResult.records.length
        detectedEncoding = recResult.encoding
        if (recResult.deletedCount > 0) {
          warnings.push(`${recResult.deletedCount} deleted record(s) will not be imported`)
        }
      } catch (error) {
        warnings.push(`REC parse failed: ${(error as Error).message}`)
      }
    } else {
      warnings.push('No matching REC file was found; only the questionnaire will be imported')
    }

    return {
      questionnaire: { name: questionnaire.name, description: questionnaire.description },
      fieldCount: result.fields.length,
      recordCount,
      encoding: detectedEncoding,
      version: result.metadata.version,
      warnings,
      fields: result.fields,
      mappedQuestions: questionnaire.questions
    }
  }

  async validateQES(qesFilePath: string): Promise<{ valid: boolean; errors: string[] }> {
    if (!existsSync(qesFilePath)) return { valid: false, errors: ['QES file not found'] }
    try {
      this.qesParser.parse(readEpiDataText(qesFilePath))
      return { valid: true, errors: [] }
    } catch (error) {
      return { valid: false, errors: [(error as Error).message] }
    }
  }

  async importEpiData(options: ImportOptions): Promise<ImportResult> {
    let createdProjectFile: string | null = null
    let createdDataFile: string | null = null
    try {
      this.validateOptions(options)
      const report = options.onProgress
      report?.({ stage: 'parsing_qes', current: 0, total: 1, message: 'Parsing QES file...' })
      const qesResult = this.qesParser.parse(readEpiDataText(options.qesFilePath, options.encoding))
      const questionnaire = this.mapper.mapQESToQuestionnaire(
        qesResult,
        options.fieldMappings
      )
      report?.({ stage: 'parsing_qes', current: 1, total: 1, message: 'QES file parsed' })

      const recFilePath = options.recFilePath ?? findSiblingRecFile(options.qesFilePath)
      const warnings: string[] = []
      let activeRecords: Array<Record<string, string>> = []
      let sourceFieldNames: string[] = []
      if (recFilePath !== null) {
        report?.({ stage: 'parsing_rec', current: 0, total: 1, message: 'Parsing REC file...' })
        const recResult = this.recParser.parse(recFilePath, options.encoding)
        activeRecords = recResult.records
          .filter((record) => record.status === 'normal')
          .map((record) => record.fields)
        sourceFieldNames = recResult.header.fields.map((field) => field.name)
        if (recResult.deletedCount > 0) {
          warnings.push(`${recResult.deletedCount} deleted record(s) were skipped`)
        }
        report?.({
          stage: 'parsing_rec',
          current: 1,
          total: 1,
          message: `Parsed ${activeRecords.length} active record(s)`
        })
      } else {
        warnings.push('No matching REC file was found; imported questionnaire only')
      }

      report?.({ stage: 'creating_project', current: 0, total: 1, message: 'Creating encrypted project...' })
      const created = createProject(options.targetProjectPath, options.projectName, options.password)
      createdProjectFile = getProjectFilePath(options.targetProjectPath, options.projectName)
      const projectData = {
        meta: created.meta,
        questionnaireRevision: created.questionnaireRevision,
        questionnaire
      }
      saveProject(
        options.targetProjectPath,
        options.projectName,
        projectData,
        created.encryptionKey,
        created.salt,
        created.passwordHash
      )
      report?.({ stage: 'creating_project', current: 1, total: 1, message: 'Encrypted project created' })

      createdDataFile = getDataFilePath(options.targetProjectPath, options.projectName)
      createDataFile(createdDataFile, created.encryptionKey)
      const records = mapImportedRecords(
        activeRecords,
        questionnaire,
        qesResult.fields,
        sourceFieldNames,
        report
      )
      replaceRecords(createdDataFile, created.encryptionKey, records)

      return {
        success: true,
        projectPath: createdProjectFile,
        recordCount: records.length,
        warnings,
        errors: []
      }
    } catch (error) {
      if (createdDataFile !== null && existsSync(createdDataFile)) rmSync(createdDataFile)
      if (createdProjectFile !== null && existsSync(createdProjectFile)) rmSync(createdProjectFile)
      return {
        success: false,
        projectPath: '',
        recordCount: 0,
        warnings: [],
        errors: [(error as Error).message]
      }
    }
  }

  private validateOptions(options: ImportOptions): void {
    if (!existsSync(options.qesFilePath)) throw new Error('QES_FILE_NOT_FOUND')
    if (options.projectName.trim().length === 0) throw new Error('PROJECT_NAME_REQUIRED')
    if (options.password.length < 6) throw new Error('PROJECT_PASSWORD_TOO_SHORT')
  }

}
