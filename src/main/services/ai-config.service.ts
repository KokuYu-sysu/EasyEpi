import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import path from 'node:path'

import type {
  AIProviderId,
  AIProviderConfigErrorCode,
  AIProviderConfigResult,
  AIProviderConfigUpdate,
  AIProviderConfigView
} from '@shared/ai-assistant-contract'
import {
  AI_MASKED_API_KEY,
  AI_PRIVACY_NOTICE_VERSION,
  isAIProviderId
} from '@shared/ai-assistant-contract'
import { detectAIProviderId } from '@shared/ai-provider-profiles'

const CONFIG_FILE_NAME = 'ai-provider-config.json'
const DEFAULT_BASE_URL = 'https://api.openai.com/v1'
const MAX_BASE_URL_LENGTH = 2_048
const MAX_MODEL_LENGTH = 200
const MAX_API_KEY_LENGTH = 8_192

interface StoredAIConfig {
  schemaVersion: 1 | 2
  providerId: AIProviderId
  baseUrl: string
  model: string
  webSearchEnabled: boolean
  encryptedApiKey?: string
  privacyAcceptedAt?: string
  privacyNoticeVersion?: number
}

export interface AISecureStorage {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
}

export interface AIMainConfig {
  providerId?: AIProviderId
  baseUrl: string
  model: string
  webSearchEnabled?: boolean
  apiKey?: string
}

export interface AIConfigService {
  get(): Promise<AIProviderConfigResult>
  update(request: AIProviderConfigUpdate): Promise<AIProviderConfigResult>
  clear(): Promise<AIProviderConfigResult>
  /** Main-process only. Never expose this method through a shared bridge. */
  getPlaintextForMain(): Promise<AIMainConfig>
  getPrivacyStatus(): Promise<{ accepted: boolean; acceptedAt: string | null }>
  acceptPrivacy(): Promise<{ accepted: true; acceptedAt: string }>
}

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function isStrictBase64(value: string): boolean {
  return value.length > 0 && value.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(value)
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 0x1f || code === 0x7f) return true
  }
  return false
}

export function normalizeAIBaseUrl(value: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_BASE_URL_LENGTH ||
    value !== value.trim() ||
    value.includes('%') ||
    value.includes('\\') ||
    hasControlCharacter(value)
  ) {
    throw new Error('INVALID_AI_BASE_URL')
  }

  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('INVALID_AI_BASE_URL')
  }

  if (
    (url.protocol !== 'https:' && url.protocol !== 'http:') ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.hash.length > 0 ||
    url.search.length > 0
  ) {
    throw new Error('INVALID_AI_BASE_URL')
  }

  if (url.protocol === 'http:') {
    const authority = value.slice('http://'.length).split('/')[0] ?? ''
    if (!/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i.test(authority)) {
      throw new Error('INVALID_AI_BASE_URL')
    }
  }

  const normalizedPath = url.pathname.replace(/\/+$/, '')
  return `${url.origin}${normalizedPath}`
}

export function validateAIConfigUpdate(request: unknown): AIProviderConfigUpdate {
  if (!isPlainObject(request)) throw new Error('INVALID_AI_CONFIG')

  const { providerId, baseUrl, model, webSearchEnabled, apiKey } = request
  if (
    typeof baseUrl !== 'string' ||
    typeof model !== 'string' ||
    model !== model.trim() ||
    model.length === 0 ||
    model.length > MAX_MODEL_LENGTH ||
    hasControlCharacter(model) ||
    (providerId !== undefined && !isAIProviderId(providerId)) ||
    (webSearchEnabled !== undefined && typeof webSearchEnabled !== 'boolean') ||
    (apiKey !== undefined && apiKey !== null && typeof apiKey !== 'string') ||
    (typeof apiKey === 'string' && (apiKey.length > MAX_API_KEY_LENGTH || apiKey.includes('\0')))
  ) {
    throw new Error('INVALID_AI_CONFIG')
  }

  const normalized: AIProviderConfigUpdate = {
    providerId: providerId ?? detectAIProviderId(baseUrl),
    baseUrl: normalizeAIBaseUrl(baseUrl),
    model,
    webSearchEnabled: webSearchEnabled ?? false
  }
  if (apiKey !== undefined) normalized.apiKey = apiKey
  return normalized
}

