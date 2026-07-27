import { QESFieldType } from '@shared/types/epidata'
import type { QESBlock, QESField, QESParseResult } from '@shared/types/epidata'

const BLOCK_TYPES: QESBlock['type'][] = [
  'LABEL',
  'JUMPS',
  'RANGE',
  'LEGAL',
  'MUSTENTER',
  'COMMENT',
  'TYPE',
  'VALUELABEL',
  'GOTO'
]

const MASK_PATTERN = /<[^>\r\n]+>|#+(?:[.,]#+)?|_+/g

interface ParsedMask {
  type: QESFieldType
  length: number
  decimals: number
}

export class QESParser {
  parse(fileContent: string): QESParseResult {
    const lines = fileContent.replace(/^\uFEFF/, '').split(/\r?\n/)
    const fields: QESField[] = []
    const blocks: QESBlock[] = []
    const usedNames = new Set<string>()
    let title = ''
    let currentBlock: { type: QESBlock['type']; content: string[] } | null = null

    for (const rawLine of lines) {
      const line = rawLine.trim()
      if (/<E[^>]*>/i.test(line)) throw new Error('QES_ENCRYPTED_FIELD_UNSUPPORTED')
      if (currentBlock !== null) {
        if (/^END$/i.test(line)) {
          blocks.push({ type: currentBlock.type, content: currentBlock.content.join('\n') })
          currentBlock = null
        } else {
          currentBlock.content.push(line)
        }
        continue
      }

      const blockType = this.detectBlockType(line)
      if (blockType !== null) {
        currentBlock = { type: blockType, content: [line] }
        continue
      }

      if (line.length === 0 || /^END$/i.test(line)) continue
      const parsedFields = this.parseFieldsFromLine(rawLine, usedNames)
      if (parsedFields.length > 0) {
        fields.push(...parsedFields)
      } else if (title.length === 0) {
        title = line.replace(/^"|"$/g, '').trim()
      }
    }

    if (currentBlock !== null) {
      blocks.push({ type: currentBlock.type, content: currentBlock.content.join('\n') })
    }

    this.attachValueLabels(blocks, fields)
    if (fields.length === 0) throw new Error('QES_NO_FIELDS')

    return { metadata: { title }, fields, blocks }
  }

  private detectBlockType(line: string): QESBlock['type'] | null {
    const keyword = line.split(/\s+/, 1)[0]?.toUpperCase()
    return BLOCK_TYPES.find((type) => type === keyword) ?? null
  }

  private parseFieldsFromLine(line: string, usedNames: Set<string>): QESField[] {
    const matches = [...line.matchAll(MASK_PATTERN)].filter((match) => {
      const index = match.index ?? 0
      const before = line.slice(0, index)
      if (before.lastIndexOf('{') > before.lastIndexOf('}')) return false
      if (match[0].startsWith('_')) {
        const previous = index > 0 ? line[index - 1] : undefined
        const next = line[index + match[0].length]
        if (previous !== undefined && /[A-Za-z0-9_]/.test(previous)) return false
        if (next !== undefined && /[A-Za-z0-9_]/.test(next)) return false
      }
      return true
    })
    const recognized: Array<{ match: RegExpExecArray; mask: ParsedMask }> = []
    for (const match of matches) {
      const mask = this.parseMask(match[0])
      if (mask !== null) recognized.push({ match, mask })
    }
    if (recognized.length === 0) return []

    const firstIndex = recognized[0]?.match.index ?? 0
    if (firstIndex === line.search(/\S/) && recognized.length === 1) {
      const item = recognized[0]!
      const afterMask = line.slice((item.match.index ?? 0) + item.match[0].length).trim()
      const nameMatch = afterMask.match(/^([A-Za-z][A-Za-z0-9_]*)/)
      if (nameMatch === null) throw new Error('QES_FIELD_NAME_MISSING')
      const quotedLabel = afterMask.match(/"([^"]+)"/)
      const label = quotedLabel?.[1] ?? afterMask.slice(nameMatch[0].length).trim()
      return [this.createField(nameMatch[1]!, label, item.mask, usedNames)]
    }

