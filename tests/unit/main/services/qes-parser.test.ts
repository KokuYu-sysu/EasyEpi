import { describe, it, expect } from 'vitest'
import { QESParser } from '@main/services/qes-parser'

describe('QESParser', () => {
  const parser = new QESParser()

  describe('field detection', () => {
    it('should detect integer field ##', () => {
      const content = `## age`
      const result = parser.parse(content)
      expect(result.fields).toHaveLength(1)
      expect(result.fields[0].name).toBe('age')
      expect(result.fields[0].type).toBe('INTEGER')
      expect(result.fields[0].length).toBe(2)
    })

    it('should detect decimal field #.##', () => {
      const content = `#.## bmi`
      const result = parser.parse(content)
      expect(result.fields).toHaveLength(1)
      expect(result.fields[0].name).toBe('bmi')
      expect(result.fields[0].type).toBe('DECIMAL')
      expect(result.fields[0].length).toBe(4)
      expect(result.fields[0].decimals).toBe(2)
    })

    it('should detect text field _____', () => {
      const content = `_____ name`
      const result = parser.parse(content)
      expect(result.fields).toHaveLength(1)
      expect(result.fields[0].name).toBe('name')
      expect(result.fields[0].type).toBe('TEXT')
      expect(result.fields[0].length).toBe(5)
    })

    it('should detect uppercase field <A>', () => {
      const content = `<A> code`
      const result = parser.parse(content)
      expect(result.fields).toHaveLength(1)
      expect(result.fields[0].name).toBe('code')
      expect(result.fields[0].type).toBe('UPPERCASE')
    })

    it('should detect boolean field <Y>', () => {
      const content = `<Y> is_smoker`
      const result = parser.parse(content)
      expect(result.fields).toHaveLength(1)
      expect(result.fields[0].name).toBe('is_smoker')
      expect(result.fields[0].type).toBe('BOOLEAN')
    })
  })

  describe('block parsing', () => {
    it('should parse LABEL block', () => {
      const content = `
LABEL sex
  1 "Male"
  2 "Female"
END
`
      const result = parser.parse(content)
      expect(result.blocks).toHaveLength(1)
      expect(result.blocks[0].type).toBe('LABEL')
      expect(result.blocks[0].content).toContain('sex')
    })

    it('should parse JUMPS block', () => {
      const content = `
JUMPS
  smoke=1 > 5
  smoke=2 > 10
END
`
      const result = parser.parse(content)
      expect(result.blocks).toHaveLength(1)
      expect(result.blocks[0].type).toBe('JUMPS')
    })

    it('should parse RANGE block', () => {
      const content = `
RANGE
  age 0 120
END
`
      const result = parser.parse(content)
      expect(result.blocks).toHaveLength(1)
      expect(result.blocks[0].type).toBe('RANGE')
    })

    it('should parse LEGAL block', () => {
      const content = `
LEGAL
  sex 1 2
END
`
      const result = parser.parse(content)
      expect(result.blocks).toHaveLength(1)
      expect(result.blocks[0].type).toBe('LEGAL')
    })
  })

  describe('label extraction', () => {
    it('should extract label from field definition', () => {
      const content = `## age "Age of participant"`
      const result = parser.parse(content)
      expect(result.fields[0].label).toBe('Age of participant')
    })

    it('should extract label from LABEL block', () => {
      const content = `
## sex
LABEL sex
  1 "Male"
  2 "Female"
END
`
      const result = parser.parse(content)
      expect(result.fields[0].label).toBe('sex')
      // Options should be extracted from LABEL block
    })
  })
})