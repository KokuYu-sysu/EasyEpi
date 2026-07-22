import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Select, ToastProvider, Tooltip, useToast, type ToastTone } from '@renderer/components/ui'

function Harness() {
  const { push } = useToast()
  const add = (title: string, tone?: ToastTone) => push({ title, tone })
  return (
    <>
      {(['info', 'success', 'warning', 'danger'] as const).map((tone) => (
        <button key={tone} onClick={() => add(tone, tone)}>
          {tone}
        </button>
      ))}
      <button onClick={() => add('duplicate')}>duplicate</button>
    </>
  )
}

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

test('select skips disabled options and a disabled trigger cannot open', async () => {
  const user = userEvent.setup()
  render(
    <>
      <Select
        label="enabled"
        options={[
          { value: 'a', label: 'A' },
          { value: 'b', label: 'B', disabled: true },
          { value: 'c', label: 'C' }
        ]}
      />
      <Select label="disabled" disabled options={[{ value: 'x', label: 'X' }]} />
    </>
  )
  await user.click(screen.getByRole('combobox', { name: 'enabled' }))
  await user.keyboard('{ArrowDown}{ArrowDown}{Enter}')
  expect(screen.getByRole('combobox', { name: 'enabled' })).toHaveTextContent('C')
  await user.click(screen.getByRole('combobox', { name: 'disabled' }))
  expect(screen.queryByRole('option', { name: 'X' })).not.toBeInTheDocument()
})

test('tooltip opens from keyboard focus without trapping it', async () => {
  const user = userEvent.setup()
  render(
    <Tooltip content="supplemental">
      <button>target</button>
    </Tooltip>
  )
  await user.tab()
  expect(await screen.findByRole('tooltip')).toHaveTextContent('supplemental')
  await user.tab()
  expect(screen.getByRole('button', { name: 'target' })).not.toHaveFocus()
})

test('toasts append FIFO including duplicates and tone classes are mutually exclusive token styles', async () => {
  const user = userEvent.setup()
  render(
    <ToastProvider>
      <Harness />
    </ToastProvider>
  )
  for (const name of ['info', 'success', 'warning', 'danger'] as const)
    await user.click(screen.getByRole('button', { name }))
  await user.click(screen.getByRole('button', { name: 'duplicate' }))
  await user.click(screen.getByRole('button', { name: 'duplicate' }))
  const surfaces = screen.getAllByRole('status').filter((node) => node.matches('li'))
  expect(surfaces.map((node) => node.textContent?.replace('×', ''))).toEqual([
    'info',
    'success',
    'warning',
    'danger',
    'duplicate',
    'duplicate'
  ])
  const classes = surfaces.slice(0, 4).map((node) => node.className)
  expect(new Set(classes).size).toBe(4)
  classes.forEach((value) => expect(value).toMatch(/var\(--color-/))
  expect(document.querySelector('[aria-live]')).toHaveAttribute('aria-live')
})

test('default timer pauses on hover and focus, resumes, manual close works, and unmount leaks no timers', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  try {
    const user = userEvent.setup({ advanceTimers: (delay) => vi.advanceTimersByTimeAsync(delay) })
    const view = render(
      <ToastProvider>
        <Harness />
      </ToastProvider>
    )
    await user.click(screen.getByRole('button', { name: 'duplicate' }))
    const toast = screen.getAllByRole('status').find((node) => node.matches('li'))!
    await act(() => vi.advanceTimersByTimeAsync(3000))
    await user.hover(toast)
    await act(() => vi.advanceTimersByTimeAsync(5000))
    expect(toast).toBeInTheDocument()
    await user.unhover(toast)
    await act(() => vi.advanceTimersByTimeAsync(1000))
    expect(toast).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'duplicate' }))
    const focused = screen.getAllByRole('status').find((node) => node.matches('li'))!
    focused.focus()
    await act(() => vi.advanceTimersByTimeAsync(5000))
    expect(focused).toBeInTheDocument()
    await user.tab()
    await user.tab()
    await user.tab()
    expect(focused.contains(document.activeElement)).toBe(false)
    await act(() => vi.advanceTimersByTimeAsync(4000))
    expect(focused).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'duplicate' }))
    await user.click(screen.getByRole('button', { name: '关闭通知' }))
    expect(screen.queryAllByRole('status').filter((node) => node.matches('li'))).toHaveLength(0)
    view.unmount()
    expect(vi.getTimerCount()).toBe(0)
  } finally {
    vi.clearAllTimers()
    vi.useRealTimers()
  }
})
