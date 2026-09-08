import { describe, expect, it, vi } from 'vitest'

import { createAIResearchService } from '@main/services/ai-research.service'

function chatResponse(content = 'Evidence summary'): Response {
  return new Response(JSON.stringify({
    id: 'chat_1', object: 'chat.completion',
    choices: [{
      index: 0, finish_reason: 'stop',
      message: { role: 'assistant', content }
    }]
  }), { status: 200, headers: { 'content-type': 'application/json' } })
}

describe('provider built-in research service', () => {
  it.each([
    ['deepseek', 'https://api.deepseek.com'],
    ['gemini', 'https://generativelanguage.googleapis.com/v1beta/openai'],
    ['custom', 'https://gateway.example/v1']
  ] as const)('returns unsupported for %s without a network request', async (providerId, baseUrl) => {
    const fetcher = vi.fn()
    const service = createAIResearchService({ fetch: fetcher })
    await expect(service.research({
      providerId, baseUrl, model: 'model', enabled: true, query: 'lung cancer screening'
    })).resolves.toEqual({ status: 'unsupported', evidence: '', citations: [] })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('returns disabled without a network request', async () => {
    const fetcher = vi.fn()
    const service = createAIResearchService({ fetch: fetcher })
    await expect(service.research({
      providerId: 'qwen', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      model: 'qwen-plus', enabled: false, query: 'lung cancer screening'
    })).resolves.toEqual({ status: 'disabled', evidence: '', citations: [] })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it.each([
    ['qwen', 'https://dashscope.aliyuncs.com/compatible-mode/v1', {
      enable_search: true,
      search_options: { forced_search: true, search_strategy: 'max' }
    }],
    ['glm', 'https://open.bigmodel.cn/api/paas/v4', {
      tools: [{
        type: 'web_search',
        web_search: { enable: true, search_engine: 'search_pro', search_result: true, count: 10 }
      }]
    }],
    ['mimo', 'https://api.xiaomimimo.com/v1', {
      thinking: { type: 'disabled' },
      tools: [{ type: 'web_search', max_keyword: 3, force_search: true, limit: 10 }],
      tool_choice: 'auto'
    }]
  ] as const)('uses only the approved %s Chat search extension', async (providerId, baseUrl, expected) => {
    const fetcher = vi.fn().mockResolvedValue(chatResponse())
    const service = createAIResearchService({ fetch: fetcher })
    await expect(service.research({
      providerId, baseUrl, model: 'model', enabled: true, query: 'lung cancer screening'
    })).resolves.toEqual({ status: 'searched', evidence: 'Evidence summary', citations: [] })
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))
    expect(body).toMatchObject(expected)
    expect(body.messages[0].content).toContain('PubMed')
    expect(body.messages[0].content).toContain('Web of Science')
    expect(body.messages[0].content).toContain('Cochrane Library')
    expect(fetcher.mock.calls[0]?.[0]).toBe(`${baseUrl}/chat/completions`)
  })

  it.each([
    ['openai', 'https://api.openai.com/v1', ['pubmed.ncbi.nlm.nih.gov', 'who.int']],
    ['xai', 'https://api.x.ai/v1', undefined]
  ] as const)('uses the %s compatible Responses search transport', async (providerId, baseUrl, allowedDomains) => {
    const responses = {
      search: vi.fn().mockResolvedValue({
        content: 'Evidence', citations: [{ url: 'https://who.int/a', title: 'WHO' }],
        searched: true, streamingSupported: false
      })
    }
    const service = createAIResearchService({ responsesClient: responses })
    await expect(service.research({
      providerId, baseUrl, model: 'model', enabled: true, query: 'lung cancer screening'
    })).resolves.toEqual({
      status: 'searched', evidence: 'Evidence',
      citations: [{ url: 'https://who.int/a', title: 'WHO' }]
    })
    expect(responses.search).toHaveBeenCalledWith(expect.objectContaining({
      baseUrl, model: 'model', allowedDomains
    }))
  })

  it('completes the bounded Kimi built-in search tool round trip', async () => {
    const toolCall = {
      id: 'web_search:0', type: 'builtin_function',
      function: { name: '$web_search', arguments: '{"query":"lung cancer","total_tokens":1200}' }
    }
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{
          index: 0, finish_reason: 'tool_calls',
          message: { role: 'assistant', content: null, tool_calls: [toolCall] }
        }]
      }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(chatResponse('Kimi evidence'))
    const service = createAIResearchService({ fetch: fetcher })

    await expect(service.research({
      providerId: 'moonshot', baseUrl: 'https://api.moonshot.cn/v1',
      model: 'kimi-k2.6', enabled: true, query: 'lung cancer screening'
    })).resolves.toEqual({ status: 'searched', evidence: 'Kimi evidence', citations: [] })

    const secondBody = JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))
    expect(secondBody).toMatchObject({
      thinking: { type: 'disabled' },
      tools: [{ type: 'builtin_function', function: { name: '$web_search' } }]
    })
    expect(secondBody.messages.at(-1)).toEqual({
      role: 'tool', tool_call_id: 'web_search:0', name: '$web_search',
      content: '{"query":"lung cancer","total_tokens":1200}'
    })
  })

  it('turns provider failures into an explicit offline result', async () => {
    const service = createAIResearchService({
      fetch: vi.fn().mockResolvedValue(new Response('secret', { status: 429 }))
    })
    await expect(service.research({
      providerId: 'qwen', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      model: 'qwen-plus', enabled: true, query: 'lung cancer screening'
    })).resolves.toEqual({ status: 'failed', evidence: '', citations: [] })
  })
})
