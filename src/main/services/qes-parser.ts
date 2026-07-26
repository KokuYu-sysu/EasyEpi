import { QESFieldType, QESField, QESBlock, QESParseResult } from '@shared/types/epidata'

export class QESParser {
  parse(fileContent: string): QESParseResult {
    const lines = fileContent.split('\n')
    const fields: QESField[] = []
    const blocks: QESBlock[] = []
    let metadata = { title: '' }

    // Parse header (first line if it starts with ")
    if (lines.length > 0 && lines[0].startsWith('"')) {
      metadata.title = lines[0].replace(/^"|"$/g, '').trim()
    }

    // Parse fields
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim()
      if (!line || line === 'END') continue

      const field = this.parseField(line)
      if (field) {
        fields.push(field)
      }
    }

    return { metadata, fields, blocks }
  }

  private parseField(line: string): QESField | null {
    // Detect integer field ##
    const integerMatch = line.match(/^(\#+)\s+(\w+)/)
    if (integerMatch) {
      return {
        name: integerMatch[2],
        label: '',
        type: QESFieldType.INTEGER,
        length: integerMatch[1].length,
        decimals: 0,
        comment: null
      }
    }

    // Detect decimal field #.##
    const decimalMatch = line.match(/^(\#+)\.(\#+)\s+(\w+)/)
    if (decimalMatch) {
      return {
        name: decimalMatch[3],
        label: '',
        type: QESFieldType.DECIMAL,
        length: decimalMatch[1].length + decimalMatch[2].length + 1,
        decimals: decimalMatch[2].length,
        comment: null
      }
    }

    // Detect text field _____
    const textMatch = line.match(/^(_+)\s+(\w+)/)
    if (textMatch) {
      return {
        name: textMatch[2],
        label: '',
        type: QESFieldType.TEXT,
        length: textMatch[1].length,
        decimals: 0,
        comment: null
      }
    }

    // Detect uppercase field <A>
    const uppercaseMatch = line.match(/^<A\s*>\s*(\w+)/)
    if (uppercaseMatch) {
      return {
        name: uppercaseMatch[1],
        label: '',
        type: QESFieldType.UPPERCASE,
        length: 1, // Will be calculated from spaces
        decimals: 0,
        comment: null
      }
    }

    // Detect boolean field <Y>
    const booleanMatch = line.match(/^<Y>\s+(\w+)/)
    if (booleanMatch) {
      return {
        name: booleanMatch[1],
        label: '',
        type: QESFieldType.BOOLEAN,
        length: 1,
        decimals: 0,
        comment: null
      }
    }

    return null
  }
}