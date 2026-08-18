import React from 'react'

interface TableProps {
  children: React.ReactNode
  className?: string
}

export function Table({ children, className = '' }: TableProps) {
  return (
    <div className="relative w-full overflow-auto">
      <table className={`w-full caption-bottom text-[length:var(--font-size-sm)] ${className}`}>
        {children}
      </table>
    </div>
  )
}

interface TableHeaderProps {
  children: React.ReactNode
  className?: string
}

export function TableHeader({ children, className = '' }: TableHeaderProps) {
  return (
    <thead className={`[&_tr]:border-b [&_tr]:border-[var(--color-border-default)] ${className}`}>
      {children}
    </thead>
  )
}

interface TableBodyProps {
  children: React.ReactNode
  className?: string
}

export function TableBody({ children, className = '' }: TableBodyProps) {
  return (
    <tbody className={`[&_tr:last-child]:border-0 ${className}`}>
      {children}
    </tbody>
  )
}

interface TableRowProps {
  children: React.ReactNode
  className?: string
}

export function TableRow({ children, className = '' }: TableRowProps) {
  return (
    <tr className={`border-b border-[var(--color-border-default)] transition-colors hover:bg-[var(--color-surface-sunken)] data-[state=selected]:bg-[var(--color-brand-soft)] ${className}`}>
      {children}
    </tr>
  )
}

interface TableHeadProps {
  children: React.ReactNode
  className?: string
}

export function TableHead({ children, className = '' }: TableHeadProps) {
  return (
    <th className={`h-12 px-[var(--space-4)] text-left align-middle font-[var(--font-weight-medium)] text-[var(--color-text-muted)] [&:has([role=checkbox])]:pr-0 ${className}`}>
      {children}
    </th>
  )
}

interface TableCellProps {
  children: React.ReactNode
  className?: string
}

export function TableCell({ children, className = '' }: TableCellProps) {
  return (
    <td className={`p-[var(--space-4)] align-middle [&:has([role=checkbox])]:pr-0 ${className}`}>
      {children}
    </td>
  )
}