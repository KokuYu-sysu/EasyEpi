import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  createAIConfigService,
  type AISecureStorage
} from '@main/services/ai-config.service'
import { DEEPSEEK_BASE_URL, DEEPSEEK_DEFAULT_MODEL } from '@shared/ai-provider-profiles'

const directories: string[] = []
const secureStorage: AISecureStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(value, 'utf8'),
  decryptString: (value) => value.toString('utf8')
}

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'easyepi-ai-config-v3-'))
  directories.push(directory)
  return directory
}

function configPathOf(directory: string): string {
  return join(directory, 'ai-provider-config.json')
}

function readStoredConfig(directory: string): Record<string, unknown> {
  return JSON.parse(readFileSync(configPathOf(directory), 'utf8')) as Record<string, unknown>
}

afterEach(() => {
  while (directories.length > 0) {
    rmSync(directories.pop()!, { recursive: true, force: true })
  }
})

describe('AI configuration schema version 3', () => {
  it('reads a version 1 configuration on the DeepSeek host without rewriting the file', async () => {
    const directory = temporaryDirectory()
    const configPath = configPathOf(directory)
    writeFileSync(configPath, JSON.stringify({
      schemaVersion: 1,
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-v4-pro',
      encryptedApiKey: Buffer.from('secret').toString('base64')
    }))

    const service = createAIConfigService(directory, secureStorage)

    await expect(service.get()).resolves.toEqual({
      ok: true,
      config: {
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-v4-pro',
        hasApiKey: true,
        maskedApiKey: '••••••••'
      }
    })
    await expect(service.getPlaintextForMain()).resolves.toEqual({
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-v4-pro',
      apiKey: 'secret'
    })
    // Reading never rewrites the stored file; migration happens on the next write.
    expect(readStoredConfig(directory).schemaVersion).toBe(1)
  })

  it('migrates a version 2 configuration from another provider onto DeepSeek and drops its key', async () => {
    const directory = temporaryDirectory()
    writeFileSync(configPathOf(directory), JSON.stringify({
      schemaVersion: 2,
      providerId: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o',
      webSearchEnabled: true,
      encryptedApiKey: Buffer.from('foreign-secret').toString('base64')
    }))

    const service = createAIConfigService(directory, secureStorage)

    await expect(service.get()).resolves.toEqual({
      ok: true,
      config: {
        baseUrl: DEEPSEEK_BASE_URL,
        model: DEEPSEEK_DEFAULT_MODEL,
        hasApiKey: false,
        maskedApiKey: null
      }
    })
    await expect(service.getPlaintextForMain()).resolves.toEqual({
      baseUrl: DEEPSEEK_BASE_URL,
      model: DEEPSEEK_DEFAULT_MODEL
    })
  })

  it('writes only the single-provider fields using schema version 3', async () => {
    const directory = temporaryDirectory()
    const service = createAIConfigService(directory, secureStorage)

    await expect(service.update({
      baseUrl: 'https://api.deepseek.com/v1/',
      model: 'deepseek-v4-pro',
      apiKey: 'secret'
    })).resolves.toMatchObject({
      ok: true,
      config: {
        baseUrl: 'https://api.deepseek.com/v1',
        model: 'deepseek-v4-pro',
        hasApiKey: true,
        maskedApiKey: '••••••••'
      }
    })

    expect(readStoredConfig(directory)).toEqual({
      schemaVersion: 3,
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-v4-pro',
      encryptedApiKey: Buffer.from('secret', 'utf8').toString('base64')
    })
    expect(readStoredConfig(directory)).not.toHaveProperty('providerId')
    expect(readStoredConfig(directory)).not.toHaveProperty('webSearchEnabled')
  })

  it('coerces a caller-supplied non-DeepSeek base URL to the DeepSeek endpoint', async () => {
    const directory = temporaryDirectory()
    const service = createAIConfigService(directory, secureStorage)

    await expect(service.update({
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/',
      model: 'qwen-plus',
      apiKey: 'secret'
    })).resolves.toMatchObject({
      ok: true,
      config: {
        baseUrl: DEEPSEEK_BASE_URL,
        model: 'qwen-plus',
        hasApiKey: true,
        maskedApiKey: '••••••••'
      }
    })

    expect(readStoredConfig(directory)).toMatchObject({
      schemaVersion: 3,
      baseUrl: DEEPSEEK_BASE_URL,
      model: 'qwen-plus'
    })
    await expect(service.getPlaintextForMain()).resolves.toEqual({
      baseUrl: DEEPSEEK_BASE_URL,
      model: 'qwen-plus',
      apiKey: 'secret'
    })
  })

  it('preserves a key only when the key is omitted and the normalized Base URL is unchanged', async () => {
    const directory = temporaryDirectory()
    const service = createAIConfigService(directory, secureStorage)
    await service.update({
      baseUrl: 'https://api.deepseek.com',
      model: 'model-a',
      apiKey: 'secret'
    })

    // A trailing slash normalizes onto the stored Base URL, so the key survives.
    await service.update({
      baseUrl: 'https://api.deepseek.com/',
      model: 'model-b'
    })
    await expect(service.getPlaintextForMain()).resolves.toEqual({
      baseUrl: 'https://api.deepseek.com',
      model: 'model-b',
      apiKey: 'secret'
    })

    // A different normalized Base URL clears the key even though the host is still DeepSeek.
    await expect(service.update({
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'model-c'
    })).resolves.toMatchObject({
      ok: true,
      config: { baseUrl: 'https://api.deepseek.com/v1', hasApiKey: false, maskedApiKey: null }
    })
    await expect(service.getPlaintextForMain()).resolves.toEqual({
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'model-c'
    })
  })
})
