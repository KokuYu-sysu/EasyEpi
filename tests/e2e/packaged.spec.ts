import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { access, mkdir, readFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { basename, dirname, isAbsolute, join } from 'node:path'

import {
  chromium,
  expect,
  test,
  _electron as electron,
  type Browser,
  type ElectronApplication,
  type Page
} from '@playwright/test'

import type { DesktopApi } from '../../src/shared/desktop-api'

const hostileDevelopmentUrl = 'https://attacker.invalid/easyepi'

interface PackagedPaths {
  executablePath: string
  userDataDir: string
}

interface PortableSession {
  browser: Browser
  child: ChildProcess
  window: Page
}

type RendererWindow = Window & { easyEpi: DesktopApi }

async function assertEasyEpiWindow(window: Page): Promise<void> {
  await expect(window).toHaveTitle('EasyEpi')
  await expect(window.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(window.locator('main')).toBeVisible()
  expect(new URL(window.url()).protocol).toBe('file:')
}

async function assertProductionComponentRouteIsHidden(window: Page): Promise<void> {
  await window.evaluate(() => {
    globalThis.location.hash = '#/__components'
  })
  await expect(window.getByRole('heading', { level: 1, name: '页面未找到' })).toBeVisible()
  await expect(window.getByText('设计系统组件展厅')).toHaveCount(0)
}

async function enableLargeText(window: Page): Promise<void> {
  const toggle = window.locator('button[aria-label*="大字模式"]')
  await expect(toggle).toBeVisible()
  if ((await window.locator('html').getAttribute('data-font-scale')) !== 'large') {
    await toggle.click()
  }
  await expect(window.locator('html')).toHaveAttribute('data-font-scale', 'large')
}

async function assertStoredLargeText(userDataDir: string): Promise<void> {
  await expect
    .poll(async () => JSON.parse(await readFile(join(userDataDir, 'preferences.json'), 'utf8')))
    .toMatchObject({ schemaVersion: 1, largeText: true })
}

function readPackagedPaths(): PackagedPaths {
  const executablePath = process.env['EASYEPI_EXECUTABLE']
  const userDataDir = process.env['EASYEPI_USER_DATA_DIR']

  if (executablePath === undefined || executablePath.length === 0) {
    throw new Error('EASYEPI_EXECUTABLE must be set to an absolute packaged executable path')
  }
  if (!isAbsolute(executablePath)) {
    throw new Error('EASYEPI_EXECUTABLE must be an absolute path')
  }
  if (userDataDir === undefined || userDataDir.length === 0) {
    throw new Error('EASYEPI_USER_DATA_DIR must be set to an absolute isolated directory path')
  }
  if (!isAbsolute(userDataDir)) {
    throw new Error('EASYEPI_USER_DATA_DIR must be an absolute path')
  }

  return { executablePath, userDataDir }
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

async function waitForPortableBrowser(endpoint: string): Promise<Browser> {
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

async function launchPortable(paths: PackagedPaths): Promise<PortableSession> {
  const port = await reserveLoopbackPort()
  const child = spawn(
    paths.executablePath,
    [`--remote-debugging-port=${port}`, `--user-data-dir=${paths.userDataDir}`],
    {
      cwd: dirname(paths.executablePath),
      env: { ...process.env, ELECTRON_RENDERER_URL: hostileDevelopmentUrl },
      stdio: 'ignore',
      windowsHide: true
    }
  )

  try {
    const browser = await waitForPortableBrowser(`http://127.0.0.1:${port}`)
    const context = browser.contexts()[0]
    if (context === undefined) {
      throw new Error('PORTABLE_BROWSER_CONTEXT_MISSING')
    }
    await expect.poll(() => context.pages().length).toBeGreaterThan(0)
    const window = context.pages()[0]
    if (window === undefined) {
      throw new Error('PORTABLE_WINDOW_MISSING')
    }
    return { browser, child, window }
  } catch (error) {
    await stopProcessTree(child)
    throw error
  }
}

async function closePortable(session: PortableSession | undefined): Promise<void> {
  if (session === undefined) return
  await session.browser.close()
  await stopProcessTree(session.child)
}

async function launchInstalled(paths: PackagedPaths): Promise<ElectronApplication> {
  return electron.launch({
    executablePath: paths.executablePath,
    args: [`--user-data-dir=${paths.userDataDir}`],
    env: { ...process.env, ELECTRON_RENDERER_URL: hostileDevelopmentUrl }
  })
}

test('validates production behavior and preference persistence in a packaged EasyEpi executable', async () => {
  const paths = readPackagedPaths()
  await access(paths.executablePath)
  await mkdir(paths.userDataDir, { recursive: true })

  if (basename(paths.executablePath).toLowerCase().includes('-portable-')) {
    let session: PortableSession | undefined
    try {
      session = await launchPortable(paths)
      await assertEasyEpiWindow(session.window)
      await enableLargeText(session.window)
      await assertStoredLargeText(paths.userDataDir)
      await assertProductionComponentRouteIsHidden(session.window)
    } finally {
      await closePortable(session)
    }

    session = undefined
    try {
      session = await launchPortable(paths)
      await assertEasyEpiWindow(session.window)
      await expect(session.window.locator('html')).toHaveAttribute('data-font-scale', 'large')
    } finally {
      await closePortable(session)
    }
    return
  }

  let electronApp: ElectronApplication | undefined
  try {
    electronApp = await launchInstalled(paths)
    const window = await electronApp.firstWindow()
    await assertEasyEpiWindow(window)
    await enableLargeText(window)
    await assertStoredLargeText(paths.userDataDir)
    await assertProductionComponentRouteIsHidden(window)
  } finally {
    await electronApp?.close()
  }

  electronApp = undefined
  try {
    electronApp = await launchInstalled(paths)
    const window = await electronApp.firstWindow()
    await assertEasyEpiWindow(window)
    await expect(window.locator('html')).toHaveAttribute('data-font-scale', 'large')
  } finally {
    await electronApp?.close()
  }
})

test('submits and reopens an encrypted M4 record in the packaged executable', async () => {
  const paths = readPackagedPaths()
  test.skip(!basename(paths.executablePath).toLowerCase().includes('-portable-'))
  await access(paths.executablePath)
  await mkdir(paths.userDataDir, { recursive: true })
  const projectFolder = join(paths.userDataDir, 'm4-packaged-project')
  const projectFile = join(projectFolder, 'M4 EXE 验收.easyepi')
  await mkdir(projectFolder, { recursive: true })

  let session: PortableSession | undefined
  try {
    session = await launchPortable(paths)
    const { window } = session
    await window.evaluate(
      async ({ folderPath }) => {
        const api = (globalThis as unknown as RendererWindow).easyEpi
        await api.project.create({
          name: 'M4 EXE 验收',
          folderPath,
          password: 'm4-exe-password'
        })
        await api.qnaire.addQuestion({
          id: 'exe-q1',
          content: '受试者编号',
          variableName: 'participant_id',
          type: 'fixed_length',
          options: [],
          constraint: { type: 'alphanumeric', fixedLength: 3 },
          isKey: true,
          allowSkip: false,
          order: 0
        })
        await api.qnaire.addQuestion({
          id: 'exe-q2',
          content: '现场备注',
          variableName: 'notes',
          type: 'free_text',
          options: [],
          constraint: { type: 'none' },
          isKey: false,
          allowSkip: false,
          order: 1
        })
        await api.project.save({ folderPath })
        globalThis.location.hash = '#/entry'
      },
      { folderPath: projectFolder }
    )

    await window.getByRole('button', { name: '开始录入' }).click()
    await window.getByRole('textbox', { name: '受试者编号' }).fill('E01')
    await window.getByRole('button', { name: '下一题' }).click()
    await window.getByRole('textbox', { name: '现场备注' }).fill('来自便携版 EXE')
    await window.getByRole('button', { name: '完成录入' }).click()
    await window.getByRole('button', { name: '确认提交' }).click()
    await expect(window.getByText('本次已录入: 1 份')).toBeVisible()
    await expect(
      window.evaluate(() => (globalThis as unknown as RendererWindow).easyEpi.record.list())
    ).resolves.toMatchObject({ total: 1 })
  } finally {
    await closePortable(session)
  }

  session = undefined
  try {
    session = await launchPortable(paths)
    const { window } = session
    await expect(
      window.evaluate(
        ({ filePath }) =>
          (globalThis as unknown as RendererWindow).easyEpi.project.open({
            filePath,
            password: 'm4-exe-password'
          }),
        { filePath: projectFile }
      )
    ).resolves.toMatchObject({ ok: true })
    await expect(
      window.evaluate(() => (globalThis as unknown as RendererWindow).easyEpi.record.list())
    ).resolves.toMatchObject({
      total: 1,
      records: [{ answers: { 'exe-q1': 'E01', 'exe-q2': '来自便携版 EXE' } }]
    })
    await expect(
      window.evaluate(() =>
        (globalThis as unknown as RendererWindow).easyEpi.record.submit({
          'exe-q1': 'E01',
          'exe-q2': '重复记录'
        })
      )
    ).resolves.toMatchObject({ ok: false, error: 'KEY_DUPLICATE' })
  } finally {
    await closePortable(session)
  }
})
