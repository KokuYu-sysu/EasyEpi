import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { RECParser } from '@main/services/rec-parser'

interface HeaderField {
  display: '#' | '_'
  name: string
  typeCode: number
  width: number
  question: string
}

function headerField({ display, name, typeCode, width, question }: HeaderField): string {
  return [
    display,
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

describe('RECParser', () => {
  let directory: string
  let parser: RECParser

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'easyepi-rec-'))
    parser = new RECParser()
  })

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  it('parses the official EpiData text header and fixed-width records', () => {
    const filePath = join(directory, 'people.rec')
    const contents = [
      '2 1 VLAB Filelabel: People',
      headerField({ display: '_', name: 'name', typeCode: 1, width: 10, question: 'Name' }),
      headerField({ display: '#', name: 'age', typeCode: 0, width: 3, question: 'Age' }),
      'Alice      42!',
      'Bob        37?',
      ''
    ].join('\r\n')
    writeFileSync(filePath, contents, 'latin1')

    const result = parser.parse(filePath)

    expect(result.header).toMatchObject({
      fileType: 'EpiData REC',
      fieldCount: 2,
      fields: [
        { name: 'name', type: '1', length: 10, decimals: 0 },
        { name: 'age', type: '0', length: 3, decimals: 0 }
      ]
    })
    expect(result.records).toEqual([
      { status: 'normal', fields: { name: 'Alice', age: '42' } },
      { status: 'deleted', fields: { name: 'Bob', age: '37' } }
    ])
    expect(result.deletedCount).toBe(1)
  })

  it('reassembles records split across 79-byte physical lines', () => {
    const filePath = join(directory, 'wide.rec')
    const contents = [
      '1 1 VLAB',
      headerField({ display: '_', name: 'notes', typeCode: 1, width: 80, question: 'Notes' }),
      `${'a'.repeat(79)}!`,
      'b!',
      ''
    ].join('\r\n')
    writeFileSync(filePath, contents, 'latin1')

    const result = parser.parse(filePath)

    expect(result.records).toEqual([
      { status: 'normal', fields: { notes: `${'a'.repeat(79)}b` } }
    ])
  })

  it('detects and decodes GBK data bytes after UTF-8 validation fails', () => {
    const filePath = join(directory, 'gbk.rec')
    const header = Buffer.from(
      ['1 1 VLAB', headerField({ display: '_', name: 'text', typeCode: 1, width: 4, question: 'Text' })].join('\r\n') + '\r\n',
      'ascii'
    )
    const record = Buffer.from([0xd6, 0xd0, 0xce, 0xc4, 0x21, 0x0d, 0x0a])
    writeFileSync(filePath, Buffer.concat([header, record]))

    const result = parser.parse(filePath)

    expect(result.encoding).toBe('gbk')
    expect(result.records[0]?.fields.text).toBe('中文')
  })

  it('rejects a truncated record with a precise error', () => {
    const filePath = join(directory, 'truncated.rec')
    const contents = [
      '1 1 VLAB',
      headerField({ display: '_', name: 'name', typeCode: 1, width: 10, question: 'Name' }),
      'short!',
      ''
    ].join('\r\n')
    writeFileSync(filePath, contents, 'latin1')

    expect(() => parser.parse(filePath)).toThrow('REC_TRUNCATED_RECORD')
  })

  it('rejects password-protected REC files instead of importing ciphertext', () => {
    const filePath = join(directory, 'encrypted.rec')
    writeFileSync(filePath, '~kq:password:kq~ 1 1 VLAB\r\n', 'latin1')

    expect(() => parser.parse(filePath)).toThrow('REC_ENCRYPTED_UNSUPPORTED')
  })

  it('rejects encrypted type-18 fields even without a password marker', () => {
    const filePath = join(directory, 'encrypted-field.rec')
    writeFileSync(
      filePath,
      ['1 1 VLAB', headerField({ display: '_', name: 'secret', typeCode: 18, width: 8, question: 'Secret' })].join('\r\n'),
      'latin1'
    )

    expect(() => parser.parse(filePath)).toThrow('REC_ENCRYPTED_UNSUPPORTED')
  })
})
