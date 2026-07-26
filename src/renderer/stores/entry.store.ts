import { createStore, type StoreApi } from 'zustand/vanilla'

import type { QuestionDef, QuestionnaireDef } from '@shared/types/qnaire'
import { getVisibleQuestions, validateQuestionAnswer } from '@shared/types/qnaire'

export type EntryPhase = 'idle' | 'entering' | 'confirming' | 'submitted' | 'work_end'

export interface EntryState {
  phase: EntryPhase
  questionnaire: QuestionnaireDef | null
  visibleQuestions: readonly Readonly<QuestionDef>[]
  currentIndex: number
  answers: Readonly<Record<string, string>>
  validationError: string | null
  batchCount: number
  batchStartTime: number
  isLoading: boolean
  error: string | null
  lastSubmitError: string | null
}

export interface EntryActions {
  loadQuestionnaire(): Promise<void>
  startEntry(): void
  setAnswer(questionId: string, value: string): void
  goNext(): boolean
  goPrev(): void
  skipQuestion(): void
  submitRecord(): Promise<boolean>
  confirmSubmit(): void
  startNextRecord(): void
  endWork(): void
  reset(): void
  saveProgress(): Promise<void>
  restoreProgress(): Promise<void>
}

export type EntryStore = StoreApi<EntryState & EntryActions>

function freezeVisible(qnaire: QuestionnaireDef, answers: Record<string, string>): QuestionDef[] {
  return getVisibleQuestions(qnaire, answers as Record<string, unknown>)
}

