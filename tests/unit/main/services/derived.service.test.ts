import { describe, expect, it } from 'vitest'

import { DerivedService } from '@main/services/derived/derived.service'
import type { QuestionnaireDef } from '@shared/types/qnaire'
import type { DerivedVariableDef } from '@shared/types/derived'

function baseQnaire(): QuestionnaireDef {
  return {
    name: '测试问卷',
    questions: [
      { id: 'q-weight', content: '体重(kg)', variableName: 'weight', type: 'numeric_range', options: [], constraint: { type: 'none' }, isKey: false, allowSkip: true, order: 0 },
      { id: 'q-height', content: '身高(cm)', variableName: 'height', type: 'numeric_range', options: [], constraint: { type: 'none' }, isKey: false, allowSkip: true, order: 1 },
      { id: 'q-age', content: '年龄', variableName: 'age', type: 'numeric_range', options: [], constraint: { type: 'none' }, isKey: false, allowSkip: true, order: 2 },
      { id: 'q-birth', content: '出生日期', variableName: 'birth', type: 'date', options: [], constraint: { type: 'none' }, isKey: false, allowSkip: true, order: 3 },
      { id: 'q-sex', content: '性别', variableName: 'sex', type: 'single_choice', options: [{ value: '1', label: '男' }, { value: '2', label: '女' }], constraint: { type: 'none' }, isKey: false, allowSkip: true, order: 4 }
    ],
    conditionRules: [],
    keyQuestionIds: [],
    derivedVariables: []
  }
}

function derived(id: string, variableName: string, formula: string, order: number, resultType: DerivedVariableDef['resultType'] = 'numeric'): DerivedVariableDef {
  return { id, variableName, label: variableName, formula, resultType, order }
}

describe('DerivedService.validateFormula', () => {
  it('accepts a valid formula referencing questions', () => {
    const result = new DerivedService().validateFormula('{weight} / ({height} / 100) ^ 2', baseQnaire())
    expect(result.ok).toBe(true)
    expect(result.inferredType).toBe('numeric')
  })

  it('rejects syntax errors', () => {
    const result = new DerivedService().validateFormula('1 + (2', baseQnaire())
    expect(result.ok).toBe(false)
  })

  it('rejects unknown variables', () => {
    const result = new DerivedService().validateFormula('{nope} + 1', baseQnaire())
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors[0]!.code).toBe('UNKNOWN_VARIABLE')
  })

  it('rejects reserved metadata prefix variables as invalid identifiers', () => {
    const result = new DerivedService().validateFormula('{__easyepi_record_id} + 1', baseQnaire())
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors[0]!.code).toBe('SYNTAX_ERROR')
  })

  it('accepts references to earlier derived variables', () => {
    const qnaire = {
      ...baseQnaire(),
      derivedVariables: [derived('d1', 'bmi', '{weight} / 2', 0)]
    }
    const result = new DerivedService().validateFormula('ROUND({bmi}, 1)', qnaire)
    expect(result.ok).toBe(true)
  })

  it('rejects circular references', () => {
    const qnaire = {
      ...baseQnaire(),
      derivedVariables: [
        derived('d1', 'a', '{b} + 1', 0),
        derived('d2', 'b', '{a} + 1', 1)
      ]
    }
    const result = new DerivedService().validateFormula('{a}', qnaire)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.some((e) => e.code === 'CIRCULAR_REFERENCE')).toBe(true)
  })

  it('rejects self reference', () => {
    const qnaire = {
      ...baseQnaire(),
      derivedVariables: [derived('d1', 'a', '{a} + 1', 0)]
    }
    const result = new DerivedService().validateDerivedVariables(qnaire)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.some((e) => e.code === 'CIRCULAR_REFERENCE')).toBe(true)
  })
})

