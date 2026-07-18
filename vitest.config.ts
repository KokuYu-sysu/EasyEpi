import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

const projectRoot = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@renderer': resolve(projectRoot, 'src/renderer'),
      '@shared': resolve(projectRoot, 'src/shared')
    }
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/unit/**/*.test.{ts,tsx}'],
    setupFiles: ['tests/setup.ts'],
    coverage: {
      provider: 'v8',
      include: [
        'src/shared/**/*.ts',
        'src/main/window-policy.ts',
        'src/main/system-ipc.ts',
        'src/preload/desktop-api.ts',
        'src/renderer/App.tsx'
      ],
      reporter: ['text', 'html', 'json-summary'],
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
        'src/main/window-policy.ts': {
          branches: 90
        },
        'src/main/system-ipc.ts': {
          branches: 90
        }
      }
    }
  }
})