export function createEntryStore(): EntryStore {
  return createStore<EntryState & EntryActions>()((set, get) => ({
    phase: 'idle',
    questionnaire: null,
    visibleQuestions: [],
    currentIndex: 0,
    answers: {},
    validationError: null,
    batchCount: 0,
    batchStartTime: Date.now(),
    isLoading: false,
    error: null,
    lastSubmitError: null,

    loadQuestionnaire: async () => {
      set({ isLoading: true, error: null })
      try {
        const qnaire = await window.easyEpi.qnaire.getData()
        const visible = freezeVisible(qnaire, {})
        set({
          questionnaire: qnaire,
          visibleQuestions: Object.freeze(visible.map((q) => Object.freeze({ ...q }))),
          isLoading: false
        })
        // Try to restore break-point resume progress
        try {
          const progress = await window.easyEpi.record.getProgress()
          if (progress.ok && progress.batchCount > 0) {
            set({
              batchCount: progress.batchCount,
              batchStartTime: progress.batchStartTime
            })
            if (progress.currentIndex > 0 && Object.keys(progress.currentAnswers).length > 0) {
              const restoredVisible = freezeVisible(qnaire, progress.currentAnswers as Record<string, string>)
              set({
                phase: 'entering',
                visibleQuestions: Object.freeze(restoredVisible.map((q) => Object.freeze({ ...q }))),
                currentIndex: progress.currentIndex,
                answers: Object.freeze(progress.currentAnswers as Record<string, string>)
              })
            }
          }
        } catch {
          // Progress restore is best-effort
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        if (msg.includes('NO_PROJECT_OPEN')) {
          set({ isLoading: false, phase: 'idle', error: null })
        } else {
          set({ isLoading: false, error: `加载问卷失败: ${msg}` })
        }
      }
    },

    startEntry: () => {
      const state = get()
      if (!state.questionnaire) return
      const visible = freezeVisible(state.questionnaire, {})
      set({
        phase: 'entering',
        visibleQuestions: Object.freeze(visible.map((q) => Object.freeze({ ...q }))),
        currentIndex: 0,
        answers: {},
        validationError: null,
        lastSubmitError: null,
        batchStartTime: Date.now()
      })
    },

    setAnswer: (questionId, value) => {
      const state = get()
      const newAnswers = { ...state.answers, [questionId]: value }
      if (!state.questionnaire) return
      const visible = freezeVisible(state.questionnaire, newAnswers)
      set({
        answers: Object.freeze(newAnswers),
        visibleQuestions: Object.freeze(visible.map((q) => Object.freeze({ ...q }))),
        validationError: null
      })
    },

    goNext: () => {
      const state = get()
      const question = state.visibleQuestions[state.currentIndex]
      if (!question || state.phase !== 'entering') return false

      const error = validateQuestionAnswer(question, state.answers[question.id])
      if (error) {
        set({ validationError: error })
        return false
      }

      if (state.currentIndex >= state.visibleQuestions.length - 1) {
        set({ phase: 'confirming', validationError: null })
        return true
      }

      set({ currentIndex: state.currentIndex + 1, validationError: null })
      // Auto-save progress for break-point resume
      void get().saveProgress()
      return true
    },

    goPrev: () => {
      const state = get()
      if (state.phase === 'confirming') {
        set({ phase: 'entering', validationError: null })
        return
      }
      if (state.currentIndex > 0) {
        set({ currentIndex: state.currentIndex - 1, validationError: null })
      }
    },

    skipQuestion: () => {
      const state = get()
      const question = state.visibleQuestions[state.currentIndex]
      if (!question || !question.allowSkip || state.phase !== 'entering') return

      const skipValue = question.skipValue ?? '-9'
      const newAnswers = { ...state.answers, [question.id]: skipValue }
      if (!state.questionnaire) return
      const visible = freezeVisible(state.questionnaire, newAnswers)

      if (state.currentIndex >= state.visibleQuestions.length - 1) {
        set({
          answers: Object.freeze(newAnswers),
          visibleQuestions: Object.freeze(visible.map((q) => Object.freeze({ ...q }))),
          phase: 'confirming',
          validationError: null
        })
      } else {
        set({
          answers: Object.freeze(newAnswers),
          visibleQuestions: Object.freeze(visible.map((q) => Object.freeze({ ...q }))),
          currentIndex: state.currentIndex + 1,
          validationError: null
        })
        // Auto-save progress for break-point resume
        void get().saveProgress()
      }
    },

    submitRecord: async () => {
      const state = get()
      if (state.phase !== 'confirming') return false
      try {
        const result = await window.easyEpi.record.submit(state.answers as Record<string, unknown>)
        if (result.ok) {
          set((s) => ({
            phase: 'submitted',
            batchCount: s.batchCount + 1,
            lastSubmitError: null
          }))
          return true
        } else {
          set({ lastSubmitError: result.error ?? '提交失败' })
          return false
        }
      } catch (e) {
        set({ lastSubmitError: (e as Error).message })
        return false
      }
    },

    confirmSubmit: () => {
      set({ phase: 'work_end' })
    },

    startNextRecord: () => {
      const state = get()
      if (!state.questionnaire) return
      const visible = freezeVisible(state.questionnaire, {})
      set({
        phase: 'entering',
        visibleQuestions: Object.freeze(visible.map((q) => Object.freeze({ ...q }))),
        currentIndex: 0,
        answers: {},
        validationError: null,
        lastSubmitError: null
      })
      // Reset saved progress for new record
      void get().saveProgress()
    },

    endWork: () => {
      set({
        phase: 'idle',
        currentIndex: 0,
        answers: {},
        validationError: null,
        lastSubmitError: null
      })
      // Clear saved progress
      void window.easyEpi.record.saveProgress({
        currentIndex: 0,
        currentAnswers: {}
      })
    },

    reset: () => {
      set({
        phase: 'idle',
        questionnaire: null,
        visibleQuestions: [],
        currentIndex: 0,
        answers: {},
        validationError: null,
        batchCount: 0,
        batchStartTime: Date.now(),
        isLoading: false,
        error: null,
        lastSubmitError: null
      })
    },

    saveProgress: async () => {
      const state = get()
      try {
        await window.easyEpi.record.saveProgress({
          currentIndex: state.currentIndex,
          batchStartTime: state.batchStartTime,
          currentAnswers: state.answers as Record<string, unknown>
        })
      } catch {
        // Silent fail for auto-save
      }
    },

    restoreProgress: async () => {
      try {
        const progress = await window.easyEpi.record.getProgress()
        if (progress.ok && progress.batchCount > 0) {
          set({
            batchCount: progress.batchCount,
            batchStartTime: progress.batchStartTime,
            currentIndex: progress.currentIndex,
            answers: Object.freeze(progress.currentAnswers as Record<string, string>)
          })
        }
      } catch {
        // Silent fail for restore
      }
    }
  }))
}
