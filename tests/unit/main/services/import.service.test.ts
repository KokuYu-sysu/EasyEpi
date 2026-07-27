import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { ImportService } from '@main/services/import.service'
import { loadRecords } from '@main/services/record.service'
import {
  decryptProjectData,
  readProjectHeader,
  verifyAndDeriveKey
} from '@main/services/project.service'
import type { ImportProgress } from '@shared/types/epidata'

function headerField(name: string, typeCode: number, width: number, question: string): string {
  return [
    typeCode === 0 ? '#' : '_',
    name.padEnd(10),
    ' ',
    '1'.padStart(4),
    '1'.padStart(4),
    '30'.padStart(4),
    '20'.padStart(4),
    '1'.padStart(4),
    String(typeCode).padStart(4),
    String(width).padStart(4),
    '112'.padStart(4),
    ' ',
    question
  ].join('')
}

describe('ImportService', () => {
  const directories: string[] = []

  afterEach(() => {
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  function createFixture(): { source: string; target: string; qesFilePath: string } {
    const source = mkdtempSync(join(tmpdir(), 'easyepi-import-source-'))
    const target = mkdtempSync(join(tmpdir(), 'easyepi-import-target-'))
    directories.push(source, target)
    const qesFilePath = join(source, 'people.qes')
    writeFileSync(
      qesFilePath,
      ['People survey', '{name} Participant name __________', '{age} Participant age ###'].join('\r\n'),
      'utf8'
    )
    writeFileSync(
      join(source, 'people.rec'),
      [
        '2 1 VLAB Filelabel: People',
        headerField('name', 1, 10, 'Participant name'),
        headerField('age', 0, 3, 'Participant age'),
        'Alice      42!',
        'Deleted    99?',
        ''
      ].join('\r\n'),
      'latin1'
    )
    return { source, target, qesFilePath }
  }

  it('previews real fields, mappings, record count, and detected encoding', async () => {
    const { qesFilePath } = createFixture()
    const preview = await new ImportService().previewImport(qesFilePath)

    expect(preview).toMatchObject({
      questionnaire: { name: 'People survey' },
      fieldCount: 2,
      recordCount: 2,
      encoding: 'utf-8',
      fields: [{ name: 'name' }, { name: 'age' }],
      mappedQuestions: [
        { variableName: 'name', type: 'free_text' },
        { variableName: 'age', type: 'numeric_range' }
      ]
    })
  })

  it('creates an encrypted EasyEpi project and imports only active REC records', async () => {
    const { target, qesFilePath } = createFixture()
    const progress: ImportProgress[] = []
    const result = await new ImportService().importEpiData({
      qesFilePath,
      targetProjectPath: target,
      projectName: 'Imported people',
      password: 'secure-password',
      onProgress: (update) => progress.push(update)
    })

    expect(result).toMatchObject({
      success: true,
      projectPath: join(target, 'Imported people.easyepi'),
      recordCount: 1,
      errors: []
    })
    expect(progress.map((update) => update.stage)).toContain('importing_data')
    expect(progress.at(-1)).toMatchObject({ stage: 'importing_data', current: 1, total: 1 })

    const header = readProjectHeader(result.projectPath)
    const key = verifyAndDeriveKey('secure-password', header.saltHex, header.hashHex)
    expect(key).not.toBeNull()
    const project = decryptProjectData(result.projectPath, key!)
    expect(project.questionnaire.questions).toHaveLength(2)
    const questionIds = Object.fromEntries(
      project.questionnaire.questions.map((question) => [question.variableName, question.id])
    )
    expect(loadRecords(join(target, 'Imported people.easyepi_data'), key!)).toMatchObject([
      {
        answers: {
          [questionIds['name']!]: 'Alice',
          [questionIds['age']!]: '42'
        }
      }
    ])
  })

  it('returns a failed result without leaving a partial project for invalid input', async () => {
    const target = mkdtempSync(join(tmpdir(), 'easyepi-import-target-'))
    directories.push(target)

    const result = await new ImportService().importEpiData({
      qesFilePath: join(target, 'missing.qes'),
      targetProjectPath: target,
      projectName: 'Broken import',
      password: 'secure-password'
    })

    expect(result.success).toBe(false)
    expect(result.errors).toContain('QES_FILE_NOT_FOUND')
  })

  it('imports more than 10,000 records and reports bounded progress', async () => {
    const source = mkdtempSync(join(tmpdir(), 'easyepi-import-large-source-'))
    const target = mkdtempSync(join(tmpdir(), 'easyepi-import-large-target-'))
    directories.push(source, target)
    const qesFilePath = join(source, 'large.qes')
    writeFileSync(qesFilePath, ['Large survey', '{id} Participant ID #####'].join('\r\n'), 'utf8')
    const rows = Array.from({ length: 10_001 }, (_, index) => String(index).padStart(5, '0') + '!')
    writeFileSync(
      join(source, 'large.rec'),
      ['1 1 VLAB Filelabel: Large', headerField('id', 0, 5, 'Participant ID'), ...rows, ''].join('\r\n'),
      'latin1'
    )
    const progress: ImportProgress[] = []

    const result = await new ImportService().importEpiData({
      qesFilePath,
      targetProjectPath: target,
      projectName: 'Large import',
      password: 'secure-password',
      onProgress: (update) => progress.push(update)
    })

    expect(result, result.errors.join('; ')).toMatchObject({ success: true, recordCount: 10_001 })
    const importing = progress.filter((update) => update.stage === 'importing_data')
    expect(importing[0]).toMatchObject({ current: 0, total: 10_001 })
    expect(importing.at(-1)).toMatchObject({ current: 10_001, total: 10_001 })
    expect(importing.every((update) => update.current <= update.total)).toBe(true)
  }, 20_000)

  it('maps classic ten-character REC names to longer explicit QES variable names by field order', async () => {
    const source = mkdtempSync(join(tmpdir(), 'easyepi-import-long-name-source-'))
    const target = mkdtempSync(join(tmpdir(), 'easyepi-import-long-name-target-'))
    directories.push(source, target)
    const qesFilePath = join(source, 'long-name.qes')
    writeFileSync(qesFilePath, '{participant_identifier} Participant ID __________', 'utf8')
    writeFileSync(
      join(source, 'long-name.rec'),
      ['1 1 VLAB', headerField('participan', 1, 10, 'Participant ID'), 'P000000001!', ''].join('\r\n'),
      'latin1'
    )

    const result = await new ImportService().importEpiData({
      qesFilePath,
      targetProjectPath: target,
      projectName: 'Long name import',
      password: 'secure-password'
    })

    expect(result, result.errors.join('; ')).toMatchObject({ success: true, recordCount: 1 })
    const header = readProjectHeader(result.projectPath)
    const key = verifyAndDeriveKey('secure-password', header.saltHex, header.hashHex)!
    const project = decryptProjectData(result.projectPath, key)
    const question = project.questionnaire.questions[0]!
    expect(question.variableName).toBe('participant_identifier')
    expect(loadRecords(join(target, 'Long name import.easyepi_data'), key)[0]?.answers).toEqual({
      [question.id]: 'P000000001'
    })
  })
})
