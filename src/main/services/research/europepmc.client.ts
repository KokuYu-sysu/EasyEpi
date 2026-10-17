/**
 * Europe PMC preprint discovery.
 *
 * bioRxiv and medRxiv publish no keyword-search API: their own API is limited to date ranges and DOI
 * lookups. Europe PMC indexes both servers and does support keyword search, so it performs discovery
 * here while the official servers later verify the metadata (`preprint.client.ts`).
 *
 * One request per query, and the page is only read until the source budget is full. Terminal
 * pagination on Europe PMC is unreliable because the final page may echo the request cursor, and a
 * single un-paginated page already satisfies `RESEARCH_LIMITS.maxSources`.
 */

import {
  RESEARCH_LIMITS,
  ResearchContractError,
  isPlainRecord,
  parseLiteratureSource,
  type LiteratureSource,
  type ResearchDiagnostic,
  type ResearchOutcome
} from './contracts'

export const EUROPEPMC_SEARCH_ORIGIN = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search'

/** Host carrying both servers' preprints. `source` is `PPR` for bioRxiv and medRxiv alike. */
const EUROPEPMC_PREPRINT_SOURCE = 'PPR'

const EUROPEPMC_USER_AGENT = 'EasyEpi/0.8.0 (questionnaire research; +https://github.com/)'

const DEFAULT_PAGE_SIZE = 25
const DEFAULT_MAX_RESPONSE_BYTES = 4_000_000
const MAX_RETRY_AFTER_MS = 5_000
const RETRY_DELAYS_MS = [500, 1_000] as const

const MAX_RECORD_PUBLICATION_TYPES = 20
const MAX_DOI_LENGTH = 300
const MAX_PMID_LENGTH = 32
const PMID_PATTERN = /^\d{1,12}$/
const MAX_URL_LENGTH = 2_048
const MIN_YEAR = 1800
const MAX_YEAR = 2200

export interface EuropePmcSearchRequest {
  queries: readonly string[]
}

export interface EuropePmcSearchResult {
  sources: LiteratureSource[]
  diagnostics: ResearchDiagnostic[]
}

/**
 * Europe PMC indexes both preprint servers and MEDLINE. `PPR` is the preprint source; `MED` is the
 * MEDLINE/PubMed record set, which makes it a reachable stand-in for PubMed E-utilities when the NCBI
 * host is blocked or throttled from the user's network.
 */
export type EuropePmcSource = 'PPR' | 'MED'

export interface EuropePmcClient {
  searchPreprints(request: EuropePmcSearchRequest, signal?: AbortSignal): Promise<EuropePmcSearchResult>
  /**
   * MEDLINE records through Europe PMC. Optional on the interface so existing test doubles stay
   * valid; `createEuropePmcClient` always provides it.
   */
  searchMedline?(request: EuropePmcSearchRequest, signal?: AbortSignal): Promise<EuropePmcSearchResult>
}

export interface EuropePmcClientOptions {
  fetch?: typeof fetch
  maxResponseBytes?: number
  pageSize?: number
  maxSources?: number
  now?: () => number
  wait?: (ms: number, signal?: AbortSignal) => Promise<void>
}

/**
 * Turns one caller-supplied query into a Europe PMC title/abstract clause.
 *
 * The previous form wrapped the *entire* query in one phrase search —
 * `(TITLE_ABS:"chronic disease AND aged AND China")` — which searches for those words in that order
 * as literal text and matches nothing. Since the planner is asked for Boolean queries, that silently
 * emptied Europe PMC: measured against the live API the old form returns 0 hits where the correct
 * form returns 6017.
 *
 * `AND` now separates terms, each becoming its own `TITLE_ABS` clause. An explicitly quoted phrase
 * keeps its phrase semantics; an unquoted multi-word term is conjoined word by word, which is the
 * recall-friendly reading and is what a title/abstract search wants.
 */
function titleAbstractClause(query: string): string {
  const parts = query
    .split(/\s+AND\s+/i)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)

  const clauses: string[] = []
  for (const part of parts) {
    const quoted = /^".*"$/.test(part) && part.length > 2
    if (quoted) {
      clauses.push(`TITLE_ABS:${part}`)
      continue
    }
    const words = part.replaceAll(/^"|"$/g, '').split(/\s+/).filter((word) => word.length > 0)
    if (words.length === 0) continue
    clauses.push(words.map((word) => `TITLE_ABS:"${word}"`).join(' AND '))
  }

  // A query that produced nothing usable falls back to its own text as a phrase, so a caller can
  // never inject an empty or dangling clause into the expression.
  if (clauses.length === 0) return `TITLE_ABS:"${query.replaceAll('"', '')}"`
  return clauses.join(' AND ')
}

