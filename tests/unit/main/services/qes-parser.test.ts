import { describe, expect, it } from 'vitest'

import { QESParser } from '@main/services/qes-parser'

describe('QESParser', () => {
  const parser = new QESParser()

  it('parses classic QES fields where the field mask follows the question text', () => {
    const result = parser.parse(`Community health survey
{participant_id} Participant identifier <idnum>
name Participant name __________
bmi Body mass index #.##
birth_date Date of birth <dd/mm/yyyy>
smoker Current smoker <Y>
code Site code <A   >`)

    expect(result.metadata.title).toBe('Community health survey')
    expect(result.fields).toMatchObject([
      { name: 'participant_id', label: 'Participant identifier', type: 'ID_NUM' },
      { name: 'name', label: 'Participant name', type: 'TEXT', length: 10 },
      { name: 'bmi', label: 'Body mass index', type: 'DECIMAL', length: 4, decimals: 2 },
      { name: 'birth_date', label: 'Date of birth', type: 'DATE_DMY', length: 10 },
      { name: 'smoker', label: 'Current smoker', type: 'BOOLEAN', length: 1 },
      { name: 'code', label: 'Site code', type: 'UPPERCASE', length: 4 }
    ])
  })

  it('parses multiple fields on one line and concatenates explicit name fragments', () => {
    const result = parser.parse(
      'Procedure {start dat}e <dd/mm/yyyy> Procedure {start tim}e ##.##'
    )

    expect(result.fields).toMatchObject([
      { name: 'startdat', label: 'Procedure start date', type: 'DATE_DMY' },
      { name: 'starttim', label: 'Procedure start time', type: 'DECIMAL' }
    ])
  })

  it('keeps support for mask-first definitions used by exported Manager templates', () => {
    const result = parser.parse('## age "Age of participant"')

    expect(result.fields).toMatchObject([
      { name: 'age', label: 'Age of participant', type: 'INTEGER', length: 2 }
    ])
  })

  it('parses rule blocks and attaches LABEL values to the matching field', () => {
    const result = parser.parse(`sex Biological sex #
LABEL sex
  1 "Male"
  2 "Female"
END
RANGE age
  0 120
END`)

    expect(result.blocks).toHaveLength(2)
    expect(result.blocks.map((block) => block.type)).toEqual(['LABEL', 'RANGE'])
    expect(result.fields[0]).toMatchObject({
      name: 'sex',
      valueLabels: [
        { value: '1', label: 'Male' },
        { value: '2', label: 'Female' }
      ]
    })
  })

  it('rejects malformed input instead of silently returning an empty questionnaire', () => {
    expect(() => parser.parse('Only headings and no fields')).toThrow('QES_NO_FIELDS')
  })

  it('rejects encrypted EpiData fields instead of silently omitting them', () => {
    expect(() => parser.parse('{secret} Confidential value <E10>')).toThrow(
      'QES_ENCRYPTED_FIELD_UNSUPPORTED'
    )
  })
})
