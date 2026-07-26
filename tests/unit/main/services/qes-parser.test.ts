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
})