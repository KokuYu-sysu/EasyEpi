import { StrictMode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { AppBootstrap } from '@renderer/app/AppBootstrap'
import {
  createPreferencesStore,
  type PreferencesAppearance
} from '@renderer/stores/preferences-store'
import {
  DEFAULT_PREFERENCES,
  type PreferencesResult,
  type PreferencesV1
} from '@shared/preferences-contract'

const appearance: PreferencesAppearance = { apply: () => {}, observeSystemTheme: () => () => {} }
function makeStore(
  loadResult: PreferencesResult,
  update: (value: PreferencesV1) => Promise<PreferencesResult> = async (value) => ({
    ok: true,
    preferences: value
  })
) {
  return createPreferencesStore({ appearance, api: { get: async () => loadResult, update } })
}

test.each([
  [
    {
      ok: true as const,
      preferences: DEFAULT_PREFERENCES,
      warning: 'PREFERENCES_RECOVERED' as const
    },
    '界面设置已恢复'
  ],
  [
    { ok: false as const, code: 'PREFERENCES_READ_FAILED' as const },
    '读取界面设置失败，已使用默认设置'
  ]
])(
  'renders ready children and consumes a load notice once in StrictMode',
  async (result, message) => {
    const store = makeStore(result)
    const consume = vi.spyOn(store.getState(), 'consumeNotice')
    render(
      <StrictMode>
        <AppBootstrap store={store}>
          <div>ready child</div>
        </AppBootstrap>
      </StrictMode>
    )
    expect(await screen.findByText('ready child')).toBeVisible()
    expect(await screen.findByText(message)).toBeVisible()
    expect(screen.getAllByText(message)).toHaveLength(1)
    expect(consume).toHaveReturnedTimes(1)
  }
)

test('delivers one nonblocking save failure notice', async () => {
  let rejectSave!: (value: PreferencesResult) => void
  const store = makeStore(
    { ok: true, preferences: DEFAULT_PREFERENCES },
    () =>
      new Promise((resolve) => {
        rejectSave = resolve
      })
  )
  render(
    <AppBootstrap store={store}>
      <div>ready after save</div>
    </AppBootstrap>
  )
  expect(await screen.findByText('ready after save')).toBeVisible()
  store.getState().setPreferences({ largeText: true })
  rejectSave({ ok: false, code: 'PREFERENCES_SAVE_FAILED' })
  expect(await screen.findByText('保存界面设置失败')).toBeVisible()
  expect(screen.getAllByText('保存界面设置失败')).toHaveLength(1)
  expect(screen.getByText('ready after save')).toBeVisible()
  await waitFor(() => expect(store.getState().notice).toBeNull())
})
