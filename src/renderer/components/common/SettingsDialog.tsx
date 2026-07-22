import { Settings } from 'lucide-react'

import { Button, Checkbox, Modal, Radio } from '@renderer/components/ui'
import { usePreferencesStore } from '@renderer/stores/preferences-store'
import type { PreferencesV1 } from '@shared/preferences-contract'

const themes: Array<{ value: PreferencesV1['theme']; label: string }> = [
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
  { value: 'system', label: '跟随系统' }
]

export function SettingsDialog() {
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
      title="界面设置"
      description="设置会安全保存到本机的 EasyEpi 界面偏好文件。"
    >
      <div className="grid gap-[var(--space-4)] py-[var(--space-4)]">
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
      </div>
    </Modal>
  )
}
