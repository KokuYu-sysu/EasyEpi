import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'

import type { RecordData, AnswerValue } from '@shared/types/record'
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
  loadRecords,
  appendRecord,
  deleteRecords,
  checkKeyDuplicate,
  getDataFilePath
} from '../services/record.service'

import type { ProjectIpcState } from './project.ipc'
import { type IpcMainLike, type IpcInvokeEventLike, assertTrustedSender } from './types'

export interface RecordIpcState {
  entryProgress: {
    currentIndex: number
    batchCount: number
    batchStartTime: number
    currentAnswers: Record<string, unknown>
  }
}

export function createRecordIpcState(): RecordIpcState {
  return {
    entryProgress: {
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

  const folderPath = projectState.currentProject.meta.folderPath
  const name = projectState.currentProject.meta.name
  const filePath = getDataFilePath(folderPath, name)

  if (!existsSync(filePath)) {
    createDataFile(filePath, key)
  }

  return { filePath, key }
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

    // Check Key duplicate
    const keyQuestionIds = projectState.currentProject?.questionnaire.keyQuestionIds ?? []
    if (keyQuestionIds.length > 0) {
      const keyQuestions =
        projectState.currentProject?.questionnaire.questions.filter((q) =>
          keyQuestionIds.includes(q.id)
        ) ?? []
      const keyFieldNames = keyQuestions.map((q) => q.variableName)
      const keyValues: Record<string, unknown> = {}
      for (const q of keyQuestions) {
        keyValues[q.variableName] = request.answers[q.id] ?? request.answers[q.variableName]
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

    const now = new Date().toISOString()
    const record: RecordData = {
      id: randomUUID(),
      answers: request.answers as Record<string, AnswerValue>,
      createdAt: now,
      updatedAt: now
    }

    appendRecord(filePath, key, record)

    // Update progress
    recordState.entryProgress.batchCount++
    recordState.entryProgress.currentIndex = 0
    recordState.entryProgress.currentAnswers = {}

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
    return {
      ok: true,
      currentIndex: recordState.entryProgress.currentIndex,
      batchCount: recordState.entryProgress.batchCount,
      batchStartTime: recordState.entryProgress.batchStartTime,
      currentAnswers: recordState.entryProgress.currentAnswers
    } satisfies EntryProgressResult
  })

  ipcMain.handle(
    RECORD_SAVE_PROGRESS_CHANNEL,
    async (event: IpcInvokeEventLike, rawRequest: unknown) => {
      assertTrustedSender(event, packagedRendererUrl, developmentOrigin)
      if (typeof rawRequest === 'object' && rawRequest !== null) {
        const req = rawRequest as Record<string, unknown>
        if (typeof req.currentIndex === 'number') {
          recordState.entryProgress.currentIndex = req.currentIndex
        }
        if (typeof req.batchStartTime === 'number') {
          recordState.entryProgress.batchStartTime = req.batchStartTime
        }
        if (typeof req.currentAnswers === 'object' && req.currentAnswers !== null) {
          recordState.entryProgress.currentAnswers = req.currentAnswers as Record<string, unknown>
        }
      }
      return { ok: true }
    }
  )

  ipcMain.handle(RECORD_CHECK_KEY_CHANNEL, async (event: IpcInvokeEventLike, rawRequest: unknown) => {
    assertTrustedSender(event, packagedRendererUrl, developmentOrigin)
    const request = parseKeyDuplicateRequest(rawRequest)
    const { filePath, key } = ensureDataFile(projectState)

    const keyQuestionIds = projectState.currentProject?.questionnaire.keyQuestionIds ?? []
    const keyQuestions =
      projectState.currentProject?.questionnaire.questions.filter((q) =>
        keyQuestionIds.includes(q.id)
      ) ?? []
    const keyFieldNames = keyQuestions.map((q) => q.variableName)

    const result = checkKeyDuplicate(
      filePath,
      key,
      keyFieldNames,
      request.keyValues,
      request.excludeRecordId
    )
    return {
      ok: true,
      isDuplicate: result.isDuplicate,
      duplicateRecordId: result.duplicateRecordId
    } satisfies KeyDuplicateResult
  })

  return () => {
    ipcMain.removeHandler(RECORD_SUBMIT_CHANNEL)
    ipcMain.removeHandler(RECORD_LIST_CHANNEL)
    ipcMain.removeHandler(RECORD_DELETE_CHANNEL)
    ipcMain.removeHandler(RECORD_GET_PROGRESS_CHANNEL)
    ipcMain.removeHandler(RECORD_SAVE_PROGRESS_CHANNEL)
    ipcMain.removeHandler(RECORD_CHECK_KEY_CHANNEL)
  }
}
