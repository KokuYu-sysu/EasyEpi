import { useCallback, useEffect, useState } from 'react'

import { Button, Input } from '@renderer/components/ui'
import type { AIProviderConfigView, AIProviderId } from '@shared/ai-assistant-contract'
import { AI_PROVIDER_PRESETS } from '@shared/ai-provider-profiles'
import { friendlyAIError } from './ai-errors'
import { notifyAIConfigChanged } from './ai-config-events'

const EMPTY_CONFIG: AIProviderConfigView = {
  providerId: 'custom',
  baseUrl: '',
  model: '',
  webSearchEnabled: false,
  hasApiKey: false,
  maskedApiKey: null
}

export function AIProviderSettings() {
  const [saved, setSaved] = useState<AIProviderConfigView>(EMPTY_CONFIG)
  const [providerId, setProviderId] = useState<AIProviderId>('custom')
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [webSearchEnabled, setWebSearchEnabled] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const providerChanged = providerId !== (saved.providerId ?? 'custom')
  const baseUrlChanged = providerChanged || baseUrl.trim() !== saved.baseUrl
  const searchSupported = !['deepseek', 'gemini', 'custom'].includes(providerId)

  const adopt = useCallback((config: AIProviderConfigView) => {
    setSaved(config)
    setProviderId(config.providerId ?? 'custom')
    setBaseUrl(config.baseUrl)
    setModel(config.model)
    setWebSearchEnabled(config.webSearchEnabled === true)
    setApiKey('')
    setDirty(false)
  }, [])

  useEffect(() => {
    let active = true
    void window.easyEpi.ai.config.get().then((result) => {
      if (!active) return
      if (result.ok) adopt(result.config)
      else setError(friendlyAIError(result.errorCode, '无法读取 AI 服务配置。'))
    }).catch(() => {
      if (active) setError('无法读取 AI 服务配置。')
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [adopt])

  const save = async () => {
    const nextBaseUrl = baseUrl.trim()
    const nextModel = model.trim()
    if (nextBaseUrl.length === 0 || nextModel.length === 0) {
      setError('请填写 Base URL 和模型名称。')
      return
    }
    setBusy(true)
    setError(null)
    setStatus(null)
    try {
      const result = await window.easyEpi.ai.config.update({
        providerId,
        baseUrl: nextBaseUrl,
        model: nextModel,
        webSearchEnabled,
        ...(apiKey.trim().length > 0 ? { apiKey } : {})
      })
      if (!result.ok) {
        setError(friendlyAIError(result.errorCode, '无法保存 AI 服务配置。'))
        return
      }
      adopt(result.config)
      notifyAIConfigChanged()
      setStatus('AI 服务配置已保存。')
    } catch {
      setError('无法保存 AI 服务配置。')
    } finally {
      setBusy(false)
    }
  }

  const clear = async () => {
    setBusy(true)
    setError(null)
    setStatus(null)
    try {
      const result = await window.easyEpi.ai.config.clear()
      if (!result.ok) {
        setError(friendlyAIError(result.errorCode, '无法清除 AI 服务配置。'))
        return
      }
      adopt(result.config)
      notifyAIConfigChanged()
      setStatus('AI 服务配置已清除。')
    } catch {
      setError('无法清除 AI 服务配置。')
    } finally {
      setBusy(false)
    }
  }

  const testConnection = async () => {
    if (dirty || providerId !== saved.providerId || baseUrl !== saved.baseUrl ||
      model !== saved.model || webSearchEnabled !== saved.webSearchEnabled || apiKey.length > 0) {
      setError('当前有未保存的更改，请先保存再测试连接。')
      return
    }
    if (!saved.baseUrl || !saved.model || !saved.hasApiKey) {
      setError('请先保存完整的 AI 服务配置。')
      return
    }
    setBusy(true)
    setError(null)
    setStatus(null)
    try {
      const result = await window.easyEpi.ai.config.testConnection()
      if (!result.ok) {
        setError(friendlyAIError(result.errorCode, 'AI 服务连接测试失败。'))
        return
      }
      setStatus('连接成功。')
    } catch {
      setError('AI 服务连接测试失败。')
    } finally {
      setBusy(false)
    }
  }

  const markDirty = () => {
    setDirty(true)
    setStatus(null)
  }

  return (
    <section aria-labelledby="ai-service-settings" className="grid gap-[var(--space-3)]">
      <div>
        <h3 id="ai-service-settings" className="m-0 text-[length:var(--font-size-lg)]">AI 服务</h3>
        <p className="mb-0 mt-[var(--space-1)] text-[length:var(--font-size-sm)] text-[var(--color-text-secondary)]">
          只需配置一次，即可跨项目复用。API Key 由系统安全存储保护。
          清除 API 配置不会清除已确认的隐私说明。
        </p>
      </div>
      {loading ? <p role="status" className="m-0">正在读取 AI 服务配置…</p> : (
        <>
          <label className="grid gap-[var(--space-1)] font-[var(--font-weight-medium)]">
            <span>AI 厂商</span>
            <select
              className="min-h-11 w-full rounded-[var(--radius-1)] border border-[var(--color-border-default)] bg-[var(--color-surface-base)] px-[var(--space-3)]"
              value={providerId}
              disabled={busy}
              onChange={(event) => {
                const next = event.target.value as AIProviderId
                const preset = AI_PROVIDER_PRESETS.find(({ id }) => id === next)!
                setProviderId(next)
                if (preset.defaultBaseUrl) setBaseUrl(preset.defaultBaseUrl)
                if (['deepseek', 'gemini', 'custom'].includes(next)) setWebSearchEnabled(false)
                markDirty()
              }}
            >
              {AI_PROVIDER_PRESETS.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}
            </select>
          </label>
          <Input
            label="Base URL"
            value={baseUrl}
            placeholder="https://api.example.com/v1"
            autoComplete="url"
            disabled={busy}
            onChange={(event) => { setBaseUrl(event.target.value); markDirty() }}
          />
          <Input
            label="模型名称"
            value={model}
            placeholder="model-name"
            autoComplete="off"
            disabled={busy}
            onChange={(event) => { setModel(event.target.value); markDirty() }}
          />
          <Input
            label="API Key"
            type="password"
            value={apiKey}
            placeholder={saved.hasApiKey && !baseUrlChanged
              ? '已安全保存；留空将保留原 Key'
              : '请输入 API Key'}
            autoComplete="new-password"
            disabled={busy}
            hint="为保护凭据，已保存的 Key 不会回显。"
            onChange={(event) => { setApiKey(event.target.value); markDirty() }}
          />
          <label className="flex items-start gap-[var(--space-2)]">
            <input
              type="checkbox"
              aria-label="启用内置联网搜索"
              checked={webSearchEnabled}
              disabled={busy || !searchSupported}
              onChange={(event) => { setWebSearchEnabled(event.target.checked); markDirty() }}
            />
            <span>
              启用内置联网搜索
              <small className="block text-[var(--color-text-secondary)]">
                {searchSupported
                  ? '可能产生额外费用，且可能需在厂商控制台开通。'
                  : '该厂商当前未提供可用的 OpenAI-Compatible 内置搜索；生成时将显示“本次未联网”。'}
              </small>
            </span>
          </label>
          {baseUrlChanged ? (
            <p role="status" className="m-0 text-[length:var(--font-size-sm)] text-[var(--color-warning)]">
              服务地址变化后需重新输入 API Key
            </p>
          ) : !saved.hasApiKey ? (
            <p className="m-0 text-[length:var(--font-size-sm)] text-[var(--color-text-secondary)]">
              未配置 API Key。
            </p>
          ) : null}
          {error ? <p role="alert" className="m-0 text-[var(--color-danger)]">{error}</p> : null}
          {status ? <p role="status" className="m-0 text-[var(--color-success)]">{status}</p> : null}
          <div className="flex flex-wrap justify-end gap-[var(--space-2)]">
            <Button variant="danger" onClick={() => void clear()} disabled={busy}>
              清除 API 配置
            </Button>
            <Button variant="secondary" onClick={() => void testConnection()} disabled={busy}>
              测试连接
            </Button>
            <Button onClick={() => void save()} loading={busy}>保存</Button>
          </div>
        </>
      )}
    </section>
  )
}
