import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it, vi } from 'vitest'

import {
  ResearchContractError,
  parseLiteratureSource,
  type LiteratureSource
} from '@main/services/research/contracts'
import {
  DEFAULT_CONTACT_EMAIL,
  EFETCH_PATH,
  ESEARCH_PATH,
  EUTILS_ORIGIN,
  assertTrustedEUtilsUrl,
  createPubMedClient,
  type PubMedClientOptions,
  type PubMedSearchRequest
} from '@main/services/research/pubmed.client'

const fixtureDirectory = join(
  dirname(fileURLToPath(import.meta.url)),
  '..', '..', '..', '..',
  'fixtures',
  'pubmed'
)

function fixture(name: string): string {
  return readFileSync(join(fixtureDirectory, name), 'utf8')
}

const esearchFixture = fixture('esearch-hypertension.json')
const efetchFixture = fixture('efetch-hypertension.xml')

const request: PubMedSearchRequest = {
  searchQueries: ['hypertension ambulatory blood pressure'],
  meshTerms: ['Hypertension'],
  keywords: ['ambulatory blood pressure monitoring']
}

const ESEARCH_URL_PREFIX = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?'
const EFETCH_URL_PREFIX = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?'

const FIRST_ARTICLE: LiteratureSource = {
  sourceId: 'pubmed:12345678',
  kind: 'pubmed',
  title: 'Hypertension & cardiovascular risk \u2013 a cohort study of 24-hour ambulatory blood pressure',
  abstract: 'BACKGROUND: Elevated blood pressure is a leading modifiable risk factor for ' +
    'cardiovascular disease worldwide. RESULTS: Over a median follow-up of 8.2 years, each ' +
    '10-mmHg increase in systolic blood pressure was associated with a hazard ratio of 1.42 ' +
    '(95% CI 1.31-1.54).',
  authors: ['Smith Jane A', 'Doe AD', 'The Hypertension Cohort Investigators'],
  url: 'https://pubmed.ncbi.nlm.nih.gov/12345678/',
  publicationTypes: ['Journal Article', 'Multicenter Study'],
  pmid: '12345678',
  journal: 'Journal of Hypertension Research',
  year: 2023,
  doi: '10.1000/jhr.2023.0042'
}

const SECOND_ARTICLE: LiteratureSource = {
  sourceId: 'pubmed:87654321',
  kind: 'pubmed',
  title: 'Nurse-led blood pressure management in rural primary care: a pragmatic review',
  abstract: 'Nurse-led interventions improved systolic blood pressure control in rural primary care settings.',
  authors: ['Rural Cardiovascular Nursing Group'],
  url: 'https://pubmed.ncbi.nlm.nih.gov/87654321/',
  publicationTypes: ['Journal Article', 'Review'],
  pmid: '87654321',
  journal: 'Eur J Cardiovasc Nurs',
  year: 2019
}

interface StubHandlers {
  esearch?: (url: string, callIndex: number) => Response
  efetch?: (url: string) => Response
}

function jsonResponse(body: string): Response {
  return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } })
}

function xmlResponse(body: string): Response {
  return new Response(body, { status: 200, headers: { 'content-type': 'text/xml' } })
}

function esearchPayload(ids: readonly string[], count = ids.length): string {
  return JSON.stringify({
    header: { type: 'esearch', version: '0.3' },
    esearchresult: {
      count: String(count),
      retmax: '20',
      retstart: '0',
      idlist: ids,
      querytranslation: 'hypertension[All Fields]'
    }
  })
}

function createClient(
  handlers: StubHandlers = {},
  overrides: Omit<PubMedClientOptions, 'fetch' | 'now' | 'wait'> = {}
): {
  client: ReturnType<typeof createPubMedClient>
  fetcher: ReturnType<typeof vi.fn>
  calls: string[]
  waits: number[]
} {
  const calls: string[] = []
  const waits: number[] = []
  let clock = 1_000
  const fetcher = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    calls.push(url)
    if (url.includes(ESEARCH_PATH)) {
      return handlers.esearch?.(url, calls.filter((call) => call.includes(ESEARCH_PATH)).length - 1) ??
        jsonResponse(esearchFixture)
    }
    if (url.includes(EFETCH_PATH)) {
      return handlers.efetch?.(url) ?? xmlResponse(efetchFixture)
    }
    throw new Error(`unexpected request URL: ${url}`)
  })
  const client = createPubMedClient({
    fetch: fetcher,
    now: () => clock,
    wait: async (milliseconds, signal) => {
      if (signal?.aborted === true) throw new ResearchContractError('AI_CANCELLED')
      waits.push(milliseconds)
      clock += milliseconds
    },
    ...overrides
  })
  return { client, fetcher, calls, waits }
}

