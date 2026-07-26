import { describe, it, expect } from 'vitest'
import { EpiDataMapper } from '@main/services/epidata-mapper'
import { QESFieldType } from '@shared/types/epidata'

describe('EpiDataMapper', () => {
  const mapper = new EpiDataMapper()

  it('should map INTEGER to numeric_range', () => {
    const qesField = {
      name: 'age',
      label: 'Age',
      type: QESFieldType.INTEGER,
      length: 2,
      decimals: 0,
      comment: null
    }
    const question = mapper.mapFieldToQuestion(qesField)
    expect(question.type).toBe('numeric_range')
    expect(question.variableName).toBe('age')
    expect(question.constraint.type).toBe('integer')
  })

  it('should map DECIMAL to numeric_range', () => {
    const qesField = {
      name: 'bmi',
      label: 'BMI',
      type: QESFieldType.DECIMAL,
      length: 4,
      decimals: 2,
      comment: null
    }
    const question = mapper.mapFieldToQuestion(qesField)
    expect(question.type).toBe('numeric_range')
    expect(question.constraint.type).toBe('decimal')
  })

  it('should map TEXT to free_text', () => {
    const qesField = {
      name: 'name',
      label: 'Name',
      type: QESFieldType.TEXT,
      length: 5,
      decimals: 0,
      comment: null
    }
    const question = mapper.mapFieldToQuestion(qesField)
    expect(question.type).toBe('free_text')
  })

  it('should map BOOLEAN to single_choice', () => {
    const qesField = {
      name: 'is_smoker',
      label: 'Is Smoker',
      type: QESFieldType.BOOLEAN,
      length: 1,
      decimals: 0,
      comment: null
    }
    const question = mapper.mapFieldToQuestion(qesField)
    expect(question.type).toBe('single_choice')
    expect(question.options).toHaveLength(2)
  })
})