import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  createAIConfigService,
  type AISecureStorage
} from '@main/services/ai-config.service'

const directories: string[] = []
const secureStorage: AISecureStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(value, 'utf8'),
  decryptString: (value) => value.toString('utf8')
}

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'easyepi-ai-config-v2-'))
  directories.push(directory)
  return directory
}

afterEach(() => {
  while (directories.length > 0) {
    rmSync(directories.pop()!, { recursive: true, force: true })
  }
})

describe('AI configuration version 2', () => {
  it('reads a version 1 configuration as a detected provider without rewriting it', async () => {
    const directory = temporaryDirectory()
    const configPath = join(directory, 'ai-provider-config.json')
    writeFileSync(configPath, JSON.stringify({
      schemaVersion: 1,
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-v4-flash',
      encryptedApiKey: Buffer.from('secret').toString('base64')
    }))

    const service = createAIConfigService(directory, secureStorage)

    await expect(service.get()).resolves.toEqual({
      ok: true,
      config: {
        providerId: 'deepseek',
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-v4-flash',
        webSearchEnabled: false,
        hasApiKey: true,
        maskedApiKey: '••••••••'
      }
    })
    expect(JSON.parse(readFileSync(configPath, 'utf8')).schemaVersion).toBe(1)
  })

  it('writes provider identity and search preference using schema version 2', async () => {
    const directory = temporaryDirectory()
    const service = createAIConfigService(directory, secureStorage)

    await expect(service.update({
      providerId: 'qwen',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/',
      model: 'qwen-plus',
      webSearchEnabled: true,
      apiKey: 'secret'
    })).resolves.toMatchObject({
      ok: true,
      config: {
        providerId: 'qwen',
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        model: 'qwen-plus',
        webSearchEnabled: true,
        hasApiKey: true
      }
    })

    expect(JSON.parse(readFileSync(join(directory, 'ai-provider-config.json'), 'utf8'))).toMatchObject({
      schemaVersion: 2,
      providerId: 'qwen',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      model: 'qwen-plus',
      webSearchEnabled: true
    })
  })

  it('preserves a key only when both provider and normalized Base URL stay unchanged', async () => {
    const directory = temporaryDirectory()
    const service = createAIConfigService(directory, secureStorage)
    await service.update({
      providerId: 'custom',
      baseUrl: 'https://gateway.example/v1',
      model: 'model-a',
      webSearchEnabled: false,
      apiKey: 'secret'
    })

    await service.update({
      providerId: 'custom',
      baseUrl: 'https://gateway.example/v1/',
      model: 'model-b',
      webSearchEnabled: false
    })
    await expect(service.getPlaintextForMain()).resolves.toMatchObject({ apiKey: 'secret' })

    await service.update({
      providerId: 'openai',
      baseUrl: 'https://gateway.example/v1',
      model: 'model-b',
      webSearchEnabled: false
    })
    await expect(service.getPlaintextForMain()).resolves.toEqual({
      providerId: 'openai',
      baseUrl: 'https://gateway.example/v1',
      model: 'model-b',
      webSearchEnabled: false
    })
  })
})
