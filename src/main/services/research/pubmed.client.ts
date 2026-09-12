/**
 * PubMed E-utilities retriever (ESearch + one batched EFetch).
 *
 * Failure policy, applied consistently by every path below:
 * - cancellation always rejects with `ResearchContractError('AI_CANCELLED')`;
 * - a refused XML document (doctype, undeclared entity, depth or node overflow, malformed markup)
 *   throws `ResearchContractError('AI_PUBMED_UNAVAILABLE')`, because a half-parsed batch would
 *   silently shrink the evidence set;
 * - every HTTP or transport condition becomes a diagnostic instead, so a transient NCBI failure is
 *   visible to the caller without destroying the diagnostics already collected.
 */

import { SaxesParser, type SaxesTag } from 'saxes'

import {
  RESEARCH_LIMITS,
  ResearchContractError,
  isPlainRecord,
  parseLiteratureSource,
  type LiteratureSource,
  type ResearchDiagnostic,
  type ResearchOutcome
} from './contracts'

export const EUTILS_ORIGIN = 'https://eutils.ncbi.nlm.nih.gov'
export const ESEARCH_PATH = '/entrez/eutils/esearch.fcgi'
export const EFETCH_PATH = '/entrez/eutils/efetch.fcgi'
/** NCBI asks for contact information; this app intentionally ships no NCBI API key. */
export const DEFAULT_CONTACT_EMAIL = 'easyepi@example.invalid'

export interface PubMedSearchRequest {
  /** One ESearch request is issued per entry, capped at `RESEARCH_LIMITS.maxQueries`. */
  searchQueries: readonly string[]
  /** Carried for pipeline symmetry: the search queries already contain the expanded terms. */
  meshTerms: readonly string[]
  keywords: readonly string[]
}

export interface PubMedSearchResult {
  sources: LiteratureSource[]
  diagnostics: ResearchDiagnostic[]
}

export interface PubMedClient {
  search(request: PubMedSearchRequest, signal?: AbortSignal): Promise<PubMedSearchResult>
}

export interface PubMedClientOptions {
  fetch?: typeof fetch
  now?: () => number
  wait?: (milliseconds: number, signal?: AbortSignal) => Promise<void>
  contactEmail?: string
  maxResponseBytes?: number
  maxSources?: number
}

const EUTILS_HOST = 'eutils.ncbi.nlm.nih.gov'
const TOOL_NAME = 'easyepi'
const ESEARCH_RETMAX = '20'
const DEFAULT_MAX_RESPONSE_BYTES = 8_000_000
const MIN_REQUEST_INTERVAL_MS = 334
const FIXED_RETRY_DELAYS_MS: readonly number[] = [500, 1_000]
const MAX_RETRY_AFTER_SECONDS = 5
const MAX_XML_DEPTH = 32
const MAX_XML_NODES = 100_000
const MAX_PUBLICATION_TYPES = 20
const MAX_DOI_LENGTH = 300
const MAX_PMID_LENGTH = 32
const PUBMED_ARTICLE_URL_PREFIX = 'https://pubmed.ncbi.nlm.nih.gov/'
const PMID_PATTERN = /^\d{1,12}$/
const YEAR_IN_TEXT_PATTERN = /(1[89]\d{2}|2[01]\d{2})/
const UNAVAILABLE_ERROR = 'AI_PUBMED_UNAVAILABLE'
const CANCELLED_ERROR = 'AI_CANCELLED'

/** Every request URL crosses this guard before `fetch` sees it. Exported for its own test suite. */
export function assertTrustedEUtilsUrl(rawUrl: string): URL {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new ResearchContractError(UNAVAILABLE_ERROR)
  }
  if (url.protocol !== 'https:' || url.host !== EUTILS_HOST ||
    url.username.length > 0 || url.password.length > 0) {
    throw new ResearchContractError(UNAVAILABLE_ERROR)
  }
  return url
}

function esearchUrl(query: string, contactEmail: string): string {
  return `${EUTILS_ORIGIN}${ESEARCH_PATH}?db=pubmed&term=${encodeURIComponent(query)}` +
    `&retmode=json&retmax=${ESEARCH_RETMAX}&retstart=0&sort=relevance` +
    `&tool=${TOOL_NAME}&email=${encodeURIComponent(contactEmail)}`
}

