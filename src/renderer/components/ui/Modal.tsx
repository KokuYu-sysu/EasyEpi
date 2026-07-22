import * as R from '@radix-ui/react-dialog'
import { type ReactNode } from 'react'
export interface ModalProps {
  trigger: ReactNode
  title: string
  description: string
  children: ReactNode
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (v: boolean) => void
  className?: string
}
export function Modal({ trigger, title, description, children, className, ...props }: ModalProps) {
  return (
    <R.Root {...props}>
      <R.Trigger asChild>
        {typeof trigger === 'string' ? <button>{trigger}</button> : trigger}
      </R.Trigger>
      <R.Portal>
        <R.Overlay className="fixed inset-0 z-[var(--z-3)] bg-[var(--color-surface-overlay)]" />
        <R.Content
          tabIndex={-1}
          className={[
            'fixed left-1/2 top-1/2 z-[var(--z-4)] w-[min(32rem,calc(100%-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-[var(--radius-2)] bg-[var(--color-surface-raised)] p-[var(--space-5)] shadow-[var(--shadow-z4)]',
            className
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <R.Title>{title}</R.Title>
          <R.Description>{description}</R.Description>
          <div>{children}</div>
          <R.Close aria-label="关闭对话框">×</R.Close>
        </R.Content>
      </R.Portal>
    </R.Root>
  )
}
