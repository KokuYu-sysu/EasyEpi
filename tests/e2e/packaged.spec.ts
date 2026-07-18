import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { access } from 'node:fs/promises'
import { createServer } from 'node:net'
import { basename, dirname, isAbsolute } from 'node:path'

import { chromium, expect, test, _electron as electron, type Page } from '@playwright/test'

const hostileDevelopmentUrl = 'https://attacker.invalid/easyepi'

async function assertEasyEpiWindow(window: Page): Promise<void> {
  await expect(window).toHaveTitle('EasyEpi')
  await expect(window.getByText('桌面运行环境已连接')).toBeVisible()
}

async function reserveLoopbackPort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') {
    server.close()
    throw new Error('FAILED_TO_RESERVE_CDP_PORT')
  }
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  return address.port
}

async function waitForPortableBrowser(endpoint: string) {
  const deadline = Date.now() + 30_000
  let lastError: unknown

  while (Date.now() < deadline) {
    try {
      return await chromium.connectOverCDP(endpoint, { timeout: 1_000 })
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }

  throw new Error(`PORTABLE_CDP_START_TIMEOUT: ${String(lastError)}`)
}

async function stopProcessTree(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.pid === undefined) {
    return
  }

  child.kill()
  await Promise.race([once(child, 'exit'), new Promise((resolve) => setTimeout(resolve, 2_000))])
  if (child.exitCode === null && process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true })
  }
}

async function testPortableExecutable(executablePath: string): Promise<void> {
  const port = await reserveLoopbackPort()
  const child = spawn(executablePath, [`--remote-debugging-port=${port}`], {
    cwd: dirname(executablePath),
    env: { ...process.env, ELECTRON_RENDERER_URL: hostileDevelopmentUrl },
    stdio: 'ignore',
    windowsHide: true
  })
  let browser

  try {
    browser = await waitForPortableBrowser(`http://127.0.0.1:${port}`)
    const context = browser.contexts()[0]
    if (context === undefined) {
      throw new Error('PORTABLE_BROWSER_CONTEXT_MISSING')
    }
    await expect.poll(() => context.pages().length).toBeGreaterThan(0)
    const window = context.pages()[0]
    if (window === undefined) {
      throw new Error('PORTABLE_WINDOW_MISSING')
    }
    await assertEasyEpiWindow(window)
  } finally {
    await browser?.close()
    await stopProcessTree(child)
  }
}

test('launches a packaged EasyEpi executable', async () => {
  const executablePath = process.env['EASYEPI_EXECUTABLE']
  if (executablePath === undefined || executablePath.length === 0) {
    throw new Error('EASYEPI_EXECUTABLE must be set to an absolute packaged executable path')
  }
  if (!isAbsolute(executablePath)) {
    throw new Error('EASYEPI_EXECUTABLE must be an absolute path')
  }
  await access(executablePath)

  if (basename(executablePath).toLowerCase().includes('-portable-')) {
    await testPortableExecutable(executablePath)
    return
  }

  const electronApp = await electron.launch({
    executablePath,
    env: { ...process.env, ELECTRON_RENDERER_URL: hostileDevelopmentUrl }
  })
  try {
    await assertEasyEpiWindow(await electronApp.firstWindow())
  } finally {
    await electronApp.close()
  }
})
