import { describe, expect, it } from 'vitest'

import {
  EMPTY_FORM_DATA,
  validateQuestionFormData
} from '@renderer/components/qnaire/QuestionEditDialog'

describe('question editor validation', () => {
  it('rejects duplicate option values and blank labels', () => {
    const errors = validateQuestionFormData(
      {
        ...EMPTY_FORM_DATA,
        content: 'Choice',
        variableName: 'choice',
        options: [
          { value: '1', label: 'One' },
          { value: '1', label: '' }
        ]
      },
      [],
      true
    )
    expect(errors.options).toBeTruthy()
  })

  it('rejects inverted numeric ranges and invalid regular expressions', () => {
    const rangeErrors = validateQuestionFormData(
      {
        ...EMPTY_FORM_DATA,
        content: 'Age',
        variableName: 'age',
        type: 'numeric_range',
        options: [],
        constraint: { type: 'integer', minValue: 10, maxValue: 5 }
      },
      [],
      true
    )
    expect(rangeErrors.constraint).toBeTruthy()

    const regexErrors = validateQuestionFormData(
      {
        ...EMPTY_FORM_DATA,
        content: 'Code',
        variableName: 'code',
        type: 'free_text',
        options: [],
        constraint: { type: 'regex', regexPattern: '[' }
      },
      [],
      true
    )
    expect(regexErrors.constraint).toBeTruthy()
  })
})
