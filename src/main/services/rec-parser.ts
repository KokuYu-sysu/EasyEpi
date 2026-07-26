import { readFileSync } from 'node:fs'
import { RECHeader, RECFieldInfo, RECRecord, RECParseResult } from '@shared/types/epidata'

export class RECParser {
  parse(filePath: string, encoding?: string): RECParseResult {
    const buffer = readFileSync(filePath)
    const detectedEncoding = encoding || this.detectEncoding(buffer)
    const header = this.parseHeader(buffer)
    const records = this.parseRecords(buffer, header, detectedEncoding)
    const deletedCount = records.filter(r => r.status === 'deleted').length

    return {
      header,
      records,
      deletedCount,
      encoding: detectedEncoding
    }
  }

  parseHeader(buffer: Buffer): RECHeader {
    // Parse file type marker (4 bytes)
    const fileType = buffer.toString('ascii', 0, 4)
    
    // Parse field count (2 bytes)
    const fieldCount = buffer.readUInt16BE(4)
    
    // Parse field definitions
    const fields: RECFieldInfo[] = []
    let offset = 6
    
    for (let i = 0; i < fieldCount; i++) {
      const name = buffer.toString('ascii', offset, offset + 10).trim()
      const type = buffer.toString('ascii', offset + 10, offset + 11)
      const length = buffer.readUInt16BE(offset + 11)
      const decimals = buffer.readUInt8(offset + 13)
      
      fields.push({ name, type, length, decimals })
      offset += 14
    }

    return { fileType, fieldCount, fields }
  }

  private parseRecords(buffer: Buffer, header: RECHeader, encoding: string): RECRecord[] {
    const records: RECRecord[] = []
    
    // Calculate record size from header
    const recordSize = this.calculateRecordSize(header)
    
    // Find where records start (after header)
    const headerSize = this.calculateHeaderSize(header)
    
    // Parse each record
    for (let offset = headerSize; offset < buffer.length; offset += recordSize) {
      if (offset + recordSize > buffer.length) break // Incomplete record
      
      const record = this.parseSingleRecord(buffer, offset, header, encoding)
      records.push(record)
    }
    
    return records
  }

  private calculateRecordSize(header: RECHeader): number {
    // Status byte + sum of all field lengths
    return 1 + header.fields.reduce((sum, field) => sum + field.length, 0)
  }

  private calculateHeaderSize(header: RECHeader): number {
    // File type (4) + field count (2) + fields (14 each)
    return 6 + (header.fieldCount * 14)
  }

  private parseSingleRecord(
    buffer: Buffer,
    offset: number,
    header: RECHeader,
    encoding: string
  ): RECRecord {
    // Read status byte
    const statusByte = buffer.readUInt8(offset)
    const status = statusByte === 0x20 ? 'normal' : 'deleted'
    
    // Read field values
    const fields: Record<string, string> = {}
    let fieldOffset = offset + 1
    
    for (const field of header.fields) {
      const value = this.readFieldValue(buffer, fieldOffset, field.length, encoding)
      fields[field.name] = value
      fieldOffset += field.length
    }
    
    return { status, fields }
  }

  private readFieldValue(
    buffer: Buffer,
    offset: number,
    length: number,
    encoding: string
  ): string {
    // Read bytes for the field
    const bytes = buffer.subarray(offset, offset + length)
    
    // Decode based on encoding
    let value: string
    switch (encoding) {
      case 'utf-8':
        value = bytes.toString('utf-8')
        break
      case 'gbk':
        // GBK decoding would need a library like iconv-lite
        value = bytes.toString('binary')
        break
      default:
        value = bytes.toString('latin1')
    }
    
    // Trim and clean up
    return value.replace(/\0/g, '').trim()
  }

  private detectEncoding(buffer: Buffer): string {
    // Try UTF-8 first
    try {
      buffer.toString('utf-8')
      return 'utf-8'
    } catch {
      // Try GBK
      try {
        buffer.toString('binary')
        return 'gbk'
      } catch {
        // Fallback to Latin-1
        return 'latin1'
      }
    }
  }
}