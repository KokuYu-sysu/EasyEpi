import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import path from 'node:path'

import type {
  AIProviderConfigErrorCode,
  AIProviderConfigResult,
  AIProviderConfigUpdate,
  AIProviderConfigView
} from '@shared/ai-assistant-contract'
import { AI_MASKED_API_KEY, AI_PRIVACY_NOTICE_VERSION } from '@shared/ai-assistant-contract'
import {
  DEEPSEEK_BASE_URL,
  DEEPSEEK_DEFAULT_MODEL,
  detectAIProviderId
} from '@shared/ai-provider-profiles'

const CONFIG_FILE_NAME = 'ai-provider-config.json'
const DEFAULT_BASE_URL = DEEPSEEK_BASE_URL
const MAX_BASE_URL_LENGTH = 2_048
const MAX_MODEL_LENGTH = 200
const MAX_API_KEY_LENGTH = 8_192
/** An NCBI E-utilities key is a short opaque token; 200 characters is far above any issued value. */
const MAX_NCBI_API_KEY_LENGTH = 200

/**
 * Schema v3 drops `providerId` and `webSearchEnabled`: EasyEpi supports exactly one provider, and
 * retrieval is a mandatory pipeline stage rather than a user preference.
 *
 * Schema v4 adds the optional `encryptedNcbiApiKey`. It is independent of the chat provider, so it is
 * kept (and never dropped) when the Base URL is not DeepSeek. Records written by v1/v2/v3 have no
 * NCBI key at all, which is a fully valid state.
 */
const CURRENT_SCHEMA_VERSION = 4

interface StoredAIConfig {
  schemaVersion: number
  baseUrl: string
  model: string
  encryptedApiKey?: string
  encryptedNcbiApiKey?: string
  privacyAcceptedAt?: string
  privacyNoticeVersion?: number
}

export interface AISecureStorage {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
}

export interface AIMainConfig {
  baseUrl: string
  model: string
  apiKey?: string
  /** Optional PubMed/NCBI E-utilities key. Independent of the chat provider. */
  ncbiApiKey?: string
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

  const { baseUrl, model, apiKey, ncbiApiKey } = request
  if (
    typeof baseUrl !== 'string' ||
    typeof model !== 'string' ||
    model !== model.trim() ||
    model.length === 0 ||
    model.length > MAX_MODEL_LENGTH ||
    hasControlCharacter(model) ||
    (apiKey !== undefined && apiKey !== null && typeof apiKey !== 'string') ||
    (typeof apiKey === 'string' && (apiKey.length > MAX_API_KEY_LENGTH || apiKey.includes('\0'))) ||
    (ncbiApiKey !== undefined && ncbiApiKey !== null && typeof ncbiApiKey !== 'string') ||
    (typeof ncbiApiKey === 'string' &&
      (ncbiApiKey.length > MAX_NCBI_API_KEY_LENGTH ||
        ncbiApiKey.includes('\0') ||
        hasControlCharacter(ncbiApiKey)))
  ) {
    throw new Error('INVALID_AI_CONFIG')
  }

  const normalized: AIProviderConfigUpdate = {
    baseUrl: normalizeAIBaseUrl(baseUrl),
    model
  }
  if (apiKey !== undefined) normalized.apiKey = apiKey
  if (ncbiApiKey !== undefined) normalized.ncbiApiKey = ncbiApiKey
  return normalized
}

/**
 * Accepts schema v1 (single-vendor, no provider field), v2 (providerId + webSearchEnabled), v3 and v4.
 * Every legacy shape is normalized onto the single supported provider: a stored base URL that does
 * not resolve to DeepSeek is replaced, its model id is reset, and its encrypted chat key is dropped
 * because a key issued elsewhere is useless here. The optional NCBI key is provider-independent, so it
 * is preserved across that rewrite and absent keys are always valid.
 */
function parseStoredAIConfig(value: unknown): StoredAIConfig {
  if (!isPlainObject(value)) throw new Error('INVALID_AI_CONFIG_FILE')
  const {
    schemaVersion, baseUrl, model, encryptedApiKey, encryptedNcbiApiKey,
    privacyAcceptedAt, privacyNoticeVersion
  } = value
  if (
    schemaVersion !== 1 && schemaVersion !== 2 && schemaVersion !== 3 &&
      schemaVersion !== CURRENT_SCHEMA_VERSION ||
    typeof baseUrl !== 'string' ||
    typeof model !== 'string' ||
    (encryptedApiKey !== undefined &&
      (typeof encryptedApiKey !== 'string' || !isStrictBase64(encryptedApiKey))) ||
    (encryptedNcbiApiKey !== undefined &&
      (typeof encryptedNcbiApiKey !== 'string' || !isStrictBase64(encryptedNcbiApiKey))) ||
    (privacyAcceptedAt !== undefined &&
      (typeof privacyAcceptedAt !== 'string' || !Number.isFinite(Date.parse(privacyAcceptedAt)))) ||
    (privacyNoticeVersion !== undefined &&
      (!Number.isSafeInteger(privacyNoticeVersion) || Number(privacyNoticeVersion) < 1))
  ) {
    throw new Error('INVALID_AI_CONFIG_FILE')
  }

  let storedBaseUrl: string
  try {
    storedBaseUrl = normalizeAIBaseUrl(baseUrl)
  } catch {
    throw new Error('INVALID_AI_CONFIG_FILE')
  }
  const belongsToDeepSeek = detectAIProviderId(storedBaseUrl) === 'deepseek'

  let normalizedModel: string
  if (model.length === 0) {
    normalizedModel = ''
  } else {
    if (model !== model.trim() || model.length > MAX_MODEL_LENGTH || hasControlCharacter(model)) {
      throw new Error('INVALID_AI_CONFIG_FILE')
    }
    normalizedModel = belongsToDeepSeek ? model : DEEPSEEK_DEFAULT_MODEL
  }

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    baseUrl: belongsToDeepSeek ? storedBaseUrl : DEFAULT_BASE_URL,
    model: normalizedModel,
    ...(belongsToDeepSeek && encryptedApiKey !== undefined ? { encryptedApiKey } : {}),
    ...(encryptedNcbiApiKey === undefined ? {} : { encryptedNcbiApiKey }),
    ...(privacyAcceptedAt === undefined ? {} : { privacyAcceptedAt }),
    ...(privacyNoticeVersion === undefined ? {} : { privacyNoticeVersion: Number(privacyNoticeVersion) })
  }
}