function efetchUrl(pmids: readonly string[], contactEmail: string): string {
  return `${EUTILS_ORIGIN}${EFETCH_PATH}?db=pubmed&id=${encodeURIComponent(pmids.join(','))}` +
    `&rettype=abstract&retmode=xml&tool=${TOOL_NAME}&email=${encodeURIComponent(contactEmail)}`
}

function isCancellation(error: unknown): boolean {
  return error instanceof ResearchContractError && error.errorCode === CANCELLED_ERROR
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true
}

function positiveIntegerOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isSafeInteger(value) && value > 0 ? value : fallback
}

/** NCBI returns counts and page sizes as decimal strings and omits them on some responses. */
function coerceCount(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value
  if (typeof value === 'string' && /^\d{1,9}$/.test(value)) return Number(value)
  return undefined
}

function retryDelayMilliseconds(retryAfter: string | null, attemptIndex: number): number {
  const fixedDelay = FIXED_RETRY_DELAYS_MS[attemptIndex] ??
    FIXED_RETRY_DELAYS_MS[FIXED_RETRY_DELAYS_MS.length - 1] ?? 1_000
  const header = retryAfter === null ? '' : retryAfter.trim()
  if (/^\d{1,10}$/.test(header)) {
    const seconds = Number(header)
    if (seconds <= MAX_RETRY_AFTER_SECONDS) return seconds * 1_000
  }
  return fixedDelay
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500
}

