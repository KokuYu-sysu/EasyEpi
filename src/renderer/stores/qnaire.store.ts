import { createStore, type StoreApi } from 'zustand/vanilla'

import type {
  QuestionDef,
  ConditionRule
} from '@shared/types/qnaire'

export type DesignerMode = 'idle' | 'designing' | 'previewing'

export interface QnaireState {
  mode: DesignerMode
  projectName: string | null
  folderPath: string | null
  questions: readonly Readonly<QuestionDef>[]
  conditionRules: readonly Readonly<ConditionRule>[]
  keyQuestionIds: readonly string[]
  selectedQuestionId: string | null
  isLoading: boolean
  error: string | null
}

export interface QnaireActions {
  selectQuestion(id: string | null): void
  addQuestion(question: QuestionDef): Promise<void>
  updateQuestion(id: string, patch: Partial<QuestionDef>): Promise<void>
  deleteQuestion(id: string): Promise<void>
  moveQuestion(fromIndex: number, toIndex: number): Promise<void>
  addConditionRule(rule: ConditionRule): Promise<void>
  updateConditionRule(id: string, patch: Partial<ConditionRule>): Promise<void>
  deleteConditionRule(id: string): Promise<void>
  setKeyQuestion(questionId: string, isKey: boolean): Promise<void>
  updateMeta(name?: string, description?: string): Promise<void>
  loadFromIpc(): Promise<void>
  setMode(mode: DesignerMode): void
  setError(error: string | null): void
  reset(): void
}

export type QnaireStore = StoreApi<QnaireState & QnaireActions>

export function createQnaireStore(): QnaireStore {
  return createStore<QnaireState & QnaireActions>()((set, get) => ({
    mode: 'idle',
    projectName: null,
    folderPath: null,
    questions: [],
    conditionRules: [],
    keyQuestionIds: [],
    selectedQuestionId: null,
    isLoading: false,
    error: null,

    selectQuestion: (id) => {
      set({ selectedQuestionId: id })
    },

    addQuestion: async (question) => {
      try {
        const result = await window.easyEpi.qnaire.addQuestion(question)
        if (result.ok) {
          const data = await window.easyEpi.qnaire.getData()
          set({
            questions: Object.freeze(data.questions.map((q) => Object.freeze({ ...q }))),
            selectedQuestionId: question.id
          })
        }
      } catch (e) {
        set({ error: (e as Error).message })
      }
    },

    updateQuestion: async (id, patch) => {
      try {
        await window.easyEpi.qnaire.updateQuestion(id, patch)
        const data = await window.easyEpi.qnaire.getData()
        set({
          questions: Object.freeze(data.questions.map((q) => Object.freeze({ ...q })))
        })
      } catch (e) {
        set({ error: (e as Error).message })
      }
    },

    deleteQuestion: async (id) => {
      try {
        await window.easyEpi.qnaire.deleteQuestion(id)
        const data = await window.easyEpi.qnaire.getData()
        const state = get()
        const newSelected = state.selectedQuestionId === id ? null : state.selectedQuestionId
        set({
          questions: Object.freeze(data.questions.map((q) => Object.freeze({ ...q }))),
          conditionRules: Object.freeze(data.conditionRules.map((r) => Object.freeze({ ...r }))),
          keyQuestionIds: Object.freeze(data.keyQuestionIds),
          selectedQuestionId: newSelected
        })
      } catch (e) {
        set({ error: (e as Error).message })
      }
    },

    moveQuestion: async (fromIndex, toIndex) => {
      const state = get()
      const ids = state.questions.map((q) => q.id)
      const [moved] = ids.splice(fromIndex, 1)
      if (moved !== undefined) {
        ids.splice(toIndex, 0, moved)
      }
      try {
        await window.easyEpi.qnaire.reorderQuestions(ids)
        const data = await window.easyEpi.qnaire.getData()
        set({
          questions: Object.freeze(data.questions.map((q) => Object.freeze({ ...q })))
        })
      } catch (e) {
        set({ error: (e as Error).message })
      }
    },

    addConditionRule: async (rule) => {
      try {
        await window.easyEpi.qnaire.addConditionRule(rule)
        const data = await window.easyEpi.qnaire.getData()
        set({
          conditionRules: Object.freeze(data.conditionRules.map((r) => Object.freeze({ ...r })))
        })
      } catch (e) {
        set({ error: (e as Error).message })
      }
    },

    updateConditionRule: async (id, patch) => {
      try {
        await window.easyEpi.qnaire.updateConditionRule(id, patch)
        const data = await window.easyEpi.qnaire.getData()
        set({
          conditionRules: Object.freeze(data.conditionRules.map((r) => Object.freeze({ ...r })))
        })
      } catch (e) {
        set({ error: (e as Error).message })
      }
    },

    deleteConditionRule: async (id) => {
      try {
        await window.easyEpi.qnaire.deleteConditionRule(id)
        const data = await window.easyEpi.qnaire.getData()
        set({
          conditionRules: Object.freeze(data.conditionRules.map((r) => Object.freeze({ ...r })))
        })
      } catch (e) {
        set({ error: (e as Error).message })
      }
    },

    setKeyQuestion: async (questionId, isKey) => {
      try {
        await window.easyEpi.qnaire.updateQuestion(questionId, { isKey })
        const data = await window.easyEpi.qnaire.getData()
        set({
          questions: Object.freeze(data.questions.map((q) => Object.freeze({ ...q }))),
          keyQuestionIds: Object.freeze(data.keyQuestionIds)
        })
      } catch (e) {
        set({ error: (e as Error).message })
      }
    },

    updateMeta: async (name, description) => {
      try {
        await window.easyEpi.qnaire.updateMeta(name, description)
        if (name) set({ projectName: name })
      } catch (e) {
        set({ error: (e as Error).message })
      }
    },

    loadFromIpc: async () => {
      set({ isLoading: true, error: null })
      try {
        const data = await window.easyEpi.qnaire.getData()
        set({
          questions: Object.freeze(data.questions.map((q) => Object.freeze({ ...q }))),
          conditionRules: Object.freeze(data.conditionRules.map((r) => Object.freeze({ ...r }))),
          keyQuestionIds: Object.freeze(data.keyQuestionIds),
          projectName: data.name,
          mode: 'designing',
          isLoading: false
        })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        if (msg.includes('NO_PROJECT_OPEN')) {
          // No project open yet - stay in idle mode silently
          set({ isLoading: false, mode: 'idle' })
        } else {
          // Real error - show it to the user
          set({ isLoading: false, mode: 'idle', error: `加载问卷数据失败: ${msg}` })
        }
      }
    },

    setMode: (mode) => set({ mode }),
    setError: (error) => set({ error }),

    reset: () => {
      set({
        mode: 'idle',
        projectName: null,
        folderPath: null,
        questions: [],
        conditionRules: [],
        keyQuestionIds: [],
        selectedQuestionId: null,
        isLoading: false,
        error: null
      })
    }
  }))
}
