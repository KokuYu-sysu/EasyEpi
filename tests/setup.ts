import '@testing-library/jest-dom/vitest'
import './radix-polyfills'

import { beforeEach, vi } from 'vitest'

beforeEach(() => {
  Object.defineProperty(window, 'easyEpi', {
    configurable: true,
    value: {
      admin: {
        checkSession: vi.fn().mockResolvedValue({
          isAuthenticated: true,
          expiresAt: Date.now() + 30 * 60 * 1000
        })
      },
      project: {
        onClosed: vi.fn(() => () => undefined)
      }
    }
  })
})