async function defaultWait(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (isAborted(signal)) throw new ResearchContractError(CANCELLED_ERROR)
  await new Promise<void>((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(new ResearchContractError(CANCELLED_ERROR))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, milliseconds)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

async function waitFor(
  milliseconds: number,
  signal: AbortSignal | undefined,
  wait: (milliseconds: number, signal?: AbortSignal) => Promise<void>
): Promise<void> {
  if (isAborted(signal)) throw new ResearchContractError(CANCELLED_ERROR)
  if (milliseconds <= 0) return
  try {
    await wait(milliseconds, signal)
  } catch (error) {
    if (isAborted(signal) || isCancellation(error)) {
      throw new ResearchContractError(CANCELLED_ERROR)
    }
    throw error
  }
  if (isAborted(signal)) throw new ResearchContractError(CANCELLED_ERROR)
}

interface XmlElement {
  name: string
  attributes: Record<string, string>
  children: XmlChild[]
}

type XmlChild = XmlElement | string

function isXmlElement(node: XmlChild): node is XmlElement {
  return typeof node !== 'string'
}

/** Namespaces are off, so every attribute saxes reports is a plain name/value string pair. */
function elementAttributes(tag: SaxesTag): Record<string, string> {
  const attributes: Record<string, string> = {}
  for (const [name, value] of Object.entries(tag.attributes)) {
    if (typeof value === 'string') attributes[name] = value
  }
  return attributes
}

/**
 * Single bounded pass that materializes the document tree. saxes has no error handler installed on
 * purpose: without one, saxes throws instead of continuing in a broken state, and a throw from any
 * handler below propagates out of `write`.
 */
function parseXmlDocument(xml: string): XmlElement {
  const parser = new SaxesParser({ fragment: false })
  const stack: XmlElement[] = []
  const document: { root: XmlElement | undefined } = { root: undefined }
  let nodeCount = 0

  const countNode = (): void => {
    nodeCount += 1
    if (nodeCount > MAX_XML_NODES) throw new ResearchContractError(UNAVAILABLE_ERROR)
  }

  parser.on('doctype', () => {
    throw new ResearchContractError(UNAVAILABLE_ERROR)
  })

  parser.on('opentag', (tag) => {
    countNode()
    if (stack.length >= MAX_XML_DEPTH) throw new ResearchContractError(UNAVAILABLE_ERROR)
    const element: XmlElement = {
      name: tag.name,
      attributes: elementAttributes(tag),
      children: []
    }
    const parent = stack[stack.length - 1]
    if (parent === undefined) {
      if (document.root !== undefined) throw new ResearchContractError(UNAVAILABLE_ERROR)
      document.root = element
    } else {
      parent.children.push(element)
    }
    stack.push(element)
  })

  parser.on('text', (text) => {
    countNode()
    stack[stack.length - 1]?.children.push(text)
  })

  parser.on('cdata', (text) => {
    countNode()
    stack[stack.length - 1]?.children.push(text)
  })

  parser.on('closetag', () => {
    stack.pop()
  })

  try {
    parser.write(xml)
    parser.close()
  } catch (error) {
    if (isCancellation(error)) throw error
    throw new ResearchContractError(UNAVAILABLE_ERROR)
  }

  const root = document.root
  if (root === undefined) throw new ResearchContractError(UNAVAILABLE_ERROR)
  return root
}

function collapseWhitespace(text: string): string {
  return text.replaceAll(/\s+/g, ' ').trim()
}

function childElements(parent: XmlElement, name?: string): XmlElement[] {
  const elements: XmlElement[] = []
  for (const child of parent.children) {
    if (!isXmlElement(child)) continue
    if (name === undefined || child.name === name) elements.push(child)
  }
  return elements
}

function firstElement(parent: XmlElement | undefined, name: string): XmlElement | undefined {
  return parent === undefined ? undefined : childElements(parent, name)[0]
}

function collectText(node: XmlChild, buffer: { text: string }, limit: number): void {
  if (buffer.text.length >= limit) return
  if (typeof node === 'string') {
    buffer.text += node
    return
  }
  for (const child of node.children) collectText(child, buffer, limit)
}

/** Concatenates every descendant text node, so mixed content such as `<i>` and `<sup>` is kept. */
function elementText(element: XmlElement | undefined, limit: number): string | undefined {
  if (element === undefined) return undefined
  const buffer = { text: '' }
  collectText(element, buffer, limit)
  const text = collapseWhitespace(buffer.text)
  return text.length === 0 ? undefined : text.slice(0, limit)
}

function firstText(root: XmlElement, path: readonly string[], limit: number): string | undefined {
  let current: XmlElement | undefined = root
  for (const name of path) current = firstElement(current, name)
  return elementText(current, limit)
}

function parseYear(text: string | undefined): number | undefined {
  if (text === undefined) return undefined
  const match = YEAR_IN_TEXT_PATTERN.exec(text)
  if (match === null) return undefined
  const year = Number(match[0])
  return Number.isSafeInteger(year) ? year : undefined
}

function abstractText(article: XmlElement): string {
  const abstractElement = firstElement(article, 'Abstract')
  if (abstractElement === undefined) return ''
  const sections: string[] = []
  for (const section of childElements(abstractElement, 'AbstractText')) {
    const text = elementText(section, RESEARCH_LIMITS.maxAbstractChars)
    if (text === undefined) continue
    const label = section.attributes['Label']
    const normalizedLabel = label === undefined ? undefined : collapseWhitespace(label)
    sections.push(
      normalizedLabel === undefined || normalizedLabel.length === 0
        ? text
        : `${normalizedLabel}: ${text}`
    )
  }
  return sections.join(' ').slice(0, RESEARCH_LIMITS.maxAbstractChars)
}

function authorName(author: XmlElement): string | undefined {
  const limit = RESEARCH_LIMITS.maxAuthorLength
  const collective = elementText(firstElement(author, 'CollectiveName'), limit)
  if (collective !== undefined) return collective
  const lastName = elementText(firstElement(author, 'LastName'), limit)
  if (lastName === undefined) return undefined
  const givenName = elementText(firstElement(author, 'ForeName'), limit) ??
    elementText(firstElement(author, 'Initials'), limit)
  const name = givenName === undefined ? lastName : `${lastName} ${givenName}`
  return name.slice(0, limit)
}

function articleAuthors(article: XmlElement): string[] {
  const authorList = firstElement(article, 'AuthorList')
  if (authorList === undefined) return []
  const authors: string[] = []
  for (const author of childElements(authorList, 'Author')) {
    if (authors.length >= RESEARCH_LIMITS.maxAuthors) break
    const name = authorName(author)
    if (name !== undefined) authors.push(name)
  }
  return authors
}

function articleJournal(article: XmlElement): string | undefined {
  return firstText(article, ['Journal', 'Title'], RESEARCH_LIMITS.maxJournalLength) ??
    firstText(article, ['Journal', 'ISOAbbreviation'], RESEARCH_LIMITS.maxJournalLength)
}

function articleYear(article: XmlElement): number | undefined {
  const pubDate = firstElement(firstElement(firstElement(article, 'Journal'), 'JournalIssue'), 'PubDate')
  return parseYear(elementText(firstElement(pubDate, 'Year'), 32)) ??
    parseYear(elementText(firstElement(pubDate, 'MedlineDate'), 64)) ??
    parseYear(firstText(article, ['ArticleDate', 'Year'], 32))
}

function articleDoi(article: XmlElement, articleElement: XmlElement): string | undefined {
  const articleIdList = firstElement(firstElement(article, 'PubmedData'), 'ArticleIdList')
  for (const articleId of articleIdList === undefined ? [] : childElements(articleIdList, 'ArticleId')) {
    if (articleId.attributes['IdType'] === 'doi') return elementText(articleId, MAX_DOI_LENGTH)
  }
  for (const locationId of childElements(articleElement, 'ELocationID')) {
    if (locationId.attributes['EIdType'] === 'doi') return elementText(locationId, MAX_DOI_LENGTH)
  }
  return undefined
}

function articlePublicationTypes(article: XmlElement): string[] {
  const publicationTypeList = firstElement(article, 'PublicationTypeList')
  if (publicationTypeList === undefined) return []
  const types: string[] = []
  for (const element of childElements(publicationTypeList, 'PublicationType')) {
    if (types.length >= MAX_PUBLICATION_TYPES) break
    const text = elementText(element, RESEARCH_LIMITS.maxJournalLength)
    if (text !== undefined) types.push(text)
  }
  return types
}

function extractArticle(article: XmlElement): LiteratureSource | undefined {
  const pmid = firstText(article, ['MedlineCitation', 'PMID'], MAX_PMID_LENGTH)
  if (pmid === undefined || !PMID_PATTERN.test(pmid)) return undefined
  const articleElement = firstElement(firstElement(article, 'MedlineCitation'), 'Article')
  if (articleElement === undefined) return undefined
  const title = elementText(firstElement(articleElement, 'ArticleTitle'), RESEARCH_LIMITS.maxTitleLength)
  if (title === undefined) return undefined
  const journal = articleJournal(articleElement)
  const year = articleYear(articleElement)
  const doi = articleDoi(article, articleElement)
  const candidate: LiteratureSource = {
    sourceId: `pubmed:${pmid}`,
    kind: 'pubmed',
    title,
    abstract: abstractText(articleElement),
    authors: articleAuthors(articleElement),
    url: `${PUBMED_ARTICLE_URL_PREFIX}${pmid}/`,
    publicationTypes: articlePublicationTypes(articleElement),
    pmid,
    ...(journal === undefined ? {} : { journal }),
    ...(year === undefined ? {} : { year }),
    ...(doi === undefined ? {} : { doi })
  }
  try {
    return parseLiteratureSource(candidate)
  } catch {
    return undefined
  }
}

function parseESearchIdList(text: string): string[] | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return undefined
  }
  if (!isPlainRecord(parsed)) return undefined
  const esearchResult = parsed.esearchresult
  if (!isPlainRecord(esearchResult)) return undefined
  const rawIds = esearchResult.idlist
  if (!Array.isArray(rawIds)) return undefined
  const ids: string[] = []
  for (const rawId of rawIds) {
    if (typeof rawId !== 'string' || !PMID_PATTERN.test(rawId)) return undefined
    ids.push(rawId)
  }
  const count = coerceCount(esearchResult.count)
  if (count === 0 && ids.length > 0) return undefined
  const retmax = coerceCount(esearchResult.retmax)
  return retmax === undefined ? ids : ids.slice(0, retmax)
}

