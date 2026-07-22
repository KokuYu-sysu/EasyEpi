import { useState } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Checkbox, Radio, Select } from '@renderer/components/ui'

test('radio follows orientation, moves focus, wraps, and skips disabled options', async () => {
  const user = userEvent.setup()
  render(
    <>
      <Radio
        label="vertical"
        defaultValue="a"
        options={[
          { value: 'a', label: 'A' },
          { value: 'b', label: 'B', disabled: true },
          { value: 'c', label: 'C' }
        ]}
      />
      <Radio
        label="horizontal"
        orientation="horizontal"
        defaultValue="x"
        options={[
          { value: 'x', label: 'X' },
          { value: 'y', label: 'Y' }
        ]}
      />
    </>
  )
  const a = screen.getByRole('radio', { name: 'A' })
  const c = screen.getByRole('radio', { name: 'C' })
  await user.click(a)
  await user.keyboard('{ArrowDown>}')
  await waitFor(() => {
    expect(c).toBeChecked()
    expect(c).toHaveFocus()
  })
  await user.keyboard('{/ArrowDown}{ArrowDown>}')
  await waitFor(() => {
    expect(a).toBeChecked()
    expect(a).toHaveFocus()
  })
  await user.keyboard('{/ArrowDown}{ArrowUp>}')
  await waitFor(() => {
    expect(c).toBeChecked()
    expect(c).toHaveFocus()
  })
  await user.keyboard('{/ArrowUp}')
  const x = screen.getByRole('radio', { name: 'X' })
  const y = screen.getByRole('radio', { name: 'Y' })
  await user.click(x)
  await user.keyboard('{ArrowRight>}')
  await waitFor(() => {
    expect(y).toBeChecked()
    expect(y).toHaveFocus()
  })
  await user.keyboard('{/ArrowRight}{ArrowRight>}')
  await waitFor(() => {
    expect(x).toBeChecked()
    expect(x).toHaveFocus()
  })
  await user.keyboard('{/ArrowRight}{ArrowLeft>}')
  await waitFor(() => {
    expect(y).toBeChecked()
    expect(y).toHaveFocus()
  })
  await user.keyboard('{/ArrowLeft}')
})

test('checkbox and radio preserve native form, required, aria, and controlled behavior', async () => {
  const user = userEvent.setup()
  const changes = vi.fn()
  function Controlled() {
    const [checked, setChecked] = useState(false)
    return (
      <form data-testid="form">
        <Checkbox
          label="agree"
          name="agree"
          value="yes"
          required
          aria-describedby="hint"
          aria-invalid
          checked={checked}
          onCheckedChange={(value) => {
            changes(value)
            if (typeof value === 'boolean') setChecked(value)
          }}
        />
        <Radio
          label="choice"
          name="choice"
          required
          aria-describedby="radio-hint"
          value="a"
          onValueChange={changes}
          options={[
            { value: 'a', label: 'A' },
            { value: 'b', label: 'B', itemProps: { 'aria-describedby': 'b-hint' } }
          ]}
        />
      </form>
    )
  }
  render(<Controlled />)
  const checkbox = screen.getByRole('checkbox', { name: 'agree' })
  expect(checkbox).toHaveAttribute('aria-describedby', 'hint')
  expect(checkbox).toHaveAttribute('aria-invalid', 'true')
  await user.click(checkbox)
  expect(checkbox).toBeChecked()
  const b = screen.getByRole('radio', { name: 'B' })
  await user.click(b)
  expect(screen.getByRole('radio', { name: 'A' })).toBeChecked()
  expect(b).not.toBeChecked()
  expect(changes).toHaveBeenCalledWith('b')
  expect(b).toHaveAttribute('aria-describedby', 'b-hint')
  const data = new FormData(screen.getByTestId('form') as HTMLFormElement)
  expect(data.get('agree')).toBe('yes')
  expect(data.get('choice')).toBe('a')
})

test('select separates root props from trigger props and supports controlled form submission', async () => {
  const user = userEvent.setup()
  const changes = vi.fn()
  render(
    <form data-testid="select-form">
      <span id="help">help</span>
      <Select
        label="region"
        name="region"
        required
        value="a"
        onValueChange={changes}
        triggerProps={{
          id: 'region-trigger',
          'aria-describedby': 'help',
          'aria-invalid': true,
          onBlur: changes
        }}
        options={[
          { value: 'a', label: 'A' },
          { value: 'b', label: 'B' }
        ]}
      />
    </form>
  )
  const trigger = screen.getByRole('combobox', { name: 'region' })
  expect(trigger).toHaveAttribute('id', 'region-trigger')
  expect(trigger).toHaveAttribute('aria-describedby', 'help')
  expect(trigger).toHaveAttribute('aria-invalid', 'true')
  expect(trigger).not.toHaveAttribute('name')
  expect(trigger).not.toHaveAttribute('required')
  await user.click(trigger)
  await user.keyboard('{ArrowDown}{ArrowDown}{Enter}')
  expect(changes).toHaveBeenCalledWith('b')
  expect(trigger).toHaveTextContent('A')
  expect(new FormData(screen.getByTestId('select-form') as HTMLFormElement).get('region')).toBe('a')
})
