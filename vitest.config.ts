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
        'src/shared/**/*.{ts,tsx}',
        'src/main/**/*.{ts,tsx}',
        'src/preload/**/*.{ts,tsx}',
        'src/renderer/**/*.{ts,tsx}'
      ],
      exclude: [
        'src/main/index.ts',
        // Electron IPC/preload and routed M3 UI are exercised in the built-app Playwright suite.
        'src/main/dialog-ipc.ts',
        'src/main/ipc/**',
        'src/preload/index.ts',
        'src/preload/desktop-api.ts',
        'src/renderer/main.tsx',
        'src/renderer/global.d.ts',
        'src/renderer/demo/demo-data.ts',
        'src/renderer/components/qnaire/**',
        'src/renderer/pages/DesignerPage.tsx',
        'src/renderer/pages/WelcomePage.tsx',
        'src/renderer/stores/designer-demo-store.ts',
        'src/renderer/stores/qnaire.store.ts'
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
