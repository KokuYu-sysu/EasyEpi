/**
 * Official bioRxiv / medRxiv metadata lookup.
 *
 * The two servers share the `10.1101/` DOI prefix, so the landing host is taken from the record's own
 * `server` field instead of being inferred from the DOI. This client never searches: it only verifies
 * a DOI that Europe PMC discovered.
 */

import {
  RESEARCH_LIMITS,
  ResearchContractError,
  isPlainRecord,
  type ResearchDiagnostic,
  type ResearchOutcome
} from './contracts'

export const BIORXIV_DETAILS_ORIGIN = 'https://api.biorxiv.org'

const BIORXIV_USER_AGENT = 'EasyEpi/0.8.0 (questionnaire research; +https://github.com/)'

const DEFAULT_MAX_RESPONSE_BYTES = 2_000_000
const MAX_RETRY_AFTER_MS = 5_000
const RETRY_DELAYS_MS = [500, 1_000] as const

const MAX_DOI_LENGTH = 300
const MAX_TITLE_LENGTH = RESEARCH_LIMITS.maxTitleLength
const MAX_AUTHOR_STRING_LENGTH = 8_192
const MAX_VERSION_LENGTH = 32
const MAX_URL_LENGTH = 2_048
const MIN_YEAR = 1800
const MAX_YEAR = 2200

export type PreprintServer = 'bioRxiv' | 'medRxiv'

export interface PreprintMetadata {
  server: PreprintServer
  doi: string
  title: string
  authors: string[]
  year?: number
  version: string
  landingUrl: string
  published?: string
}

export interface PreprintLookupRequest {
  server: PreprintServer
  doi: string
}

export interface PreprintLookupResult {
  metadata?: PreprintMetadata
  diagnostic: ResearchDiagnostic
}

export interface PreprintClient {
  lookup(request: PreprintLookupRequest, signal?: AbortSignal): Promise<PreprintLookupResult>
}

export interface PreprintClientOptions {
  fetch?: typeof fetch
  maxResponseBytes?: number
  now?: () => number
  wait?: (ms: number, signal?: AbortSignal) => Promise<void>
}

/** Path order is server first, then DOI, and the DOI is percent-encoded as one path segment. */
export function buildPreprintDetailsPath(server: PreprintServer, doi: string): string {
  return `/details/${server.toLowerCase()}/${encodeURIComponent(doi)}`
}

export function buildPreprintDetailsUrl(server: PreprintServer, doi: string): string {
  return `${BIORXIV_DETAILS_ORIGIN}${buildPreprintDetailsPath(server, doi)}`
}

/**
 * The host follows the record's server field. `bioRxiv` maps to `biorxiv.org`, and the `medRxiv`
 * spelling lower-cases to `medrxiv.org`.
 */
export function buildPreprintLandingUrl(server: PreprintServer, doi: string, version: string | undefined): string {
  const host = server === 'medRxiv' ? 'https://www.medrxiv.org' : 'https://www.biorxiv.org'
  const suffix = version === undefined || version.length === 0 ? '' : `v${version}`
  return `${host}/content/${doi}${suffix}`
}

class PreprintPayloadTooLargeError extends Error {
  constructor() {
    super('BIORXIV_RESPONSE_TOO_LARGE')
    this.name = 'PreprintPayloadTooLargeError'
  }
}

interface TransportOptions {
  fetcher: typeof fetch
  maxResponseBytes: number
  now: () => number
  wait: (ms: number, signal?: AbortSignal) => Promise<void>
  signal?: AbortSignal
}

interface TransportState {
  retryCount: number
  cancelled: boolean
}

interface RawResponse {
  payload?: unknown
  status?: number
  errorCode?: string
}

function field(record: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isPlainRecord(value) ? value : undefined
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function firstItem(value: unknown): unknown {
  const items = asArray(value)
  return items.length > 0 ? items[0] : undefined
}

function textField(value: unknown, maxLength = Number.MAX_SAFE_INTEGER): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > maxLength) return undefined
  return trimmed
}

function isCancelled(options: TransportOptions, state: TransportState): boolean {
  if (state.cancelled) return true
  if (options.signal?.aborted === true) {
    state.cancelled = true
    return true
  }
  return false
}

function retryDelayMs(attempt: number): number {
  return RETRY_DELAYS_MS[attempt] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1] ?? 1_000
}

function capRetryAfter(response: Response): number | undefined {  const raw = response.headers.get('retry-after')
  if (raw === null) return undefined
  const seconds = Number(raw.trim())
  if (!Number.isFinite(seconds) || seconds < 0) return undefined
  const milliseconds = Math.ceil(seconds * 1_000)
  return milliseconds > MAX_RETRY_AFTER_MS ? undefined : milliseconds
}

