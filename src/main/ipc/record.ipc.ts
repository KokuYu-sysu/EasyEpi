import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'

import type { RecordData, AnswerValue } from '@shared/types/record'
import { normalizeVisibleAnswers, validateQuestionAnswer } from '@shared/types/qnaire'
import {
  RECORD_SUBMIT_CHANNEL,
  RECORD_LIST_CHANNEL,
  RECORD_DELETE_CHANNEL,
  RECORD_GET_PROGRESS_CHANNEL,
  RECORD_SAVE_PROGRESS_CHANNEL,
  RECORD_CHECK_KEY_CHANNEL,
  parseRecordSubmitRequest,
  parseRecordListRequest,
  parseRecordDeleteRequest,
  parseKeyDuplicateRequest,
  type RecordSubmitResult,
  type RecordListResult,
  type EntryProgressResult,
  type KeyDuplicateResult
} from '@shared/record-contract'

import {
  createDataFile,
  getDataFilePath,
  loadRecords,
  appendRecord,
  deleteRecords,
  checkKeyDuplicate,
  loadEntryProgress,
  saveEntryProgress,
  resolveProjectDataFilePath,
  type PersistedEntryProgress
} from '../services/record.service'
import { DerivedService } from '../services/derived/derived.service'

import type { ProjectIpcState } from './project.ipc'
import { type IpcMainLike, type IpcInvokeEventLike, assertTrustedSender } from './types'

export interface RecordIpcState {
  entryProgress: {
    hasDraft: boolean
    currentIndex: number
    batchCount: number
    batchStartTime: number
    currentAnswers: Record<string, unknown>
  }
}

export function createRecordIpcState(): RecordIpcState {
  return {
    entryProgress: {
      hasDraft: false,
      currentIndex: 0,
      batchCount: 0,
      batchStartTime: Date.now(),
      currentAnswers: {}
    }
  }
}

function ensureDataFile(projectState: ProjectIpcState): { filePath: string; key: Buffer } {
  if (!projectState.currentProject) throw new Error('NO_PROJECT_OPEN')
  const key = projectState.auth.encryptionKey
  if (!key) throw new Error('PROJECT_NOT_UNLOCKED')

  const filePath = projectState.currentFilePath
    ? resolveProjectDataFilePath(projectState.currentFilePath, projectState.currentProject.meta.name)
    : getDataFilePath(
        projectState.currentProject.meta.folderPath,
        projectState.currentProject.meta.name
      )

  if (!existsSync(filePath)) {
    createDataFile(filePath, key)
  }

  return { filePath, key }
}

function validateAndNormalizeAnswers(
  projectState: ProjectIpcState,
  answers: Record<string, unknown>
): Record<string, AnswerValue> | null {
  const questionnaire = projectState.currentProject?.questionnaire
  if (!questionnaire) return null

  const canonicalAnswers: Record<string, unknown> = {}
  for (const question of questionnaire.questions) {
    const rawAnswer = answers[question.id] ?? answers[question.variableName]
    if (rawAnswer !== undefined) canonicalAnswers[question.id] = rawAnswer
  }
  const { visibleQuestions, answers: visibleAnswers } = normalizeVisibleAnswers(
    questionnaire,
    canonicalAnswers
  )
  const normalized: Record<string, AnswerValue> = {}
  for (const question of visibleQuestions) {
    const rawAnswer = visibleAnswers[question.id]
    if (rawAnswer === undefined) {
      if (validateQuestionAnswer(question, undefined) !== null) return null
      continue
    }
    if (typeof rawAnswer !== 'string') return null

    const skipValue = question.skipValue ?? '-9'
    if (!(question.allowSkip && rawAnswer === skipValue)) {
      if (validateQuestionAnswer(question, rawAnswer) !== null) return null
    }
    normalized[question.id] = rawAnswer
  }
  return normalized
}

function updatePersistedProgress(
  filePath: string,
  key: Buffer,
  recordState: RecordIpcState,
  update: Partial<PersistedEntryProgress>
): PersistedEntryProgress {
  const progress = { ...loadEntryProgress(filePath, key), ...update }
  saveEntryProgress(filePath, key, progress)
  recordState.entryProgress = progress
  return progress
}

