import { describe, expect, it } from 'vitest'

import {
  parseEpiDataImportRequest,
  parseEpiDataPreviewRequest
} from '@shared/epidata-contract'

describe('EpiData IPC contract', () => {
  it('parses a complete import request including manual field mappings', () => {
    expect(
      parseEpiDataImportRequest({
        qesFilePath: ' D:\\source\\people.qes ',
        recFilePath: ' D:\\source\\people.rec ',
        targetProjectPath: ' D:\\projects ',
        projectName: ' Imported people ',
        password: 'secure-password',
        encoding: 'gbk',
        fieldMappings: { notes: 'free_text' }
      })
    ).toEqual({
      qesFilePath: 'D:\\source\\people.qes',
      recFilePath: 'D:\\source\\people.rec',
      targetProjectPath: 'D:\\projects',
      projectName: 'Imported people',
      password: 'secure-password',
      encoding: 'gbk',
      fieldMappings: { notes: 'free_text' }
    })
  })

  it.each([
    null,
    {},
    { qesFilePath: 'x', targetProjectPath: 'y', projectName: '../escape', password: 'secret' },
    { qesFilePath: 'x', targetProjectPath: 'y', projectName: 'valid', password: 'short' },
    {
      qesFilePath: 'x',
      targetProjectPath: 'y',
      projectName: 'valid',
      password: 'secure-password',
      encoding: 'utf-16'
    },
    {
      qesFilePath: 'x',
      targetProjectPath: 'y',
      projectName: 'valid',
      password: 'secure-password',
      fieldMappings: { notes: 'script' }
    }
  ])('rejects unsafe or malformed import request %#', (value) => {
    expect(() => parseEpiDataImportRequest(value)).toThrow()
  })

  it('parses preview encoding and rejects unsupported values', () => {
    expect(parseEpiDataPreviewRequest({ qesFilePath: ' x.qes ', encoding: 'auto' })).toEqual({
      qesFilePath: 'x.qes',
      encoding: 'auto'
    })
    expect(() => parseEpiDataPreviewRequest({ qesFilePath: 'x.qes', encoding: 'utf-16' })).toThrow(
      'INVALID_EPIDATA_ENCODING'
    )
  })
})
