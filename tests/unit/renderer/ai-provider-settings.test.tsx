import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AIProviderSettings } from '@renderer/components/ai/AIProviderSettings'
import type { AIProviderConfigView } from '@shared/ai-assistant-contract'

const DEEPSEEK_BASE_URL = 'https://api.deepseek.com'
const DEEPSEEK_DEFAULT_MODEL = 'deepseek-v4.1-flash'

const savedConfig: AIProviderConfigView = {
  baseUrl: DEEPSEEK_BASE_URL,
  model: 'research-model',
  hasApiKey: true,
  maskedApiKey: '••••••••'
}

const emptyConfig: AIProviderConfigView = {
  baseUrl: DEEPSEEK_BASE_URL,
  model: '',
  hasApiKey: false,
  maskedApiKey: null
}

const modelOnlyConfig: AIProviderConfigView = {
  baseUrl: DEEPSEEK_BASE_URL,
  model: DEEPSEEK_DEFAULT_MODEL,
  hasApiKey: false,
  maskedApiKey: null
}

function installConfigApi(overrides: Record<string, unknown> = {}) {
  const config = {
    get: vi.fn().mockResolvedValue({ ok: true, config: savedConfig }),
    update: vi.fn().mockResolvedValue({ ok: true, config: savedConfig }),
    clear: vi.fn().mockResolvedValue({ ok: true, config: emptyConfig }),
    testConnection: vi.fn().mockResolvedValue({ ok: true }),
    ...overrides
  }
  Object.defineProperty(window, 'easyEpi', {
    configurable: true,
    value: { ai: { config } }
  })
  return config
}

