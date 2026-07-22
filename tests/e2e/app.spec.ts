import AxeBuilder from '@axe-core/playwright'
import { expect, test, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = fileURLToPath(new URL('../..', import.meta.url))
const mainEntry = fileURLToPath(new URL('../../out/main/index.js', import.meta.url))
const userDataRoot = join(projectRoot, '.e2e-user-data')

interface RunningApp {
  app: ElectronApplication
  page: Page
  stderr: string[]
}

async function createUserDataDir(): Promise<string> {
  await mkdir(userDataRoot, { recursive: true })
  return mkdtemp(join(userDataRoot, 'easyepi-'))
}

async function launchBuiltApp(userDataDir: string): Promise<RunningApp> {
  const app = await electron.launch({
    args: [mainEntry, `--user-data-dir=${userDataDir}`],
    cwd: projectRoot
  })
  const stderr: string[] = []
  app.process().stderr?.on('data', (chunk: Buffer) => stderr.push(chunk.toString()))
  try {
    const page = await app.firstWindow()
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    return { app, page, stderr }
  } catch (error) {
    await app.close()
    throw error
  }
}

async function closeApp(running: RunningApp | undefined): Promise<void> {
  if (running === undefined) return
  await running.app.close()
  expect(running.stderr.join('')).not.toContain('Electron Security Warning')
}

async function assertNoAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .setLegacyMode()
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze()
  expect(results.violations).toEqual([])
}

async function navigateHash(page: Page, path: string): Promise<void> {
  await page.evaluate((target) => {
    window.location.hash = `#${target}`
  }, path)
}

async function pressTabUntil(page: Page, name: string): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await page.keyboard.press('Tab')
    const accessibleName = await page.evaluate(() => {
      const active = document.activeElement
      return active?.getAttribute('aria-label') ?? active?.textContent?.trim() ?? ''
    })
    if (accessibleName.includes(name)) return
  }
  throw new Error(`Keyboard focus did not reach: ${name}`)
}

