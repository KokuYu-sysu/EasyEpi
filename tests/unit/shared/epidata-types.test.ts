import { describe, it, expect } from 'vitest'
import { QESFieldType, isQESFieldType } from '@shared/types/epidata'

describe('EpiData types', () => {
  it('should define all QES field types', () => {
    expect(QESFieldType.INTEGER).toBe('INTEGER')
    expect(QESFieldType.DECIMAL).toBe('DECIMAL')
    expect(QESFieldType.TEXT).toBe('TEXT')
    expect(QESFieldType.UPPERCASE).toBe('UPPERCASE')
    expect(QESFieldType.BOOLEAN).toBe('BOOLEAN')
    expect(QESFieldType.DATE_DMY).toBe('DATE_DMY')
    expect(QESFieldType.DATE_MDY).toBe('DATE_MDY')
    expect(QESFieldType.TODAY_DATE).toBe('TODAY_DATE')
    expect(QESFieldType.SOUNDEX).toBe('SOUNDEX')
    expect(QESFieldType.ID_NUMBER).toBe('ID_NUM')
  })

  it('should validate QES field type', () => {
    expect(isQESFieldType('INTEGER')).toBe(true)
    expect(isQESFieldType('INVALID')).toBe(false)
  })
})