async function readBounded(response: Response, maxBytes: number, signal?: AbortSignal): Promise<string> {
  const declared = response.headers.get('content-length')
  if (declared !== null) {
    const declaredBytes = Number(declared.trim())
    if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
      await response.body?.cancel().catch(() => undefined)
      throw new PreprintPayloadTooLargeError()
    }
  }
  const body = response.body
  if (body === null) return ''
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  let failed = false
  const cancelReader = (): void => {
    void reader.cancel().catch(() => undefined)
  }
  signal?.addEventListener('abort', cancelReader, { once: true })
  try {
    for (;;) {
      const next = await reader.read()
      if (signal?.aborted === true) throw new Error('BIORXIV_ABORTED')
      if (next.done === true) break
      const chunk = next.value
      size += chunk.byteLength
      if (size > maxBytes) {
        failed = true
        await reader.cancel().catch(() => undefined)
        throw new PreprintPayloadTooLargeError()
      }
      chunks.push(chunk)
    }
  } catch (error) {
    cancelReader()
    throw error
  } finally {
    signal?.removeEventListener('abort', cancelReader)
    if (failed) reader.releaseLock()
  }
  const merged = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(merged)
}

function isRetryable(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599)
}

/**
 * Each attempt owns a fresh `AbortController`; the caller's signal is forwarded to it, so an abort
 * cancels the in-flight attempt and every later one without ever handing an already-aborted signal
 * to `fetch`.
 */
async function requestDetails(
  url: string,
  options: TransportOptions,
  state: TransportState
): Promise<RawResponse> {
  for (let attempt = 0; ; attempt += 1) {
    if (isCancelled(options, state)) return { errorCode: 'AI_CANCELLED' }
    const controller = new AbortController()
    let response: Response
    const forwardAbort = (): void => controller.abort()
    options.signal?.addEventListener('abort', forwardAbort, { once: true })
    try {
      response = await options.fetcher(url, {
        method: 'GET',
        headers: { accept: 'application/json', 'user-agent': BIORXIV_USER_AGENT },
        redirect: 'follow',
        signal: controller.signal
      })
    } catch {
      return { errorCode: isCancelled(options, state) ? 'AI_CANCELLED' : 'AI_NETWORK_ERROR' }
    } finally {
      options.signal?.removeEventListener('abort', forwardAbort)
    }
    if (isCancelled(options, state)) {
      await response.body?.cancel().catch(() => undefined)
      return { errorCode: 'AI_CANCELLED' }
    }
    if (response.redirected === true) {
      await response.body?.cancel().catch(() => undefined)
      return { status: response.status, errorCode: 'AI_REDIRECT_REJECTED' }
    }
    if (!response.ok) {
      if (isRetryable(response.status) && attempt < RETRY_DELAYS_MS.length) {
        const retryAfter = capRetryAfter(response)
        await response.body?.cancel().catch(() => undefined)
        state.retryCount += 1
        await options.wait(retryAfter ?? retryDelayMs(attempt), options.signal)
        continue
      }
      await response.body?.cancel().catch(() => undefined)
      return { status: response.status, errorCode: 'AI_HTTP_ERROR' }
    }
    try {
      const text = await readBounded(response, options.maxResponseBytes, options.signal)
      const payload = JSON.parse(text) as unknown
      return { payload, status: response.status }
    } catch (error) {
      if (isCancelled(options, state)) return { status: response.status, errorCode: 'AI_CANCELLED' }
      if (error instanceof PreprintPayloadTooLargeError) {
        return { status: response.status, errorCode: 'AI_RESPONSE_TOO_LARGE' }
      }
      return { status: response.status, errorCode: 'AI_INVALID_RESPONSE' }
    }
  }
}

/** Authors arrive as one semicolon-separated string, never as an array. */
export function splitPreprintAuthors(authors: string): string[] {
  const names: string[] = []
  for (const part of authors.split(';')) {
    const name = part.trim()
    if (name.length === 0 || name.length > RESEARCH_LIMITS.maxAuthorLength) continue
    names.push(name)
    if (names.length >= RESEARCH_LIMITS.maxAuthors) break
  }
  return names
}

/** Derives the publication year from a `YYYY-MM-DD` date, tolerating a malformed value. */
export function parsePreprintYear(date: string | undefined): number | undefined {
  if (date === undefined) return undefined
  const match = /^(\d{4})-\d{2}-\d{2}$/.exec(date.trim())
  if (match?.[1] === undefined) return undefined
  const year = Number(match[1])
  if (!Number.isSafeInteger(year) || year < MIN_YEAR || year > MAX_YEAR) return undefined
  return year
}

function toServer(value: unknown, fallback: PreprintServer): PreprintServer {
  if (typeof value !== 'string') return fallback
  const normalized = value.trim().toLowerCase()
  if (normalized === 'biorxiv') return 'bioRxiv'
  if (normalized === 'medrxiv') return 'medRxiv'
  return fallback
}