describe('AIProviderSettings', () => {
  afterEach(() => Reflect.deleteProperty(window, 'easyEpi'))

  it('loads, tests, updates, and clears a DeepSeek-only service configuration', async () => {
    const user = userEvent.setup()
    const updatedConfig: AIProviderConfigView = { ...savedConfig, model: 'new-model' }
    const config = installConfigApi({
      update: vi.fn().mockResolvedValue({ ok: true, config: updatedConfig })
    })
    render(<AIProviderSettings />)

    expect(await screen.findByDisplayValue(savedConfig.model)).toBeVisible()
    expect(screen.getByLabelText('API Key')).toHaveAttribute(
      'placeholder',
      '已安全保存；留空将保留原 Key'
    )

    await user.click(screen.getByRole('button', { name: '测试连接' }))
    expect(await screen.findByText('连接成功。')).toBeVisible()

    await user.clear(screen.getByLabelText('模型名称'))
    await user.type(screen.getByLabelText('模型名称'), updatedConfig.model)
    await user.type(screen.getByLabelText('API Key'), 'new-secret')
    await user.click(screen.getByRole('button', { name: '保存' }))

    expect(config.update).toHaveBeenCalledWith({
      baseUrl: DEEPSEEK_BASE_URL,
      model: updatedConfig.model,
      apiKey: 'new-secret'
    })
    expect(Object.keys(config.update.mock.calls[0]![0] as Record<string, unknown>).sort())
      .toEqual(['apiKey', 'baseUrl', 'model'])
    expect(await screen.findByText('AI 服务配置已保存。')).toBeVisible()

    await user.click(screen.getByRole('button', { name: '清除 API 配置' }))
    expect(await screen.findByText('AI 服务配置已清除。')).toBeVisible()
    expect(screen.getByText('未配置 API Key。')).toBeVisible()
    expect(screen.getByLabelText('API Key')).toHaveAttribute(
      'placeholder',
      '请输入 DeepSeek API Key'
    )
  })

  it('renders only the fixed DeepSeek endpoint, a model field, and an API key field', async () => {
    const user = userEvent.setup()
    const config = installConfigApi()
    render(<AIProviderSettings />)

    await screen.findByDisplayValue(savedConfig.model)

    expect(screen.getByText(/服务地址：/)).toHaveTextContent(DEEPSEEK_BASE_URL)
    expect(screen.getByText(/固定为 DeepSeek 官方接口/)).toBeVisible()
    expect(screen.getByLabelText('模型名称')).toHaveValue(savedConfig.model)
    expect(screen.getByLabelText('模型名称')).toHaveAttribute(
      'placeholder',
      DEEPSEEK_DEFAULT_MODEL
    )
    expect(screen.getByText('常用：deepseek-v4.1-flash、deepseek-v4-pro')).toBeVisible()
    expect(screen.getByLabelText('API Key')).toHaveAttribute(
      'placeholder',
      '已安全保存；留空将保留原 Key'
    )
    expect(screen.getByText('为保护凭据，已保存的 Key 不会回显。')).toBeVisible()
    expect(screen.getByRole('link', { name: 'NCBI E-utilities 使用条款' })).toHaveAttribute(
      'href',
      'https://www.ncbi.nlm.nih.gov/books/NBK25497/'
    )

    expect(screen.queryByLabelText('AI 厂商')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Base URL')).not.toBeInTheDocument()
    expect(screen.queryByText('Base URL')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('启用内置联网搜索')).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()

    // A stored key is never echoed, so a model-only change must not send an API key at all.
    await user.clear(screen.getByLabelText('模型名称'))
    await user.type(screen.getByLabelText('模型名称'), 'draft-model')
    await user.click(screen.getByRole('button', { name: '保存' }))

    expect(config.update).toHaveBeenCalledWith({
      baseUrl: DEEPSEEK_BASE_URL,
      model: 'draft-model'
    })
    expect(Object.keys(config.update.mock.calls[0]![0] as Record<string, unknown>).sort())
      .toEqual(['baseUrl', 'model'])
  })

  it('defaults 模型名称 to deepseek-v4.1-flash when the stored model is empty', async () => {
    const user = userEvent.setup()
    const config = installConfigApi({
      get: vi.fn().mockResolvedValue({ ok: true, config: emptyConfig })
    })
    render(<AIProviderSettings />)

    const modelInput = await screen.findByLabelText('模型名称')
    expect(modelInput).toHaveValue(DEEPSEEK_DEFAULT_MODEL)
    expect(modelInput).toHaveAttribute('placeholder', DEEPSEEK_DEFAULT_MODEL)
    expect(screen.getByText('常用：deepseek-v4.1-flash、deepseek-v4-pro')).toBeVisible()
    expect(screen.getByText('未配置 API Key。')).toBeVisible()
    expect(screen.getByLabelText('API Key')).toHaveAttribute(
      'placeholder',
      '请输入 DeepSeek API Key'
    )

    await user.clear(modelInput)
    await user.click(screen.getByRole('button', { name: '保存' }))
    expect(screen.getByRole('alert')).toHaveTextContent('请填写模型名称。')
    expect(config.update).not.toHaveBeenCalled()
  })

  it('guards the connection test against unsaved changes and a missing API key', async () => {
    const user = userEvent.setup()
    const config = installConfigApi({
      get: vi.fn().mockResolvedValue({ ok: true, config: modelOnlyConfig })
    })
    render(<AIProviderSettings />)

    await screen.findByDisplayValue(DEEPSEEK_DEFAULT_MODEL)
    await user.click(screen.getByRole('button', { name: '测试连接' }))
    expect(screen.getByRole('alert')).toHaveTextContent('请先保存完整的 AI 服务配置。')

    await user.type(screen.getByLabelText('模型名称'), '-draft')
    await user.click(screen.getByRole('button', { name: '测试连接' }))
    expect(screen.getByRole('alert')).toHaveTextContent('当前有未保存的更改')
    expect(config.testConnection).not.toHaveBeenCalled()
  })

  it('shows service errors for failed save, clear, and connection operations', async () => {
    const user = userEvent.setup()
    const config = installConfigApi({
      update: vi.fn().mockResolvedValue({ ok: false, errorCode: 'AI_CONFIG_INVALID' }),
      clear: vi.fn().mockResolvedValue({ ok: false, errorCode: 'AI_CONFIG_STORAGE_FAILED' }),
      testConnection: vi.fn().mockResolvedValue({ ok: false, errorCode: 'AI_PROVIDER_UNREACHABLE' })
    })
    render(<AIProviderSettings />)
    await screen.findByDisplayValue(savedConfig.model)

    await user.click(screen.getByRole('button', { name: '保存' }))
    expect(await screen.findByRole('alert')).toBeVisible()
    await user.click(screen.getByRole('button', { name: '清除 API 配置' }))
    expect(await screen.findByRole('alert')).toBeVisible()
    await user.click(screen.getByRole('button', { name: '测试连接' }))
    expect(await screen.findByRole('alert')).toBeVisible()

    expect(config.update).toHaveBeenCalledWith({
      baseUrl: DEEPSEEK_BASE_URL,
      model: savedConfig.model
    })
    expect(config.clear).toHaveBeenCalledOnce()
    expect(config.testConnection).toHaveBeenCalledOnce()
  })

  it('handles rejected loading and mutation requests without leaking raw errors', async () => {
    const user = userEvent.setup()
    const config = installConfigApi({
      get: vi.fn().mockRejectedValue(new Error('secret-load-detail')),
      update: vi.fn().mockRejectedValue(new Error('secret-save-detail')),
      clear: vi.fn().mockRejectedValue(new Error('secret-clear-detail')),
      testConnection: vi.fn().mockRejectedValue(new Error('secret-test-detail'))
    })
    render(<AIProviderSettings />)

    expect(await screen.findByRole('alert')).toHaveTextContent('无法读取 AI 服务配置。')
    await user.clear(screen.getByLabelText('模型名称'))
    await user.type(screen.getByLabelText('模型名称'), savedConfig.model)
    await user.click(screen.getByRole('button', { name: '保存' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('无法保存 AI 服务配置。')

    await user.click(screen.getByRole('button', { name: '清除 API 配置' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('无法清除 AI 服务配置。')

    expect(config.update).toHaveBeenCalledOnce()
    expect(config.clear).toHaveBeenCalledOnce()
    expect(screen.queryByText(/secret-(load|save|clear|test)-detail/)).not.toBeInTheDocument()
  })

  it('handles explicit load failures and rejected connection tests', async () => {
    const failedLoad = installConfigApi({
      get: vi.fn().mockResolvedValue({ ok: false, errorCode: 'AI_CONFIG_STORAGE_FAILED' })
    })
    const firstView = render(<AIProviderSettings />)
    expect(await screen.findByRole('alert')).toBeVisible()
    expect(failedLoad.get).toHaveBeenCalledOnce()
    firstView.unmount()

    const user = userEvent.setup()
    installConfigApi({
      testConnection: vi.fn().mockRejectedValue(new Error('secret-provider-detail'))
    })
    render(<AIProviderSettings />)
    await screen.findByDisplayValue(savedConfig.model)
    await user.click(screen.getByRole('button', { name: '测试连接' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('AI 服务连接测试失败。')
    expect(screen.queryByText(/secret-provider-detail/)).not.toBeInTheDocument()
  })
})
