import type { QuestionnaireDef, QuestionDef, ConditionRule } from '@shared/types/qnaire'
import {
  QNAIRE_ADD_QUESTION_CHANNEL,
  QNAIRE_UPDATE_QUESTION_CHANNEL,
  QNAIRE_DELETE_QUESTION_CHANNEL,
  QNAIRE_REORDER_QUESTIONS_CHANNEL,
  QNAIRE_ADD_CONDITION_CHANNEL,
  QNAIRE_UPDATE_CONDITION_CHANNEL,
  QNAIRE_DELETE_CONDITION_CHANNEL,
  QNAIRE_GET_DATA_CHANNEL,
  QNAIRE_UPDATE_META_CHANNEL
} from '@shared/qnaire-contract'

import type { ProjectIpcState } from './project.ipc'
import type { IpcMainLike, IpcInvokeEventLike } from './types'
import { assertTrustedSender } from './types'
import {
  addQuestion,
  updateQuestion,
  deleteQuestion,
  reorderQuestions,
  addConditionRule,
  updateConditionRule,
  deleteConditionRule
} from '../services/qnaire.service'
import { refreshQuestionnaireRevision } from '../services/project.service'

export function registerQnaireIpc(
  ipcMain: IpcMainLike,
  state: ProjectIpcState,
  packagedRendererUrl: string,
  developmentOrigin?: string
): () => void {
  function getQnaire(): QuestionnaireDef {
    if (!state.currentProject) throw new Error('NO_PROJECT_OPEN')
    return state.currentProject.questionnaire
  }

  function setQnaire(qnaire: QuestionnaireDef): void {
    if (!state.currentProject) throw new Error('NO_PROJECT_OPEN')
    state.currentProject.questionnaire = qnaire
    refreshQuestionnaireRevision(state.currentProject)
  }

  ipcMain.handle(QNAIRE_GET_DATA_CHANNEL, async (event: IpcInvokeEventLike) => {
    assertTrustedSender(event, packagedRendererUrl, developmentOrigin)
    const qnaire = getQnaire()
    return {
      questions: qnaire.questions,
      conditionRules: qnaire.conditionRules,
      keyQuestionIds: qnaire.keyQuestionIds,
      derivedVariables: qnaire.derivedVariables ?? [],
      name: qnaire.name,
      description: qnaire.description
    }
  })

  ipcMain.handle(QNAIRE_ADD_QUESTION_CHANNEL, async (event: IpcInvokeEventLike, rawQuestion: unknown) => {
    assertTrustedSender(event, packagedRendererUrl, developmentOrigin)
    const question = rawQuestion as QuestionDef
    const qnaire = getQnaire()
    const updated = addQuestion(qnaire, question)
    setQnaire(updated)
    return { ok: true, question }
  })

  ipcMain.handle(QNAIRE_UPDATE_QUESTION_CHANNEL, async (event: IpcInvokeEventLike, rawArgs: unknown) => {
    assertTrustedSender(event, packagedRendererUrl, developmentOrigin)
    const { id, patch } = rawArgs as { id: string; patch: Partial<QuestionDef> }
    const qnaire = getQnaire()
    const updated = updateQuestion(qnaire, id, patch)
    setQnaire(updated)
    return { ok: true }
  })

  ipcMain.handle(QNAIRE_DELETE_QUESTION_CHANNEL, async (event: IpcInvokeEventLike, rawId: unknown) => {
    assertTrustedSender(event, packagedRendererUrl, developmentOrigin)
    const id = rawId as string
    const qnaire = getQnaire()
    const updated = deleteQuestion(qnaire, id)
    setQnaire(updated)
    return { ok: true }
  })

  ipcMain.handle(QNAIRE_REORDER_QUESTIONS_CHANNEL, async (event: IpcInvokeEventLike, rawIds: unknown) => {
    assertTrustedSender(event, packagedRendererUrl, developmentOrigin)
    const ids = rawIds as string[]
    const qnaire = getQnaire()
    const updated = reorderQuestions(qnaire, ids)
    setQnaire(updated)
    return { ok: true }
  })

  ipcMain.handle(QNAIRE_ADD_CONDITION_CHANNEL, async (event: IpcInvokeEventLike, rawRule: unknown) => {
    assertTrustedSender(event, packagedRendererUrl, developmentOrigin)
    const rule = rawRule as ConditionRule
    const qnaire = getQnaire()
    const updated = addConditionRule(qnaire, rule)
    setQnaire(updated)
    return { ok: true, rule }
  })

  ipcMain.handle(QNAIRE_UPDATE_CONDITION_CHANNEL, async (event: IpcInvokeEventLike, rawArgs: unknown) => {
    assertTrustedSender(event, packagedRendererUrl, developmentOrigin)
    const { id, patch } = rawArgs as { id: string; patch: Partial<ConditionRule> }
    const qnaire = getQnaire()
    const updated = updateConditionRule(qnaire, id, patch)
    setQnaire(updated)
    return { ok: true }
  })

  ipcMain.handle(QNAIRE_DELETE_CONDITION_CHANNEL, async (event: IpcInvokeEventLike, rawId: unknown) => {
    assertTrustedSender(event, packagedRendererUrl, developmentOrigin)
    const id = rawId as string
    const qnaire = getQnaire()
    const updated = deleteConditionRule(qnaire, id)
    setQnaire(updated)
    return { ok: true }
  })

  ipcMain.handle(QNAIRE_UPDATE_META_CHANNEL, async (event: IpcInvokeEventLike, rawArgs: unknown) => {
    assertTrustedSender(event, packagedRendererUrl, developmentOrigin)
    const { name, description } = rawArgs as { name?: string; description?: string }
    const qnaire = getQnaire()
    if (name !== undefined || description !== undefined) {
      setQnaire({
        ...qnaire,
        ...(name === undefined ? {} : { name }),
        ...(description === undefined ? {} : { description })
      })
    }
    return { ok: true }
  })

  return () => {
    ipcMain.removeHandler(QNAIRE_GET_DATA_CHANNEL)
    ipcMain.removeHandler(QNAIRE_ADD_QUESTION_CHANNEL)
    ipcMain.removeHandler(QNAIRE_UPDATE_QUESTION_CHANNEL)
    ipcMain.removeHandler(QNAIRE_DELETE_QUESTION_CHANNEL)
    ipcMain.removeHandler(QNAIRE_REORDER_QUESTIONS_CHANNEL)
    ipcMain.removeHandler(QNAIRE_ADD_CONDITION_CHANNEL)
    ipcMain.removeHandler(QNAIRE_UPDATE_CONDITION_CHANNEL)
    ipcMain.removeHandler(QNAIRE_DELETE_CONDITION_CHANNEL)
    ipcMain.removeHandler(QNAIRE_UPDATE_META_CHANNEL)
  }
}
