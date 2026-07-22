import * as R from '@radix-ui/react-tooltip'
import type { ReactElement } from 'react'
export function Tooltip({ content, children }: { content: string; children: ReactElement }) {
  return (
    <R.Provider delayDuration={0}>
      <R.Root>
        <R.Trigger asChild>{children}</R.Trigger>
        <R.Portal>
          <R.Content
            sideOffset={6}
            className="z-[var(--z-4)] rounded-[var(--radius-1)] bg-[var(--color-text-primary)] px-[var(--space-2)] py-[var(--space-1)] text-[var(--color-text-inverse)] shadow-[var(--shadow-z2)]"
          >
            {content}
            <R.Arrow className="fill-[var(--color-text-primary)]" />
          </R.Content>
        </R.Portal>
      </R.Root>
    </R.Provider>
  )
}
