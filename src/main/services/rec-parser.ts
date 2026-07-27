import { readFileSync } from 'node:fs'

import type { RECFieldInfo, RECHeader, RECParseResult, RECRecord } from '@shared/types/epidata'

type RECEncoding = 'utf-8' | 'gbk' | 'latin1'

function splitBufferLines(buffer: Buffer): Buffer[] {
  const lines: Buffer[] = []
  let start = 0
  for (let index = 0; index < buffer.length; index += 1) {
    if (buffer[index] !== 0x0a) continue
    const end = index > start && buffer[index - 1] === 0x0d ? index - 1 : index
    lines.push(buffer.subarray(start, end))
    start = index + 1
  }
  if (start < buffer.length) lines.push(buffer.subarray(start))
  return lines
}

export class RECParser {
  parse(filePath: string, requestedEncoding?: string): RECParseResult {
    const buffer = readFileSync(filePath)
    const lines = splitBufferLines(buffer)
    const encoding = this.resolveEncoding(buffer, requestedEncoding)
    const header = this.parseHeaderLines(lines)
    const records = this.parseRecords(lines.slice(header.fieldCount + 1), header, encoding)
    return {
      header,
      records,
      deletedCount: records.filter((record) => record.status === 'deleted').length,
      encoding
    }
  }

  parseHeader(buffer: Buffer): RECHeader {
    return this.parseHeaderLines(splitBufferLines(buffer))
  }

  private parseHeaderLines(lines: Buffer[]): RECHeader {
    const firstLine = lines[0]?.toString('ascii').trim()
    if (firstLine === undefined || firstLine.length === 0) throw new Error('REC_HEADER_MISSING')
    if (/~kq:/i.test(firstLine)) throw new Error('REC_ENCRYPTED_UNSUPPORTED')
    const fieldCount = Number.parseInt(firstLine.split(/\s+/, 1)[0] ?? '', 10)
    if (!Number.isInteger(fieldCount) || fieldCount < 0) throw new Error('REC_INVALID_FIELD_COUNT')
    if (lines.length < fieldCount + 1) throw new Error('REC_TRUNCATED_HEADER')

    const fields: RECFieldInfo[] = []
    for (let index = 0; index < fieldCount; index += 1) {
      const line = lines[index + 1]
      if (line === undefined || line.length < 45) throw new Error('REC_INVALID_FIELD_HEADER')
      const name = line.subarray(1, 11).toString('ascii').trim()
      const typeCode = Number.parseInt(line.subarray(32, 36).toString('ascii').trim(), 10)
      const length = Number.parseInt(line.subarray(36, 40).toString('ascii').trim(), 10)
      if (!Number.isInteger(typeCode) || !Number.isInteger(length) || length < 0) {
        throw new Error('REC_INVALID_FIELD_HEADER')
      }
      if (typeCode === 18) throw new Error('REC_ENCRYPTED_UNSUPPORTED')
      fields.push({
        name,
        type: String(typeCode),
        length,
        decimals: typeCode >= 101 ? typeCode - 100 : 0
      })
    }
    return { fileType: 'EpiData REC', fieldCount, fields }
  }

  private parseRecords(lines: Buffer[], header: RECHeader, encoding: RECEncoding): RECRecord[] {
    const recordWidth = header.fields.reduce((sum, field) => sum + field.length, 0)
    if (recordWidth === 0) return []
    const records: RECRecord[] = []
    let chunks: Buffer[] = []
    let accumulatedLength = 0

    for (const originalLine of lines) {
      let line = originalLine
      if (line.length === 0) continue
      if (line.length === 1 && line[0] === 0x1a) break
      if (line[line.length - 1] === 0x1a) line = line.subarray(0, line.length - 1)
      if (line.length === 0) break

      const marker = String.fromCharCode(line[line.length - 1]!)
      if (marker !== '!' && marker !== '?' && marker !== '^') {
        throw new Error('REC_INVALID_RECORD_TERMINATOR')
      }
      const payload = line.subarray(0, line.length - 1)
      chunks.push(payload)
      accumulatedLength += payload.length
      if (accumulatedLength > recordWidth) throw new Error('REC_RECORD_TOO_LONG')

      const isComplete = marker !== '!' || accumulatedLength === recordWidth
      if (!isComplete) continue
      if (accumulatedLength !== recordWidth) throw new Error('REC_TRUNCATED_RECORD')

      records.push(
        this.parseSingleRecord(
          Buffer.concat(chunks, accumulatedLength),
          header,
          encoding,
          marker === '?' ? 'deleted' : 'normal'
        )
      )
      chunks = []
      accumulatedLength = 0
    }

    if (accumulatedLength !== 0) throw new Error('REC_TRUNCATED_RECORD')
    return records
  }

  private parseSingleRecord(
    bytes: Buffer,
    header: RECHeader,
    encoding: RECEncoding,
    status: RECRecord['status']
  ): RECRecord {
    const fields: Record<string, string> = {}
    let offset = 0
    for (const field of header.fields) {
      const fieldBytes = bytes.subarray(offset, offset + field.length)
      offset += field.length
      if (field.length === 0 || field.name.length === 0) continue
      fields[field.name] = this.decode(fieldBytes, encoding).replace(/\0/g, '').trim()
    }
    return { status, fields }
  }

  private resolveEncoding(buffer: Buffer, requestedEncoding?: string): RECEncoding {
    if (requestedEncoding !== undefined && requestedEncoding !== 'auto') {
      const normalized = requestedEncoding.toLowerCase().replace('_', '-')
      if (normalized === 'utf8' || normalized === 'utf-8') return 'utf-8'
      if (normalized === 'gbk' || normalized === 'gb2312' || normalized === 'windows-936') {
        return 'gbk'
      }
      if (normalized === 'latin1' || normalized === 'latin-1' || normalized === 'windows-1252') {
        return 'latin1'
      }
      throw new Error('REC_UNSUPPORTED_ENCODING')
    }

    try {
      new TextDecoder('utf-8', { fatal: true }).decode(buffer)
      return 'utf-8'
    } catch {
      try {
        new TextDecoder('gbk', { fatal: true }).decode(buffer)
        return 'gbk'
      } catch {
        return 'latin1'
      }
    }
  }

  private decode(bytes: Buffer, encoding: RECEncoding): string {
    const decoderEncoding = encoding === 'latin1' ? 'windows-1252' : encoding
    return new TextDecoder(decoderEncoding).decode(bytes)
  }
}
