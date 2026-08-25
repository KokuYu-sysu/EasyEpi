import { Settings } from 'lucide-react'
import { useState } from 'react'

import { Button, Checkbox, Modal, Radio } from '@renderer/components/ui'
import { usePreferencesStore } from '@renderer/stores/preferences-store'
import type { PreferencesV1 } from '@shared/preferences-contract'
import { AIProviderSettings } from '@renderer/components/ai/AIProviderSettings'

const themes: Array<{ value: PreferencesV1['theme']; label: string }> = [
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
  { value: 'system', label: '跟随系统' }
]

export function SettingsDialog() {
  const [open, setOpen] = useState(false)
  const preferences = usePreferencesStore((state) => state.desired)
  const setPreferences = usePreferencesStore((state) => state.setPreferences)

  return (
    <Modal
      trigger={
        <Button variant="ghost" aria-label="打开设置">
          <Settings aria-hidden="true" size={20} />
          <span className="hidden xl:inline">设置</span>
        </Button>
      }
      title="设置"
      description="管理界面偏好与可跨项目复用的 AI 服务配置。"
      open={open}
      onOpenChange={setOpen}
      className="max-h-[min(46rem,calc(100vh-2rem))] overflow-auto"
    >
      <div className="grid gap-[var(--space-4)] py-[var(--space-4)]">
        <section aria-labelledby="appearance-settings" className="grid gap-[var(--space-3)]">
          <h3 id="appearance-settings" className="m-0 text-[length:var(--font-size-lg)]">界面偏好</h3>
          <Radio
            label="主题"
            value={preferences.theme}
            onValueChange={(theme) =>
              setPreferences({ theme: theme as PreferencesV1['theme'] })
            }
            options={themes}
          />
          <Checkbox
            label="启用大字模式"
            checked={preferences.largeText}
            onCheckedChange={(checked) => setPreferences({ largeText: checked === true })}
          />
          <Checkbox
            label="默认收起侧栏"
            checked={preferences.sidebarCollapsed}
            onCheckedChange={(checked) =>
              setPreferences({ sidebarCollapsed: checked === true })
            }
          />
        </section>
        {open ? <AIProviderSettings /> : null}
      </div>
    </Modal>
  )
}
