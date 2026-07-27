import { existsSync } from 'node:fs'

import type { ProjectIpcState } from '../ipc/project.ipc'
import type { AnswerValue, RecordData } from '@shared/types/record'
import {
  normalizeVisibleAnswers,
  validateQuestionAnswer,
  type QuestionDef
} from '@shared/types/qnaire'

import {
  checkKeyDuplicate,
  createDataFile,
  deleteRecords as deletePersistedRecords,
  loadRecords,
  replaceRecords,
  resolveProjectDataFilePath
} from './record.service'

export interface PaginationOptions {
  page: number
  pageSize: number
  search?: string
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
}

export interface PaginatedResult {
  records: RecordData[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

interface DataFileAccess {
  filePath: string
  key: Buffer
}

function isAnswerValue(value: unknown): value is AnswerValue {
  return (
    value === null ||
    typeof value === 'string' ||
    (typeof value === 'number' && Number.isFinite(value)) ||
    (Array.isArray(value) && value.every((item) => typeof item === 'string'))
  )
}

function searchable(value: AnswerValue | undefined): string {
  if (value === null || value === undefined) return ''
  return Array.isArray(value) ? value.join(' ') : String(value)
}

function compareValues(left: AnswerValue | string | undefined, right: AnswerValue | string | undefined): number {
  if (left === undefined || left === null) return right === undefined || right === null ? 0 : 1
  if (right === undefined || right === null) return -1

  if (typeof left === 'number' && typeof right === 'number') return left - right
  const leftString = Array.isArray(left) ? left.join(',') : String(left)
  const rightString = Array.isArray(right) ? right.join(',') : String(right)
  return leftString.localeCompare(rightString, 'zh-CN', { numeric: true, sensitivity: 'base' })
}

export class DataService {
  constructor(
    private readonly projectState: ProjectIpcState,
    private readonly now: () => Date = () => new Date()
  ) {}

  private accessDataFile(): DataFileAccess {
    const project = this.projectState.currentProject
    if (!project) throw new Error('NO_PROJECT_OPEN')
    const key = this.projectState.auth.encryptionKey
    if (!key) throw new Error('PROJECT_NOT_UNLOCKED')

    if (!this.projectState.currentFilePath) throw new Error('NO_PROJECT_OPEN')
    const filePath = resolveProjectDataFilePath(this.projectState.currentFilePath, project.meta.name)
    if (!existsSync(filePath)) createDataFile(filePath, key)
    return { filePath, key }
  }

  private resolveQuestion(field: string): QuestionDef | null {
    return this.projectState.currentProject?.questionnaire.questions.find(
      (candidate) => candidate.id === field || candidate.variableName === field
    ) ?? null
  }

  private resolveQuestionId(field: string): string | null {
    return this.resolveQuestion(field)?.id ?? null
  }

  private validateAnswer(question: QuestionDef, value: AnswerValue): void {
    if (Array.isArray(value) && question.type !== 'multiple_choice') {
      throw new Error('ANSWER_CONSTRAINT_VIOLATION')
    }
    if (typeof value === 'number' && question.type !== 'numeric_range') {
      throw new Error('ANSWER_CONSTRAINT_VIOLATION')
    }
    const validationValue = value === null
      ? undefined
      : Array.isArray(value)
        ? value.join(',')
        : String(value)
    const skipValue = question.skipValue ?? '-9'
    if (
      !(question.allowSkip && validationValue === skipValue) &&
      validateQuestionAnswer(question, validationValue) !== null
    ) {
      throw new Error('ANSWER_CONSTRAINT_VIOLATION')
    }
  }

  async getRecords(options: PaginationOptions): Promise<PaginatedResult> {
    if (!Number.isInteger(options.page) || options.page < 1) throw new Error('INVALID_PAGE')
    if (!Number.isInteger(options.pageSize) || options.pageSize < 1 || options.pageSize > 500) {
      throw new Error('INVALID_PAGE_SIZE')
    }

    const { filePath, key } = this.accessDataFile()
    let records = loadRecords(filePath, key)
    const query = options.search?.trim().toLocaleLowerCase('zh-CN')
    if (query) {
      records = records.filter((record) => {
        if (record.id.toLocaleLowerCase('zh-CN').includes(query)) return true
        return Object.values(record.answers).some((value) =>
          searchable(value).toLocaleLowerCase('zh-CN').includes(query)
        )
      })
    }

    if (options.sortBy) {
      const metadataFields = new Set(['id', 'createdAt', 'updatedAt'])
      const explicitMetadata = new Map([
        ['@record:id', 'id'],
        ['@record:createdAt', 'createdAt'],
        ['@record:updatedAt', 'updatedAt']
      ])
      const metadataField = explicitMetadata.get(options.sortBy) ??
        (metadataFields.has(options.sortBy) ? options.sortBy : undefined)
      const questionId = options.sortBy.startsWith('@answer:')
        ? this.projectState.currentProject?.questionnaire.questions.find(
            (question) => question.id === options.sortBy!.slice('@answer:'.length)
          )?.id ?? null
        : metadataField === undefined
          ? this.resolveQuestionId(options.sortBy)
          : null
      if (metadataField === undefined && questionId === null) {
        throw new Error('INVALID_SORT_FIELD')
      }
      const direction = options.sortOrder === 'desc' ? -1 : 1
      records = [...records].sort((left, right) => {
        const leftValue = questionId === null
          ? left[metadataField as keyof RecordData]
          : left.answers[questionId]
        const rightValue = questionId === null
          ? right[metadataField as keyof RecordData]
          : right.answers[questionId]
        const comparison = compareValues(
          leftValue as AnswerValue | string,
          rightValue as AnswerValue | string
        )
        return comparison === 0 ? left.id.localeCompare(right.id) : comparison * direction
      })
    }

    const total = records.length
    const start = (options.page - 1) * options.pageSize
    return {
      records: records.slice(start, start + options.pageSize),
      total,
      page: options.page,
      pageSize: options.pageSize,
      totalPages: total === 0 ? 0 : Math.ceil(total / options.pageSize)
    }
  }

  async updateRecord(id: string, data: Record<string, unknown>): Promise<void> {
    const { filePath, key } = this.accessDataFile()
    const records = loadRecords(filePath, key)
    const index = records.findIndex((record) => record.id === id)
    if (index < 0) throw new Error('RECORD_NOT_FOUND')

    const rawAnswers = data['answers']
    if (typeof rawAnswers !== 'object' || rawAnswers === null || Array.isArray(rawAnswers)) {
      throw new Error('INVALID_ANSWERS')
    }

    const answerPatch: Record<string, AnswerValue> = {}
    for (const [field, value] of Object.entries(rawAnswers)) {
      const question = this.resolveQuestion(field)
      if (question === null) throw new Error('UNKNOWN_QUESTION')
      if (!isAnswerValue(value)) throw new Error('INVALID_ANSWER_VALUE')
      this.validateAnswer(question, value)
      answerPatch[question.id] = value
    }

    const current = records[index]!
    const questionnaire = this.projectState.currentProject!.questionnaire
    const mergedAnswers = { ...current.answers, ...answerPatch }
    const { visibleQuestions, answers: visibleAnswers } = normalizeVisibleAnswers(
      questionnaire,
      mergedAnswers
    )
    const answers: Record<string, AnswerValue> = {}
    for (const question of visibleQuestions) {
      const value = visibleAnswers[question.id]
      if (value === undefined) {
        this.validateAnswer(question, null)
        continue
      }
      if (!isAnswerValue(value)) throw new Error('INVALID_ANSWER_VALUE')
      this.validateAnswer(question, value)
      answers[question.id] = value
    }
    const keyFields = this.projectState.currentProject?.questionnaire.keyQuestionIds ?? []
    if (keyFields.length > 0) {
      const duplicate = checkKeyDuplicate(filePath, key, keyFields, answers, id)
      if (duplicate.isDuplicate) throw new Error('KEY_DUPLICATE')
    }

    records[index] = {
      ...current,
      answers,
      updatedAt: this.now().toISOString()
    }
    replaceRecords(filePath, key, records)
  }

  async deleteRecords(ids: string[]): Promise<void> {
    const { filePath, key } = this.accessDataFile()
    deletePersistedRecords(filePath, key, ids)
  }

  async getRecordCount(): Promise<number> {
    const { filePath, key } = this.accessDataFile()
    return loadRecords(filePath, key).length
  }

  async getRecordById(id: string): Promise<RecordData | null> {
    const { filePath, key } = this.accessDataFile()
    return loadRecords(filePath, key).find((record) => record.id === id) ?? null
  }
}
