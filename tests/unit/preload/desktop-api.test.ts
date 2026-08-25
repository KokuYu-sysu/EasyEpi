import { describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_PREFERENCES,
  PREFERENCES_GET_CHANNEL,
  PREFERENCES_UPDATE_CHANNEL
} from '@shared/preferences-contract'
import { SYSTEM_PING_CHANNEL } from '@shared/system-contract'
import {
  BASELINE_EXPORT_CHANNEL,
  BASELINE_GENERATE_CHANNEL
} from '@shared/baseline-contract'
import { EXPORT_CSV_CHANNEL } from '@shared/export-contract'
import type { DesktopInvoke } from '../../../src/preload/desktop-api'
import { createDesktopApi } from '../../../src/preload/desktop-api'
import { AI_CONFIG_UPDATE_CHANNEL } from '@shared/ai-assistant-contract'

function assertDesktopInvokeShape(invoke: DesktopInvoke, checkCalls: boolean): void {
  if (checkCalls) {
    void invoke(SYSTEM_PING_CHANNEL, { nonce: 'typed' })
    void invoke(PREFERENCES_GET_CHANNEL)
    void invoke(PREFERENCES_UPDATE_CHANNEL, DEFAULT_PREFERENCES)

    // @ts-expect-error preferences:get never accepts a request payload
    void invoke(PREFERENCES_GET_CHANNEL, DEFAULT_PREFERENCES)
    // @ts-expect-error preferences:update always requires a complete snapshot
    void invoke(PREFERENCES_UPDATE_CHANNEL)
    // @ts-expect-error no caller-selected channels are available
    void invoke('preferences:delete')
  }
}