/** `published` is the journal DOI once the preprint is published; the literal `NA` means "not yet". */
function toPublished(value: unknown): string | undefined {
  const published = textField(value, MAX_DOI_LENGTH)
  if (published === undefined) return undefined
  return published.toLowerCase() === 'na' ? undefined : published
}

/**
 * The details API carries some scalars as strings and some as numbers depending on the record age,
 * so `version` and `date` are coerced before the length and format checks.
 */
function coercedString(value: unknown, maxLength: number): string | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : undefined
  }
  return textField(value, maxLength)
}

function toMetadata(value: unknown, request: PreprintLookupRequest): PreprintMetadata | undefined {
  const record = asRecord(value)
  if (record === undefined) return undefined
  const doi = textField(field(record, 'doi'), MAX_DOI_LENGTH) ?? request.doi
  const title = textField(field(record, 'title'), MAX_TITLE_LENGTH)
  if (title === undefined) return undefined
  const server = toServer(field(record, 'server'), request.server)
  const authors = splitPreprintAuthors(textField(field(record, 'authors'), MAX_AUTHOR_STRING_LENGTH) ?? '')
  const version = coercedString(field(record, 'version'), MAX_VERSION_LENGTH)
  const year = parsePreprintYear(coercedString(field(record, 'date'), 64))
  const published = toPublished(field(record, 'published'))
  const landingUrl = buildPreprintLandingUrl(server, doi, version)
  if (landingUrl.length > MAX_URL_LENGTH) return undefined

  return {
    server,
    doi,
    title,
    authors,
    version: version === undefined ? '' : String(version),
    landingUrl,
    ...(year === undefined ? {} : { year }),
    ...(published === undefined ? {} : { published })
  }
}

export function createPreprintClient(options: PreprintClientOptions = {}): PreprintClient {
  const fetcher = options.fetch ?? fetch
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES
  // `now` is accepted for symmetry with the Europe PMC client. The retry delay is fixed at 500 ms and
  // 1,000 ms, so no clock reading is required yet.
  const now = options.now ?? ((): number => Date.now())
  const wait = options.wait ?? ((ms: number, signal?: AbortSignal): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort)
        resolve()
      }, ms)
      const onAbort = (): void => {
        clearTimeout(timer)
        reject(new Error('BIORXIV_ABORTED'))
      }
      signal?.addEventListener('abort', onAbort, { once: true })
    }))

  return {
    async lookup(request, signal) {
      if (signal?.aborted === true) throw new ResearchContractError('AI_CANCELLED')
      const doi = request.doi.trim()
      if (doi.length === 0 || doi.length > MAX_DOI_LENGTH) {
        throw new ResearchContractError('AI_RESEARCH_SOURCE_INVALID')
      }

      const state: TransportState = { retryCount: 0, cancelled: false }
      const transport: TransportOptions = { fetcher, maxResponseBytes, now, wait, signal }
      const response = await requestDetails(buildPreprintDetailsUrl(request.server, doi), transport, state)
      if (response.errorCode === 'AI_CANCELLED') throw new ResearchContractError('AI_CANCELLED')

      const diagnosticFor = (outcome: ResearchOutcome): ResearchDiagnostic => ({
        stage: 'literature',
        protocol: 'biorxiv',
        outcome,
        ...(response.status === undefined ? {} : { status: response.status }),
        ...(outcome === 'failed' || outcome === 'invalid' ? {} : { sourceCount: 1 }),
        retryCount: state.retryCount,
        ...(outcome === 'failed' || outcome === 'invalid'
          ? { errorCode: response.errorCode ?? 'AI_INVALID_RESPONSE' }
          : {})
      })
      // `no posts found` and an empty collection are the documented "this DOI is not on the server"
      // answers, not failures.
      const emptyDiagnostic = (): ResearchDiagnostic => ({
        stage: 'literature',
        protocol: 'biorxiv',
        outcome: 'empty',
        ...(response.status === undefined ? {} : { status: response.status }),
        sourceCount: 0,
        retryCount: state.retryCount
      })

      if (response.payload === undefined) {
        return { diagnostic: diagnosticFor('failed') }
      }

      const root = asRecord(response.payload)
      if (root === undefined) return { diagnostic: diagnosticFor('invalid') }

      const status = textField(asRecord(firstItem(field(root, 'messages')))?.status, 64)
      const collection = asArray(field(root, 'collection'))
      if ((status !== undefined && status.toLowerCase() === 'no posts found') || collection.length === 0) {
        return { diagnostic: emptyDiagnostic() }
      }

      const metadata = toMetadata(collection[0], { server: request.server, doi })
      if (metadata === undefined) return { diagnostic: diagnosticFor('invalid') }
      return { metadata, diagnostic: diagnosticFor('success') }
    }
  }
}
