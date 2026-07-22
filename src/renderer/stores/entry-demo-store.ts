import { createStore, type StoreApi } from 'zustand/vanilla'

interface EntryQuestionBase {
  id: string
  title: string
  required: boolean
}

export interface EntryRadioQuestion extends EntryQuestionBase {
  type: 'radio'
  options: readonly Readonly<{ value: string; label: string }>[]
}

export interface EntryTextQuestion extends EntryQuestionBase {
  type: 'text'
  hint: string
}

export type EntryQuestion = EntryRadioQuestion | EntryTextQuestion

export const ENTRY_DEMO_QUESTIONS: readonly Readonly<EntryQuestion>[] = Object.freeze([
  Object.freeze({
    id: 'visit',
    title: '过去两周是否接受过入户随访？',
    required: true,
    type: 'radio' as const,
    options: Object.freeze([
      Object.freeze({ value: 'yes', label: '是' }),
      Object.freeze({ value: 'no', label: '否' })
    ])
  }),
  Object.freeze({
    id: 'location',
    title: '本次调查地点',
    required: true,
    type: 'text' as const,
    hint: '请输入区县或街道名称；这里只使用合成演示内容。'
  })
])

export interface EntryDemoState {
  index: number
  answers: Readonly<Record<string, string>>
  validationError: string | null
  completed: boolean
  answer(questionId: string, value: string): void
  next(): boolean
  previous(): void
  reset(): void
}

export type EntryDemoStore = StoreApi<EntryDemoState>

const initialState = {
  index: 0,
  answers: Object.freeze({}) as Readonly<Record<string, string>>,
  validationError: null,
  completed: false
}

export function createEntryDemoStore(
  questions: readonly Readonly<EntryQuestion>[] = ENTRY_DEMO_QUESTIONS
): EntryDemoStore {
  return createStore<EntryDemoState>()((set, get) => ({
    ...initialState,
    answer: (questionId, value) => {
      if (!questions.some((question) => question.id === questionId)) return
      set((state) => ({
        answers: Object.freeze({ ...state.answers, [questionId]: value }),
        validationError: null
      }))
    },
    next: () => {
      const state = get()
      const question = questions[state.index]
      if (!question || state.completed) return false
      if (question.required && !state.answers[question.id]?.trim()) {
        set({ validationError: '此题为必答题，请完成后继续。' })
        return false
      }
      if (state.index === questions.length - 1) {
        set({ completed: true, validationError: null })
      } else {
        set({ index: state.index + 1, validationError: null })
      }
      return true
    },
    previous: () => {
      set((state) => ({
        index: state.completed ? Math.max(0, questions.length - 1) : Math.max(0, state.index - 1),
        completed: false,
        validationError: null
      }))
    },
    reset: () => set({ ...initialState })
  }))
}
