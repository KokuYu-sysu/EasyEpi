import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef, useState } from 'react'
import { ConfirmDialog, Modal, ToastProvider, Tooltip, useToast } from '@renderer/components/ui'

function ToastDemo() {
  const toast = useToast()
  return <button onClick={() => toast.push({ title: '已保存' })}>通知</button>
}

test('modal and confirm manage safe focus', async () => {
  const user = userEvent.setup()
  render(
    <>
      <Modal trigger={<button>打开</button>} title="编辑" description="说明">
        内容
      </Modal>
      <ConfirmDialog
        trigger={<button>删除</button>}
        title="确认删除"
        description="无法撤销"
        confirmLabel="确认"
        onConfirm={() => {}}
      />
    </>
  )
  await user.click(screen.getByRole('button', { name: '打开' }))
  expect(screen.getByRole('button', { name: '关闭对话框' })).toHaveFocus()
  await user.keyboard('{Escape}')
  expect(screen.getByRole('button', { name: '打开' })).toHaveFocus()
  await user.click(screen.getByRole('button', { name: '删除' }))
  expect(screen.getByRole('button', { name: '取消' })).toHaveFocus()
})

function ControlledModalDemo() {
  const [open, setOpen] = useState(true)
  const restoreRef = useRef<HTMLButtonElement>(null)
  return (
    <>
      <button ref={restoreRef}>编辑器</button>
      <Modal
        open={open}
        onOpenChange={setOpen}
        restoreFocusRef={restoreRef}
        title="受控对话框"
        description="由外部状态控制"
      >
        内容
      </Modal>
    </>
  )
}

test('controlled modal does not require a trigger and restores explicit focus', async () => {
  const user = userEvent.setup()
  render(
    <ControlledModalDemo />
  )

  expect(screen.getByRole('dialog', { name: '受控对话框' })).toBeVisible()
  expect(screen.getByRole('button', { name: '关闭对话框' })).toBeVisible()
  await user.click(screen.getByRole('button', { name: '关闭对话框' }))
  expect(screen.getByRole('button', { name: '编辑器' })).toHaveFocus()
})

test('tooltip and toast provide supplemental status', async () => {
  const user = userEvent.setup()
  render(
    <ToastProvider>
      <Tooltip content="补充说明">
        <button>帮助</button>
      </Tooltip>
      <ToastDemo />
    </ToastProvider>
  )
  await user.hover(screen.getByRole('button', { name: '帮助' }))
  expect(await screen.findByRole('tooltip')).toHaveTextContent('补充说明')
  await user.click(screen.getByRole('button', { name: '通知' }))
  expect(screen.getByText('已保存').closest('[role="status"]')).toBeVisible()
  expect(screen.getByRole('button', { name: '关闭通知' })).toBeVisible()
})
