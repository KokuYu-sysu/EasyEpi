import { useCallback, useEffect, useState } from 'react'

import { Button, Input } from '@renderer/components/ui'
import type { AIProviderConfigView } from '@shared/ai-assistant-contract'
import {
  DEEPSEEK_BASE_URL,
  DEEPSEEK_DEFAULT_MODEL,
  DEEPSEEK_MODEL_OPTIONS
} from '@shared/ai-provider-profiles'
import { friendlyAIError } from './ai-errors'
import { notifyAIConfigChanged } from './ai-config-events'

const EMPTY_CONFIG: AIProviderConfigView = {
  baseUrl: DEEPSEEK_BASE_URL,
  model: DEEPSEEK_DEFAULT_MODEL,
  hasApiKey: false,
  maskedApiKey: null,
  hasNcbiApiKey: false,
  maskedNcbiApiKey: null
}

export function AIProviderSettings() {
  const [saved, setSaved] = useState<AIProviderConfigView>(EMPTY_CONFIG)
  const [model, setModel] = useState(DEEPSEEK_DEFAULT_MODEL)
  const [apiKey, setApiKey] = useState('')
  const [ncbiApiKey, setNcbiApiKey] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  const adopt = useCallback((config: AIProviderConfigView) => {
    setSaved(config)
    setModel(config.model.length === 0 ? DEEPSEEK_DEFAULT_MODEL : config.model)
    setApiKey('')
    setNcbiApiKey('')
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
    const nextModel = model.trim()
    if (nextModel.length === 0) {
      setError('请填写模型名称。')
      return
    }
    setBusy(true)
    setError(null)
    setStatus(null)
    try {
      const result = await window.easyEpi.ai.config.update({
        baseUrl: DEEPSEEK_BASE_URL,
        model: nextModel,
        ...(apiKey.trim().length > 0 ? { apiKey } : {}),
        ...(ncbiApiKey.trim().length > 0 ? { ncbiApiKey } : {})
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
    if (dirty || model !== saved.model || apiKey.length > 0) {
      setError('当前有未保存的更改，请先保存再测试连接。')
      return
    }
    if (!saved.model || !saved.hasApiKey) {
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
          EasyEpi 使用 DeepSeek 生成问卷，并通过 DeepSeek Responses API 的内置联网搜索补充权威来源；
          医学类问卷还会检索 PubMed、Europe PMC 与 bioRxiv/medRxiv 公开接口。
          API Key 由系统安全存储保护，清除配置不会清除已确认的隐私说明。
        </p>
      </div>
      {loading ? <p role="status" className="m-0">正在读取 AI 服务配置…</p> : (
        <>
          <p className="m-0 text-[length:var(--font-size-sm)] text-[var(--color-text-secondary)]">
            服务地址：<code>{DEEPSEEK_BASE_URL}</code>（固定为 DeepSeek 官方接口）
          </p>
          <Input
            label="模型名称"
            value={model}
            placeholder={DEEPSEEK_DEFAULT_MODEL}
            autoComplete="off"
            disabled={busy}
            hint={`常用：${DEEPSEEK_MODEL_OPTIONS.join('、')}`}
            onChange={(event) => { setModel(event.target.value); markDirty() }}
          />
          <Input
            label="API Key"
            type="password"
            value={apiKey}
            placeholder={saved.hasApiKey ? '已安全保存；留空将保留原 Key' : '请输入 DeepSeek API Key'}
            autoComplete="new-password"
            disabled={busy}
            hint="为保护凭据，已保存的 Key 不会回显。"
            onChange={(event) => { setApiKey(event.target.value); markDirty() }}
          />
          <Input
            label="NCBI API Key（可选）"
            type="password"
            value={ncbiApiKey}
            placeholder={saved.hasNcbiApiKey ? '已安全保存；留空将保留原 Key' : '可不填'}
            autoComplete="new-password"
            disabled={busy}
            hint="可选。填写后仅提高 PubMed/NCBI 的请求配额，不影响对话服务；已保存的 Key 不会回显。"
            onChange={(event) => { setNcbiApiKey(event.target.value); markDirty() }}
          />
          <p className="m-0 text-[length:var(--font-size-sm)] text-[var(--color-text-secondary)]">
            文献检索说明：<a href="https://www.ncbi.nlm.nih.gov/books/NBK25497/" target="_blank" rel="noreferrer">NCBI E-utilities 使用条款</a>。
          </p>
          {!saved.hasApiKey ? (
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
