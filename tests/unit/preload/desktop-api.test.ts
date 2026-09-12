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
import {
  AI_CONFIG_UPDATE_CHANNEL,
  AI_PROGRESS_CHANNEL
} from '@shared/ai-assistant-contract'

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

  it('subscribes to only the fixed AI progress channel and filters the exact request scope', () => {
    const listeners = new Map<string, (event: unknown, value: unknown) => void>()
    const on = vi.fn((channel: string, listener: (event: unknown, value: unknown) => void) => {
      listeners.set(channel, listener)
    })
    const removeListener = vi.fn()
    const api = createDesktopApi(vi.fn(), { on, removeListener })
    const callback = vi.fn()

    api.ai.onProgress({ requestId: 'request-1', sessionId: '123e4567-e89b-42d3-a456-426614174000' }, callback)

    expect(on).toHaveBeenCalledOnce()
    expect(on).toHaveBeenCalledWith(AI_PROGRESS_CHANNEL, expect.any(Function))
    const listener = listeners.get(AI_PROGRESS_CHANNEL)!
    listener({}, {
      type: 'started', requestId: 'other-request',
      sessionId: '123e4567-e89b-42d3-a456-426614174000', runId: 'run-1',
      at: '2026-08-29T00:00:00.000Z'
    })
    listener({}, {
      type: 'started', requestId: 'request-1',
      sessionId: '16fd2706-8baf-433b-82eb-8c7fada847da', runId: 'run-1',
      at: '2026-08-29T00:00:00.000Z'
    })
    const expected = {
      type: 'started', requestId: 'request-1',
      sessionId: '123e4567-e89b-42d3-a456-426614174000', runId: 'run-1',
      at: '2026-08-29T00:00:00.000Z'
    }
    listener({}, expected)

    expect(callback).toHaveBeenCalledOnce()
    expect(callback).toHaveBeenCalledWith(expected)
  })

  it('rejects invalid progress scopes before listening and ignores malformed event payloads', () => {
    let listener: ((event: unknown, value: unknown) => void) | undefined
    const events = {
      on: vi.fn((_channel: string, value: (event: unknown, payload: unknown) => void) => {
        listener = value
      }),
      removeListener: vi.fn()
    }
    const api = createDesktopApi(vi.fn(), events)
    const callback = vi.fn()

    expect(() => api.ai.onProgress({
      requestId: 'request-1',
      sessionId: '123e4567-e89b-42d3-a456-426614174000',
      extra: 'unsafe'
    } as never, callback)).toThrow('INVALID_AI_REQUEST')
    expect(events.on).not.toHaveBeenCalled()

    api.ai.onProgress({
      requestId: 'request-1', sessionId: '123e4567-e89b-42d3-a456-426614174000'
    }, callback)
    listener!({}, {
      type: 'assistant_delta', requestId: 'request-1',
      sessionId: '123e4567-e89b-42d3-a456-426614174000', runId: 'run-1',
      at: '2026-08-29T00:00:00.000Z', attempt: 1, sequence: 0, delta: 'ok',
      apiKey: 'sk-unsafe'
    })
    listener!({}, {
      type: 'assistant_delta', requestId: 'request-1',
      sessionId: '123e4567-e89b-42d3-a456-426614174000', runId: 'run-1',
      at: '2026-08-29T00:00:00.000Z', attempt: 1, sequence: -1, delta: 'unsafe'
    })

    expect(callback).not.toHaveBeenCalled()
  })

  it('supports subscribe-before-send and removes the exact listener only once', async () => {
    const order: string[] = []
    let listener: ((event: unknown, value: unknown) => void) | undefined
    const events = {
      on: vi.fn((_channel: string, value: (event: unknown, payload: unknown) => void) => {
        order.push('subscribe')
        listener = value
      }),
      removeListener: vi.fn((_channel: string, value: (event: unknown, payload: unknown) => void) => {
        expect(value).toBe(listener)
        order.push('unsubscribe')
      })
    }
    const invoke = vi.fn(async () => {
      order.push('send')
      return { ok: false, errorCode: 'AI_CANCELLED', message: 'AI 请求已取消。' }
    })
    const api = createDesktopApi(invoke as unknown as DesktopInvoke, events)

    const unsubscribe = api.ai.onProgress({
      requestId: 'request-1', sessionId: '123e4567-e89b-42d3-a456-426614174000'
    }, vi.fn())
    await api.ai.send({
      requestId: 'request-1', sessionId: '123e4567-e89b-42d3-a456-426614174000',
      content: 'Create', includeCurrentQuestionnaire: false
    })
    unsubscribe()
    unsubscribe()

    expect(order).toEqual(['subscribe', 'send', 'unsubscribe'])
    expect(events.removeListener).toHaveBeenCalledOnce()
    expect(events.removeListener).toHaveBeenCalledWith(AI_PROGRESS_CHANNEL, listener)
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
    const configView = {
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-v4-flash',
      hasApiKey: true,
      maskedApiKey: '••••••••'
    }
    const invoke = vi.fn()
      .mockResolvedValueOnce({ ok: true, config: configView })
      // A stale bridge answer that still carries the removed provider picker and search toggle, or an
      // unmasked key, must be rejected instead of reaching the renderer.
      .mockResolvedValueOnce({
        ok: true,
        config: {
          ...configView,
          providerId: 'deepseek',
          webSearchEnabled: true,
          maskedApiKey: 'sk-secret'
        }
      })
    const api = createDesktopApi(invoke)

    const result = await api.ai.config.update({
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-v4-flash',
      apiKey: 'sk-secret'
    })

    expect(invoke).toHaveBeenCalledWith(AI_CONFIG_UPDATE_CHANNEL, {
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-v4-flash',
      apiKey: 'sk-secret'
    })
    expect(result).toEqual({ ok: true, config: configView })
    expect(JSON.stringify(result)).not.toContain('sk-secret')
    await expect(api.ai.config.get()).rejects.toThrow('INVALID_AI_RESPONSE')
  })

  it('clears session cache through one fixed validated channel', async () => {
    const sessionId = '123e4567-e89b-42d3-a456-426614174000'
    const invoke = vi.fn()
      .mockResolvedValueOnce({ ok: true, removed: 2 })
      .mockResolvedValueOnce({ ok: true, removed: -1 })
    const api = createDesktopApi(invoke)
    const clearCache = (api.ai.session as unknown as {
      clearCache(request: { sessionId: string }): Promise<{ ok: true; removed: number }>
    }).clearCache

    await expect(clearCache({ sessionId })).resolves.toEqual({ ok: true, removed: 2 })
    expect(invoke).toHaveBeenCalledWith('ai:session:clearCache', { sessionId })
    await expect(clearCache({ sessionId })).rejects.toThrow('INVALID_AI_RESPONSE')
  })

  it('recursively rejects malformed or sensitive AI responses', async () => {
    const manifest = {
      sessionId: '123e4567-e89b-42d3-a456-426614174000',
      title: 'AI',
      versionStamp: {
        promptId: 'assistant', promptVersion: '1', promptHash: 'hash',
        harnessVersion: '1', schemaVersion: 1
      },
      createdAt: '2026-08-25T00:00:00.000Z',
      updatedAt: '2026-08-25T00:00:00.000Z'
    }
    const invoke = vi.fn()
      .mockResolvedValueOnce({ ok: true, accepted: 'yes', acceptedAt: null, notice: 'invalid' })
      .mockResolvedValueOnce({
        ok: true,
        session: {
          manifest,
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
        sessions: [manifest]
      })
      .mockResolvedValueOnce({
        ok: true,
        session: {
          manifest,
          messages: [{
            id: 'message-1', role: 'user', content: 'Create',
            createdAt: '2026-08-25T00:00:00.000Z', clarification: null
          }],
          attachments: [{
            attachmentId: 'attachment-1', messageId: 'message-1', kind: 'questionnaire',
            createdAt: '2026-08-25T00:00:00.000Z'
          }],
          status: 'running', activeArtifactId: null, activeRun: null, failures: [],
          artifacts: [], total: 1, nextOffset: null
        }
      })
      .mockResolvedValueOnce({
        ok: true,
        session: {
          manifest,
          messages: Array.from({ length: 11 }, (_, index) => ({
            id: `message-${index}`, role: 'assistant', content: 'x'.repeat(100_000),
            createdAt: '2026-08-25T00:00:00.000Z', clarification: null
          })),
          attachments: [], status: 'completed', activeArtifactId: null,
          activeRun: null, failures: [], artifacts: [], total: 11, nextOffset: null
        }
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
      sessions: [{ sessionId: manifest.sessionId, title: 'AI' }]
    })
    await expect(api.ai.session.get({ sessionId: manifest.sessionId })).resolves.toMatchObject({
      ok: true,
      session: {
        messages: [{ content: 'Create' }],
        attachments: [{ attachmentId: 'attachment-1' }],
        total: 1,
        nextOffset: null
      }
    })
    await expect(api.ai.session.get({ sessionId: manifest.sessionId, limit: 100 }))
      .rejects.toThrow('INVALID_AI_RESPONSE')
    await expect(api.ai.session.get({ sessionId: manifest.sessionId, limit: 101 }))
      .rejects.toThrow('INVALID_AI_REQUEST')
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
