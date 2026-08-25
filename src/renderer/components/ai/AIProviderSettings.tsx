import { useCallback, useEffect, useState } from 'react'

import { Button, Input } from '@renderer/components/ui'
import type { AIProviderConfigView } from '@shared/ai-assistant-contract'
import { friendlyAIError } from './ai-errors'

const EMPTY_CONFIG: AIProviderConfigView = {
  baseUrl: '',
  model: '',
  hasApiKey: false,
  maskedApiKey: null
}

export interface AIProviderSettingsProps {
  onConfigChange?: (config: AIProviderConfigView) => void
}

export function AIProviderSettings({ onConfigChange }: AIProviderSettingsProps) {
  const [saved, setSaved] = useState<AIProviderConfigView>(EMPTY_CONFIG)
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  const adopt = useCallback((config: AIProviderConfigView) => {
    setSaved(config)
    setBaseUrl(config.baseUrl)
    setModel(config.model)
    setApiKey('')
    setDirty(false)
    onConfigChange?.(config)
  }, [onConfigChange])

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
        baseUrl: nextBaseUrl,
        model: nextModel,
        ...(apiKey.trim().length > 0 ? { apiKey } : {})
      })
      if (!result.ok) {
        setError(friendlyAIError(result.errorCode, '无法保存 AI 服务配置。'))
        return
      }
      adopt(result.config)
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
      setStatus('AI 服务配置已清除。')
    } catch {
      setError('无法清除 AI 服务配置。')
    } finally {
      setBusy(false)
    }
  }

  const testConnection = async () => {
    if (dirty || baseUrl !== saved.baseUrl || model !== saved.model || apiKey.length > 0) {
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
          <Input
            label="Base URL"
            value={baseUrl}
            placeholder="https://api.example.com/v1"
            autoComplete="url"
            onChange={(event) => { setBaseUrl(event.target.value); markDirty() }}
          />
          <Input
            label="模型名称"
            value={model}
            placeholder="model-name"
            autoComplete="off"
            onChange={(event) => { setModel(event.target.value); markDirty() }}
          />
          <Input
            label="API Key"
            type="password"
            value={apiKey}
            placeholder={saved.hasApiKey ? '已安全保存；留空将保留原 Key' : '请输入 API Key'}
            autoComplete="new-password"
            hint="为保护凭据，已保存的 Key 不会回显。"
            onChange={(event) => { setApiKey(event.target.value); markDirty() }}
          />
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
