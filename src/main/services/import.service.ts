import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, basename } from 'node:path'
import { QESParser } from './qes-parser'
import { RECParser } from './rec-parser'
import { EpiDataMapper } from './epidata-mapper'
import { ImportPreview, ImportResult, ImportProgress } from '@shared/types/epidata'

export class ImportService {
  private qesParser = new QESParser()
  private recParser = new RECParser()
  private mapper = new EpiDataMapper()

  async previewImport(qesFilePath: string): Promise<ImportPreview> {
    if (!existsSync(qesFilePath)) {
      throw new Error('QES_FILE_NOT_FOUND')
    }

    const content = readFileSync(qesFilePath, 'utf-8')
    const result = this.qesParser.parse(content)
    
    // Try to find REC file
    const recFilePath = this.findRecFile(qesFilePath)
    let recordCount: number | undefined
    
    if (recFilePath) {
      try {
        const recResult = this.recParser.parse(recFilePath)
        recordCount = recResult.records.length
      } catch {
        // REC file parsing failed, but we can still preview QES
      }
    }

    return {
      questionnaire: {
        name: result.metadata.title
      },
      fieldCount: result.fields.length,
      recordCount,
      warnings: []
    }
  }

  async validateQES(qesFilePath: string): Promise<{ valid: boolean; errors: string[] }> {
    try {
      if (!existsSync(qesFilePath)) {
        return { valid: false, errors: ['QES file not found'] }
      }

      const content = readFileSync(qesFilePath, 'utf-8')
      const result = this.qesParser.parse(content)
      
      if (result.fields.length === 0) {
        return { valid: false, errors: ['No fields found in QES file'] }
      }

      return { valid: true, errors: [] }
    } catch (error) {
      return { valid: false, errors: [(error as Error).message] }
    }
  }

  async importEpiData(
    qesFilePath: string,
    targetProjectPath: string,
    onProgress?: (progress: ImportProgress) => void
  ): Promise<ImportResult> {
    try {
      // Stage 1: Parse QES
      onProgress?.({
        stage: 'parsing_qes',
        current: 0,
        total: 100,
        message: 'Parsing QES file...'
      })

      const qesContent = readFileSync(qesFilePath, 'utf-8')
      const qesResult = this.qesParser.parse(qesContent)
      const questionnaire = this.mapper.mapQESToQuestionnaire(qesResult)

      onProgress?.({
        stage: 'parsing_qes',
        current: 100,
        total: 100,
        message: 'QES file parsed successfully'
      })

      // Stage 2: Parse REC (if exists)
      const recFilePath = this.findRecFile(qesFilePath)
      let recordCount = 0

      if (recFilePath) {
        onProgress?.({
          stage: 'parsing_rec',
          current: 0,
          total: 100,
          message: 'Parsing REC file...'
        })

        const recResult = this.recParser.parse(recFilePath)
        recordCount = recResult.records.length

        onProgress?.({
          stage: 'parsing_rec',
          current: 100,
          total: 100,
          message: `Parsed ${recordCount} records`
        })
      }

      // Stage 3: Create project
      onProgress?.({
        stage: 'creating_project',
        current: 0,
        total: 100,
        message: 'Creating project...'
      })

      // Create project directory
      mkdirSync(targetProjectPath, { recursive: true })
      
      // Create project file
      const projectData = {
        name: questionnaire.name,
        description: questionnaire.description,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
      
      writeFileSync(
        join(targetProjectPath, 'project.json'),
        JSON.stringify(projectData, null, 2)
      )
      
      // Create questionnaire file
      writeFileSync(
        join(targetProjectPath, 'questionnaire.json'),
        JSON.stringify(questionnaire, null, 2)
      )

      onProgress?.({
        stage: 'creating_project',
        current: 100,
        total: 100,
        message: 'Project created successfully'
      })

      return {
        success: true,
        projectPath: targetProjectPath,
        recordCount,
        warnings: [],
        errors: []
      }
    } catch (error) {
      return {
        success: false,
        projectPath: '',
        recordCount: 0,
        warnings: [],
        errors: [(error as Error).message]
      }
    }
  }

  private findRecFile(qesFilePath: string): string | null {
    const dir = dirname(qesFilePath)
    const baseName = basename(qesFilePath, '.qes')
    const recPath = join(dir, `${baseName}.rec`)
    
    if (existsSync(recPath)) {
      return recPath
    }
    
    return null
  }
}