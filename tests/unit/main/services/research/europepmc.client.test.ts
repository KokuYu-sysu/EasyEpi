import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import {
  EUROPEPMC_SEARCH_ORIGIN,
  buildEuropePmcArticleUrl,
  buildEuropePmcQuery,
  buildEuropePmcSearchUrl,
  createEuropePmcClient,
  splitEuropePmcAuthors
} from '@main/services/research/europepmc.client'
import { RESEARCH_LIMITS, parseLiteratureSource } from '@main/services/research/contracts'

const FIXTURE_PATH = join(import.meta.dirname, '../../../../fixtures/europepmc/search-preprints.json')

function loadSearchFixture(): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'))
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('EUROPEPMC_FIXTURE_INVALID')
  }
  return parsed as Record<string, unknown>
}

function fixtureResponse(overrides: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({ ...loadSearchFixture(), ...overrides }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })
}

function requestUrl(fetcher: { mock: { calls: unknown[][] } }, index = 0): URL {
  return new URL(String(fetcher.mock.calls[index]?.[0]))
}

function fixtureRecords(): Record<string, unknown>[] {
  const parsed: unknown = (loadSearchFixture().resultList as { result?: unknown }).result ?? []
  if (!Array.isArray(parsed)) throw new Error('EUROPEPMC_FIXTURE_INVALID')
  return parsed.filter((record): record is Record<string, unknown> =>
    typeof record === 'object' && record !== null && !Array.isArray(record))
}

function fixtureRecord(id: string): Record<string, unknown> {
  const record = fixtureRecords().find((entry) => entry.id === id)
  if (record === undefined) throw new Error('EUROPEPMC_FIXTURE_INVALID')
  return record
}

/** Builds a page from selected fixture records so each query in a test has distinct content. */
function pageResponse(ids: readonly string[], hitCount = ids.length): Response {
  return fixtureResponse({
    hitCount,
    nextCursorMark: 'AoIIP8EBMTIzNDU2Nw==',
    resultList: { result: ids.map((id) => fixtureRecord(id)) }
  })
}

const MEDRXIV_DOI = '10.1101/2024.03.14.24304231'
const MEDRXIV_ID = 'PPR9128461'
const BIORXIV_ID = 'PPR8712034'
const META_ANALYSIS_ID = 'PPR8554977'

