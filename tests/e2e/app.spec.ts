import AxeBuilder from '@axe-core/playwright'
import {
  expect,
  test,
  _electron as electron,
  type ElectronApplication,
  type Locator,
  type Page
} from '@playwright/test'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { DesktopApi } from '../../src/shared/desktop-api'

const projectRoot = fileURLToPath(new URL('../..', import.meta.url))
const mainEntry = fileURLToPath(new URL('../../out/main/index.js', import.meta.url))
const userDataRoot = join(projectRoot, '.e2e-user-data')

interface RunningApp {
  app: ElectronApplication
  page: Page
  stderr: string[]
}

type RendererWindow = Window & { easyEpi: DesktopApi }

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

async function assertSelectChevronGeometry(trigger: Locator): Promise<void> {
  const chevron = trigger.locator('svg.lucide-chevron-down')
  await expect(chevron).toBeVisible()

  const triggerBox = await trigger.boundingBox()
  const chevronBox = await chevron.boundingBox()
  expect(triggerBox).not.toBeNull()
  expect(chevronBox).not.toBeNull()
  if (triggerBox === null || chevronBox === null) return

  expect(Math.abs(chevronBox.width - 20)).toBeLessThanOrEqual(1)
  expect(Math.abs(chevronBox.height - 20)).toBeLessThanOrEqual(1)
  const rightInset = triggerBox.x + triggerBox.width - (chevronBox.x + chevronBox.width)
  expect(Math.abs(rightInset - 12)).toBeLessThanOrEqual(1)
  const triggerCenter = triggerBox.y + triggerBox.height / 2
  const chevronCenter = chevronBox.y + chevronBox.height / 2
  expect(Math.abs(triggerCenter - chevronCenter)).toBeLessThanOrEqual(1)
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
    await expect(
      readFile(new URL('../../out/preload/index.cjs', import.meta.url), 'utf8')
    ).resolves.toContain('contextBridge')

    running = await launchBuiltApp(userDataDir)
    await expect(running.page).toHaveTitle('EasyEpi')
    await expect
      .poll(() =>
        running?.page.evaluate(() => typeof (globalThis as { require?: unknown }).require)
      )
      .toBe('undefined')
  })

  test('navigates from welcome to the three complete business demos', async () => {
    running = await launchBuiltApp(userDataDir)
    const { page } = running

    await page.getByRole('link', { name: '开始问卷设计' }).click()
    await expect(page.getByRole('heading', { name: '问卷设计' })).toBeVisible()
    await navigateHash(page, '/')
    await page.getByRole('link', { name: '进入录入' }).click()
    await expect(page.getByRole('heading', { name: '问卷录入' })).toBeVisible()
    await navigateHash(page, '/')
    await page
      .getByRole('navigation', { name: '欢迎页主要操作' })
      .getByRole('link', { name: '数据管理' })
      .click()
    await expect(page.getByRole('heading', { level: 1, name: '管理员验证' })).toBeVisible()
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
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= document.documentElement.clientWidth
          )
        )
        .toBe(true)

      if (viewport.width === 1024) {
        for (const action of [
          page.getByRole('button', { name: '新建项目' }),
          page.getByRole('button', { name: '打开项目' }),
          page.getByRole('link', { name: '开始问卷设计' }),
          page.getByRole('link', { name: '进入录入' }),
          page.getByRole('link', { name: '数据管理' })
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
        await expect(page.getByRole('tooltip')).toHaveText('打开导航菜单，显示全部九个页面入口')
        await page.keyboard.press('Enter')
        await expect(
          page.getByRole('navigation', { name: '紧凑导航' }).getByRole('link')
        ).toHaveCount(9)
      } else {
        await expect(page.getByRole('navigation', { name: '主要导航' })).toBeVisible()
        await expect(page.getByRole('navigation', { name: '主要导航' }).locator('..')).toBeVisible()
        await navigateHash(page, '/designer')
        await expect(page.getByRole('heading', { level: 1, name: '问卷设计' })).toBeVisible()
        await expect(page.getByText('未打开项目', { exact: true })).toBeVisible()
      }
    })
  }

  test('creates, edits, saves, closes, and reopens an encrypted M3 questionnaire', async () => {
    running = await launchBuiltApp(userDataDir)
    const { page } = running
    const projectFolder = join(userDataDir, 'm3-project')
    await mkdir(projectFolder, { recursive: true })

    await expect(
      page.evaluate(
        ({ folderPath }) =>
          (window as unknown as RendererWindow).easyEpi.project.create({
            name: 'M3 验收问卷',
            folderPath,
            password: 'm3-password'
          }),
        { folderPath: projectFolder }
      )
    ).resolves.toMatchObject({ ok: true })

    await navigateHash(page, '/designer')
    await expect(page.getByRole('heading', { level: 1, name: '问卷设计' })).toBeVisible()
    await expect(page.getByText('暂无题目')).toBeVisible()

    await page.getByRole('button', { name: '新增第一道题目' }).click()
    const dialog = page.getByRole('dialog', { name: '添加新题目' })
    await dialog.getByLabel('题目内容 *').fill('受试者编号')
    await dialog.getByLabel('变量名 *').fill('participant_id')
    const questionType = dialog.getByRole('combobox', { name: '题型 *' })
    await assertSelectChevronGeometry(questionType)
    await questionType.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('option')).toHaveText([
      '单选题',
      '多选题',
      '固定长度填空',
      '自由填空',
      '数字范围',
      '日期'
    ])
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('option')).toHaveCount(0)
    await expect(questionType).toContainText('多选题')

    const originalDocumentState = await page.locator('html').evaluate((html) => ({
      theme: html.getAttribute('data-theme'),
      fontScale: html.getAttribute('data-font-scale')
    }))
    for (const { theme, fontScale } of [
      { theme: 'light', fontScale: 'normal' },
      { theme: 'light', fontScale: 'large' },
      { theme: 'dark', fontScale: 'normal' },
      { theme: 'dark', fontScale: 'large' }
    ]) {
      await page.locator('html').evaluate(
        (html, state) => {
          html.setAttribute('data-theme', state.theme)
          html.setAttribute('data-font-scale', state.fontScale)
        },
        { theme, fontScale }
      )
      await assertSelectChevronGeometry(questionType)

      const fixtureId = `${theme}-${fontScale}`
      await questionType.evaluate((trigger, id) => {
        const fixture = trigger.cloneNode(true) as HTMLButtonElement
        const triggerBox = trigger.getBoundingClientRect()
        fixture.dataset.e2eSelectFixture = id
        fixture.style.position = 'fixed'
        fixture.style.left = `${triggerBox.left}px`
        fixture.style.top = `${triggerBox.top}px`
        fixture.style.width = `${triggerBox.width}px`
        fixture.style.pointerEvents = 'none'
        fixture.style.zIndex = '100001'
        const value = fixture.querySelector(':scope > span')
        if (value !== null) {
          value.textContent =
            '这是一个用于验证箭头固定在最右侧且内容不会水平溢出的很长题型名称'.repeat(4)
        }
        fixture.setAttribute('disabled', '')
        fixture.setAttribute('data-disabled', '')
        document.body.append(fixture)
      }, fixtureId)
      const fixture = page.locator(`[data-e2e-select-fixture="${fixtureId}"]`)
      await expect(fixture).toBeDisabled()
      await assertSelectChevronGeometry(fixture)
      await expect
        .poll(() => fixture.evaluate((element) => element.scrollWidth <= element.clientWidth))
        .toBe(true)
      await fixture.evaluate((element) => element.remove())
      await expect(questionType).toBeEnabled()
    }
    await page.locator('html').evaluate((html, state) => {
      if (state.theme === null) html.removeAttribute('data-theme')
      else html.setAttribute('data-theme', state.theme)
      if (state.fontScale === null) html.removeAttribute('data-font-scale')
      else html.setAttribute('data-font-scale', state.fontScale)
    }, originalDocumentState)
    await dialog.getByRole('checkbox', { name: '设为 Key 标识符' }).click()
    await dialog.getByRole('button', { name: '+ 添加选项' }).click()
    await dialog.getByRole('button', { name: '添加题目' }).click()

    await expect(page.getByRole('heading', { name: '受试者编号' })).toBeVisible()
    await expect(page.getByText('1 个 Key')).toBeVisible()
    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as RendererWindow).easyEpi.qnaire.getData())
      )
      .toMatchObject({
        questions: [
          {
            content: '受试者编号',
            variableName: 'participant_id',
            type: 'multiple_choice',
            isKey: true
          }
        ],
        keyQuestionIds: [expect.any(String)]
      })

    await page.getByRole('button', { name: '保存问卷' }).click()
    await expect(page.locator('li[role="status"]').filter({ hasText: '问卷已保存' })).toBeVisible()

    await page.evaluate(() => (window as unknown as RendererWindow).easyEpi.project.close())
    const filePath = join(projectFolder, 'M3 验收问卷.easyepi')
    await expect(
      page.evaluate(
        ({ path }) =>
          (window as unknown as RendererWindow).easyEpi.project.open({
            filePath: path,
            password: 'wrong-password'
          }),
        { path: filePath }
      )
    ).resolves.toMatchObject({ ok: false })
    await expect(
      page.evaluate(
        ({ path }) =>
          (window as unknown as RendererWindow).easyEpi.project.open({
            filePath: path,
            password: 'm3-password'
          }),
        { path: filePath }
      )
    ).resolves.toMatchObject({ ok: true })
    await expect(
      page.evaluate(() => (window as unknown as RendererWindow).easyEpi.qnaire.getData())
    ).resolves.toMatchObject({
      questions: [
        {
          content: '受试者编号',
          variableName: 'participant_id',
          type: 'multiple_choice',
          isKey: true
        }
      ],
      keyQuestionIds: [expect.any(String)]
    })
  })

  test('completes the M4 entry cycle, rejects duplicate Keys, and resumes after restart', async () => {
    running = await launchBuiltApp(userDataDir)
    let { page } = running
    const projectFolder = join(userDataDir, 'm4-project')
    const projectFile = join(projectFolder, 'M4 验收问卷.easyepi')
    await mkdir(projectFolder, { recursive: true })

    await page.evaluate(
      async ({ folderPath }) => {
        const api = (window as unknown as RendererWindow).easyEpi
        await api.project.create({
          name: 'M4 验收问卷',
          folderPath,
          password: 'm4-password'
        })
        const questions = [
          {
            id: 'm4-q1',
            content: '受试者编号',
            variableName: 'participant_id',
            type: 'fixed_length' as const,
            options: [],
            constraint: { type: 'alphanumeric' as const, fixedLength: 3 },
            isKey: true,
            allowSkip: false,
            order: 0
          },
          {
            id: 'm4-q2',
            content: '是否吸烟',
            variableName: 'smoking',
            type: 'single_choice' as const,
            options: [
              { value: 'yes', label: '是' },
              { value: 'no', label: '否' }
            ],
            constraint: { type: 'none' as const },
            isKey: false,
            allowSkip: false,
            order: 1
          },
          {
            id: 'm4-q3',
            content: '常见症状',
            variableName: 'symptoms',
            type: 'multiple_choice' as const,
            options: [
              { value: 'cough', label: '咳嗽' },
              { value: 'fever', label: '发热' }
            ],
            constraint: { type: 'none' as const },
            isKey: false,
            allowSkip: false,
            order: 2
          },
          {
            id: 'm4-q4',
            content: '现场备注',
            variableName: 'notes',
            type: 'free_text' as const,
            options: [],
            constraint: { type: 'none' as const },
            isKey: false,
            allowSkip: false,
            order: 3
          },
          {
            id: 'm4-q5',
            content: '年龄',
            variableName: 'age',
            type: 'numeric_range' as const,
            options: [],
            constraint: { type: 'integer' as const, minValue: 0, maxValue: 120 },
            isKey: false,
            allowSkip: false,
            order: 4
          },
          {
            id: 'm4-q6',
            content: '访视日期',
            variableName: 'visit_date',
            type: 'date' as const,
            options: [],
            constraint: { type: 'date' as const },
            isKey: false,
            allowSkip: false,
            order: 5
          }
        ]
        for (const question of questions) await api.qnaire.addQuestion(question)
        await api.qnaire.addConditionRule({
          id: 'm4-rule-1',
          sourceQuestionId: 'm4-q2',
          conditions: [{ questionId: 'm4-q2', operator: 'equals', value: 'no' }],
          logic: 'AND',
          action: 'skip',
          targetQuestionIds: ['m4-q3']
        })
        await api.project.save({ folderPath })
      },
      { folderPath: projectFolder }
    )

    await navigateHash(page, '/entry')
    await page.getByRole('button', { name: '开始录入' }).click()
    await page.getByRole('textbox', { name: '受试者编号' }).fill('A01')
    await page.getByRole('button', { name: '下一题' }).click()
    await page.getByRole('radio', { name: '是' }).click()
    await page.getByRole('button', { name: '下一题' }).click()
    await page.getByRole('checkbox', { name: '咳嗽' }).click()
    await page.getByRole('checkbox', { name: '发热' }).click()
    await page.getByRole('button', { name: '下一题' }).click()
    await page.getByRole('textbox', { name: '现场备注' }).fill('首次完整录入')
    await page.getByRole('button', { name: '下一题' }).click()
    await page.getByRole('spinbutton', { name: '年龄' }).fill('42')
    await page.getByRole('button', { name: '下一题' }).click()
    await page.getByRole('textbox', { name: '访视日期' }).fill('2026-07-26')
    await page.getByRole('button', { name: '完成录入' }).click()
    await expect(page.getByRole('heading', { name: '确认提交' })).toBeVisible()
    await page.getByRole('button', { name: '确认提交' }).click()
    await expect(page.getByText('本次已录入: 1 份')).toBeVisible()

    await expect(
      page.evaluate(() => (window as unknown as RendererWindow).easyEpi.record.list())
    ).resolves.toMatchObject({
      ok: true,
      total: 1,
      records: [
        {
          answers: {
            'm4-q1': 'A01',
            'm4-q2': 'yes',
            'm4-q3': 'cough,fever',
            'm4-q4': '首次完整录入',
            'm4-q5': '42',
            'm4-q6': '2026-07-26'
          }
        }
      ]
    })

    await expect(
      page.evaluate(() =>
        (window as unknown as RendererWindow).easyEpi.record.submit({
          'm4-q1': 'A01',
          'm4-q2': 'yes',
          'm4-q3': 'cough',
          'm4-q4': 'duplicate',
          'm4-q5': '30',
          'm4-q6': '2026-07-26'
        })
      )
    ).resolves.toMatchObject({ ok: false, error: 'KEY_DUPLICATE' })

    await expect(
      page.evaluate(() =>
        (window as unknown as RendererWindow).easyEpi.record.submit({
          'm4-q1': 'C03',
          'm4-q2': 'no',
          'm4-q3': 'stale-hidden-value',
          'm4-q4': '跳题记录',
          'm4-q5': '51',
          'm4-q6': '2026-07-26'
        })
      )
    ).resolves.toMatchObject({ ok: true })
    const skippedRecord = await page.evaluate(async () => {
      const result = await (window as unknown as RendererWindow).easyEpi.record.list()
      return result.records.find((record) => record.answers['m4-q1'] === 'C03')
    })
    expect(skippedRecord?.answers).not.toHaveProperty('m4-q3')

    await page.getByRole('button', { name: '开始下一份' }).click()
    await page.getByRole('textbox', { name: '受试者编号' }).fill('B02')
    await page.getByRole('button', { name: '下一题' }).click()
    await page.getByRole('radio', { name: '是' }).click()
    await page.getByRole('button', { name: '下一题' }).click()
    await page.getByRole('checkbox', { name: '咳嗽' }).click()
    await page.getByRole('button', { name: '下一题' }).click()
    await page.getByRole('textbox', { name: '现场备注' }).fill('等待续录')
    await page.getByRole('button', { name: '下一题' }).click()
    await expect(page.getByRole('spinbutton', { name: '年龄' })).toBeVisible()
    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as RendererWindow).easyEpi.record.getProgress())
      )
      .toMatchObject({
        currentIndex: 4,
        currentAnswers: {
          'm4-q1': 'B02',
          'm4-q2': 'yes',
          'm4-q3': 'cough',
          'm4-q4': '等待续录'
        }
      })

    await closeApp(running)
    running = undefined
    running = await launchBuiltApp(userDataDir)
    page = running.page
    await expect(
      page.evaluate(
        ({ filePath }) =>
          (window as unknown as RendererWindow).easyEpi.project.open({
            filePath,
            password: 'm4-password'
          }),
        { filePath: projectFile }
      )
    ).resolves.toMatchObject({ ok: true })
    await navigateHash(page, '/entry')
    const age = page.getByRole('spinbutton', { name: '年龄' })
    await expect(age).toBeVisible()
    await expect(page.getByText('第 5 题 / 共 6 题')).toBeVisible()
    await age.fill('36')
    await page.getByRole('button', { name: '下一题' }).click()
    await page.getByRole('textbox', { name: '访视日期' }).fill('2026-07-27')
    await page.getByRole('button', { name: '完成录入' }).click()
    await page.getByRole('button', { name: '确认提交' }).click()
    await expect(page.getByText('本次已录入: 3 份')).toBeVisible()

    await expect(
      page.evaluate(() => (window as unknown as RendererWindow).easyEpi.record.list())
    ).resolves.toMatchObject({
      ok: true,
      total: 3,
      records: expect.arrayContaining([
        expect.objectContaining({
          answers: {
            'm4-q1': 'B02',
            'm4-q2': 'yes',
            'm4-q3': 'cough',
            'm4-q4': '等待续录',
            'm4-q5': '36',
            'm4-q6': '2026-07-27'
          }
        })
      ])
    })
  })

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
    await navigateHash(page, '/work-session')
    await expect(page.getByRole('heading', { name: '页面未找到' })).toBeVisible()
    await navigateHash(page, '/__components')
    await expect(page.getByRole('heading', { name: '页面未找到' })).toBeVisible()
    await expect(page.getByText('设计系统组件展厅')).toHaveCount(0)
  })

  test('keeps UI animation frame pacing stable and releases route allocations', async () => {
    running = await launchBuiltApp(userDataDir)
    const { app, page } = running
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('HeapProfiler.enable')
    await cdp.send('HeapProfiler.collectGarbage')
    const baseline = await cdp.send('Runtime.getHeapUsage')

    const frameSample = page.evaluate(
      () =>
        new Promise<number[]>((resolve) => {
          const intervals: number[] = []
          let previous = performance.now()
          const sample = (current: number) => {
            intervals.push(current - previous)
            previous = current
            if (intervals.length >= 120) resolve(intervals.slice(1))
            else requestAnimationFrame(sample)
          }
          requestAnimationFrame(sample)
        })
    )
    for (let index = 0; index < 12; index += 1) {
      await page.getByRole('button', { name: /切换主题/ }).click()
    }
    const intervals = (await frameSample).sort((left, right) => left - right)
    const p95 = intervals[Math.floor(intervals.length * 0.95)]!
    expect(p95).toBeLessThanOrEqual(20)

    for (let cycle = 0; cycle < 5; cycle += 1) {
      for (const path of ['/designer', '/entry', '/admin/data', '/derived', '/']) {
        await navigateHash(page, path)
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      }
    }
    await cdp.send('HeapProfiler.collectGarbage')
    const afterCycles = await cdp.send('Runtime.getHeapUsage')
    expect(afterCycles.usedSize - baseline.usedSize).toBeLessThan(8 * 1024 * 1024)
    await cdp.detach()
    expect(app.windows()).toHaveLength(1)
  })

  test('has no automated WCAG A/AA violations in key pages and settings', async () => {
    running = await launchBuiltApp(userDataDir)
    const { page } = running
    for (const { path, heading } of [
      { path: '/', heading: '欢迎页' },
      { path: '/designer', heading: '问卷设计' },
      { path: '/entry', heading: '问卷录入' },
      { path: '/admin/login', heading: '管理员验证' }
    ]) {
      await navigateHash(page, path)
      await expect.poll(() => page.evaluate(() => window.location.hash)).toBe(`#${path}`)
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible()
      await assertNoAxeViolations(page)
    }
    await page.getByRole('button', { name: '打开设置' }).click()
    await expect(page.getByRole('dialog', { name: '界面设置' })).toBeVisible()
    await assertNoAxeViolations(page)
  })
})