function parseStoredAIConfig(value: unknown): StoredAIConfig {
  if (!isPlainObject(value)) throw new Error('INVALID_AI_CONFIG_FILE')
  const {
    schemaVersion, providerId, baseUrl, model, webSearchEnabled,
    encryptedApiKey, privacyAcceptedAt, privacyNoticeVersion
  } = value
  if (
    (schemaVersion !== 1 && schemaVersion !== 2) ||
    (schemaVersion === 2 && !isAIProviderId(providerId)) ||
    (schemaVersion === 2 && typeof webSearchEnabled !== 'boolean') ||
    typeof baseUrl !== 'string' ||
    typeof model !== 'string' ||
    (encryptedApiKey !== undefined &&
      (typeof encryptedApiKey !== 'string' || !isStrictBase64(encryptedApiKey))) ||
    (privacyAcceptedAt !== undefined &&
      (typeof privacyAcceptedAt !== 'string' || !Number.isFinite(Date.parse(privacyAcceptedAt)))) ||
    (privacyNoticeVersion !== undefined &&
      (!Number.isSafeInteger(privacyNoticeVersion) || Number(privacyNoticeVersion) < 1))
  ) {
    throw new Error('INVALID_AI_CONFIG_FILE')
  }

  const validated = model.length === 0
    ? { baseUrl: normalizeAIBaseUrl(baseUrl), model }
    : validateAIConfigUpdate({ baseUrl, model })
  return {
    schemaVersion,
    providerId: schemaVersion === 1 ? detectAIProviderId(validated.baseUrl) : providerId as AIProviderId,
    baseUrl: validated.baseUrl,
    model: validated.model,
    webSearchEnabled: schemaVersion === 1 ? false : webSearchEnabled as boolean,
    ...(encryptedApiKey === undefined ? {} : { encryptedApiKey }),
    ...(privacyAcceptedAt === undefined ? {} : { privacyAcceptedAt }),
    ...(privacyNoticeVersion === undefined ? {} : { privacyNoticeVersion: Number(privacyNoticeVersion) })
  }
}

function configView(config: StoredAIConfig): AIProviderConfigView {
  const hasApiKey = config.encryptedApiKey !== undefined
  return {
    providerId: config.providerId,
    baseUrl: config.baseUrl,
    model: config.model,
    webSearchEnabled: config.webSearchEnabled,
    hasApiKey,
    maskedApiKey: hasApiKey ? AI_MASKED_API_KEY : null
  }
}

function emptyConfig(): StoredAIConfig {
  return {
    schemaVersion: 2,
    providerId: 'openai',
    baseUrl: DEFAULT_BASE_URL,
    model: '',
    webSearchEnabled: false
  }
}

async function electronSafeStorage(): Promise<AISecureStorage> {
  const { safeStorage } = await import('electron')
  return safeStorage
}

