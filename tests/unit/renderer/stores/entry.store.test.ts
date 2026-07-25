import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createEntryStore } from '@renderer/stores/entry.store'

const mockQnaireGetData = vi.fn()
const mockRecordSubmit = vi.fn()
const mockRecordSaveProgress = vi.fn()
const mockRecordGetProgress = vi.fn()

vi.stubGlobal('window', {
  easyEpi: {
    qnaire: { getData: mockQnaireGetData },
    record: {
      submit: mockRecordSubmit,
      saveProgress: mockRecordSaveProgress,
      getProgress: mockRecordGetProgress
    }
  }
})

const testQuestionnaire = {
  name: 'Test',
  questions: [
    {
      id: 'q1',
      content: '性别',
      variableName: 'sex',
      type: 'single_choice' as const,
      options: [
        { value: '1', label: '男' },
        { value: '2', label: '女' }
      ],
      constraint: { type: 'none' as const },
      isKey: false,
      allowSkip: false,
      order: 0
    },
    {
      id: 'q2',
      content: '姓名',
      variableName: 'name',
      type: 'free_text' as const,
      options: [],
      constraint: { type: 'none' as const },
      isKey: true,
      allowSkip: false,
      order: 1
    }
  ],
  conditionRules: [],
  keyQuestionIds: ['q2']
}

describe('entry.store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockQnaireGetData.mockResolvedValue(testQuestionnaire)
    mockRecordSubmit.mockResolvedValue({ ok: true, recordId: 'test-id' })
    mockRecordSaveProgress.mockResolvedValue({ ok: true })
    mockRecordGetProgress.mockResolvedValue({
      ok: true,
      currentIndex: 0,
      batchCount: 0,
      batchStartTime: Date.now(),
      currentAnswers: {}
    })
  })

  it('starts in idle phase', () => {
    const store = createEntryStore()
    expect(store.getState().phase).toBe('idle')
  })

  it('loads questionnaire', async () => {
    const store = createEntryStore()
    await store.getState().loadQuestionnaire()
    expect(store.getState().questionnaire?.name).toBe('Test')
    expect(store.getState().visibleQuestions).toHaveLength(2)
  })

  it('starts entry and shows first question', async () => {
    const store = createEntryStore()
    await store.getState().loadQuestionnaire()
    store.getState().startEntry()
    expect(store.getState().phase).toBe('entering')
    expect(store.getState().currentIndex).toBe(0)
  })

  it('sets answer and navigates', async () => {
    const store = createEntryStore()
    await store.getState().loadQuestionnaire()
    store.getState().startEntry()
    store.getState().setAnswer('q1', '1')
    expect(store.getState().answers['q1']).toBe('1')
    const moved = store.getState().goNext()
    expect(moved).toBe(true)
    expect(store.getState().currentIndex).toBe(1)
  })

  it('validates required fields', async () => {
    const store = createEntryStore()
    await store.getState().loadQuestionnaire()
    store.getState().startEntry()
    const moved = store.getState().goNext()
    expect(moved).toBe(false)
    expect(store.getState().validationError).toBeTruthy()
  })

  it('goes to confirming phase after last question', async () => {
    const store = createEntryStore()
    await store.getState().loadQuestionnaire()
    store.getState().startEntry()
    store.getState().setAnswer('q1', '1')
    store.getState().goNext()
    store.getState().setAnswer('q2', '张三')
    store.getState().goNext()
    expect(store.getState().phase).toBe('confirming')
  })

  it('submits record successfully', async () => {
    const store = createEntryStore()
    await store.getState().loadQuestionnaire()
    store.getState().startEntry()
    store.getState().setAnswer('q1', '1')
    store.getState().goNext()
    store.getState().setAnswer('q2', '张三')
    store.getState().goNext()
    const success = await store.getState().submitRecord()
    expect(success).toBe(true)
    expect(store.getState().batchCount).toBe(1)
  })

  it('handles goPrev from confirming', async () => {
    const store = createEntryStore()
    await store.getState().loadQuestionnaire()
    store.getState().startEntry()
    store.getState().setAnswer('q1', '1')
    store.getState().goNext()
    store.getState().setAnswer('q2', '张三')
    store.getState().goNext()
    expect(store.getState().phase).toBe('confirming')
    store.getState().goPrev()
    expect(store.getState().phase).toBe('entering')
  })

  it('starts next record after submit', async () => {
    const store = createEntryStore()
    await store.getState().loadQuestionnaire()
    store.getState().startEntry()
    store.getState().setAnswer('q1', '1')
    store.getState().goNext()
    store.getState().setAnswer('q2', '张三')
    store.getState().goNext()
    await store.getState().submitRecord()
    store.getState().confirmSubmit()
    store.getState().startNextRecord()
    expect(store.getState().phase).toBe('entering')
    expect(store.getState().currentIndex).toBe(0)
    expect(store.getState().answers).toEqual({})
  })

  it('handles skip logic with conditions', async () => {
    const qnaireWithConditions = {
      name: 'SkipTest',
      questions: [
        {
          id: 'q1',
          content: '是否吸烟',
          variableName: 'smoke',
          type: 'single_choice' as const,
          options: [
            { value: 'yes', label: '是' },
            { value: 'no', label: '否' }
          ],
          constraint: { type: 'none' as const },
          isKey: false,
          allowSkip: false,
          order: 0
        },
        {
          id: 'q2',
          content: '每日吸烟量',
          variableName: 'cig_per_day',
          type: 'numeric_range' as const,
          options: [],
          constraint: { type: 'integer' as const, minValue: 0, maxValue: 100 },
          isKey: false,
          allowSkip: false,
          order: 1
        }
      ],
      conditionRules: [
        {
          id: 'rule1',
          sourceQuestionId: 'q1',
          conditions: [{ questionId: 'q1', operator: 'equals' as const, value: 'no' }],
          logic: 'AND' as const,
          action: 'skip' as const,
          targetQuestionIds: ['q2']
        }
      ],
      keyQuestionIds: []
    }
    mockQnaireGetData.mockResolvedValue(qnaireWithConditions)

    const store = createEntryStore()
    await store.getState().loadQuestionnaire()
    store.getState().startEntry()

    // Initially both visible (no answer yet, condition not met)
    expect(store.getState().visibleQuestions).toHaveLength(2)

    // Answer "no" to smoke → q2 should be skipped
    store.getState().setAnswer('q1', 'no')
    expect(store.getState().visibleQuestions).toHaveLength(1)

    // Answer "yes" → q2 should reappear
    store.getState().setAnswer('q1', 'yes')
    expect(store.getState().visibleQuestions).toHaveLength(2)
  })
})