describe('createDesktopApi', () => {
  it('uses a channel-specific invoke contract', () => {
    expect(assertDesktopInvokeShape).toBeTypeOf('function')
  })
  it('invokes only the fixed system ping channel', async () => {
    const invoke = vi.fn().mockResolvedValue({
      nonce: 'n',
      version: '0.1.0',
      platform: 'win32'
    })

    const api = createDesktopApi(invoke)

    await expect(api.system.ping({ nonce: 'n' })).resolves.toMatchObject({ nonce: 'n' })
    expect(invoke).toHaveBeenCalledWith(SYSTEM_PING_CHANNEL, { nonce: 'n' })
    expect(api).not.toHaveProperty('invoke')
  })

  it('freezes the exposed API surface', () => {
    const api = createDesktopApi(vi.fn())

    expect(Object.isFrozen(api)).toBe(true)
    expect(Object.isFrozen(api.system)).toBe(true)
    expect(Object.isFrozen(api.preferences)).toBe(true)
    expect(Object.isFrozen(api.ai)).toBe(true)
    expect(Object.isFrozen(api.ai.config)).toBe(true)
  })

  it('gets preferences through only the fixed get channel and normalizes the response', async () => {
    const rawResult = { ok: true, preferences: { ...DEFAULT_PREFERENCES } }
    const invoke = vi.fn().mockResolvedValue(rawResult)
    const api = createDesktopApi(invoke)

    const result = await api.preferences.get()

    expect(invoke).toHaveBeenCalledWith(PREFERENCES_GET_CHANNEL)
    expect(result).toEqual(rawResult)
    expect(result).not.toBe(rawResult)
    if (result.ok) {
      expect(result.preferences).not.toBe(rawResult.preferences)
    }
  })

  it('validates and sends a complete normalized update snapshot on the fixed channel', async () => {
    const normalized = { ...DEFAULT_PREFERENCES, theme: 'dark' as const }
    const invoke = vi.fn().mockResolvedValue({ ok: true, preferences: normalized })
    const api = createDesktopApi(invoke)

    await api.preferences.update({ ...normalized, rendererOnly: 'discarded' } as typeof normalized)

    expect(invoke).toHaveBeenCalledWith(PREFERENCES_UPDATE_CHANNEL, normalized)
  })

  it('rejects invalid updates before invoking Electron', async () => {
    const invoke = vi.fn()
    const api = createDesktopApi(invoke)

    await expect(
      api.preferences.update({ ...DEFAULT_PREFERENCES, theme: 'blue' } as never)
    ).rejects.toThrow('INVALID_PREFERENCES_REQUEST')
    expect(invoke).not.toHaveBeenCalled()
  })

  it.each([
    ['get', undefined],
    ['update', DEFAULT_PREFERENCES]
  ] as const)(
    'rejects malformed %s responses with one stable public error',
    async (method, request) => {
      const invoke = vi.fn().mockResolvedValue({
        ok: false,
        code: 'EACCES at C:\\Users\\secret\\preferences.json'
      })
      const api = createDesktopApi(invoke)

      const operation = method === 'get' ? api.preferences.get() : api.preferences.update(request!)

      await expect(operation).rejects.toEqual(new Error('INVALID_PREFERENCES_RESPONSE'))
    }
  )

  it('does not expose raw Electron or filesystem capabilities', () => {
    const api = createDesktopApi(vi.fn())

    expect(Object.keys(api)).toEqual([
      'system',
      'preferences',
      'ai',
      'dialog',
      'project',
      'qnaire',
      'derived',
      'record',
      'epidata',
      'admin',
      'exportData',
      'baseline',
      'quality',
      'doubleEntry'
    ])
    for (const forbidden of [
      'invoke',
      'channel',
      'path',
      'userData',
      'ipcRenderer',
      'fs',
      'electron'
    ]) {
      expect(api).not.toHaveProperty(forbidden)
      expect(api.preferences).not.toHaveProperty(forbidden)
    }
  })

  it('never returns the submitted AI API key through the bridge', async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        config: {
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4.1-mini',
          hasApiKey: true,
          maskedApiKey: '••••••••'
        }
      })
      .mockResolvedValueOnce({
        ok: true,
        config: {
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4.1-mini',
          hasApiKey: true,
          maskedApiKey: '********'
        }
      })
    const api = createDesktopApi(invoke)

    const result = await api.ai.config.update({
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4.1-mini',
      apiKey: 'sk-secret'
    })

    expect(invoke).toHaveBeenCalledWith(AI_CONFIG_UPDATE_CHANNEL, {
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4.1-mini',
      apiKey: 'sk-secret'
    })
    expect(JSON.stringify(result)).not.toContain('sk-secret')
    await expect(api.ai.config.get()).rejects.toThrow('INVALID_AI_RESPONSE')
  })

  it('recursively rejects malformed or sensitive AI responses', async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce({ ok: true, accepted: 'yes', acceptedAt: null, notice: 'invalid' })
      .mockResolvedValueOnce({
        ok: true,
        session: {
          manifest: {
            sessionId: '123e4567-e89b-42d3-a456-426614174000',
            title: 'AI',
            versionStamp: {
              promptId: 'assistant', promptVersion: '1', promptHash: 'hash',
              harnessVersion: '1', schemaVersion: 1
            },
            createdAt: '2026-08-25T00:00:00.000Z',
            updatedAt: '2026-08-25T00:00:00.000Z'
          },
          conversation: { messages: [], attachments: {} },
          state: { status: 'idle', runs: {}, values: { nested: { password: 'leak' } } },
          cache: { values: {} },
          artifacts: { byId: {} },
          temp: { runs: {} }
        }
      })
      .mockResolvedValueOnce({
        ok: true,
        requestId: 'request-1',
        attempts: 1,
        artifact: {
          artifactId: 'artifact-1', operationId: 'operation-1', kind: 'other',
          status: 'completed', createdAt: '2026-08-25T00:00:00.000Z',
          updatedAt: '2026-08-25T00:00:00.000Z', value: {}
        }
      })
      .mockResolvedValueOnce({
        ok: true,
        sessions: [{
          manifest: {
            sessionId: '123e4567-e89b-42d3-a456-426614174000',
            title: 'AI',
            versionStamp: {
              promptId: 'assistant', promptVersion: '1', promptHash: 'hash',
              harnessVersion: '1', schemaVersion: 1
            },
            createdAt: '2026-08-25T00:00:00.000Z',
            updatedAt: '2026-08-25T00:00:00.000Z'
          },
          messages: [], attachments: [], status: 'running', activeArtifactId: null, artifacts: []
        }]
      })
    const api = createDesktopApi(invoke)

    await expect(api.ai.privacy.status()).rejects.toThrow('INVALID_AI_RESPONSE')
    await expect(api.ai.session.get({
      sessionId: '123e4567-e89b-42d3-a456-426614174000'
    })).rejects.toThrow('INVALID_AI_RESPONSE')
    await expect(api.ai.send({
      requestId: 'request-1',
      sessionId: '123e4567-e89b-42d3-a456-426614174000',
      content: 'Create',
      includeCurrentQuestionnaire: false
    })).rejects.toThrow('INVALID_AI_RESPONSE')
    await expect(api.ai.session.list()).resolves.toMatchObject({
      ok: true,
      sessions: [{ status: 'running', messages: [], attachments: [], artifacts: [] }]
    })
  })

  it('exposes fixed export and baseline channels with renderer-side request validation', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === BASELINE_GENERATE_CHANNEL) return { headers: [], rows: [] }
      return { success: true }
    })
    const api = createDesktopApi(invoke as unknown as DesktopInvoke)

    await api.exportData.csv({
      outputPath: 'D:/reports/data.csv',
      encoding: 'one_hot',
      scope: 'selected',
      selectedIds: ['record-1']
    })
    await api.baseline.generate({ selectedQuestionIds: ['age'], groupQuestionId: 'arm' })
    await api.baseline.export({ outputPath: 'D:/reports/table.csv', selectedQuestionIds: ['age'] })

    expect(invoke).toHaveBeenCalledWith(EXPORT_CSV_CHANNEL, {
      outputPath: 'D:/reports/data.csv',
      encoding: 'one_hot',
      scope: 'selected',
      selectedIds: ['record-1']
    })
    expect(invoke).toHaveBeenCalledWith(BASELINE_GENERATE_CHANNEL, {
      selectedQuestionIds: ['age'],
      groupQuestionId: 'arm'
    })
    expect(invoke).toHaveBeenCalledWith(BASELINE_EXPORT_CHANNEL, {
      outputPath: 'D:/reports/table.csv',
      selectedQuestionIds: ['age']
    })

    await expect(api.exportData.csv({
      outputPath: 'D:/reports/data.csv',
      encoding: 'one_hot',
      scope: 'all',
      records: [{ id: 'plaintext' }]
    } as never)).rejects.toThrow('INVALID_EXPORT_REQUEST')
    expect(invoke).toHaveBeenCalledTimes(3)
  })
})