test.describe('built Electron application', () => {
  let userDataDir: string
  let running: RunningApp | undefined

  test.beforeEach(async () => {
    userDataDir = await createUserDataDir()
  })

  test.afterEach(async () => {
    try {
      await closeApp(running)
    } finally {
      running = undefined
      await rm(userDataDir, { recursive: true, force: true })
    }
  })

  test.afterAll(async () => {
    await rm(userDataRoot, { recursive: true, force: true })
  })

  test('launches the secure production shell without renderer Node access', async () => {
    const builtMain = await readFile(new URL('../../out/main/index.js', import.meta.url), 'utf8')
    expect(builtMain).not.toContain('Downloading Electron binary...')
    expect(builtMain).toContain('../preload/index.cjs')
    await expect(readFile(new URL('../../out/preload/index.cjs', import.meta.url), 'utf8')).resolves.toContain(
      'contextBridge'
    )

    running = await launchBuiltApp(userDataDir)
    await expect(running.page).toHaveTitle('EasyEpi')
    await expect
      .poll(() => running?.page.evaluate(() => typeof (globalThis as { require?: unknown }).require))
      .toBe('undefined')
  })

  test('navigates from welcome to the three complete business demos', async () => {
    running = await launchBuiltApp(userDataDir)
    const { page } = running

    await page.getByRole('link', { name: '开始问卷设计' }).click()
    await expect(page.getByRole('heading', { name: '问卷设计' })).toBeVisible()
    await navigateHash(page, '/')
    await page.getByRole('link', { name: '进入录入演示' }).click()
    await expect(page.getByRole('heading', { name: '单题录入' })).toBeVisible()
    await navigateHash(page, '/')
    await page.getByRole('link', { name: '查看数据管理演示' }).click()
    await expect(page.getByRole('heading', { name: '数据管理' })).toBeVisible()
  })

  test('switches all themes and large text, then restores preferences after restart', async () => {
    running = await launchBuiltApp(userDataDir)
    const { page } = running

    await page.getByRole('button', { name: '打开设置' }).click()
    await page.getByRole('radio', { name: '深色' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await page.getByRole('radio', { name: '浅色' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await page.getByRole('radio', { name: '跟随系统' }).click()
    await page.emulateMedia({ colorScheme: 'dark' })
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await page.getByRole('radio', { name: '深色' }).click()
    await page.getByRole('checkbox', { name: '启用大字模式' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-font-scale', 'large')
    await expect
      .poll(async () => JSON.parse(await readFile(join(userDataDir, 'preferences.json'), 'utf8')))
      .toMatchObject({ theme: 'dark', largeText: true })

    await closeApp(running)
    running = undefined
    running = await launchBuiltApp(userDataDir)
    await expect(running.page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await expect(running.page.locator('html')).toHaveAttribute('data-font-scale', 'large')
  })

  for (const viewport of [
    { width: 1024, height: 700 },
    { width: 1366, height: 768 }
  ]) {
    test(`keeps the complete shell usable at ${viewport.width}x${viewport.height}`, async () => {
      running = await launchBuiltApp(userDataDir)
      const { page } = running
      await page.setViewportSize(viewport)

      await expect(page.locator('header').first()).toBeVisible()
      await expect(page.locator('main')).toBeVisible()
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth))
        .toBe(true)

      if (viewport.width === 1024) {
        for (const action of [
          page.getByRole('button', { name: '新建项目' }),
          page.getByRole('button', { name: '打开项目' }),
          page.getByRole('link', { name: '开始问卷设计' }),
          page.getByRole('link', { name: '进入录入演示' }),
          page.getByRole('link', { name: '查看数据管理演示' })
        ]) {
          await action.scrollIntoViewIfNeeded()
          await expect(action).toBeVisible()
        }
        await expect(page.getByRole('button', { name: /切换主题/ })).toBeVisible()
        await expect(page.getByRole('button', { name: /大字模式/ })).toBeVisible()
        await expect(page.getByRole('button', { name: '打开设置' })).toBeVisible()
        const compactMenuTrigger = page.getByRole('button', { name: '打开导航菜单' })
        await expect(compactMenuTrigger).toBeVisible()
        await page.locator('body').focus()
        await pressTabUntil(page, '打开导航菜单')
        await expect(compactMenuTrigger).toBeFocused()
        await expect(page.getByRole('tooltip')).toHaveText(
          '打开导航菜单，显示全部九个页面入口'
        )
        await page.keyboard.press('Enter')
        await expect(page.getByRole('navigation', { name: '紧凑导航' }).getByRole('link')).toHaveCount(9)
      } else {
        await expect(page.getByRole('navigation', { name: '主要导航' })).toBeVisible()
        await expect(page.getByRole('navigation', { name: '主要导航' }).locator('..')).toBeVisible()
        await navigateHash(page, '/designer')
        await expect(page.getByRole('heading', { level: 1, name: '问卷设计' })).toBeVisible()
        await page.getByRole('button', { name: '保存问卷' }).click()
        await expect(
          page.locator('li[role="status"]').filter({ hasText: '保存功能尚未保存' })
        ).toBeVisible()
        await expect(page.getByRole('list', { name: '通知' })).toBeVisible()
      }
    })
  }

  test('supports keyboard-only skip link, settings dialog, and route navigation', async () => {
    running = await launchBuiltApp(userDataDir)
    const { page } = running

    await page.keyboard.press('Tab')
    await expect(page.getByRole('link', { name: '跳到主内容' })).toBeFocused()
    await expect(page.getByRole('link', { name: '跳到主内容' })).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/index\.html(?:#\/)?$/)
    await expect(page.getByRole('heading', { level: 1, name: '欢迎页' })).toBeVisible()
    await expect(page.locator('#main-content')).toBeFocused()

    await pressTabUntil(page, '打开设置')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog', { name: '界面设置' })).toBeVisible()
    await expect(page.getByRole('radio', { name: '跟随系统' })).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(page.getByRole('radio', { name: '浅色' })).toBeFocused()
    await pressTabUntil(page, '关闭对话框')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('button', { name: '打开设置' })).toBeFocused()

    await navigateHash(page, '/')
    await page.locator('body').focus()
    await pressTabUntil(page, '开始问卷设计')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('heading', { name: '问卷设计' })).toBeVisible()
  })

  test('exposes reduced-motion state and production recovery pages', async () => {
    running = await launchBuiltApp(userDataDir)
    const { page } = running
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced')

    await navigateHash(page, '/missing-route')
    await expect(page.getByRole('heading', { name: '页面未找到' })).toBeVisible()
    await expect(page.getByRole('link', { name: '返回欢迎页' })).toBeVisible()
    await navigateHash(page, '/__components')
    await expect(page.getByRole('heading', { name: '页面未找到' })).toBeVisible()
    await expect(page.getByText('设计系统组件展厅')).toHaveCount(0)
  })

  test('has no automated WCAG A/AA violations in key pages and settings', async () => {
    running = await launchBuiltApp(userDataDir)
    const { page } = running
    for (const { path, heading } of [
      { path: '/', heading: '欢迎页' },
      { path: '/designer', heading: '问卷设计' },
      { path: '/entry', heading: '单题录入' },
      { path: '/admin/data', heading: '数据管理' }
    ]) {
      await navigateHash(page, path)
      await expect
        .poll(() => page.evaluate(() => window.location.hash))
        .toBe(`#${path}`)
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible()
      await assertNoAxeViolations(page)
    }
    await page.getByRole('button', { name: '打开设置' }).click()
    await expect(page.getByRole('dialog', { name: '界面设置' })).toBeVisible()
    await assertNoAxeViolations(page)
  })
})
