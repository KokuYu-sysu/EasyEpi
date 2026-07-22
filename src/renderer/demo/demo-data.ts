import type { DesignerQuestion } from '@renderer/stores/designer-demo-store'

function freezeQuestion(question: DesignerQuestion): Readonly<DesignerQuestion> {
  return Object.freeze({ ...question })
}

export const DEMO_QUESTIONS: readonly Readonly<DesignerQuestion>[] = Object.freeze([
  freezeQuestion({
    id: 'question-1',
    title: '您的年龄是？',
    type: 'text',
    isKey: true,
    hasCondition: false
  }),
  freezeQuestion({
    id: 'question-2',
    title: '近期是否出现发热？',
    type: 'single',
    isKey: false,
    hasCondition: true
  }),
  freezeQuestion({
    id: 'question-3',
    title: '过去一周出现过哪些症状？',
    type: 'multiple',
    isKey: false,
    hasCondition: false
  })
])

export type AdminDemoStatus = '待复核' | '已复核' | '演示草稿'

export interface AdminDemoRecord {
  id: string
  code: string
  area: string
  status: AdminDemoStatus
  updatedAt: string
  synthetic: true
  sensitivity: 'non-sensitive'
}

function freezeAdminRecord(record: AdminDemoRecord): Readonly<AdminDemoRecord> {
  return Object.freeze({ ...record })
}

/** All entries are deliberately fictional labels and contain no person-level fields. */
export const DEMO_ADMIN_RECORDS: readonly Readonly<AdminDemoRecord>[] = Object.freeze([
  freezeAdminRecord({
    id: 'synthetic-1',
    code: 'SYN-001',
    area: '合成北区',
    status: '待复核',
    updatedAt: '2026-07-18',
    synthetic: true,
    sensitivity: 'non-sensitive'
  }),
  freezeAdminRecord({
    id: 'synthetic-2',
    code: 'SYN-002',
    area: '合成北区',
    status: '已复核',
    updatedAt: '2026-07-18',
    synthetic: true,
    sensitivity: 'non-sensitive'
  }),
  freezeAdminRecord({
    id: 'synthetic-3',
    code: 'SYN-003',
    area: '合成南区',
    status: '演示草稿',
    updatedAt: '2026-07-17',
    synthetic: true,
    sensitivity: 'non-sensitive'
  }),
  freezeAdminRecord({
    id: 'synthetic-4',
    code: 'SYN-004',
    area: '合成东区',
    status: '已复核',
    updatedAt: '2026-07-17',
    synthetic: true,
    sensitivity: 'non-sensitive'
  }),
  freezeAdminRecord({
    id: 'synthetic-5',
    code: 'SYN-005',
    area: '合成西区',
    status: '待复核',
    updatedAt: '2026-07-16',
    synthetic: true,
    sensitivity: 'non-sensitive'
  }),
  freezeAdminRecord({
    id: 'synthetic-6',
    code: 'SYN-006',
    area: '合成南区',
    status: '演示草稿',
    updatedAt: '2026-07-16',
    synthetic: true,
    sensitivity: 'non-sensitive'
  })
])
