export const SYSTEM_PING_CHANNEL = 'system:ping' as const

export interface PingRequest {
  nonce: string
}

export type DesktopPlatform =
  | 'aix'
  | 'android'
  | 'cygwin'
  | 'darwin'
  | 'freebsd'
  | 'haiku'
  | 'linux'
  | 'netbsd'
  | 'openbsd'
  | 'sunos'
  | 'win32'

export interface PingResponse {
  nonce: string
  version: string
  platform: DesktopPlatform
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

export function parsePingRequest(value: unknown): PingRequest {
  if (!isPlainObject(value)) {
    throw new Error('INVALID_IPC_REQUEST')
  }

  const { nonce } = value
  if (typeof nonce !== 'string' || nonce.length < 1 || nonce.length > 64) {
    throw new Error('INVALID_IPC_REQUEST')
  }

  return { nonce }
}