describe('DerivedService.previewResult', () => {
  it('computes a preview value with a sample context', () => {
    const result = new DerivedService().previewResult('{weight} / ({height} / 100) ^ 2', baseQnaire(), {
      'q-weight': '70',
      'q-height': '170'
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(Number(result.value)).toBeCloseTo(24.22, 1)
  })

  it('returns an error for an invalid formula', () => {
    const result = new DerivedService().previewResult('{nope} + 1', baseQnaire(), {})
    expect(result.ok).toBe(false)
  })
})

describe('DerivedService.computeForRecord', () => {
  it('computes BMI from question-id keyed answers', () => {
    const qnaire = {
      ...baseQnaire(),
      derivedVariables: [derived('d1', 'bmi', '{weight} / ({height} / 100) ^ 2', 0)]
    }
    const result = new DerivedService().computeForRecord(qnaire, { 'q-weight': '70', 'q-height': '170' })
    expect(Number(result['bmi'])).toBeCloseTo(24.22, 1)
  })

  it('computes categorical age group with IF', () => {
    const qnaire = {
      ...baseQnaire(),
      derivedVariables: [
        derived('d1', 'age_group', 'IF({age} >= 60, "老年", IF({age} >= 18, "成年", "未成年"))', 0, 'categorical')
      ]
    }
    const result = new DerivedService().computeForRecord(qnaire, { 'q-age': '30' })
    expect(result['age_group']).toBe('成年')
  })

  it('chains derived-to-derived references in order', () => {
    const qnaire = {
      ...baseQnaire(),
      derivedVariables: [
        derived('d1', 'bmi', '{weight} / ({height} / 100) ^ 2', 0),
        derived('d2', 'bmi_rounded', 'ROUND({bmi}, 1)', 1)
      ]
    }
    const result = new DerivedService().computeForRecord(qnaire, { 'q-weight': '70', 'q-height': '170' })
    expect(result['bmi_rounded']).toBe('24.2')
  })

  it('stores null for missing dependencies', () => {
    const qnaire = {
      ...baseQnaire(),
      derivedVariables: [derived('d1', 'bmi', '{weight} / ({height} / 100) ^ 2', 0)]
    }
    const result = new DerivedService().computeForRecord(qnaire, {})
    expect(result['bmi']).toBe(null)
  })

  it('materializes booleans and dates', () => {
    const qnaire = {
      ...baseQnaire(),
      derivedVariables: [
        derived('d1', 'is_old', '{age} >= 60', 0, 'categorical'),
        derived('d2', 'birth_year', 'YEAR({birth})', 1)
      ]
    }
    const result = new DerivedService().computeForRecord(qnaire, { 'q-age': '70', 'q-birth': '1950-01-01' })
    expect(result['is_old']).toBe('true')
    expect(result['birth_year']).toBe('1950')
  })
})

describe('DerivedService.computeAll', () => {
  it('recomputes derived values for every record', () => {
    const qnaire = {
      ...baseQnaire(),
      derivedVariables: [derived('d1', 'bmi', '{weight} / ({height} / 100) ^ 2', 0)]
    }
    const records = [
      { id: 'r1', answers: { 'q-weight': '70', 'q-height': '170' }, createdAt: 't', updatedAt: 't' },
      { id: 'r2', answers: { 'q-weight': '80', 'q-height': '180' }, createdAt: 't', updatedAt: 't' }
    ]
    const result = new DerivedService().computeAll(qnaire, records)
    expect(result).toHaveLength(2)
    expect(Number(result[0]!['bmi'])).toBeCloseTo(24.22, 1)
    expect(Number(result[1]!['bmi'])).toBeCloseTo(24.69, 1)
  })
})

describe('DerivedService CRUD', () => {
  it('adds a derived variable with id and order', () => {
    const result = DerivedService.addDerivedVariable(baseQnaire(), {
      variableName: 'bmi',
      label: 'BMI',
      formula: '{weight} / ({height} / 100) ^ 2',
      resultType: 'numeric'
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.qnaire.derivedVariables).toHaveLength(1)
      const added = result.qnaire.derivedVariables![0]!
      expect(added.id).toBeTruthy()
      expect(added.order).toBe(0)
      expect(added.variableName).toBe('bmi')
    }
  })

  it('rejects duplicate variable names', () => {
    const result = DerivedService.addDerivedVariable(baseQnaire(), {
      variableName: 'weight',
      label: '重复',
      formula: '{weight}',
      resultType: 'numeric'
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors[0]!.code).toBe('DUPLICATE_VARIABLE')
  })

  it('rejects invalid variable name and reserved prefix', () => {
    const bad = DerivedService.addDerivedVariable(baseQnaire(), {
      variableName: '1abc',
      label: 'x',
      formula: '{weight}',
      resultType: 'numeric'
    })
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.errors[0]!.code).toBe('INVALID_VARIABLE_NAME')

    const reserved = DerivedService.addDerivedVariable(baseQnaire(), {
      variableName: '__easyepi_id',
      label: 'x',
      formula: '{weight}',
      resultType: 'numeric'
    })
    expect(reserved.ok).toBe(false)
    if (!reserved.ok) expect(reserved.errors[0]!.code).toBe('INVALID_VARIABLE_NAME')
  })

  it('rejects empty label and empty formula', () => {
    const emptyLabel = DerivedService.addDerivedVariable(baseQnaire(), {
      variableName: 'x',
      label: '   ',
      formula: '{weight}',
      resultType: 'numeric'
    })
    expect(emptyLabel.ok).toBe(false)

    const emptyFormula = DerivedService.addDerivedVariable(baseQnaire(), {
      variableName: 'x',
      label: 'x',
      formula: '',
      resultType: 'numeric'
    })
    expect(emptyFormula.ok).toBe(false)
  })

  it('updates a derived variable', () => {
    const added = DerivedService.addDerivedVariable(baseQnaire(), {
      variableName: 'bmi',
      label: 'BMI',
      formula: '{weight} / ({height} / 100) ^ 2',
      resultType: 'numeric'
    })
    if (!added.ok) throw new Error('add failed')
    const id = added.qnaire.derivedVariables![0]!.id
    const updated = DerivedService.updateDerivedVariable(added.qnaire, id, { label: '身体质量指数', displayDecimals: 1 })
    expect(updated.ok).toBe(true)
    if (updated.ok) {
      expect(updated.qnaire.derivedVariables![0]!.label).toBe('身体质量指数')
      expect(updated.qnaire.derivedVariables![0]!.displayDecimals).toBe(1)
    }
  })

  it('rejects updating a non-existent variable', () => {
    const result = DerivedService.updateDerivedVariable(baseQnaire(), 'nope', { label: 'x' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors[0]!.code).toBe('NOT_FOUND')
  })

  it('rejects an update that introduces a derived-to-derived cycle', () => {
    let qnaire = baseQnaire()
    const a = DerivedService.addDerivedVariable(qnaire, {
      variableName: 'a',
      label: 'A',
      formula: '{weight}',
      resultType: 'numeric'
    })
    if (!a.ok) throw new Error('add a failed')
    qnaire = a.qnaire
    const b = DerivedService.addDerivedVariable(qnaire, {
      variableName: 'b',
      label: 'B',
      formula: '{a} + 1',
      resultType: 'numeric'
    })
    if (!b.ok) throw new Error('add b failed')
    qnaire = b.qnaire

    const idA = qnaire.derivedVariables!.find((item) => item.variableName === 'a')!.id
    const result = DerivedService.updateDerivedVariable(qnaire, idA, { formula: '{b} + 1' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.some((error) => error.code === 'CIRCULAR_REFERENCE')).toBe(true)
    }
  })

  it('rejects adding a variable that references a nonexistent variable', () => {
    const result = DerivedService.addDerivedVariable(baseQnaire(), {
      variableName: 'c',
      label: 'C',
      formula: '{missing} + 1',
      resultType: 'numeric'
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors[0]!.code).toBe('UNKNOWN_VARIABLE')
  })

  it('rejects updating to a conflicting name', () => {
    const added = DerivedService.addDerivedVariable(baseQnaire(), {
      variableName: 'bmi',
      label: 'BMI',
      formula: '{weight} / ({height} / 100) ^ 2',
      resultType: 'numeric'
    })
    if (!added.ok) throw new Error('add failed')
    const id = added.qnaire.derivedVariables![0]!.id
    const result = DerivedService.updateDerivedVariable(added.qnaire, id, { variableName: 'age' })
    expect(result.ok).toBe(false)
  })

  it('deletes and reorders derived variables', () => {
    let qnaire = baseQnaire()
    const a = DerivedService.addDerivedVariable(qnaire, { variableName: 'a', label: 'A', formula: '{weight}', resultType: 'numeric' })
    if (!a.ok) throw new Error('add failed')
    qnaire = a.qnaire
    const b = DerivedService.addDerivedVariable(qnaire, { variableName: 'b', label: 'B', formula: '{height}', resultType: 'numeric' })
    if (!b.ok) throw new Error('add failed')
    qnaire = b.qnaire

    const ids = qnaire.derivedVariables!.map((item) => item.id)
    const reordered = DerivedService.reorderDerivedVariables(qnaire, [...ids].reverse())
    expect(reordered.derivedVariables![0]!.order).toBe(0)
    expect(reordered.derivedVariables![0]!.variableName).toBe('b')

    const deleted = DerivedService.deleteDerivedVariable(reordered, ids[0]!)
    expect(deleted.derivedVariables).toHaveLength(1)
    expect(deleted.derivedVariables![0]!.variableName).toBe('b')
  })
})

describe('DerivedService.validateDerivedVariables', () => {
  it('detects variable name collisions in the whole set', () => {
    const qnaire = {
      ...baseQnaire(),
      derivedVariables: [derived('d1', 'weight', '{weight}', 0)]
    }
    const result = new DerivedService().validateDerivedVariables(qnaire)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.some((e) => e.code === 'DUPLICATE_VARIABLE')).toBe(true)
  })

  it('passes a clean set', () => {
    const qnaire = {
      ...baseQnaire(),
      derivedVariables: [derived('d1', 'bmi', '{weight} / ({height} / 100) ^ 2', 0)]
    }
    const result = new DerivedService().validateDerivedVariables(qnaire)
    expect(result.ok).toBe(true)
  })
})