function callsTo(calls: readonly string[], path: string): string[] {
  return calls.filter((url) => url.includes(path))
}

describe('PubMed E-utilities client', () => {
  it('requests ESearch with the documented parameters and percent-encoded term', async () => {
    const { client, calls } = createClient()

    await client.search({ ...request, searchQueries: ['hypertension AND "blood pressure"'] })

    expect(calls[0]).toBe(
      `${ESEARCH_URL_PREFIX}db=pubmed&term=hypertension%20AND%20%22blood%20pressure%22` +
      '&retmode=json&retmax=20&retstart=0&sort=relevance&tool=easyepi&email=easyepi%40example.invalid'
    )
    expect(calls[0]).not.toContain('api_key')
  })

  it('fetches every collected PMID in one batched EFetch request', async () => {
    const { client, calls } = createClient()

    await client.search(request)

    expect(callsTo(calls, EFETCH_PATH)).toEqual([
      `${EFETCH_URL_PREFIX}db=pubmed&id=12345678%2C87654321&rettype=abstract&retmode=xml` +
      '&tool=easyepi&email=easyepi%40example.invalid'
    ])
  })

  it('paces requests 334 ms apart through the injected clock', async () => {
    const { client, calls, waits } = createClient()

    await client.search(request)

    expect(calls).toHaveLength(2)
    expect(waits).toEqual([334])
  })

  it('uses the configured contact email', async () => {
    const { client, calls } = createClient({}, { contactEmail: 'research@example.org' })

    await client.search(request)

    expect(calls[0]).toContain('email=research%40example.org')
  })

  it('issues at most five ESearch requests per run', async () => {
    const { client, calls } = createClient()

    await client.search({ ...request, searchQueries: ['a', 'b', 'c', 'd', 'e', 'f'] })

    expect(callsTo(calls, ESEARCH_PATH)).toHaveLength(5)
  })

  it('normalizes the batched EFetch document into contract-valid sources', async () => {
    const { client } = createClient()

    const result = await client.search(request)

    expect(result.sources).toEqual([FIRST_ARTICLE, SECOND_ARTICLE])
    expect(result.diagnostics).toEqual([
      {
        stage: 'literature', protocol: 'pubmed-esearch', outcome: 'success',
        status: 200, sourceCount: 2, retryCount: 0
      },
      {
        stage: 'literature', protocol: 'pubmed-efetch', outcome: 'success',
        status: 200, sourceCount: 2, retryCount: 0
      }
    ])
  })

  it('emits only sources that satisfy parseLiteratureSource with canonical identities', async () => {
    const { client } = createClient()

    const result = await client.search(request)

    expect(result.sources).toHaveLength(2)
    for (const source of result.sources) {
      expect(parseLiteratureSource(source)).toEqual(source)
      expect(source.kind).toBe('pubmed')
      expect(source.sourceId).toBe(`pubmed:${String(source.pmid)}`)
      expect(source.url).toBe(`https://pubmed.ncbi.nlm.nih.gov/${String(source.pmid)}/`)
    }
  })

  it('decodes XML entities in mixed-content titles', async () => {
    const { client } = createClient()

    const result = await client.search(request)

    expect(result.sources[0]?.title).toBe(
      'Hypertension & cardiovascular risk \u2013 a cohort study of 24-hour ambulatory blood pressure'
    )
  })

  it('joins labelled abstract sections in document order', async () => {
    const { client } = createClient()

    const result = await client.search(request)

    expect(result.sources[0]?.abstract).toBe(
      'BACKGROUND: Elevated blood pressure is a leading modifiable risk factor for cardiovascular ' +
      'disease worldwide. RESULTS: Over a median follow-up of 8.2 years, each 10-mmHg increase in ' +
      'systolic blood pressure was associated with a hazard ratio of 1.42 (95% CI 1.31-1.54).'
    )
    expect(result.sources[1]?.abstract).toBe(
      'Nurse-led interventions improved systolic blood pressure control in rural primary care settings.'
    )
  })

  it('keeps a DOI from ArticleIdList and omits the key when the record has none', async () => {
    const { client } = createClient()

    const result = await client.search(request)

    expect(result.sources[0]?.doi).toBe('10.1000/jhr.2023.0042')
    expect(result.sources[1]).not.toHaveProperty('doi')
  })

  it('falls back to ELocationID and ArticleDate', async () => {
    const inline = [
      '<PubmedArticleSet>',
      '  <PubmedArticle>',
      '    <MedlineCitation><PMID>24681357</PMID>',
      '      <Article>',
      '        <Journal><JournalIssue><PubDate><MedlineDate>Winter 2020</MedlineDate></PubDate>',
      '          </JournalIssue><Title>Fallback Journal</Title></Journal>',
      '        <ArticleTitle>Location identifier fallback</ArticleTitle>',
      '        <Abstract><AbstractText>Abstract body.</AbstractText></Abstract>',
      '        <ELocationID EIdType="doi">10.1000/elocation.2020.7</ELocationID>',
      '        <ArticleDate DateType="Electronic"><Year>2018</Year><Month>03</Month></ArticleDate>',
      '      </Article>',
      '    </MedlineCitation>',
      '  </PubmedArticle>',
      '  <PubmedArticle>',
      '    <MedlineCitation><PMID>13579246</PMID>',
      '      <Article>',
      '        <Journal><JournalIssue><PubDate /></JournalIssue><Title>Second Journal</Title></Journal>',
      '        <ArticleTitle>Article date fallback</ArticleTitle>',
      '        <ArticleDate DateType="Electronic"><Year>2018</Year><Month>05</Month></ArticleDate>',
      '      </Article>',
      '    </MedlineCitation>',
      '  </PubmedArticle>',
      '</PubmedArticleSet>'
    ].join('\n')
    const { client } = createClient({ efetch: () => xmlResponse(inline) })

    const result = await client.search(request)

    expect(result.sources.map((source) => ({
      pmid: source.pmid,
      year: source.year,
      doi: source.doi,
      abstract: source.abstract,
      journal: source.journal
    }))).toEqual([
      {
        pmid: '24681357', year: 2020, doi: '10.1000/elocation.2020.7',
        abstract: 'Abstract body.', journal: 'Fallback Journal'
      },
      {
        pmid: '13579246', year: 2018, doi: undefined,
        abstract: '', journal: 'Second Journal'
      }
    ])
  })

  it('removes duplicate PMIDs across queries before the batched fetch', async () => {
    const { client, calls } = createClient({
      esearch: (_url, callIndex) => callIndex === 0
        ? jsonResponse(esearchFixture)
        : jsonResponse(esearchPayload(['87654321', '11223344'], 7))
    })

    const result = await client.search({ ...request, searchQueries: ['first query', 'second query'] })

    expect(callsTo(calls, EFETCH_PATH)).toEqual([
      `${EFETCH_URL_PREFIX}db=pubmed&id=12345678%2C87654321%2C11223344&rettype=abstract&retmode=xml` +
      '&tool=easyepi&email=easyepi%40example.invalid'
    ])
    expect(result.diagnostics[0]?.sourceCount).toBe(2)
    expect(result.diagnostics[1]?.sourceCount).toBe(1)
  })

  it('skips PubmedBookArticle records and articles without a title without aborting the batch', async () => {
    const { client } = createClient()

    const result = await client.search(request)

    expect(result.sources.map((source) => source.sourceId))
      .toEqual(['pubmed:12345678', 'pubmed:87654321'])
    expect(result.sources.some((source) => source.pmid === '55556666')).toBe(false)
    expect(result.sources.some((source) => source.pmid === '11112222')).toBe(false)
  })

  it('caps the collected PMIDs at maxSources', async () => {
    const { client, calls } = createClient({}, { maxSources: 1 })

    const result = await client.search(request)

    expect(callsTo(calls, EFETCH_PATH)).toEqual([
      `${EFETCH_URL_PREFIX}db=pubmed&id=12345678&rettype=abstract&retmode=xml` +
      '&tool=easyepi&email=easyepi%40example.invalid'
    ])
    expect(result.sources).toEqual([FIRST_ARTICLE])
    expect(result.diagnostics[0]).toMatchObject({ outcome: 'truncated', sourceCount: 1 })
  })

  it('returns an empty result without calling EFetch when no PMIDs are found', async () => {
    const { client, calls } = createClient({ esearch: () => jsonResponse(esearchPayload([], 0)) })

    const result = await client.search(request)

    expect(calls).toHaveLength(1)
    expect(result).toEqual({
      sources: [],
      diagnostics: [
        {
          stage: 'literature', protocol: 'pubmed-esearch', outcome: 'empty',
          status: 200, sourceCount: 0, retryCount: 0
        },
        {
          stage: 'literature', protocol: 'pubmed-efetch', outcome: 'empty',
          sourceCount: 0, retryCount: 0
        }
      ]
    })
  })

  it('reports an unusable ESearch payload without aborting the run', async () => {
    const { client } = createClient({
      esearch: () => jsonResponse('{"esearchresult":{"idlist":["not-a-pmid"]}}')
    })

    const result = await client.search(request)

    expect(result.sources).toEqual([])
    expect(result.diagnostics[0]).toEqual({
      stage: 'literature', protocol: 'pubmed-esearch', outcome: 'invalid',
      status: 200, retryCount: 0, errorCode: 'AI_PUBMED_UNAVAILABLE'
    })
  })

  it('retries HTTP 429 after the fixed 500 ms delay and records the retry', async () => {
    const { client, calls, waits } = createClient({
      esearch: (_url, callIndex) => callIndex === 0
        ? new Response('rate limited', { status: 429 })
        : jsonResponse(esearchFixture)
    })

    const result = await client.search(request)

    expect(callsTo(calls, ESEARCH_PATH)).toHaveLength(2)
    expect(waits).toEqual([500, 334])
    expect(result.diagnostics[0]).toMatchObject({
      protocol: 'pubmed-esearch', outcome: 'success', status: 200, retryCount: 1
    })
    expect(result.sources).toEqual([FIRST_ARTICLE, SECOND_ARTICLE])
  })

  const retryAfterCases: Array<[string, number[]]> = [
    ['3', [3_000, 334]],
    ['003', [3_000, 334]],
    ['0', [334, 334]],
    ['60', [500, 334]],
    ['later', [500, 334]],
    ['99999999999999', [500, 334]]
  ]

  it.each(retryAfterCases)('honours Retry-After %s only inside the 0..5 second range', async (retryAfter, expectedWaits) => {
    const { client, waits } = createClient({
      esearch: (_url, callIndex) => callIndex === 0
        ? new Response('rate limited', { status: 429, headers: { 'retry-after': retryAfter } })
        : jsonResponse(esearchFixture)
    })

    await client.search(request)

    expect(waits).toEqual(expectedWaits)
  })

  it('exhausts two retries on a 5xx response and reports the failed ESearch', async () => {
    const { client, calls, waits } = createClient({
      esearch: () => new Response('service unavailable', { status: 503 })
    })

    const result = await client.search(request)

    expect(callsTo(calls, ESEARCH_PATH)).toHaveLength(3)
    expect(callsTo(calls, EFETCH_PATH)).toHaveLength(0)
    expect(waits).toEqual([500, 1_000])
    expect(result.sources).toEqual([])
    expect(result.diagnostics[0]).toEqual({
      stage: 'literature', protocol: 'pubmed-esearch', outcome: 'failed',
      status: 503, retryCount: 2, errorCode: 'AI_PUBMED_UNAVAILABLE'
    })
  })

  it('does not retry a 4xx response other than 429', async () => {
    const { client, fetcher } = createClient({
      esearch: () => new Response('bad request', { status: 400 })
    })

    const result = await client.search(request)

    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(result.diagnostics[0]).toEqual({
      stage: 'literature', protocol: 'pubmed-esearch', outcome: 'failed',
      status: 400, retryCount: 0, errorCode: 'AI_PUBMED_UNAVAILABLE'
    })
  })

  it('rejects with AI_CANCELLED when the signal aborts during a retry delay', async () => {
    const controller = new AbortController()
    const fetcher = vi.fn(async (): Promise<Response> => (
      new Response('rate limited', { status: 429, headers: { 'retry-after': '3' } })
    ))
    const client = createPubMedClient({ fetch: fetcher, now: () => 0 })

    const pending = client.search(request, controller.signal)
    const abortTimer = setTimeout(() => { controller.abort() }, 20)

    await expect(pending).rejects.toMatchObject({ errorCode: 'AI_CANCELLED' })
    clearTimeout(abortTimer)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('treats an injected wait that returns after an abort as a cancellation', async () => {
    const controller = new AbortController()
    const fetcher = vi.fn(async (): Promise<Response> => (
      new Response('rate limited', { status: 429 })
    ))
    const client = createPubMedClient({
      fetch: fetcher,
      now: () => 0,
      wait: async () => { controller.abort() }
    })

    await expect(client.search(request, controller.signal))
      .rejects.toMatchObject({ errorCode: 'AI_CANCELLED' })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('rejects an already aborted signal without starting a network call', async () => {
    const controller = new AbortController()
    controller.abort()
    const { client, fetcher } = createClient()

    await expect(client.search(request, controller.signal))
      .rejects.toMatchObject({ errorCode: 'AI_CANCELLED' })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('rejects with AI_CANCELLED when the signal aborts while a body is streaming', async () => {
    const controller = new AbortController()
    const stream = new ReadableStream<Uint8Array>({ start() { /* never closes on its own */ } })
    const fetcher = vi.fn(async (): Promise<Response> => (
      new Response(stream, { status: 200, headers: { 'content-type': 'application/json' } })
    ))
    const client = createPubMedClient({ fetch: fetcher, now: () => 0 })

    const pending = client.search(request, controller.signal)
    const abortTimer = setTimeout(() => { controller.abort() }, 20)

    await expect(pending).rejects.toMatchObject({ errorCode: 'AI_CANCELLED' })
    clearTimeout(abortTimer)
  })
})

describe('PubMed transport safety', () => {
  it('pins the documented E-utilities origin and paths', () => {
    expect(EUTILS_ORIGIN).toBe('https://eutils.ncbi.nlm.nih.gov')
    expect(ESEARCH_PATH).toBe('/entrez/eutils/esearch.fcgi')
    expect(EFETCH_PATH).toBe('/entrez/eutils/efetch.fcgi')
    expect(DEFAULT_CONTACT_EMAIL).toBe('easyepi@example.invalid')
    expect(assertTrustedEUtilsUrl(`${EUTILS_ORIGIN}${ESEARCH_PATH}?db=pubmed`).host)
      .toBe('eutils.ncbi.nlm.nih.gov')
  })

  it.each([
    'http://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed',
    'ftp://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed',
    'https://eutils.attacker.example/entrez/eutils/esearch.fcgi?db=pubmed',
    'https://eutils.ncbi.nlm.nih.gov.attacker.example/entrez/eutils/esearch.fcgi',
    'https://user:secret@eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi',
    '/entrez/eutils/esearch.fcgi?db=pubmed',
    'not a url'
  ])('rejects %s', (url) => {
    expect(() => assertTrustedEUtilsUrl(url)).toThrow(ResearchContractError)
    expect(() => assertTrustedEUtilsUrl(url)).toThrow('AI_PUBMED_UNAVAILABLE')
  })

  it('requests only the pinned eutils origin', async () => {
    const { client, calls } = createClient()

    await client.search(request)

    expect(calls.every((url) => url.startsWith(`${EUTILS_ORIGIN}/entrez/eutils/`))).toBe(true)
  })

  it('discards a response the transport already redirected', async () => {
    const { client, calls } = createClient({
      esearch: () => {
        const response = jsonResponse(esearchFixture)
        Object.defineProperty(response, 'redirected', { value: true })
        return response
      }
    })

    const result = await client.search(request)

    expect(calls).toHaveLength(1)
    expect(result.sources).toEqual([])
    expect(result.diagnostics[0]).toEqual({
      stage: 'literature', protocol: 'pubmed-esearch', outcome: 'failed',
      retryCount: 0, errorCode: 'AI_PUBMED_UNAVAILABLE'
    })
  })

  it('rejects a response whose declared length exceeds maxResponseBytes', async () => {
    const { client } = createClient(
      {
        esearch: () => new Response(esearchFixture, {
          status: 200, headers: { 'content-length': '9999999' }
        })
      },
      { maxResponseBytes: 1_000 }
    )

    const result = await client.search(request)

    expect(result.sources).toEqual([])
    expect(result.diagnostics[0]).toMatchObject({
      protocol: 'pubmed-esearch', outcome: 'failed', errorCode: 'AI_PUBMED_UNAVAILABLE'
    })
  })

  it('cancels a body that grows past maxResponseBytes while streaming', async () => {
    const { client } = createClient({}, { maxResponseBytes: 16 })

    const result = await client.search(request)

    expect(result.sources).toEqual([])
    expect(result.diagnostics[0]).toMatchObject({
      protocol: 'pubmed-esearch', outcome: 'failed', errorCode: 'AI_PUBMED_UNAVAILABLE'
    })
  })

  it('reports an unreadable EFetch response without throwing', async () => {
    const { client } = createClient({
      efetch: () => new Response('gateway timeout', { status: 504 })
    })

    const result = await client.search(request)

    expect(result.sources).toEqual([])
    expect(result.diagnostics[1]).toEqual({
      stage: 'literature', protocol: 'pubmed-efetch', outcome: 'failed',
      status: 504, sourceCount: 0, retryCount: 2, errorCode: 'AI_PUBMED_UNAVAILABLE'
    })
  })
})

describe('PubMed bounded XML parsing', () => {
  function searchWithXml(xml: string): Promise<unknown> {
    const { client } = createClient({ efetch: () => xmlResponse(xml) })
    return client.search(request)
  }

  it('accepts a document nested exactly at the depth limit', async () => {
    const xml = `<PubmedArticleSet>${'<n>'.repeat(31)}${'</n>'.repeat(31)}</PubmedArticleSet>`

    const result = await searchWithXml(xml)

    expect(result).toMatchObject({ sources: [] })
  })

  it('rejects a document nested deeper than the depth limit', async () => {
    const xml = `<PubmedArticleSet>${'<n>'.repeat(32)}${'</n>'.repeat(32)}</PubmedArticleSet>`

    await expect(searchWithXml(xml)).rejects.toMatchObject({ errorCode: 'AI_PUBMED_UNAVAILABLE' })
  })

  it('rejects a document with more nodes than the node limit', async () => {
    const xml = `<PubmedArticleSet>${'<n>x</n>'.repeat(60_000)}</PubmedArticleSet>`

    await expect(searchWithXml(xml)).rejects.toMatchObject({ errorCode: 'AI_PUBMED_UNAVAILABLE' })
  })

  const refusedDocuments: Array<[string, string]> = [
    ['a document type declaration', [
      '<!DOCTYPE PubmedArticleSet SYSTEM "https://pubmed.ncbi.nlm.nih.gov/pubmed.dtd">',
      '<PubmedArticleSet />'
    ].join('')],
    ['an internal entity declaration', [
      '<!DOCTYPE PubmedArticleSet [<!ENTITY custom "value">]>',
      '<PubmedArticleSet><PubmedArticle><MedlineCitation><PMID>1</PMID>',
      '<Article><ArticleTitle>&custom;</ArticleTitle></Article>',
      '</MedlineCitation></PubmedArticle></PubmedArticleSet>'
    ].join('')],
    ['an undeclared entity reference', [
      '<PubmedArticleSet><PubmedArticle><MedlineCitation><PMID>1</PMID>',
      '<Article><ArticleTitle>&custom;</ArticleTitle></Article>',
      '</MedlineCitation></PubmedArticle></PubmedArticleSet>'
    ].join('')]
  ]

  it.each(refusedDocuments)('rejects %s', async (_label, xml) => {
    await expect(searchWithXml(xml)).rejects.toMatchObject({ errorCode: 'AI_PUBMED_UNAVAILABLE' })
  })

  it('rejects malformed markup instead of returning a partial batch', async () => {
    const xml = '<PubmedArticleSet><PubmedArticle><MedlineCitation></PubmedArticleSet>'

    await expect(searchWithXml(xml)).rejects.toMatchObject({ errorCode: 'AI_PUBMED_UNAVAILABLE' })
  })
})
