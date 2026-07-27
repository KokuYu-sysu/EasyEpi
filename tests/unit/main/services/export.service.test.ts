import { existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { ExportService, type ExportQuestion } from '@main/services/export.service'
import iconv from 'iconv-lite'

const TEST_DIR = join(tmpdir(), `easyepi-export-${process.pid}`)
const questions: ExportQuestion[] = [
  { variableName: 'name', label: '姓名', type: 'free_text' },
  {
    variableName: 'group',
    label: '组别',
    type: 'single_choice',
    options: [{ value: 'case', label: '病例组' }, { value: 'control', label: '对照组' }]
  },
  {
    variableName: 'symptoms',
    label: '症状',
    type: 'multiple_choice',
    options: [
      { value: 'cough', label: '咳嗽' },
      { value: 'fever', label: '发热' },
      { value: 'pain', label: '疼痛' }
    ]
  }
]

describe('ExportService', () => {
  afterEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true })
  })

  it('writes UTF-8 BOM CSV, escapes RFC 4180 values, and preserves multi-category data', async () => {
    const result = await new ExportService().exportCSV({
      records: [
        { name: '张三, "甲"\n第二行', group: 'case', symptoms: ['cough', 'fever'] },
        { name: '李四', group: 'control', symptoms: null }
      ],
      questions,
      encoding: 'multi_category',
      outputPath: join(TEST_DIR, 'nested', 'report.csv')
    })
    expect(result).toMatchObject({ success: true, recordCount: 2, columnCount: 3 })
    const csv = readFileSync(result.csvPath!, 'utf8')
    expect(csv.startsWith('\uFEFF')).toBe(true)
    expect(csv).toContain('"张三, ""甲""\n第二行"')
    expect(csv).toContain('病例组,"咳嗽,发热"')
  })

  it('writes GBK CSV and dictionary files with display labels', async () => {
    const result = await new ExportService().exportCSV({
      records: [{ name: '张三', group: 'case', symptoms: ['cough'] }],
      questions,
      encoding: 'multi_category',
      fileEncoding: 'gbk',
      outputPath: join(TEST_DIR, 'gbk.csv')
    })
    const rawCsv = readFileSync(result.csvPath!)
    expect(rawCsv.subarray(0, 3)).not.toEqual(Buffer.from([0xef, 0xbb, 0xbf]))
    expect(iconv.decode(rawCsv, 'gbk')).toContain('张三,病例组,咳嗽')
    expect(iconv.decode(readFileSync(result.dictionaryPath!), 'gbk')).toContain('症状')
  })

  it('expands one-hot columns and removes the original multiple-choice column', async () => {
    const result = await new ExportService().exportCSV({
      records: [{ name: '张三', symptoms: 'cough,pain' }],
      questions,
      encoding: 'one_hot',
      outputPath: join(TEST_DIR, 'one-hot.csv')
    })
    const csv = readFileSync(result.csvPath!, 'utf8')
    expect(csv).toContain('name,group,symptoms_咳嗽,symptoms_发热,symptoms_疼痛')
    expect(csv).toContain('张三,,1,0,1')
  })

  it('uses the selected dummy reference in both CSV and dictionary', async () => {
    const result = await new ExportService().exportCSV({
      records: [{ name: '张三', symptoms: ['pain'] }],
      questions,
      encoding: 'dummy',
      dummyReference: 'last',
      outputPath: join(TEST_DIR, 'REPORT.CSV')
    })
    const csv = readFileSync(result.csvPath!, 'utf8')
    const dictionary = readFileSync(result.dictionaryPath!, 'utf8')
    expect(result.dictionaryPath).toBe(join(TEST_DIR, 'REPORT_dictionary.txt'))
    expect(csv).toContain('symptoms_咳嗽_d,symptoms_发热_d')
    expect(csv).not.toContain('symptoms_疼痛_d')
    expect(dictionary).toContain('参考组：疼痛 (pain)')
    expect(dictionary).not.toContain('symptoms_疼痛_d')
  })

  it('includes every encountered column and blanks absent values', async () => {
    const result = await new ExportService().exportCSV({
      records: [{ a: 1 }, { b: 2 }],
      questions: [],
      encoding: 'multi_category',
      outputPath: join(TEST_DIR, 'sparse.csv')
    })
    expect(readFileSync(result.csvPath!, 'utf8')).toBe('\uFEFFa,b\n1,\n,2')
  })

  it('returns a structured failure and does not claim output paths', async () => {
    const result = await new ExportService().exportCSV({
      records: [],
      questions: [],
      encoding: 'multi_category',
      outputPath: ''
    })
    expect(result).toEqual({ success: false, error: 'INVALID_OUTPUT_PATH' })
  })

  it('normalizes a missing extension and exports empty data with an unlabeled dictionary field', async () => {
    const result = await new ExportService().exportCSV({
      records: [],
      questions: [{ variableName: 'age', type: 'numeric_range' }],
      encoding: 'multi_category',
      outputPath: join(TEST_DIR, 'empty-report')
    })
    expect(result.csvPath).toBe(join(TEST_DIR, 'empty-report.csv'))
    expect(readFileSync(result.csvPath!, 'utf8')).toBe('\uFEFFage')
    expect(readFileSync(result.dictionaryPath!, 'utf8')).toContain('age\tage\tnumeric_range\t连续/文本')
  })

  it('treats non-string multi-choice values and missing option definitions as unselected', async () => {
    const result = await new ExportService().exportCSV({
      records: [{ symptoms: 42, missing_options: 'x' }],
      questions: [
        questions[2]!,
        { variableName: 'missing_options', type: 'multiple_choice' }
      ],
      encoding: 'one_hot',
      outputPath: join(TEST_DIR, 'non-string.csv')
    })
    expect(readFileSync(result.csvPath!, 'utf8')).toContain('symptoms_咳嗽,symptoms_发热,symptoms_疼痛')
    expect(readFileSync(result.csvPath!, 'utf8')).toContain('0,0,0')
    expect(readFileSync(result.csvPath!, 'utf8')).toContain('missing_options')
    expect(readFileSync(result.csvPath!, 'utf8')).toContain('x')
  })

  it('rejects an unsupported encoding even if called outside the strict IPC contract', async () => {
    await expect(new ExportService().exportCSV({
      records: [], questions: [], encoding: 'unsupported' as never, outputPath: join(TEST_DIR, 'bad.csv')
    })).resolves.toEqual({ success: false, error: 'INVALID_ENCODING' })
  })
})
