import { describe, expect, it } from 'vitest'

import {
  parseDerivedValidateRequest,
  parseDerivedPreviewRequest,
  parseDerivedAddRequest,
  parseDerivedUpdateRequest,
  parseDerivedDeleteRequest,
  parseDerivedReorderRequest,
  ALL_DERIVED_CHANNELS,
  DERIVED_GET_ALL_CHANNEL
} from '@shared/derived-contract'

describe('derived contract', () => {
  it('lists all channels', () => {
    expect(ALL_DERIVED_CHANNELS).toContain(DERIVED_GET_ALL_CHANNEL)
    expect(ALL_DERIVED_CHANNELS).toHaveLength(7)
  })

  it('parses validate requests', () => {
    expect(parseDerivedValidateRequest({ formula: '{weight} / 2' }).formula).toBe('{weight} / 2')
    expect(() => parseDerivedValidateRequest({ formula: '' })).toThrow('INVALID_DERIVED_FORMULA')
    expect(() => parseDerivedValidateRequest(null)).toThrow('INVALID_DERIVED_VALIDATE_REQUEST')
  })

  it('parses preview requests', () => {
    const result = parseDerivedPreviewRequest({
      formula: '{weight}',
      sampleAnswers: { 'q-1': '70' }
    })
    expect(result.sampleAnswers).toEqual({ 'q-1': '70' })
    expect(() => parseDerivedPreviewRequest({ formula: '{weight}' })).toThrow(
      'INVALID_DERIVED_SAMPLE'
    )
  })

  it('parses add requests with full validation', () => {
    const result = parseDerivedAddRequest({
      variable: {
        variableName: 'bmi',
        label: 'BMI',
        formula: '{weight} / ({height} / 100) ^ 2',
        resultType: 'numeric',
        displayDecimals: 1
      }
    })
    expect(result.variable.variableName).toBe('bmi')
    expect(result.variable.displayDecimals).toBe(1)
  })

  it('rejects invalid add requests', () => {
    const base = {
      variable: {
        variableName: 'bmi',
        label: 'BMI',
        formula: '{weight}',
        resultType: 'numeric'
      }
    }
    expect(() => parseDerivedAddRequest({ variable: { ...base.variable, variableName: '1bad' } })).toThrow(
      'INVALID_DERIVED_VARIABLE_NAME'
    )
    expect(() => parseDerivedAddRequest({ variable: { ...base.variable, label: '' } })).toThrow(
      'INVALID_DERIVED_LABEL'
    )
    expect(() => parseDerivedAddRequest({ variable: { ...base.variable, formula: '' } })).toThrow(
      'INVALID_DERIVED_FORMULA'
    )
    expect(() => parseDerivedAddRequest({ variable: { ...base.variable, resultType: 'bogus' } })).toThrow(
      'INVALID_DERIVED_RESULT_TYPE'
    )
    expect(() => parseDerivedAddRequest({ variable: { ...base.variable, displayDecimals: 99 } })).toThrow(
      'INVALID_DERIVED_DECIMALS'
    )
    expect(() => parseDerivedAddRequest(null)).toThrow('INVALID_DERIVED_ADD_REQUEST')
  })

  it('parses update requests', () => {
    const result = parseDerivedUpdateRequest({ id: 'd1', patch: { label: '新标签' } })
    expect(result.id).toBe('d1')
    expect(result.patch.label).toBe('新标签')
  })

  it('rejects update with invalid name or decimals', () => {
    expect(() =>
      parseDerivedUpdateRequest({ id: 'd1', patch: { variableName: '2x' } })
    ).toThrow('INVALID_DERIVED_VARIABLE_NAME')
    expect(() =>
      parseDerivedUpdateRequest({ id: 'd1', patch: { displayDecimals: -1 } })
    ).toThrow('INVALID_DERIVED_DECIMALS')
    expect(() => parseDerivedUpdateRequest({ id: '', patch: {} })).toThrow('INVALID_DERIVED_ID')
    expect(() => parseDerivedUpdateRequest({ id: 'd1', patch: null })).toThrow(
      'INVALID_DERIVED_PATCH'
    )
  })

  it('parses delete and reorder requests', () => {
    expect(parseDerivedDeleteRequest({ id: 'd1' }).id).toBe('d1')
    expect(parseDerivedReorderRequest({ ids: ['a', 'b'] }).ids).toEqual(['a', 'b'])
    expect(() => parseDerivedDeleteRequest({ id: '' })).toThrow('INVALID_DERIVED_ID')
    expect(() => parseDerivedReorderRequest({ ids: ['a', 'a'] })).toThrow('INVALID_DERIVED_IDS')
  })
})
