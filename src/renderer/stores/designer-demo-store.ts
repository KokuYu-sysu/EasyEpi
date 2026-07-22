import { createStore, type StoreApi } from 'zustand/vanilla'

import { DEMO_QUESTIONS } from '@renderer/demo/demo-data'

export type DesignerQuestionType = 'single' | 'multiple' | 'text'

export interface DesignerQuestion {
  id: string
  title: string
  type: DesignerQuestionType
  isKey: boolean
  hasCondition: boolean
}

export type DesignerQuestionDraft = Omit<DesignerQuestion, 'id'>

export interface DesignerDemoState {
  questions: readonly Readonly<DesignerQuestion>[]
  selectedId: string | null
  selectQuestion(id: string): void
  addQuestion(question: DesignerQuestionDraft): string
  updateQuestion(id: string, patch: Partial<DesignerQuestionDraft>): void
  removeQuestion(id: string): void
  reset(): void
}

export type DesignerDemoStore = StoreApi<DesignerDemoState>

function immutableQuestions(
  questions: readonly Readonly<DesignerQuestion>[]
): readonly Readonly<DesignerQuestion>[] {
  return Object.freeze(questions.map((question) => Object.freeze({ ...question })))
}

function nextCounter(questions: readonly Readonly<DesignerQuestion>[]): number {
  return questions.reduce((largest, question) => {
    const match = /^question-(\d+)$/.exec(question.id)
    return match ? Math.max(largest, Number(match[1])) : largest
  }, 0) + 1
}

export function createDesignerDemoStore(
  seed: readonly Readonly<DesignerQuestion>[] = DEMO_QUESTIONS
): DesignerDemoStore {
  const initialQuestions = immutableQuestions(seed)
  const initialCounter = nextCounter(initialQuestions)
  let counter = initialCounter

  return createStore<DesignerDemoState>()((set, get) => ({
    questions: immutableQuestions(initialQuestions),
    selectedId: initialQuestions[0]?.id ?? null,
    selectQuestion: (id) => {
      if (get().questions.some((question) => question.id === id)) {
        set({ selectedId: id })
      }
    },
    addQuestion: (draft) => {
      const id = `question-${counter++}`
      const question = Object.freeze({ id, ...draft })
      set((state) => ({
        questions: Object.freeze([...state.questions, question]),
        selectedId: state.selectedId ?? id
      }))
      return id
    },
    updateQuestion: (id, patch) => {
      set((state) => ({
        questions: Object.freeze(
          state.questions.map((question) =>
            question.id === id ? Object.freeze({ ...question, ...patch, id }) : question
          )
        )
      }))
    },
    removeQuestion: (id) => {
      set((state) => {
        const index = state.questions.findIndex((question) => question.id === id)
        if (index < 0) return state
        const questions = Object.freeze(state.questions.filter((question) => question.id !== id))
        const selectedId =
          state.selectedId === id
            ? (questions[Math.min(index, questions.length - 1)]?.id ?? null)
            : state.selectedId
        return { questions, selectedId }
      })
    },
    reset: () => {
      counter = initialCounter
      const questions = immutableQuestions(initialQuestions)
      set({ questions, selectedId: questions[0]?.id ?? null })
    }
  }))
}
