import { render, screen } from '@testing-library/react'
import { AppBootstrap } from '@renderer/app/AppBootstrap'
import {
  createPreferencesStore,
  type PreferencesAppearance
} from '@renderer/stores/preferences-store'
import type { PreferencesResult, PreferencesV1 } from '@shared/preferences-contract'

test('blocks children while loading then recovers with one notice toast', async () => {
  let resolve!: (value: PreferencesResult) => void
  const api = {
    get: () =>
      new Promise<PreferencesResult>((r) => {
        resolve = r
      }),
    update: async (p: PreferencesV1) => ({ ok: true as const, preferences: p })
  }
  const appearance: PreferencesAppearance = { apply: () => {}, observeSystemTheme: () => () => {} }
  const store = createPreferencesStore({ api, appearance })
  render(
    <AppBootstrap store={store}>
      <div>应用内容</div>
    </AppBootstrap>
  )
  expect(screen.getByRole('status')).toHaveTextContent('正在加载界面设置')
  expect(screen.queryByText('应用内容')).not.toBeInTheDocument()
  resolve({ ok: false, code: 'PREFERENCES_READ_FAILED' })
  expect(await screen.findByText('应用内容')).toBeVisible()
  expect(
    screen.getAllByRole('status').some((node) => node.textContent?.includes('读取界面设置失败'))
  ).toBe(true)
})