describe('Europe PMC preprint search client', () => {
  it('builds the exact query with a phrase search over preprint records', () => {
    const parameters = buildEuropePmcQuery('physical activity & "type 2" diabetes')

    expect(parameters.get('query')).toBe('(TITLE_ABS:"physical activity & "type 2" diabetes") AND SRC:PPR')
    expect(parameters.get('format')).toBe('json')
    expect(parameters.get('resultType')).toBe('core')
    expect(parameters.get('sort')).toBe('P_PDATE_D desc')
    expect(parameters.get('cursorMark')).toBe('*')
  })

  it('encodes spaces, quotes and ampersands exactly once', () => {
    const url = new URL(buildEuropePmcSearchUrl('physical activity & "type 2" diabetes', 25))

    expect(url.origin + url.pathname).toBe(EUROPEPMC_SEARCH_ORIGIN)
    expect(url.searchParams.get('query')).toBe(
      '(TITLE_ABS:"physical activity & "type 2" diabetes") AND SRC:PPR'
    )
    expect(String(url)).toContain('TITLE_ABS%3A%22physical+activity+%26+%22type+2%22+diabetes%22%29')
    expect([...url.searchParams.keys()]).toEqual([
      'query', 'format', 'resultType', 'sort', 'cursorMark', 'pageSize'
    ])
    expect(url.searchParams.get('pageSize')).toBe('25')
  })

  it('sends one GET per query with the required parameters and headers', async () => {
    const fetcher = vi.fn().mockResolvedValue(fixtureResponse())
    const client = createEuropePmcClient({ fetch: fetcher })

    await client.searchPreprints({ queries: ['physical activity'] })

    expect(fetcher).toHaveBeenCalledTimes(1)
    const url = requestUrl(fetcher)
    expect(url.searchParams.get('query')).toBe('(TITLE_ABS:"physical activity") AND SRC:PPR')
    expect(url.searchParams.get('resultType')).toBe('core')
    expect(url.searchParams.get('format')).toBe('json')
    expect(url.searchParams.get('sort')).toBe('P_PDATE_D desc')
    expect(url.searchParams.get('cursorMark')).toBe('*')
    expect(url.searchParams.get('pageSize')).toBe('25')
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      method: 'GET',
      headers: { accept: 'application/json', 'user-agent': 'EasyEpi/0.8.0 (questionnaire research; +https://github.com/)' }
    })
  })

  it('honours the pageSize override and caps the query count at the contract limit', async () => {
    const fetcher = vi.fn().mockResolvedValue(fixtureResponse())
    const client = createEuropePmcClient({ fetch: fetcher, pageSize: 5 })

    await client.searchPreprints({
      queries: ['one', 'two', 'three', 'four', ' ', 'one']
    })

    expect(fetcher).toHaveBeenCalledTimes(RESEARCH_LIMITS.maxQueries)
    expect(requestUrl(fetcher).searchParams.get('pageSize')).toBe('5')
  })

  it('coerces pubYear, splits authorString and emits contract-legal sources', async () => {
    const fetcher = vi.fn().mockResolvedValue(fixtureResponse())
    const client = createEuropePmcClient({ fetch: fetcher })

    const result = await client.searchPreprints({ queries: ['physical activity'] })

    expect(result.sources).toHaveLength(3)
    const medrxiv = result.sources[0]
    expect(medrxiv).toMatchObject({
      sourceId: 'epmc:PPR9128461',
      kind: 'epmc',
      server: 'medRxiv',
      year: 2024,
      doi: MEDRXIV_DOI,
      journal: 'medRxiv',
      authors: ['Okafor NC', 'Lindqvist A', 'Ramirez JP', 'Tanaka H'],
      url: `https://doi.org/${MEDRXIV_DOI}`,
      publicationTypes: ['Preprint', 'Journal Article']
    })
    expect(medrxiv?.abstract).toContain('incident type 2 diabetes')
    for (const source of result.sources) {
      expect(() => parseLiteratureSource(source)).not.toThrow()
    }
  })

  it('splits semicolon separated authors and bounds the list', () => {
    expect(splitEuropePmcAuthors('Bauer M; Kowalski E; Chen LY')).toEqual(['Bauer M', 'Kowalski E', 'Chen LY'])
    expect(splitEuropePmcAuthors('Okafor NC, Lindqvist A.')).toEqual(['Okafor NC', 'Lindqvist A'])
    expect(splitEuropePmcAuthors(' ;; ,, ')).toEqual([])
    const many = Array.from({ length: 40 }, (_, index) => `Author ${index}`).join(', ')
    expect(splitEuropePmcAuthors(many)).toHaveLength(RESEARCH_LIMITS.maxAuthors)
  })

  it('prefers doi.org, then fullTextUrlList, then the Europe PMC article page', async () => {
    const fetcher = vi.fn().mockResolvedValue(fixtureResponse())
    const client = createEuropePmcClient({ fetch: fetcher })
    const result = await client.searchPreprints({ queries: ['physical activity'] })

    expect(result.sources[0]?.url).toBe(`https://doi.org/${MEDRXIV_DOI}`)
    expect(result.sources[1]?.url).toBe(buildEuropePmcArticleUrl('PPR8712034'))
    expect(result.sources[2]?.url).toBe(`https://doi.org/10.1101/2022.11.30.22282937`)
  })

  it('detects the server from the publisher indicator for both preprint servers', async () => {
    const fetcher = vi.fn().mockResolvedValue(fixtureResponse())
    const client = createEuropePmcClient({ fetch: fetcher })
    const result = await client.searchPreprints({ queries: ['physical activity'] })

    expect(result.sources.map((source) => source.server)).toEqual(['medRxiv', 'bioRxiv', 'medRxiv'])
    expect(result.sources[1]).toMatchObject({ sourceId: 'epmc:PPR8712034', server: 'bioRxiv' })
  })

  it('skips records that cannot produce a title or a usable https url without aborting the page', async () => {
    const fixture = loadSearchFixture()
    fixture.resultList = {
      result: [
        { id: 'PPR0000001', source: 'PPR', title: '   ', pubYear: '2024' },
        fixtureRecord(MEDRXIV_ID)
      ]
    }
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(fixture), { status: 200 }))
    const client = createEuropePmcClient({ fetch: fetcher })

    const result = await client.searchPreprints({ queries: ['physical activity'] })

    expect(result.sources.map((source) => source.sourceId)).toEqual([`epmc:${MEDRXIV_ID}`])
    expect(result.diagnostics[0]?.outcome).toBe('truncated')
  })

  it('falls back to the europepmc.org article page when no https link can be preferred', async () => {
    const fixture = loadSearchFixture()
    fixture.resultList = {
      result: [
        { id: 'PPR0000001', source: 'PPR', title: 'No links at all', pubYear: '2024' },
        {
          id: 'PPR0000003',
          source: 'PPR',
          title: 'Http only record',
          fullTextUrlList: { fullTextUrl: [{ url: 'http://example.org/preprint.pdf', documentStyle: 'pdf' }] }
        },
        {
          id: 'PPR0000004',
          source: 'PPR',
          title: 'Credential bearing record',
          doi: '10.1101/2021.01.01.000000',
          fullTextUrlList: { fullTextUrl: [{ url: 'https://user:pass@example.org/preprint.pdf' }] }
        },
        {
          id: 'PPR0000005',
          source: 'PPR',
          title: 'Mixed link list',
          fullTextUrlList: {
            fullTextUrl: [{ url: 'http://example.org/a.pdf' }, { url: 'https://example.org/b.html' }]
          }
        }
      ]
    }
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(fixture), { status: 200 }))
    const client = createEuropePmcClient({ fetch: fetcher })

    const result = await client.searchPreprints({ queries: ['physical activity'] })

    expect(result.sources.map((source) => source.url)).toEqual([
      buildEuropePmcArticleUrl('PPR0000001'),
      buildEuropePmcArticleUrl('PPR0000003'),
      // The DOI resolver outranks a publisher link, so the credential-bearing entry is never used.
      'https://doi.org/10.1101/2021.01.01.000000',
      'https://example.org/b.html'
    ])
  })

  it('deduplicates by source id and by DOI across queries', async () => {
    const medrxivRecord = fixtureRecord(MEDRXIV_ID)
    const fetcher = vi.fn()
      .mockResolvedValueOnce(pageResponse([MEDRXIV_ID, BIORXIV_ID]))
      .mockResolvedValueOnce(fixtureResponse({
        hitCount: 2,
        resultList: { result: [medrxivRecord, { ...medrxivRecord, id: 'PPR9999999' }] }
      }))
    const client = createEuropePmcClient({ fetch: fetcher })

    const result = await client.searchPreprints({ queries: ['physical activity', 'step counts'] })

    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(result.sources.map((source) => source.sourceId)).toEqual([
      'epmc:PPR9128461', 'epmc:PPR8712034'
    ])
    expect(result.diagnostics.map((diagnostic) => diagnostic.sourceCount)).toEqual([2, 0])
  })

  it('stops collecting once maxSources records are held', async () => {
    const fetcher = vi.fn().mockResolvedValue(pageResponse([MEDRXIV_ID, BIORXIV_ID, META_ANALYSIS_ID]))
    const client = createEuropePmcClient({ fetch: fetcher, maxSources: 1 })

    const result = await client.searchPreprints({ queries: ['physical activity'] })

    expect(result.sources).toHaveLength(1)
    expect(result.sources[0]?.sourceId).toBe('epmc:PPR9128461')
  })

  it('emits one europepmc diagnostic per query', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(fixtureResponse({ resultList: { result: [] }, hitCount: 0 }))
      .mockResolvedValueOnce(pageResponse([MEDRXIV_ID, BIORXIV_ID, META_ANALYSIS_ID], 37))
    const client = createEuropePmcClient({ fetch: fetcher })

    const result = await client.searchPreprints({ queries: ['nothing here', 'physical activity'] })

    expect(result.diagnostics).toHaveLength(2)
    expect(result.diagnostics[0]).toMatchObject({
      stage: 'literature', protocol: 'europepmc', outcome: 'empty', status: 200, sourceCount: 0, retryCount: 0
    })
    expect(result.diagnostics[1]).toMatchObject({ outcome: 'truncated', sourceCount: 3 })
  })

  it('retries HTTP 429 twice at 500 ms then 1000 ms', async () => {
    const waits: number[] = []
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response('slow down', { status: 429 }))
      .mockResolvedValueOnce(new Response('still slow', { status: 503 }))
      .mockResolvedValueOnce(pageResponse([MEDRXIV_ID, BIORXIV_ID, META_ANALYSIS_ID]))
    const client = createEuropePmcClient({
      fetch: fetcher,
      wait: (ms) => {
        waits.push(ms)
        return Promise.resolve()
      }
    })

    const result = await client.searchPreprints({ queries: ['physical activity'] })

    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(waits).toEqual([500, 1_000])
    expect(result.sources).toHaveLength(3)
    expect(result.diagnostics[0]?.retryCount).toBe(2)
  })

  it('does not retry a client error', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('bad request', { status: 400 }))
    const client = createEuropePmcClient({ fetch: fetcher, wait: () => Promise.resolve() })

    const result = await client.searchPreprints({ queries: ['physical activity'] })

    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(result.sources).toEqual([])
    expect(result.diagnostics[0]).toMatchObject({ outcome: 'failed', status: 400, errorCode: 'AI_HTTP_ERROR' })
  })

  it('rejects an already aborted request without starting a network call', async () => {
    const controller = new AbortController()
    controller.abort()
    const fetcher = vi.fn().mockResolvedValue(fixtureResponse())
    const client = createEuropePmcClient({ fetch: fetcher })

    await expect(client.searchPreprints({ queries: ['physical activity'] }, controller.signal))
      .rejects.toMatchObject({ errorCode: 'AI_CANCELLED' })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('rejects with AI_CANCELLED when the signal aborts during the request', async () => {
    const controller = new AbortController()
    const fetcher = vi.fn().mockImplementation((): Promise<Response> => {
      controller.abort()
      return Promise.resolve(fixtureResponse())
    })
    const client = createEuropePmcClient({ fetch: fetcher })

    await expect(client.searchPreprints({ queries: ['physical activity'] }, controller.signal))
      .rejects.toMatchObject({ errorCode: 'AI_CANCELLED' })
  })

  it('rejects an oversize response from the streamed byte count and from content-length', async () => {
    const streamed = createEuropePmcClient({
      fetch: vi.fn().mockResolvedValue(fixtureResponse()),
      maxResponseBytes: 64
    })
    await expect(streamed.searchPreprints({ queries: ['physical activity'] }))
      .resolves.toMatchObject({
        diagnostics: [{ outcome: 'failed', errorCode: 'AI_RESPONSE_TOO_LARGE' }]
      })

    const declared = createEuropePmcClient({
      fetch: vi.fn().mockResolvedValue(new Response('{}', {
        status: 200,
        headers: { 'content-length': '9999999' }
      })),
      maxResponseBytes: 128
    })
    await expect(declared.searchPreprints({ queries: ['physical activity'] }))
      .resolves.toMatchObject({
        diagnostics: [{ outcome: 'failed', errorCode: 'AI_RESPONSE_TOO_LARGE' }]
      })
  })

  it('rejects a redirected response', async () => {
    const response = fixtureResponse()
    Object.defineProperty(response, 'redirected', { value: true })
    const client = createEuropePmcClient({ fetch: vi.fn().mockResolvedValue(response) })

    const result = await client.searchPreprints({ queries: ['physical activity'] })

    expect(result.sources).toEqual([])
    expect(result.diagnostics[0]).toMatchObject({
      outcome: 'failed', status: 200, errorCode: 'AI_REDIRECT_REJECTED'
    })
  })

  it('reports a failed query without aborting the remaining queries', async () => {
    let calls = 0
    const fetcher = vi.fn().mockImplementation((): Promise<Response> => {
      calls += 1
      // The first query burns both retries, the second one succeeds on its first attempt.
      return Promise.resolve(calls <= 3 ? new Response('{}', { status: 500 }) : pageResponse([MEDRXIV_ID]))
    })
    const client = createEuropePmcClient({ fetch: fetcher, wait: () => Promise.resolve() })

    const result = await client.searchPreprints({ queries: ['first', 'second'] })

    expect(fetcher).toHaveBeenCalledTimes(4)
    expect(result.diagnostics.map((diagnostic) => diagnostic.outcome)).toEqual(['failed', 'success'])
    expect(result.diagnostics.map((diagnostic) => diagnostic.retryCount)).toEqual([2, 0])
    expect(result.sources).toHaveLength(1)
  })

  it('gives every query its own retry budget', async () => {
    const waits: number[] = []
    let calls = 0
    const fetcher = vi.fn().mockImplementation((): Promise<Response> => {
      calls += 1
      if (calls === 2) return Promise.resolve(pageResponse([BIORXIV_ID]))
      if (calls === 3) return Promise.resolve(new Response('{}', { status: 429 }))
      if (calls === 4) return Promise.resolve(pageResponse([META_ANALYSIS_ID]))
      return Promise.resolve(new Response('{}', { status: 429 }))
    })
    const client = createEuropePmcClient({
      fetch: fetcher,
      wait: (ms) => {
        waits.push(ms)
        return Promise.resolve()
      }
    })

    const result = await client.searchPreprints({ queries: ['first', 'second'] })

    expect(fetcher).toHaveBeenCalledTimes(4)
    expect(waits).toEqual([500, 500])
    expect(result.diagnostics.map((diagnostic) => diagnostic.outcome)).toEqual(['success', 'success'])
    expect(result.sources.map((source) => source.sourceId)).toEqual([
      `epmc:${BIORXIV_ID}`, `epmc:${META_ANALYSIS_ID}`
    ])
  })
})