export function registerRecordIpc(
  ipcMain: IpcMainLike,
  projectState: ProjectIpcState,
  recordState: RecordIpcState,
  packagedRendererUrl: string,
  developmentOrigin?: string
): () => void {
  ipcMain.handle(RECORD_SUBMIT_CHANNEL, async (event: IpcInvokeEventLike, rawRequest: unknown) => {
    assertTrustedSender(event, packagedRendererUrl, developmentOrigin)
    const request = parseRecordSubmitRequest(rawRequest)
    const { filePath, key } = ensureDataFile(projectState)
    const normalizedAnswers = validateAndNormalizeAnswers(projectState, request.answers)
    if (normalizedAnswers === null) {
      return { ok: false, error: 'ANSWER_INVALID' } satisfies RecordSubmitResult
    }

    // Check Key duplicate
    const keyQuestionIds = projectState.currentProject?.questionnaire.keyQuestionIds ?? []
    if (keyQuestionIds.length > 0) {
      const keyQuestions =
        projectState.currentProject?.questionnaire.questions.filter((q) =>
          keyQuestionIds.includes(q.id)
        ) ?? []
      const keyFieldNames = keyQuestions.map((q) => q.id)
      const keyValues: Record<string, unknown> = {}
      for (const q of keyQuestions) {
        keyValues[q.id] = normalizedAnswers[q.id]
      }

      const dup = checkKeyDuplicate(filePath, key, keyFieldNames, keyValues)
      if (dup.isDuplicate) {
        return {
          ok: false,
          error: 'KEY_DUPLICATE',
          recordId: dup.duplicateRecordId
        } satisfies RecordSubmitResult
      }
    }

    const questionnaire = projectState.currentProject?.questionnaire
    if (!questionnaire) return { ok: false, error: 'NO_PROJECT_OPEN' }
    const derivedValues = new DerivedService().computeForRecord(questionnaire, normalizedAnswers)
    const answers: Record<string, AnswerValue> = {
      ...normalizedAnswers,
      ...derivedValues
    }

    const now = new Date().toISOString()
    const record: RecordData = {
      id: randomUUID(),
      answers,
      createdAt: now,
      updatedAt: now
    }

    appendRecord(filePath, key, record)

    // Update progress
    const progress = loadEntryProgress(filePath, key)
    updatePersistedProgress(filePath, key, recordState, {
      hasDraft: false,
      batchCount: progress.batchCount + 1,
      currentIndex: 0,
      currentAnswers: {}
    })

    return { ok: true, recordId: record.id } satisfies RecordSubmitResult
  })

  ipcMain.handle(RECORD_LIST_CHANNEL, async (event: IpcInvokeEventLike, rawRequest: unknown) => {
    assertTrustedSender(event, packagedRendererUrl, developmentOrigin)
    const request = parseRecordListRequest(rawRequest)
    const { filePath, key } = ensureDataFile(projectState)

    const allRecords = loadRecords(filePath, key)
    const offset = request.offset ?? 0
    const limit = request.limit ?? 100
    const sliced = allRecords.slice(offset, offset + limit)

    return {
      ok: true,
      records: sliced.map((r) => ({
        id: r.id,
        answers: r.answers as Record<string, unknown>,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt
      })),
      total: allRecords.length
    } satisfies RecordListResult
  })

  ipcMain.handle(RECORD_DELETE_CHANNEL, async (event: IpcInvokeEventLike, rawRequest: unknown) => {
    assertTrustedSender(event, packagedRendererUrl, developmentOrigin)
    const request = parseRecordDeleteRequest(rawRequest)
    const { filePath, key } = ensureDataFile(projectState)
    deleteRecords(filePath, key, request.recordIds)
    return { ok: true }
  })

  ipcMain.handle(RECORD_GET_PROGRESS_CHANNEL, async (event: IpcInvokeEventLike) => {
    assertTrustedSender(event, packagedRendererUrl, developmentOrigin)
    const { filePath, key } = ensureDataFile(projectState)
    const progress = loadEntryProgress(filePath, key)
    recordState.entryProgress = progress
    return {
      ok: true,
      hasDraft: progress.hasDraft,
      currentIndex: progress.currentIndex,
      batchCount: progress.batchCount,
      batchStartTime: progress.batchStartTime,
      currentAnswers: progress.currentAnswers
    } satisfies EntryProgressResult
  })

  ipcMain.handle(
    RECORD_SAVE_PROGRESS_CHANNEL,
    async (event: IpcInvokeEventLike, rawRequest: unknown) => {
      assertTrustedSender(event, packagedRendererUrl, developmentOrigin)
      const { filePath, key } = ensureDataFile(projectState)
      const update: Partial<PersistedEntryProgress> = {}
      if (typeof rawRequest === 'object' && rawRequest !== null) {
        const req = rawRequest as Record<string, unknown>
        if (typeof req.hasDraft === 'boolean') {
          update.hasDraft = req.hasDraft
        }
        if (typeof req.currentIndex === 'number') {
          update.currentIndex = req.currentIndex
        }
        if (typeof req.batchStartTime === 'number') {
          update.batchStartTime = req.batchStartTime
        }
        if (typeof req.currentAnswers === 'object' && req.currentAnswers !== null) {
          update.currentAnswers = req.currentAnswers as Record<string, unknown>
        }
      }
      updatePersistedProgress(filePath, key, recordState, update)
      return { ok: true }
    }
  )

  ipcMain.handle(
    RECORD_CHECK_KEY_CHANNEL,
    async (event: IpcInvokeEventLike, rawRequest: unknown) => {
      assertTrustedSender(event, packagedRendererUrl, developmentOrigin)
      const request = parseKeyDuplicateRequest(rawRequest)
      const { filePath, key } = ensureDataFile(projectState)

      const keyQuestionIds = projectState.currentProject?.questionnaire.keyQuestionIds ?? []
      const keyQuestions =
        projectState.currentProject?.questionnaire.questions.filter((q) =>
          keyQuestionIds.includes(q.id)
        ) ?? []
      const keyFieldNames = keyQuestions.map((q) => q.id)
      const keyValues: Record<string, unknown> = {}
      for (const question of keyQuestions) {
        keyValues[question.id] =
          request.keyValues[question.id] ?? request.keyValues[question.variableName]
      }

      const result = checkKeyDuplicate(
        filePath,
        key,
        keyFieldNames,
        keyValues,
        request.excludeRecordId
      )
      return {
        ok: true,
        isDuplicate: result.isDuplicate,
        duplicateRecordId: result.duplicateRecordId
      } satisfies KeyDuplicateResult
    }
  )

  return () => {
    ipcMain.removeHandler(RECORD_SUBMIT_CHANNEL)
    ipcMain.removeHandler(RECORD_LIST_CHANNEL)
    ipcMain.removeHandler(RECORD_DELETE_CHANNEL)
    ipcMain.removeHandler(RECORD_GET_PROGRESS_CHANNEL)
    ipcMain.removeHandler(RECORD_SAVE_PROGRESS_CHANNEL)
    ipcMain.removeHandler(RECORD_CHECK_KEY_CHANNEL)
  }
}