async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel()
  } catch {
    // A rejected cancellation must not replace the transport outcome.
  }
}

function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): void {
  try {
    void reader.cancel().catch(() => undefined)
  } catch {
    // Abort handlers must not replace the cancellation outcome.
  }
}

async function readBoundedText(
  response: Response,
  maxBytes: number,
  signal?: AbortSignal
): Promise<string> {
  const declaredLength = response.headers.get('content-length')
  if (declaredLength !== null && Number(declaredLength) > maxBytes) {
    await discardBody(response)
    throw new ResearchContractError(UNAVAILABLE_ERROR)
  }
  if (response.body === null) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  let readerCancelled = false
  const onAbort = (): void => {
    readerCancelled = true
    cancelReader(reader)
  }
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    for (;;) {
      if (isAborted(signal)) throw new ResearchContractError(CANCELLED_ERROR)
      const result = await reader.read()
      if (isAborted(signal)) throw new ResearchContractError(CANCELLED_ERROR)
      if (result.done === true) break
      size += result.value.byteLength
      if (size > maxBytes) {
        readerCancelled = true
        cancelReader(reader)
        throw new ResearchContractError(UNAVAILABLE_ERROR)
      }
      chunks.push(result.value)
    }
  } catch (error) {
    if (!readerCancelled) cancelReader(reader)
    throw error
  } finally {
    signal?.removeEventListener('abort', onAbort)
    try {
      reader.releaseLock()
    } catch {
      // The lock is dropped together with the failed read.
    }
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new ResearchContractError(UNAVAILABLE_ERROR)
  }
}

