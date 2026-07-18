import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

const projectRoot = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolve(projectRoot, 'src/main/index.ts')
      }
    },
    resolve: {
      alias: {
        '@shared': resolve(projectRoot, 'src/shared')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolve(projectRoot, 'src/preload/index.ts')
      }
    },
    resolve: {
      alias: {
        '@shared': resolve(projectRoot, 'src/shared')
      }
    }
  },
  renderer: {
    root: resolve(projectRoot, 'src/renderer'),
    plugins: [react()],
    resolve: {
      alias: {
        '@renderer': resolve(projectRoot, 'src/renderer'),
        '@shared': resolve(projectRoot, 'src/shared')
      }
    }
  }
})