export function createAIConfigService(
  userDataDirectory: string,
  injectedSecureStorage?: AISecureStorage
): AIConfigService {
  const configPath = path.join(userDataDirectory, CONFIG_FILE_NAME)
  let writeTail: Promise<void> = Promise.resolve()

  async function secureStorage(): Promise<AISecureStorage> {
    return injectedSecureStorage ?? electronSafeStorage()
  }

  async function readStored(): Promise<StoredAIConfig> {
    let contents: string
    try {
      contents = await readFile(configPath, 'utf8')
    } catch (error) {
      if (isMissingFile(error)) return emptyConfig()
      // eslint-disable-next-line preserve-caught-error -- Filesystem details may expose user paths.
      throw new Error('AI_CONFIG_READ_FAILED')
    }

    try {
      return parseStoredAIConfig(JSON.parse(contents))
    } catch {
      throw new Error('AI_CONFIG_READ_FAILED')
    }
  }

  async function writeStored(config: StoredAIConfig): Promise<void> {
    await mkdir(userDataDirectory, { recursive: true })
    const temporaryPath = path.join(
      userDataDirectory,
      `EasyEpi-ai-provider-${process.pid}-${randomUUID()}.tmp`
    )
    let created = false
    try {
      const handle = await open(temporaryPath, 'wx')
      created = true
      try {
        await handle.writeFile(`${JSON.stringify({ ...config, schemaVersion: 2 })}\n`, 'utf8')
        await handle.sync()
      } finally {
        await handle.close()
      }
      await rename(temporaryPath, configPath)
      created = false
    } catch {
      if (created) await unlink(temporaryPath).catch(() => undefined)
      throw new Error('AI_CONFIG_SAVE_FAILED')
    }
  }

  function serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = writeTail.then(operation, operation)
    writeTail = result.then(() => undefined, () => undefined)
    return result
  }

  async function get(): Promise<AIProviderConfigResult> {
    try {
      return { ok: true, config: configView(await readStored()) }
    } catch {
      return { ok: false, code: 'AI_CONFIG_READ_FAILED' }
    }
  }

  function update(request: AIProviderConfigUpdate): Promise<AIProviderConfigResult> {
    return serialize(async () => {
      let validated: AIProviderConfigUpdate
      try {
        validated = validateAIConfigUpdate(request)
      } catch {
        return { ok: false, code: 'INVALID_AI_CONFIG' }
      }

      let encryptedApiKey: string | undefined
      let privacyAcceptedAt: string | undefined
      let privacyNoticeVersion: number | undefined
      try {
        const current = await readStored()
        encryptedApiKey = validated.apiKey === undefined &&
          validated.providerId === current.providerId &&
          validated.baseUrl === current.baseUrl
          ? current.encryptedApiKey
          : undefined
        privacyAcceptedAt = current.privacyAcceptedAt
        privacyNoticeVersion = current.privacyNoticeVersion
      } catch {
        return { ok: false, code: 'AI_CONFIG_READ_FAILED' }
      }

      if (validated.apiKey !== undefined) {
        const key = validated.apiKey?.trim() ?? ''
        if (key.length === 0) {
          encryptedApiKey = undefined
        } else {
          let storage: AISecureStorage
          try {
            storage = await secureStorage()
            if (!storage.isEncryptionAvailable()) {
              return { ok: false, code: 'AI_SECURE_STORAGE_UNAVAILABLE' }
            }
            encryptedApiKey = storage.encryptString(key).toString('base64')
          } catch {
            return { ok: false, code: 'AI_SECURE_STORAGE_UNAVAILABLE' }
          }
        }
      }

      const stored: StoredAIConfig = {
        schemaVersion: 2,
        providerId: validated.providerId!,
        baseUrl: validated.baseUrl,
        model: validated.model,
        webSearchEnabled: validated.webSearchEnabled!,
        ...(encryptedApiKey === undefined ? {} : { encryptedApiKey }),
        ...(privacyAcceptedAt === undefined ? {} : { privacyAcceptedAt }),
        ...(privacyNoticeVersion === undefined ? {} : { privacyNoticeVersion })
      }
      try {
        await writeStored(stored)
        return { ok: true, config: configView(stored) }
      } catch {
        return { ok: false, code: 'AI_CONFIG_SAVE_FAILED' }
      }
    })
  }

  function clear(): Promise<AIProviderConfigResult> {
    return serialize(async () => {
      let privacyAcceptedAt: string | undefined
      let privacyNoticeVersion: number | undefined
      try {
        const current = await readStored()
        if (current.privacyNoticeVersion === AI_PRIVACY_NOTICE_VERSION) {
          privacyAcceptedAt = current.privacyAcceptedAt
          privacyNoticeVersion = current.privacyNoticeVersion
        }
      } catch {
        return { ok: false, code: 'AI_CONFIG_READ_FAILED' }
      }
      if (privacyAcceptedAt !== undefined) {
        try {
          await writeStored({
            ...emptyConfig(),
            privacyAcceptedAt,
            ...(privacyNoticeVersion === undefined ? {} : { privacyNoticeVersion })
          })
        } catch {
          return { ok: false, code: 'AI_CONFIG_SAVE_FAILED' }
        }
      } else {
        try {
          await unlink(configPath)
        } catch (error) {
          if (!isMissingFile(error)) return { ok: false, code: 'AI_CONFIG_SAVE_FAILED' }
        }
      }
      return { ok: true, config: configView(emptyConfig()) }
    })
  }

  async function getPlaintextForMain(): Promise<AIMainConfig> {
    const stored = await readStored()
    if (stored.encryptedApiKey === undefined) {
      return {
        providerId: stored.providerId,
        baseUrl: stored.baseUrl,
        model: stored.model,
        webSearchEnabled: stored.webSearchEnabled
      }
    }

    let storage: AISecureStorage
    try {
      storage = await secureStorage()
      if (!storage.isEncryptionAvailable()) throw new Error('UNAVAILABLE')
      const apiKey = storage.decryptString(Buffer.from(stored.encryptedApiKey, 'base64'))
      return {
        providerId: stored.providerId,
        baseUrl: stored.baseUrl,
        model: stored.model,
        webSearchEnabled: stored.webSearchEnabled,
        apiKey
      }
    } catch {
      const code: AIProviderConfigErrorCode = 'AI_SECURE_STORAGE_UNAVAILABLE'
      throw new Error(code)
    }
  }

  async function getPrivacyStatus(): Promise<{ accepted: boolean; acceptedAt: string | null }> {
    const stored = await readStored()
    const acceptedAt = stored.privacyNoticeVersion === AI_PRIVACY_NOTICE_VERSION
      ? (stored.privacyAcceptedAt ?? null)
      : null
    return { accepted: acceptedAt !== null, acceptedAt }
  }

  function acceptPrivacy(): Promise<{ accepted: true; acceptedAt: string }> {
    return serialize(async () => {
      const stored = await readStored()
      if (stored.privacyAcceptedAt !== undefined &&
        stored.privacyNoticeVersion === AI_PRIVACY_NOTICE_VERSION) {
        return { accepted: true, acceptedAt: stored.privacyAcceptedAt }
      }
      const acceptedAt = new Date().toISOString()
      await writeStored({
        ...stored,
        privacyAcceptedAt: acceptedAt,
        privacyNoticeVersion: AI_PRIVACY_NOTICE_VERSION
      })
      return { accepted: true, acceptedAt }
    })
  }

  return { get, update, clear, getPlaintextForMain, getPrivacyStatus, acceptPrivacy }
}