type AttemptResult =
  | { kind: 'response'; status: number; retryAfter: string | null; text: string }
  | { kind: 'failure'; errorCode: string }

type TransportResult =
  | { kind: 'response'; status: number; text: string; retryCount: number }
  | { kind: 'failure'; errorCode: string; retryCount: number }

function diagnostic(
  protocol: 'pubmed-esearch' | 'pubmed-efetch',
  outcome: ResearchOutcome,
  fields: {
    status?: number
    sourceCount?: number
    retryCount?: number
    errorCode?: string
  } = {}
): ResearchDiagnostic {
  return { stage: 'literature', protocol, outcome, ...fields }
}

export function createPubMedClient(options: PubMedClientOptions = {}): PubMedClient {
  const fetcher = options.fetch ?? fetch
  const now = options.now ?? Date.now
  const wait = options.wait ?? defaultWait
  const configuredEmail = options.contactEmail?.trim()
  const contactEmail = configuredEmail === undefined || configuredEmail.length === 0
    ? DEFAULT_CONTACT_EMAIL
    : configuredEmail
  const maxResponseBytes = positiveIntegerOr(options.maxResponseBytes, DEFAULT_MAX_RESPONSE_BYTES)
  const maxSources = positiveIntegerOr(options.maxSources, RESEARCH_LIMITS.maxSources)
  let lastRequestStartedAt: number | undefined

  const pace = async (signal?: AbortSignal): Promise<void> => {
    if (lastRequestStartedAt !== undefined) {
      const delay = MIN_REQUEST_INTERVAL_MS - (now() - lastRequestStartedAt)
      if (delay > 0) await waitFor(delay, signal, wait)
    }
    lastRequestStartedAt = now()
  }

  const attempt = async (url: string, signal?: AbortSignal): Promise<AttemptResult> => {
    try {
      assertTrustedEUtilsUrl(url)
      if (isAborted(signal)) throw new ResearchContractError(CANCELLED_ERROR)
      const response = await fetcher(url, { method: 'GET', redirect: 'error', signal })
      if (isAborted(signal)) {
        await discardBody(response)
        throw new ResearchContractError(CANCELLED_ERROR)
      }
      if (response.redirected === true) {
        await discardBody(response)
        throw new ResearchContractError(UNAVAILABLE_ERROR)
      }
      const retryAfter = response.headers.get('retry-after')
      if (!response.ok) {
        await discardBody(response)
        return { kind: 'response', status: response.status, retryAfter, text: '' }
      }
      const text = await readBoundedText(response, maxResponseBytes, signal)
      return { kind: 'response', status: response.status, retryAfter, text }
    } catch (error) {
      if (isCancellation(error)) throw error
      return { kind: 'failure', errorCode: UNAVAILABLE_ERROR }
    }
  }

  const perform = async (url: string, signal?: AbortSignal): Promise<TransportResult> => {
    let retryCount = 0
    for (;;) {
      await pace(signal)
      const result = await attempt(url, signal)
      if (result.kind === 'failure') {
        return { kind: 'failure', errorCode: result.errorCode, retryCount }
      }
      if (!isRetryableStatus(result.status) || retryCount >= FIXED_RETRY_DELAYS_MS.length) {
        return { kind: 'response', status: result.status, text: result.text, retryCount }
      }
      const delay = retryDelayMilliseconds(result.retryAfter, retryCount)
      retryCount += 1
      await waitFor(delay, signal, wait)
    }
  }

  return {
    async search(
      request: PubMedSearchRequest,
      signal?: AbortSignal
    ): Promise<PubMedSearchResult> {
      const diagnostics: ResearchDiagnostic[] = []
      const pmids: string[] = []
      const seenPmids = new Set<string>()

      for (const rawQuery of request.searchQueries.slice(0, RESEARCH_LIMITS.maxQueries)) {
        if (typeof rawQuery !== 'string') continue
        const query = rawQuery.trim()
        if (query.length === 0 || query.length > RESEARCH_LIMITS.maxQueryLength) continue
        let transport: TransportResult
        try {
          transport = await perform(esearchUrl(query, contactEmail), signal)
        } catch (error) {
          if (isCancellation(error)) throw error
          diagnostics.push(diagnostic('pubmed-esearch', 'failed', {
            retryCount: 0, errorCode: UNAVAILABLE_ERROR
          }))
          continue
        }
        if (transport.kind === 'failure') {
          diagnostics.push(diagnostic('pubmed-esearch', 'failed', {
            retryCount: transport.retryCount, errorCode: transport.errorCode
          }))
          continue
        }
        if (transport.status !== 200) {
          diagnostics.push(diagnostic('pubmed-esearch', 'failed', {
            status: transport.status, retryCount: transport.retryCount, errorCode: UNAVAILABLE_ERROR
          }))
          continue
        }
        const ids = parseESearchIdList(transport.text)
        if (ids === undefined) {
          diagnostics.push(diagnostic('pubmed-esearch', 'invalid', {
            status: 200, retryCount: transport.retryCount, errorCode: UNAVAILABLE_ERROR
          }))
          continue
        }
        let capped = false
        let added = 0
        for (const pmid of ids) {
          if (pmids.length >= maxSources) {
            capped = true
            break
          }
          if (seenPmids.has(pmid)) continue
          seenPmids.add(pmid)
          pmids.push(pmid)
          added += 1
        }
        diagnostics.push(diagnostic('pubmed-esearch',
          ids.length === 0 ? 'empty' : capped ? 'truncated' : 'success', {
            status: 200, sourceCount: added, retryCount: transport.retryCount
          }))
      }

      if (pmids.length === 0) {
        diagnostics.push(diagnostic('pubmed-efetch', 'empty', { sourceCount: 0, retryCount: 0 }))
        return { sources: [], diagnostics }
      }

      let efetch: TransportResult
      try {
        efetch = await perform(efetchUrl(pmids, contactEmail), signal)
      } catch (error) {
        if (isCancellation(error)) throw error
        efetch = { kind: 'failure', errorCode: UNAVAILABLE_ERROR, retryCount: 0 }
      }
      if (efetch.kind === 'failure') {
        diagnostics.push(diagnostic('pubmed-efetch', 'failed', {
          sourceCount: 0, retryCount: efetch.retryCount, errorCode: efetch.errorCode
        }))
        return { sources: [], diagnostics }
      }
      if (efetch.status !== 200) {
        diagnostics.push(diagnostic('pubmed-efetch', 'failed', {
          status: efetch.status, sourceCount: 0, retryCount: efetch.retryCount,
          errorCode: UNAVAILABLE_ERROR
        }))
        return { sources: [], diagnostics }
      }

      const document = parseXmlDocument(efetch.text)
      const sources: LiteratureSource[] = []
      for (const article of childElements(document, 'PubmedArticle')) {
        if (sources.length >= maxSources) break
        const source = extractArticle(article)
        if (source !== undefined) sources.push(source)
      }
      diagnostics.push(diagnostic('pubmed-efetch', sources.length === 0 ? 'empty' : 'success', {
        status: 200, sourceCount: sources.length, retryCount: efetch.retryCount
      }))
      return { sources, diagnostics }
    }
  }
}
