import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import {
  BIORXIV_DETAILS_ORIGIN,
  buildPreprintDetailsPath,
  buildPreprintDetailsUrl,
  buildPreprintLandingUrl,
  createPreprintClient,
  parsePreprintYear,
  splitPreprintAuthors
} from '@main/services/research/preprint.client'
import { RESEARCH_LIMITS } from '@main/services/research/contracts'

const FIXTURE_PATH = join(import.meta.dirname, '../../../../fixtures/biorxiv/details-medrxiv.json')
const MEDRXIV_DOI = '10.1101/2024.03.14.24304231'

function loadDetailsFixture(): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'))
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('BIORXIV_FIXTURE_INVALID')
  }
  return parsed as Record<string, unknown>
}

function fixtureResponse(): Response {
  return new Response(JSON.stringify(loadDetailsFixture()), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })
}

function collectionResponse(record: Record<string, unknown> | unknown, messages: unknown[] = []): Response {
  return new Response(JSON.stringify({ messages, collection: [record] }), { status: 200 })
}

function requestUrl(fetcher: { mock: { calls: unknown[][] } }, index = 0): string {
  return String(fetcher.mock.calls[index]?.[0])
}

describe('bioRxiv / medRxiv preprint client', () => {
  it('queries the details path as server-then-doi with the DOI percent-encoded', async () => {
    const fetcher = vi.fn().mockResolvedValue(fixtureResponse())
    const client = createPreprintClient({ fetch: fetcher })

    await client.lookup({ server: 'medRxiv', doi: MEDRXIV_DOI })

    expect(buildPreprintDetailsPath('medRxiv', MEDRXIV_DOI)).toBe(
      '/details/medrxiv/10.1101%2F2024.03.14.24304231'
    )
    expect(requestUrl(fetcher)).toBe(
      `${BIORXIV_DETAILS_ORIGIN}/details/medrxiv/10.1101%2F2024.03.14.24304231`
    )
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      method: 'GET',
      headers: { accept: 'application/json', 'user-agent': 'EasyEpi/0.8.0 (questionnaire research; +https://github.com/)' }
    })
  })

  it('returns verified metadata for the first collection record', async () => {
    const fetcher = vi.fn().mockResolvedValue(fixtureResponse())
    const client = createPreprintClient({ fetch: fetcher })

    const result = await client.lookup({ server: 'medRxiv', doi: MEDRXIV_DOI })

    expect(result.metadata).toEqual({
      server: 'medRxiv',
      doi: MEDRXIV_DOI,
      title: 'Physical activity and incident type 2 diabetes in adults: a prospective cohort analysis of primary care records',
      authors: ['Ngozi C Okafor', 'Anna Lindqvist', 'Juan P Ramirez', 'Hiroshi Tanaka'],
      year: 2024,
      version: '1',
      landingUrl: `https://www.medrxiv.org/content/${MEDRXIV_DOI}v1`
    })
    expect(result.diagnostic).toMatchObject({
      stage: 'literature', protocol: 'biorxiv', outcome: 'success', status: 200, sourceCount: 1, retryCount: 0
    })
  })

  it('treats published "NA" as absent and reports a journal DOI when present', async () => {
    const base = loadDetailsFixture()
    const collection = base.collection as Record<string, unknown>[]
    const medrxivRecord = collection[0]
    if (medrxivRecord === undefined) throw new Error('BIORXIV_FIXTURE_INVALID')
    const fetcher = vi.fn()
      .mockResolvedValueOnce(fixtureResponse())
      .mockResolvedValueOnce(collectionResponse({ ...medrxivRecord, published: '10.1007/s00125-024-06229-8' }))
    const client = createPreprintClient({ fetch: fetcher })

    const withNa = await client.lookup({ server: 'medRxiv', doi: MEDRXIV_DOI })
    const withDoi = await client.lookup({ server: 'medRxiv', doi: MEDRXIV_DOI })

    expect(withNa.diagnostic.outcome).toBe('success')
    expect(withNa.metadata === undefined ? 'missing' : withNa.metadata.published).toBeUndefined()
    expect(withNa.metadata).not.toHaveProperty('published')
    expect(withDoi.metadata?.published).toBe('10.1007/s00125-024-06229-8')
  })

  it("chooses the landing host from the record's server, not from the DOI prefix", async () => {
    const fetcher = vi.fn().mockResolvedValue(collectionResponse({
      doi: MEDRXIV_DOI,
      title: 'Cross-posted preprint record',
      authors: 'Anna Lindqvist',
      date: '2024-03-16',
      version: '2',
      server: 'bioRxiv',
      published: 'NA'
    }))
    const client = createPreprintClient({ fetch: fetcher })

    const result = await client.lookup({ server: 'medRxiv', doi: MEDRXIV_DOI })

    expect(result.metadata?.server).toBe('bioRxiv')
    expect(result.metadata?.landingUrl).toBe(`https://www.biorxiv.org/content/${MEDRXIV_DOI}v2`)
  })

  it('falls back to the requested server when the record omits it', async () => {
    const fetcher = vi.fn().mockResolvedValue(collectionResponse({
      doi: MEDRXIV_DOI, title: 'Untagged record', authors: 'Anna Lindqvist', version: '1'
    }))
    const client = createPreprintClient({ fetch: fetcher })

    await expect(client.lookup({ server: 'medRxiv', doi: MEDRXIV_DOI }))
      .resolves.toMatchObject({ metadata: { server: 'medRxiv' } })
    expect(buildPreprintLandingUrl('bioRxiv', MEDRXIV_DOI, undefined))
      .toBe(`https://www.biorxiv.org/content/${MEDRXIV_DOI}`)
  })

  it('coerces the version string and omits the suffix when the version is missing', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(collectionResponse({
        doi: MEDRXIV_DOI, title: 'Versioned record', authors: 'Anna Lindqvist', version: 3
      }))
      .mockResolvedValueOnce(collectionResponse({
        doi: MEDRXIV_DOI, title: 'Unversioned record', authors: 'Anna Lindqvist'
      }))
    const client = createPreprintClient({ fetch: fetcher })

    const versioned = await client.lookup({ server: 'medRxiv', doi: MEDRXIV_DOI })
    const unversioned = await client.lookup({ server: 'medRxiv', doi: MEDRXIV_DOI })

    expect(versioned.metadata?.version).toBe('3')
    expect(versioned.metadata?.landingUrl).toBe(`https://www.medrxiv.org/content/${MEDRXIV_DOI}v3`)
    expect(unversioned.metadata?.version).toBe('')
    expect(unversioned.metadata?.landingUrl).toBe(`https://www.medrxiv.org/content/${MEDRXIV_DOI}`)
  })

  it('tolerates a malformed date and bounds the author list', async () => {
    const fetcher = vi.fn().mockResolvedValue(collectionResponse({
      doi: MEDRXIV_DOI,
      title: 'Malformed date record',
      authors: Array.from({ length: 30 }, (_, index) => `Author ${index}`).join('; '),
      date: 'not-a-date',
      version: '1'
    }))
    const client = createPreprintClient({ fetch: fetcher })

    const result = await client.lookup({ server: 'medRxiv', doi: MEDRXIV_DOI })

    expect(result.diagnostic.outcome).toBe('success')
    expect(result.metadata?.year).toBeUndefined()
    expect(result.metadata === undefined ? 'missing' : result.metadata).not.toHaveProperty('year')
    expect(result.metadata?.authors).toHaveLength(RESEARCH_LIMITS.maxAuthors)
    expect(parsePreprintYear('2019-07')).toBeUndefined()
    expect(parsePreprintYear('2019-07-04')).toBe(2019)
  })

  it('returns an empty diagnostic with no metadata for "no posts found"', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      messages: [{ status: 'no posts found', count: 0, total: 0 }],
      collection: []
    }), { status: 200 }))
    const client = createPreprintClient({ fetch: fetcher })

    const result = await client.lookup({ server: 'medRxiv', doi: MEDRXIV_DOI })

    expect(result.metadata).toBeUndefined()
    expect(result.diagnostic).toEqual({
      stage: 'literature', protocol: 'biorxiv', outcome: 'empty', status: 200, sourceCount: 0, retryCount: 0
    })
  })

  it('treats an absent or null collection as empty', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ messages: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ messages: [], collection: null }), { status: 200 }))
    const client = createPreprintClient({ fetch: fetcher })

    const absent = await client.lookup({ server: 'medRxiv', doi: MEDRXIV_DOI })
    const nullish = await client.lookup({ server: 'medRxiv', doi: MEDRXIV_DOI })

    expect(absent.metadata).toBeUndefined()
    expect(absent.diagnostic).toMatchObject({ protocol: 'biorxiv', outcome: 'empty' })
    expect(nullish.metadata).toBeUndefined()
    expect(nullish.diagnostic).toMatchObject({ protocol: 'biorxiv', outcome: 'empty' })
  })

  it('reports invalid metadata when the record has no title', async () => {
    const fetcher = vi.fn().mockResolvedValue(collectionResponse({ doi: MEDRXIV_DOI, authors: 'A B' }))
    const client = createPreprintClient({ fetch: fetcher })

    const result = await client.lookup({ server: 'medRxiv', doi: MEDRXIV_DOI })

    expect(result.metadata).toBeUndefined()
    expect(result.diagnostic).toMatchObject({ outcome: 'invalid', errorCode: 'AI_INVALID_RESPONSE' })
  })

  it('retries HTTP 429 twice at 500 ms then 1000 ms', async () => {
    const waits: number[] = []
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response('slow down', { status: 429 }))
      .mockResolvedValueOnce(new Response('unavailable', { status: 500 }))
      .mockResolvedValueOnce(fixtureResponse())
    const client = createPreprintClient({
      fetch: fetcher,
      wait: (ms) => {
        waits.push(ms)
        return Promise.resolve()
      }
    })

    const result = await client.lookup({ server: 'medRxiv', doi: MEDRXIV_DOI })

    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(waits).toEqual([500, 1_000])
    expect(result.metadata?.doi).toBe(MEDRXIV_DOI)
    expect(result.diagnostic.retryCount).toBe(2)
  })

  it('gives up after two retries and reports the failure', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('unavailable', { status: 503 }))
    const client = createPreprintClient({ fetch: fetcher, wait: () => Promise.resolve() })

    const result = await client.lookup({ server: 'medRxiv', doi: MEDRXIV_DOI })

    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(result.metadata).toBeUndefined()
    expect(result.diagnostic).toMatchObject({ outcome: 'failed', status: 503, errorCode: 'AI_HTTP_ERROR' })
  })

  it('rejects an already aborted request without starting a network call', async () => {
    const controller = new AbortController()
    controller.abort()
    const fetcher = vi.fn().mockResolvedValue(fixtureResponse())
    const client = createPreprintClient({ fetch: fetcher })

    await expect(client.lookup({ server: 'medRxiv', doi: MEDRXIV_DOI }, controller.signal))
      .rejects.toMatchObject({ errorCode: 'AI_CANCELLED' })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('rejects with AI_CANCELLED when the signal aborts during the request', async () => {
    const controller = new AbortController()
    const fetcher = vi.fn().mockImplementation((): Promise<Response> => {
      controller.abort()
      return Promise.resolve(fixtureResponse())
    })
    const client = createPreprintClient({ fetch: fetcher })

    await expect(client.lookup({ server: 'medRxiv', doi: MEDRXIV_DOI }, controller.signal))
      .rejects.toMatchObject({ errorCode: 'AI_CANCELLED' })
  })

  it('rejects a redirected response', async () => {
    const response = fixtureResponse()
    Object.defineProperty(response, 'redirected', { value: true })
    const client = createPreprintClient({ fetch: vi.fn().mockResolvedValue(response) })

    const result = await client.lookup({ server: 'medRxiv', doi: MEDRXIV_DOI })

    expect(result.metadata).toBeUndefined()
    expect(result.diagnostic).toMatchObject({ outcome: 'failed', errorCode: 'AI_REDIRECT_REJECTED' })
  })

  it('rejects an oversize response and a non-https request shape', async () => {
    const oversize = createPreprintClient({
      fetch: vi.fn().mockResolvedValue(fixtureResponse()),
      maxResponseBytes: 64
    })
    const oversizeResult = await oversize.lookup({ server: 'medRxiv', doi: MEDRXIV_DOI })
    expect(oversizeResult.metadata).toBeUndefined()
    expect(oversizeResult.diagnostic).toMatchObject({ outcome: 'failed', errorCode: 'AI_RESPONSE_TOO_LARGE' })

    const emptyDoi = createPreprintClient({ fetch: vi.fn().mockResolvedValue(fixtureResponse()) })
    await expect(emptyDoi.lookup({ server: 'medRxiv', doi: '  ' }))
      .rejects.toMatchObject({ errorCode: 'AI_RESEARCH_SOURCE_INVALID' })

    expect(buildPreprintDetailsUrl('bioRxiv', MEDRXIV_DOI)).toMatch(/^https:\/\/api\.biorxiv\.org\//)
  })

  it('splits and bounds the semicolon separated author string', () => {
    expect(splitPreprintAuthors('Ngozi C Okafor; Anna Lindqvist;  ; Hiroshi Tanaka'))
      .toEqual(['Ngozi C Okafor', 'Anna Lindqvist', 'Hiroshi Tanaka'])
    expect(splitPreprintAuthors('')).toEqual([])
  })
})