function configView(config: StoredAIConfig): AIProviderConfigView {
  const hasApiKey = config.encryptedApiKey !== undefined
  const hasNcbiApiKey = config.encryptedNcbiApiKey !== undefined
  return {
    baseUrl: config.baseUrl,
    model: config.model,
    hasApiKey,
    maskedApiKey: hasApiKey ? AI_MASKED_API_KEY : null,
    hasNcbiApiKey,
    maskedNcbiApiKey: hasNcbiApiKey ? AI_MASKED_API_KEY : null
  }
}

/**
 * Encrypts one optional credential with the same mechanism as the chat key. `undefined` preserves
 * whatever is stored, while `null` or an empty string clears it. `null` is also returned when secure
 * storage cannot encrypt, which the caller maps onto `AI_SECURE_STORAGE_UNAVAILABLE`.
 */
async function encryptOptionalKey(
  submitted: string | null | undefined,
  secureStorage: () => Promise<AISecureStorage>
): Promise<string | undefined | null> {
  if (submitted === undefined) return undefined
  const key = submitted?.trim() ?? ''
  if (key.length === 0) return undefined
  try {
    const storage = await secureStorage()
    if (!storage.isEncryptionAvailable()) return null
    return storage.encryptString(key).toString('base64')
  } catch {
    return null
  }
}

function emptyConfig(): StoredAIConfig {
  return { schemaVersion: CURRENT_SCHEMA_VERSION, baseUrl: DEFAULT_BASE_URL, model: '' }
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
        await handle.writeFile(
          `${JSON.stringify({ ...config, schemaVersion: CURRENT_SCHEMA_VERSION })}\n`,
          'utf8'
        )
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

      // The endpoint is fixed by the provider contract; a caller-supplied host is accepted only when
      // it is the DeepSeek host, so a renderer bug cannot redirect credentials or requests.
      const baseUrl = detectAIProviderId(validated.baseUrl) === 'deepseek'
        ? validated.baseUrl
        : DEFAULT_BASE_URL

      let encryptedApiKey: string | undefined
      let storedNcbiApiKey: string | undefined
      let privacyAcceptedAt: string | undefined
      let privacyNoticeVersion: number | undefined
      try {
        const current = await readStored()
        encryptedApiKey = validated.apiKey === undefined && baseUrl === current.baseUrl
          ? current.encryptedApiKey
          : undefined
        storedNcbiApiKey = current.encryptedNcbiApiKey
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

      // The NCBI key is independent of the chat provider, so an omitted value keeps it stored even
      // when the Base URL changes.
      const encryptedNcbiApiKey = validated.ncbiApiKey === undefined
        ? storedNcbiApiKey
        : await encryptOptionalKey(validated.ncbiApiKey, secureStorage)
      if (encryptedNcbiApiKey === null) {
        return { ok: false, code: 'AI_SECURE_STORAGE_UNAVAILABLE' }
      }

      const stored: StoredAIConfig = {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        baseUrl,
        model: validated.model,
        ...(encryptedApiKey === undefined ? {} : { encryptedApiKey }),
        ...(encryptedNcbiApiKey === undefined ? {} : { encryptedNcbiApiKey }),
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
    if (stored.encryptedApiKey === undefined && stored.encryptedNcbiApiKey === undefined) {
      return { baseUrl: stored.baseUrl, model: stored.model }
    }

    let storage: AISecureStorage
    try {
      storage = await secureStorage()
      if (!storage.isEncryptionAvailable()) throw new Error('UNAVAILABLE')
    } catch {
      const code: AIProviderConfigErrorCode = 'AI_SECURE_STORAGE_UNAVAILABLE'
      throw new Error(code)
    }

    try {
      return {
        baseUrl: stored.baseUrl,
        model: stored.model,
        ...(stored.encryptedApiKey === undefined
          ? {}
          : { apiKey: storage.decryptString(Buffer.from(stored.encryptedApiKey, 'base64')) }),
        ...(stored.encryptedNcbiApiKey === undefined
          ? {}
          : { ncbiApiKey: storage.decryptString(Buffer.from(stored.encryptedNcbiApiKey, 'base64')) })
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