export function buildEuropePmcQuery(query: string, source: EuropePmcSource = EUROPEPMC_PREPRINT_SOURCE): URLSearchParams {
  const parameters = new URLSearchParams()
  parameters.set('query', `(${titleAbstractClause(query)}) AND SRC:${source}`)
  parameters.set('format', 'json')
  parameters.set('resultType', 'core')
  parameters.set('sort', 'P_PDATE_D desc')
  parameters.set('cursorMark', '*')
  return parameters
}

export function buildEuropePmcSearchUrl(
  query: string,
  pageSize: number,
  source: EuropePmcSource = EUROPEPMC_PREPRINT_SOURCE
): string {
  const parameters = buildEuropePmcQuery(query, source)
  parameters.set('pageSize', String(pageSize))
  return `${EUROPEPMC_SEARCH_ORIGIN}?${parameters.toString()}`
}

export function buildEuropePmcArticleUrl(
  id: string,
  source: EuropePmcSource = EUROPEPMC_PREPRINT_SOURCE
): string {
  return `https://europepmc.org/article/${source}/${id}`
}

class EuropePmcPayloadTooLargeError extends Error {
  constructor() {
    super('EUROPEPMC_RESPONSE_TOO_LARGE')
    this.name = 'EuropePmcPayloadTooLargeError'
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

interface PreprintCandidate {
  sourceId: string
  kind: 'epmc'
  server?: 'bioRxiv' | 'medRxiv'
  title: string
  abstract: string
  authors: string[]
  journal?: string
  year?: number
  doi?: string
  url: string
  publicationTypes: string[]
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

/** Reads one optional string field, honouring an optional length bound. */
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

function capRetryAfter(response: Response): number | undefined {
  const raw = response.headers.get('retry-after')
  if (raw === null) return undefined
  const seconds = Number(raw.trim())
  if (!Number.isFinite(seconds) || seconds < 0) return undefined
  const milliseconds = Math.ceil(seconds * 1_000)
  return milliseconds > MAX_RETRY_AFTER_MS ? undefined : milliseconds
}

async function readBounded(
  response: Response,
  maxBytes: number,
  signal?: AbortSignal
): Promise<string> {
  const declared = response.headers.get('content-length')
  if (declared !== null) {
    const declaredBytes = Number(declared.trim())
    if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
      await response.body?.cancel().catch(() => undefined)
      throw new EuropePmcPayloadTooLargeError()
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
      if (signal?.aborted === true) throw new Error('EUROPEPMC_ABORTED')
      if (next.done === true) break
      const chunk = next.value
      size += chunk.byteLength
      if (size > maxBytes) {
        failed = true
        await reader.cancel().catch(() => undefined)
        throw new EuropePmcPayloadTooLargeError()
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
 * Performs one GET with up to two retries. The request is a single page: there is no pagination
 * loop, so the injected `wait`/`now` pair only ever paces a 429/5xx retry.
 *
 * Each attempt owns a fresh `AbortController`; the caller's signal is forwarded to it, so an abort
 * cancels the in-flight attempt and every later one without ever handing an already-aborted signal
 * to `fetch`.
 */
async function requestPage(url: string, options: TransportOptions, state: TransportState): Promise<RawResponse> {
  for (let attempt = 0; ; attempt += 1) {
    if (isCancelled(options, state)) return { errorCode: 'AI_CANCELLED' }
    const controller = new AbortController()
    let response: Response
    const forwardAbort = (): void => controller.abort()
    options.signal?.addEventListener('abort', forwardAbort, { once: true })
    try {
      response = await options.fetcher(url, {
        method: 'GET',
        headers: { accept: 'application/json', 'user-agent': EUROPEPMC_USER_AGENT },
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
      if (error instanceof EuropePmcPayloadTooLargeError) {
        return { status: response.status, errorCode: 'AI_RESPONSE_TOO_LARGE' }
      }
      return { status: response.status, errorCode: 'AI_INVALID_RESPONSE' }
    }
  }
}

/**
 * Splits Europe PMC's flat `authorString` and bounds it. Europe PMC usually separates authors with
 * `', '` and sometimes with `';'`; both are honoured, and the trailing period some records carry is
 * dropped so the emitted names stay usable elsewhere.
 */
export function splitEuropePmcAuthors(authorString: string): string[] {
  const parts = authorString.split(/,\s*|;/)
  const authors: string[] = []
  for (const part of parts) {
    const name = part.trim().replace(/\.$/, '').trim()
    if (name.length === 0 || name.length > RESEARCH_LIMITS.maxAuthorLength) continue
    authors.push(name)
    if (authors.length >= RESEARCH_LIMITS.maxAuthors) break
  }
  return authors
}

function toHttpsUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_URL_LENGTH) return undefined
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:') return undefined
    if (url.username.length > 0 || url.password.length > 0) return undefined
    return url.toString()
  } catch {
    return undefined
  }
}

function toDoi(value: unknown): string | undefined {
  const doi = textField(value, MAX_DOI_LENGTH)
  return doi === undefined ? undefined : doi.toLowerCase()
}

function toYear(value: unknown): number | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  const year = Number(value)
  if (!Number.isSafeInteger(year) || year < MIN_YEAR || year > MAX_YEAR) return undefined
  return year
}

function toPublicationTypes(value: unknown): string[] {
  const types: string[] = []
  for (const entry of asArray(value)) {
    const type = textField(entry, RESEARCH_LIMITS.maxJournalLength)
    if (type === undefined) continue
    types.push(type)
    if (types.length >= MAX_RECORD_PUBLICATION_TYPES) break
  }
  return types
}

/**
 * `source` is `PPR` for both servers, so it cannot discriminate them. The publisher indicator is the
 * only usable signal, and it lives in a different place depending on the record type: preprint
 * records carry `bookOrReportDetails.publisher`, other records carry it in `journalTitle`.
 */
function detectServer(record: Record<string, unknown>): 'bioRxiv' | 'medRxiv' | undefined {
  const indicators = [
    field(record, 'journalTitle'),
    field(record, 'publisher'),
    asRecord(field(record, 'bookOrReportDetails'))?.publisher
  ]
  for (const indicator of indicators) {
    if (typeof indicator !== 'string') continue
    const normalized = indicator.toLowerCase()
    if (normalized.includes('medrxiv')) return 'medRxiv'
    if (normalized.includes('biorxiv')) return 'bioRxiv'
  }
  return undefined
}

function buildAbstract(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) return ''
  return value.length > RESEARCH_LIMITS.maxAbstractChars
    ? value.slice(0, RESEARCH_LIMITS.maxAbstractChars)
    : value
}

/**
 * The `fullTextUrlList` entries are publisher links, and their `documentStyle` is not a reliable
 * quality signal, so the DOI resolver is preferred, then any HTTPS publisher link, then the
 * canonical Europe PMC article page. An HTTP-only record therefore degrades to the fallback.
 */
function buildUrl(
  id: string,
  doi: string | undefined,
  record: Record<string, unknown>,
  source: EuropePmcSource
): string | undefined {
  if (doi !== undefined) {
    const resolver = toHttpsUrl(`https://doi.org/${doi}`)
    if (resolver !== undefined) return resolver
  }
  // A MEDLINE record without a DOI should still link to its PubMed page rather than to a preprint URL.
  const pmid = textField(field(record, 'pmid'), MAX_PMID_LENGTH)
  if (source === 'MED' && pmid !== undefined && PMID_PATTERN.test(pmid)) {
    return `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`
  }
  for (const entry of asArray(asRecord(field(record, 'fullTextUrlList'))?.fullTextUrl)) {
    const candidate = toHttpsUrl(asRecord(entry)?.url)
    if (candidate !== undefined) return candidate
  }
  return toHttpsUrl(buildEuropePmcArticleUrl(id, source))
}

function toCandidate(value: unknown, source: EuropePmcSource): PreprintCandidate | undefined {
  const record = asRecord(value)
  if (record === undefined) return undefined
  const id = textField(field(record, 'id'), 128)
  // `sourceId` is `epmc:<id>`, so a record without an id cannot be identified or deduplicated.
  if (id === undefined) return undefined

  const sourceId = `epmc:${id}`
  const title = textField(field(record, 'title'), RESEARCH_LIMITS.maxTitleLength)
  if (title === undefined) return undefined

  const authorString = textField(field(record, 'authorString'), 8_192)
  const doi = toDoi(field(record, 'doi'))
  const url = buildUrl(id, doi, record, source)
  if (url === undefined) return undefined

  const journal = textField(field(record, 'journalTitle'), RESEARCH_LIMITS.maxJournalLength)
  const year = toYear(field(record, 'pubYear'))
  const server = detectServer(record)
  const pmid = textField(field(record, 'pmid'), MAX_PMID_LENGTH)

  return {
    sourceId,
    kind: 'epmc',
    title,
    abstract: buildAbstract(field(record, 'abstractText')),
    authors: authorString === undefined ? [] : splitEuropePmcAuthors(authorString),
    url,
    publicationTypes: toPublicationTypes(asRecord(field(record, 'pubTypeList'))?.pubType),
    ...(server === undefined ? {} : { server }),
    ...(journal === undefined ? {} : { journal }),
    ...(year === undefined ? {} : { year }),
    ...(doi === undefined ? {} : { doi }),
    ...(pmid === undefined || !PMID_PATTERN.test(pmid) ? {} : { pmid })
  }
}

function parsePage(
  payload: unknown,
  maxSources: number,
  source: EuropePmcSource
): { candidates: PreprintCandidate[]; outcome: ResearchOutcome } {
  const root = asRecord(payload)
  if (root === undefined) return { candidates: [], outcome: 'invalid' }
  const resultList = asRecord(field(root, 'resultList'))
  const records = asArray(resultList === undefined ? undefined : field(resultList, 'result'))

  const candidates: PreprintCandidate[] = []
  for (const record of records) {
    if (candidates.length >= maxSources) break
    const candidate = toCandidate(record, source)
    if (candidate === undefined) continue
    candidates.push(candidate)
  }

  const hitCount = field(root, 'hitCount')
  const declaredHits = Number(hitCount)
  if (candidates.length > 0) {
    return {
      candidates,
      outcome: Number.isSafeInteger(declaredHits) && declaredHits > candidates.length ? 'truncated' : 'success'
    }
  }
  return { candidates, outcome: Number.isSafeInteger(declaredHits) && declaredHits > 0 ? 'skipped' : 'empty' }
}

/**
 * The parser is authoritative for the emitted shape: `parseLiteratureSource` rejects any record the
 * client cannot prove, so a record that fails here is dropped rather than returned malformed.
 */
function toSource(candidate: PreprintCandidate): LiteratureSource | undefined {
  try {
    return parseLiteratureSource(candidate)
  } catch {
    return undefined
  }
}

export function createEuropePmcClient(options: EuropePmcClientOptions = {}): EuropePmcClient {
  const fetcher = options.fetch ?? fetch
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE
  const maxSources = options.maxSources ?? RESEARCH_LIMITS.maxSources
  const now = options.now ?? ((): number => Date.now())
  const wait = options.wait ?? ((ms: number, signal?: AbortSignal): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort)
        resolve()
      }, ms)
      const onAbort = (): void => {
        clearTimeout(timer)
        reject(new Error('EUROPEPMC_ABORTED'))
      }
      signal?.addEventListener('abort', onAbort, { once: true })
    }))

  return {
    async searchPreprints(request, signal) {
      return searchWithSource(request, signal, EUROPEPMC_PREPRINT_SOURCE)
    },
    async searchMedline(request, signal) {
      return searchWithSource(request, signal, 'MED')
    }
  }

  async function searchWithSource(
    request: EuropePmcSearchRequest,
    signal: AbortSignal | undefined,
    source: EuropePmcSource
  ): Promise<EuropePmcSearchResult> {
    {
      const queries: string[] = []
      for (const query of request.queries) {
        const trimmed = query.trim()
        if (trimmed.length === 0 || trimmed.length > RESEARCH_LIMITS.maxQueryLength) continue
        if (!queries.includes(trimmed)) queries.push(trimmed)
        if (queries.length >= RESEARCH_LIMITS.maxQueries) break
      }

      const sources: LiteratureSource[] = []
      const diagnostics: ResearchDiagnostic[] = []
      const state: TransportState = { retryCount: 0, cancelled: false }
      const transport: TransportOptions = { fetcher, maxResponseBytes, now, wait, signal }
      const seenSourceIds = new Set<string>()
      const seenDois = new Set<string>()

      for (const query of queries) {
        // The retry budget belongs to the query, so a later query is never punished for an earlier
        // one having spent it.
        state.retryCount = 0
        const response = await requestPage(buildEuropePmcSearchUrl(query, pageSize, source), transport, state)
        if (response.errorCode === 'AI_CANCELLED') {
          throw new ResearchContractError('AI_CANCELLED')
        }
        if (response.payload === undefined) {
          diagnostics.push({
            stage: 'literature',
            protocol: 'europepmc',
            outcome: 'failed',
            ...(response.status === undefined ? {} : { status: response.status }),
            sourceCount: sources.length,
            retryCount: state.retryCount,
            ...(response.errorCode === undefined ? {} : { errorCode: response.errorCode })
          })
          continue
        }

        const page = parsePage(response.payload, maxSources, source)
        let added = 0
        for (const candidate of page.candidates) {
          if (sources.length >= maxSources) break
          if (seenSourceIds.has(candidate.sourceId)) continue
          if (candidate.doi !== undefined && seenDois.has(candidate.doi)) continue
          seenSourceIds.add(candidate.sourceId)
          if (candidate.doi !== undefined) seenDois.add(candidate.doi)
          const source = toSource(candidate)
          if (source === undefined) continue
          sources.push(source)
          added += 1
        }

        diagnostics.push({
          stage: 'literature',
          protocol: 'europepmc',
          outcome: page.outcome,
          ...(response.status === undefined ? {} : { status: response.status }),
          sourceCount: added,
          retryCount: state.retryCount
        })
      }

      return { sources, diagnostics }
    }
  }
}
