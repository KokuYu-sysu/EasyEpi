import { expect, test, _electron as electron } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const projectRoot = fileURLToPath(new URL('../..', import.meta.url))
const mainEntry = fileURLToPath(new URL('../../out/main/index.js', import.meta.url))

test('launches a secure and connected desktop shell', async () => {
  const builtMain = await readFile(new URL('../../out/main/index.js', import.meta.url), 'utf8')
  expect(builtMain).not.toContain('Downloading Electron binary...')
  expect(builtMain).toContain('../preload/index.cjs')
  expect(builtMain).toContain('let mainWindow')
  await expect(readFile(new URL('../../out/preload/index.cjs', import.meta.url), 'utf8')).resolves.toContain(
    'contextBridge'
  )

  const electronApp = await electron.launch({ args: [mainEntry], cwd: projectRoot })
  const stderr: string[] = []
  electronApp.process().stderr?.on('data', (chunk: Buffer) => stderr.push(chunk.toString()))

  try {
    const window = await electronApp.firstWindow()

    await expect(window).toHaveTitle('EasyEpi')
    await expect(window.getByText('桌面运行环境已连接')).toBeVisible()
    await expect
      .poll(() => window.evaluate(() => typeof (globalThis as { require?: unknown }).require))
      .toBe('undefined')
    expect(stderr.join('')).not.toContain('Electron Security Warning')
  } finally {
    await electronApp.close()
  }
})
