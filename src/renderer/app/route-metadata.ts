import { useMatches, type UIMatch } from 'react-router-dom'

export interface RoutePlaceholderMetadata {
  title: string
  description: string
}

export interface AppRouteHandle {
  title: string
  description?: string
  placeholder?: RoutePlaceholderMetadata
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isAppRouteHandle(value: unknown): value is AppRouteHandle {
  if (!isRecord(value) || typeof value.title !== 'string') {
    return false
  }
  if (value.description !== undefined && typeof value.description !== 'string') {
    return false
  }
  if (value.placeholder === undefined) {
    return true
  }
  return (
    isRecord(value.placeholder) &&
    typeof value.placeholder.title === 'string' &&
    typeof value.placeholder.description === 'string'
  )
}

export function findCurrentRouteHandle(
  matches: UIMatch<unknown, unknown>[]
): AppRouteHandle | null {
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const handle = matches[index]?.handle
    if (isAppRouteHandle(handle)) {
      return handle
    }
  }
  return null
}

export function useCurrentRouteHandle(): AppRouteHandle | null {
  return findCurrentRouteHandle(useMatches())
}
