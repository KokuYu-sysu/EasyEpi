import { QESFieldType, QESField, QESBlock, QESParseResult } from '@shared/types/epidata'

export class QESParser {
  parse(fileContent: string): QESParseResult {
    const lines = fileContent.split('\n')
    const fields: QESField[] = []
    const blocks: QESBlock[] = []
    let metadata = { title: '' }
    let currentBlock: { type: QESBlock['type']; content: string[] } | null = null

    // Parse header (first line if it starts with ")
    if (lines.length > 0 && lines[0].startsWith('"')) {
      metadata.title = lines[0].replace(/^"|"$/g, '').trim()
    }

    // Parse fields and blocks
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim()
      
      // Check for block start
      const blockType = this.detectBlockType(line)
      if (blockType) {
        if (currentBlock) {
          blocks.push({
            type: currentBlock.type,
            content: currentBlock.content.join('\n')
          })
        }
        currentBlock = { type: blockType, content: [line] }
        continue
      }

      // Check for block end
      if (line === 'END' && currentBlock) {
        blocks.push({
          type: currentBlock.type,
          content: currentBlock.content.join('\n')
        })
        currentBlock = null
        continue
      }

      // Add to current block
      if (currentBlock) {
        currentBlock.content.push(line)
        continue
      }

      // Parse field
      if (!line || line === 'END') continue
      const field = this.parseField(line)
      if (field) {
        // Extract label from quotes if present
        const labelMatch = line.match(/"([^"]+)"/)
        if (labelMatch) {
          field.label = labelMatch[1]
        }
        fields.push(field)
      }
    }

    // Extract labels from LABEL blocks
    const labelBlocks = blocks.filter(b => b.type === 'LABEL')
    for (const block of labelBlocks) {
      this.extractLabelsFromBlock(block, fields)
    }

    // Close any unclosed block
    if (currentBlock) {
      blocks.push({
        type: currentBlock.type,
        content: currentBlock.content.join('\n')
      })
    }

    return { metadata, fields, blocks }
  }

  private detectBlockType(line: string): QESBlock['type'] | null {
    const blockTypes: QESBlock['type'][] = ['LABEL', 'JUMPS', 'RANGE', 'LEGAL', 'MUSTENTER', 'COMMENT', 'TYPE', 'VALUELABEL']
    for (const type of blockTypes) {
      if (line.startsWith(type + ' ') || line === type) {
        return type
      }
    }
    return null
  }

  private extractLabelsFromBlock(block: QESBlock, fields: QESField[]): void {
    const lines = block.content.split('\n')
    let currentFieldName = ''
    
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      
      // Check for field name (first line of block)
      if (trimmed.startsWith('LABEL ')) {
        currentFieldName = trimmed.substring(6).trim()
        // Set label for the field if not already set
        const field = fields.find(f => f.name === currentFieldName)
        if (field && !field.label) {
          field.label = currentFieldName
        }
        continue
      }
      
      // Check for value label
      const valueLabelMatch = trimmed.match(/^(\d+)\s+"([^"]+)"/)
      if (valueLabelMatch && currentFieldName) {
        // Value labels are stored in blocks, not in fields
        // They will be used later for option mapping
      }
    }
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