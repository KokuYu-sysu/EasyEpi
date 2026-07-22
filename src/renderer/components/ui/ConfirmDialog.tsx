import * as R from '@radix-ui/react-alert-dialog'
import { useRef, type ReactElement } from 'react'
export interface ConfirmDialogProps {
  /** Custom triggers must forward their ref and received event/ARIA props. */
  trigger: ReactElement
  title: string
  description: string
  confirmLabel: string
  cancelLabel?: string
  onConfirm: () => void
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (v: boolean) => void
}
export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel,
  cancelLabel = '取消',
  onConfirm,
  ...props
}: ConfirmDialogProps) {
  const cancel = useRef<HTMLButtonElement>(null)
  return (
    <R.Root {...props}>
      <R.Trigger asChild>{trigger}</R.Trigger>
      <R.Portal>
        <R.Overlay className="fixed inset-0 z-[var(--z-3)] bg-[var(--color-surface-overlay)]" />
        <R.Content
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            cancel.current?.focus()
          }}
          className="fixed left-1/2 top-1/2 z-[var(--z-4)] -translate-x-1/2 -translate-y-1/2 rounded-[var(--radius-2)] bg-[var(--color-surface-raised)] p-[var(--space-5)] shadow-[var(--shadow-z4)]"
        >
          <R.Title>{title}</R.Title>
          <R.Description>{description}</R.Description>
          <R.Cancel ref={cancel}>{cancelLabel}</R.Cancel>
          <R.Action
            onClick={onConfirm}
            className="bg-[var(--color-danger)] text-[var(--color-text-inverse)]"
          >
            {confirmLabel}
          </R.Action>
        </R.Content>
      </R.Portal>
    </R.Root>
  )
}
