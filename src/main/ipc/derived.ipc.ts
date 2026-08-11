import type { QuestionnaireDef } from '@shared/types/qnaire'
import { getDerivedVariables } from '@shared/types/qnaire'
import type { DerivedVariableDef } from '@shared/types/derived'
import {
  DERIVED_GET_ALL_CHANNEL,
  DERIVED_VALIDATE_CHANNEL,
  DERIVED_PREVIEW_CHANNEL,
  DERIVED_ADD_CHANNEL,
  DERIVED_UPDATE_CHANNEL,
  DERIVED_DELETE_CHANNEL,
  DERIVED_REORDER_CHANNEL,
  parseDerivedValidateRequest,
  parseDerivedPreviewRequest,
  parseDerivedAddRequest,
  parseDerivedUpdateRequest,
  parseDerivedDeleteRequest,
  parseDerivedReorderRequest,
  type DerivedListResult,
  type DerivedValidateResult,
  type DerivedPreviewResult
} from '@shared/derived-contract'
import type { FormulaError } from '@shared/derived'

import { DerivedService } from '../services/derived/derived.service'
import type { ProjectIpcState } from './project.ipc'
import { type IpcMainLike, type IpcInvokeEventLike, assertTrustedSender } from './types'

type DerivedCrudResult =
  | { ok: true; derivedVariables: DerivedVariableDef[] }
  | { ok: false; errors?: FormulaError[] }

export function registerDerivedIpc(
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
  }

  function list(): DerivedListResult {
    return { ok: true, derivedVariables: [...getDerivedVariables(getQnaire())] }
  }

  function mutate(qnaire: QuestionnaireDef): DerivedCrudResult {
    setQnaire(qnaire)
    return { ok: true, derivedVariables: [...getDerivedVariables(qnaire)] }
  }

  ipcMain.handle(DERIVED_GET_ALL_CHANNEL, async (event: IpcInvokeEventLike) => {
    assertTrustedSender(event, packagedRendererUrl, developmentOrigin)
    return list()
  })

  ipcMain.handle(DERIVED_VALIDATE_CHANNEL, async (event: IpcInvokeEventLike, rawRequest: unknown) => {
    assertTrustedSender(event, packagedRendererUrl, developmentOrigin)
    const request = parseDerivedValidateRequest(rawRequest)
    const validation = new DerivedService().validateFormula(request.formula, getQnaire())
    return {
      ok: validation.ok,
      ...(validation.ok
        ? { inferredType: validation.inferredType }
        : { errors: validation.errors })
    } satisfies DerivedValidateResult
  })

  ipcMain.handle(DERIVED_PREVIEW_CHANNEL, async (event: IpcInvokeEventLike, rawRequest: unknown) => {
    assertTrustedSender(event, packagedRendererUrl, developmentOrigin)
    const request = parseDerivedPreviewRequest(rawRequest)
    return new DerivedService().previewResult(
      request.formula,
      getQnaire(),
      request.sampleAnswers
    ) satisfies DerivedPreviewResult
  })

  ipcMain.handle(DERIVED_ADD_CHANNEL, async (event: IpcInvokeEventLike, rawRequest: unknown) => {
    assertTrustedSender(event, packagedRendererUrl, developmentOrigin)
    const request = parseDerivedAddRequest(rawRequest)
    const result = DerivedService.addDerivedVariable(getQnaire(), request.variable)
    if (!result.ok) return { ok: false, errors: result.errors } satisfies DerivedCrudResult
    return mutate(result.qnaire)
  })

  ipcMain.handle(DERIVED_UPDATE_CHANNEL, async (event: IpcInvokeEventLike, rawRequest: unknown) => {
    assertTrustedSender(event, packagedRendererUrl, developmentOrigin)
    const request = parseDerivedUpdateRequest(rawRequest)
    const result = DerivedService.updateDerivedVariable(getQnaire(), request.id, request.patch)
    if (!result.ok) return { ok: false, errors: result.errors } satisfies DerivedCrudResult
    return mutate(result.qnaire)
  })

  ipcMain.handle(DERIVED_DELETE_CHANNEL, async (event: IpcInvokeEventLike, rawRequest: unknown) => {
    assertTrustedSender(event, packagedRendererUrl, developmentOrigin)
    const request = parseDerivedDeleteRequest(rawRequest)
    return mutate(DerivedService.deleteDerivedVariable(getQnaire(), request.id))
  })

  ipcMain.handle(DERIVED_REORDER_CHANNEL, async (event: IpcInvokeEventLike, rawRequest: unknown) => {
    assertTrustedSender(event, packagedRendererUrl, developmentOrigin)
    const request = parseDerivedReorderRequest(rawRequest)
    return mutate(DerivedService.reorderDerivedVariables(getQnaire(), request.ids))
  })

  return () => {
    ipcMain.removeHandler(DERIVED_GET_ALL_CHANNEL)
    ipcMain.removeHandler(DERIVED_VALIDATE_CHANNEL)
    ipcMain.removeHandler(DERIVED_PREVIEW_CHANNEL)
    ipcMain.removeHandler(DERIVED_ADD_CHANNEL)
    ipcMain.removeHandler(DERIVED_UPDATE_CHANNEL)
    ipcMain.removeHandler(DERIVED_DELETE_CHANNEL)
    ipcMain.removeHandler(DERIVED_REORDER_CHANNEL)
  }
}
