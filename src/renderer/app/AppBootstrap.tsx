import { useEffect, type PropsWithChildren } from 'react'
import { Skeleton, ToastProvider, useToast } from '@renderer/components/ui'
import {
  PreferencesProvider,
  usePreferencesStore,
  usePreferencesStoreApi,
  type PreferencesProviderProps
} from '@renderer/stores/preferences-store'

const messages: Record<string, string> = {
  PREFERENCES_RECOVERED: '界面设置已恢复',
  PREFERENCES_READ_FAILED: '读取界面设置失败，已使用默认设置',
  PREFERENCES_SAVE_FAILED: '保存界面设置失败'
}
function Content({ children }: PropsWithChildren) {
  const status = usePreferencesStore((s) => s.status)
  const notice = usePreferencesStore((s) => s.notice)
  const store = usePreferencesStoreApi()
  const toast = useToast()
  useEffect(() => {
    if (!notice) return
    const consumed = store.getState().consumeNotice()
    if (consumed)
      toast.push({
        title: messages[consumed.code] ?? '界面设置操作失败',
        tone: consumed.kind === 'error' ? 'danger' : 'warning'
      })
  }, [notice, store, toast])
  if (status === 'loading')
    return (
      <main>
        <Skeleton className="h-24" statusText="正在加载界面设置" />
      </main>
    )
  return <>{children}</>
}
export interface AppBootstrapProps
  extends PropsWithChildren, Pick<PreferencesProviderProps, 'api' | 'appearance' | 'store'> {}
export function AppBootstrap({ children, ...preferences }: AppBootstrapProps) {
  return (
    <PreferencesProvider {...preferences}>
      <ToastProvider>
        <Content>{children}</Content>
      </ToastProvider>
    </PreferencesProvider>
  )
}
