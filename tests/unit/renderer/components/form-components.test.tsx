import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Checkbox, Radio, Select } from '@renderer/components/ui'

test('form wrappers expose labelled keyboard-operable controls', async () => {
  const user = userEvent.setup()
  render(
    <>
      <Select
        label="地区"
        options={[
          { value: 'a', label: '甲' },
          { value: 'b', label: '乙' }
        ]}
      />
      <Checkbox label="同意" />
      <Radio
        label="性别"
        orientation="horizontal"
        options={[
          { value: 'f', label: '女' },
          { value: 'm', label: '男' }
        ]}
      />
    </>
  )
  await user.click(screen.getByRole('combobox', { name: '地区' }))
  expect(screen.getByRole('listbox')).toHaveClass('z-[var(--z-5)]')
  await user.keyboard('{ArrowDown}{ArrowDown}{Enter}')
  expect(screen.getByRole('combobox', { name: '地区' })).toHaveTextContent('乙')
  await user.click(screen.getByRole('checkbox', { name: '同意' }))
  expect(screen.getByRole('checkbox', { name: '同意' })).toBeChecked()
  await user.click(screen.getByRole('radio', { name: '女' }))
  await user.keyboard('{ArrowRight>}')
  await waitFor(() => expect(screen.getByRole('radio', { name: '男' })).toBeChecked())
  await user.keyboard('{/ArrowRight}')
})