    const result: QESField[] = []
    let segmentStart = 0
    for (const item of recognized) {
      const maskIndex = item.match.index ?? 0
      const questionSegment = line.slice(segmentStart, maskIndex).trim()
      if (questionSegment.length === 0) throw new Error('QES_FIELD_NAME_MISSING')
      const { name, label } = this.extractNameAndLabel(questionSegment)
      result.push(this.createField(name, label, item.mask, usedNames))
      segmentStart = maskIndex + item.match[0].length
    }
    return result
  }

  private extractNameAndLabel(segment: string): { name: string; label: string } {
    const fragments = [...segment.matchAll(/\{([^}]*)\}/g)]
    if (fragments.length > 0) {
      const name = fragments.map((match) => match[1] ?? '').join('').replace(/[^A-Za-z0-9_]/g, '')
      const standalonePrefix = segment.match(/^\s*\{[^}]+\}\s+(.+)$/)
      const label = (standalonePrefix?.[1] ?? segment.replace(/[{}]/g, '')).trim()
      return { name, label }
    }

    const firstWord = segment.match(/^([A-Za-z][A-Za-z0-9_]*)\b/)
    if (firstWord === null) throw new Error('QES_FIELD_NAME_MISSING')
    const remainder = segment.slice(firstWord[0].length).trim()
    return { name: firstWord[1]!, label: remainder || firstWord[1]! }
  }

  private createField(
    requestedName: string,
    label: string,
    mask: ParsedMask,
    usedNames: Set<string>
  ): QESField {
    if (requestedName.length === 0) throw new Error('QES_FIELD_NAME_MISSING')
    const baseName = requestedName.slice(0, 64)
    let name = baseName
    let suffix = 2
    while (usedNames.has(name.toLowerCase())) {
      name = `${baseName}_${suffix}`
      suffix += 1
    }
    usedNames.add(name.toLowerCase())
    return {
      name,
      label: label.replace(/^"|"$/g, '').trim() || name,
      type: mask.type,
      length: mask.length,
      decimals: mask.decimals,
      comment: null
    }
  }

  private parseMask(rawMask: string): ParsedMask | null {
    if (rawMask.startsWith('#')) {
      const separator = rawMask.search(/[.,]/)
      return {
        type: separator >= 0 ? QESFieldType.DECIMAL : QESFieldType.INTEGER,
        length: rawMask.length,
        decimals: separator >= 0 ? rawMask.length - separator - 1 : 0
      }
    }
    if (rawMask.startsWith('_')) {
      return { type: QESFieldType.TEXT, length: rawMask.length, decimals: 0 }
    }

    const inner = rawMask.slice(1, -1)
    const normalized = inner.trim().toLowerCase()
    if (normalized === 'idnum') {
      return { type: QESFieldType.ID_NUMBER, length: 14, decimals: 0 }
    }
    if (normalized === 'y') {
      return { type: QESFieldType.BOOLEAN, length: 1, decimals: 0 }
    }
    if (/^a\s*$/i.test(inner)) {
      return { type: QESFieldType.UPPERCASE, length: inner.length, decimals: 0 }
    }
    if (normalized === 'dd/mm/yyyy') {
      return { type: QESFieldType.DATE_DMY, length: 10, decimals: 0 }
    }
    if (normalized === 'mm/dd/yyyy') {
      return { type: QESFieldType.DATE_MDY, length: 10, decimals: 0 }
    }
    if (normalized.startsWith('today-')) {
      return { type: QESFieldType.TODAY_DATE, length: 10, decimals: 0 }
    }
    if (/^s\s*$/i.test(inner)) {
      return { type: QESFieldType.SOUNDEX, length: Math.max(5, inner.length), decimals: 0 }
    }
    return null
  }

  private attachValueLabels(blocks: QESBlock[], fields: QESField[]): void {
    for (const block of blocks) {
      if (block.type !== 'LABEL' && block.type !== 'VALUELABEL') continue
      const lines = block.content.split('\n')
      const fieldName = lines[0]?.trim().split(/\s+/)[1]
      if (fieldName === undefined) continue
      const field = fields.find((candidate) => candidate.name.toLowerCase() === fieldName.toLowerCase())
      if (field === undefined) continue
      const valueLabels = lines.flatMap((line) => {
        const match = line.trim().match(/^([^\s]+)\s+"([^"]+)"/)
        return match === null ? [] : [{ value: match[1]!, label: match[2]! }]
      })
      if (valueLabels.length > 0) field.valueLabels = valueLabels
    }
  }
}
