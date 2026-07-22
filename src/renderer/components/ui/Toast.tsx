import * as R from '@radix-ui/react-toast'
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type PropsWithChildren
} from 'react'
export type ToastTone = 'info' | 'success' | 'warning' | 'danger'
export interface ToastInput {
  title: string
  description?: string
  tone?: ToastTone
  duration?: number
}
interface Item extends ToastInput {
  id: number
}
const Context = createContext<{ push: (v: ToastInput) => void } | null>(null)
let nextId = 0
const toneClasses: Record<ToastTone, string> = {
  info: 'border-[var(--color-info)] bg-[var(--color-info-soft)] text-[var(--color-text-primary)]',
  success:
    'border-[var(--color-success)] bg-[var(--color-success-soft)] text-[var(--color-text-primary)]',
  warning:
    'border-[var(--color-warning)] bg-[var(--color-warning-soft)] text-[var(--color-text-primary)]',
  danger:
    'border-[var(--color-danger)] bg-[var(--color-danger-soft)] text-[var(--color-text-primary)]'
}
export function ToastProvider({ children }: PropsWithChildren) {
  const [items, setItems] = useState<Item[]>([])
  const push = useCallback((v: ToastInput) => setItems((xs) => [...xs, { ...v, id: ++nextId }]), [])
  const contextValue = useMemo(() => ({ push }), [push])
  return (
    <Context.Provider value={contextValue}>
      <R.Provider duration={4000}>
        {children}
        {items.map((item) => (
          <R.Root
            role="status"
            key={item.id}
            duration={item.duration}
            onOpenChange={(open) => {
              if (!open) setItems((xs) => xs.filter((x) => x.id !== item.id))
            }}
            className={`rounded-[var(--radius-1)] border p-[var(--space-3)] shadow-[var(--shadow-z3)] ${toneClasses[item.tone ?? 'info']}`}
            data-tone={item.tone ?? 'info'}
          >
            <R.Title>{item.title}</R.Title>
            {item.description && <R.Description>{item.description}</R.Description>}
            <R.Close aria-label="关闭通知">×</R.Close>
          </R.Root>
        ))}
        <R.Viewport
          aria-label="通知"
          className="fixed bottom-[var(--space-4)] right-[var(--space-4)] z-[var(--z-4)] grid gap-[var(--space-2)]"
        />
      </R.Provider>
    </Context.Provider>
  )
}
export function useToast() {
  const value = useContext(Context)
  if (!value) throw new Error('ToastProvider is missing')
  return value
}
