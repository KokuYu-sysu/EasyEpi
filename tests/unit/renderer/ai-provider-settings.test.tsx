import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AIProviderSettings } from '@renderer/components/ai/AIProviderSettings'
import type { AIProviderConfigView } from '@shared/ai-assistant-contract'

const savedConfig: AIProviderConfigView = {
  providerId: 'custom',
  baseUrl: 'https://api.example.com/v1',
  model: 'research-model',
  webSearchEnabled: false,
  hasApiKey: true,
  maskedApiKey: 'sk-***'
}

const emptyConfig: AIProviderConfigView = {
  providerId: 'custom',
  baseUrl: '',
  model: '',
  webSearchEnabled: false,
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

  it('loads, tests, updates, and clears a complete provider configuration', async () => {
    const user = userEvent.setup()
    const updatedConfig = {
      ...savedConfig,
      baseUrl: 'https://new.example.com/v1',
      model: 'new-model'
    }
    const config = installConfigApi({
      update: vi.fn().mockResolvedValue({ ok: true, config: updatedConfig })
    })
    render(<AIProviderSettings />)

    expect(await screen.findByDisplayValue(savedConfig.baseUrl)).toBeVisible()
    expect(screen.getByLabelText('API Key')).toHaveAttribute(
      'placeholder',
      '已安全保存；留空将保留原 Key'
    )

    await user.click(screen.getByRole('button', { name: '测试连接' }))
    expect(await screen.findByText('连接成功。')).toBeVisible()

    await user.clear(screen.getByLabelText('Base URL'))
    await user.type(screen.getByLabelText('Base URL'), updatedConfig.baseUrl)
    await user.clear(screen.getByLabelText('模型名称'))
    await user.type(screen.getByLabelText('模型名称'), updatedConfig.model)
    await user.type(screen.getByLabelText('API Key'), 'new-secret')
    expect(screen.getByText('服务地址变化后需重新输入 API Key')).toBeVisible()
    await user.click(screen.getByRole('button', { name: '保存' }))

    expect(config.update).toHaveBeenCalledWith({
      providerId: 'custom',
      baseUrl: updatedConfig.baseUrl,
      model: updatedConfig.model,
      webSearchEnabled: false,
      apiKey: 'new-secret'
    })
    expect(await screen.findByText('AI 服务配置已保存。')).toBeVisible()

    await user.click(screen.getByRole('button', { name: '清除 API 配置' }))
    expect(await screen.findByText('AI 服务配置已清除。')).toBeVisible()
    expect(screen.getByText('未配置 API Key。')).toBeVisible()
  })

  it('validates empty and unsaved settings before calling the service', async () => {
    const user = userEvent.setup()
    const config = installConfigApi({
      get: vi.fn().mockResolvedValue({ ok: true, config: emptyConfig })
    })
    render(<AIProviderSettings />)

    expect(await screen.findByText('未配置 API Key。')).toBeVisible()
    await user.click(screen.getByRole('button', { name: '保存' }))
    expect(screen.getByRole('alert')).toHaveTextContent('请填写 Base URL 和模型名称。')

    await user.click(screen.getByRole('button', { name: '测试连接' }))
    expect(screen.getByRole('alert')).toHaveTextContent('请先保存完整的 AI 服务配置。')

    await user.type(screen.getByLabelText('Base URL'), 'https://draft.example.com/v1')
    await user.type(screen.getByLabelText('模型名称'), 'draft-model')
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
    await screen.findByDisplayValue(savedConfig.baseUrl)

    await user.click(screen.getByRole('button', { name: '保存' }))
    expect(await screen.findByRole('alert')).toBeVisible()
    await user.click(screen.getByRole('button', { name: '清除 API 配置' }))
    expect(await screen.findByRole('alert')).toBeVisible()
    await user.click(screen.getByRole('button', { name: '测试连接' }))
    expect(await screen.findByRole('alert')).toBeVisible()

    expect(config.update).toHaveBeenCalledWith({
      providerId: 'custom',
      baseUrl: savedConfig.baseUrl,
      model: savedConfig.model,
      webSearchEnabled: false
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
    await user.type(screen.getByLabelText('Base URL'), savedConfig.baseUrl)
    await user.type(screen.getByLabelText('模型名称'), savedConfig.model)
    await user.click(screen.getByRole('button', { name: '保存' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('无法保存 AI 服务配置。')

    await user.click(screen.getByRole('button', { name: '清除 API 配置' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('无法清除 AI 服务配置。')

    expect(config.update).toHaveBeenCalledOnce()
    expect(config.clear).toHaveBeenCalledOnce()
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
    await screen.findByDisplayValue(savedConfig.baseUrl)
    await user.click(screen.getByRole('button', { name: '测试连接' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('AI 服务连接测试失败。')
  })
})
  it('adopts official provider URLs and saves the web-search preference', async () => {
    const user = userEvent.setup()
    const config = installConfigApi()
    render(<AIProviderSettings />)
    await screen.findByDisplayValue(savedConfig.baseUrl)

    await user.selectOptions(screen.getByLabelText('AI 厂商'), 'openai')
    expect(screen.getByLabelText('Base URL')).toHaveValue('https://api.openai.com/v1')
    await user.click(screen.getByLabelText('启用内置联网搜索'))
    expect(screen.getByText(/可能产生额外费用/)).toBeVisible()
    await user.type(screen.getByLabelText('API Key'), 'new-secret')
    await user.click(screen.getByRole('button', { name: '保存' }))

    expect(config.update).toHaveBeenCalledWith({
      providerId: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: savedConfig.model,
      webSearchEnabled: true,
      apiKey: 'new-secret'
    })
  })
