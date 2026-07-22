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
