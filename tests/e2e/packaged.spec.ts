import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
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
import iconv from 'iconv-lite'

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

function epidataHeaderField(name: string, typeCode: number, width: number, question: string): string {
  return [
    typeCode === 0 ? '#' : '_',
    name.padEnd(10),
    ' ',
    '1'.padStart(4),
    '1'.padStart(4),
    '30'.padStart(4),
    '20'.padStart(4),
    '1'.padStart(4),
    String(typeCode).padStart(4),
    String(width).padStart(4),
    '112'.padStart(4),
    ' ',
    question
  ].join('')
}

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
  try {
    const context = session.browser.contexts()[0]
    const cdp = context === undefined ? undefined : await context.newCDPSession(session.window)
    await cdp?.send('Browser.close')
  } catch {
    // The browser may close the CDP connection before acknowledging Browser.close.
  }
  await session.browser.close().catch(() => undefined)
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

test('runs phase-four administration and password re-encryption in the packaged executable', async () => {
  const paths = readPackagedPaths()
  test.skip(!basename(paths.executablePath).toLowerCase().includes('-portable-'))
  await access(paths.executablePath)
  const projectFolder = join(paths.userDataDir, 'phase4-packaged-project')
  const projectFile = join(projectFolder, 'Phase 4 EXE.easyepi')
  const dataFile = join(projectFolder, 'Phase 4 EXE.easyepi_data')
  const exportPath = join(paths.userDataDir, 'phase4-packaged-export.csv')
  const baselinePath = join(paths.userDataDir, 'phase4-packaged-baseline.csv')
  await mkdir(projectFolder, { recursive: true })

  let session: PortableSession | undefined
  try {
    session = await launchPortable(paths)
    const { window } = session
    await window.evaluate(
      async ({ folderPath }) => {
        const api = (globalThis as unknown as RendererWindow).easyEpi
        await api.project.create({
          name: 'Phase 4 EXE',
          folderPath,
          password: 'old-password'
        })
        await api.qnaire.addQuestion({
          id: 'phase4-exe-key',
          content: 'Participant ID',
          variableName: 'participant_id',
          type: 'fixed_length',
          options: [],
          constraint: { type: 'alphanumeric', fixedLength: 3 },
          isKey: true,
          allowSkip: false,
          order: 0
        })
        await api.qnaire.addQuestion({
          id: 'phase4-exe-age',
          content: 'Age',
          variableName: 'age',
          type: 'numeric_range',
          options: [],
          constraint: { type: 'integer', minValue: 0, maxValue: 120 },
          isKey: false,
          allowSkip: false,
          order: 1
        })
        await api.project.save({ folderPath })
        await api.record.submit({ 'phase4-exe-key': 'P01', 'phase4-exe-age': '28' })
        globalThis.location.hash = '#/admin/data'
      },
      { folderPath: projectFolder }
    )

    await expect(window.getByRole('heading', { level: 2, name: '管理员验证' })).toBeVisible()
    await window.getByLabel('当前项目密码').fill('old-password')
    await window.getByRole('button', { name: '登录管理后台' }).click()
    await expect(window.getByText('共 1 条记录')).toBeVisible()

    await expect(
      window.evaluate(
        ({ outputPath }) => (globalThis as unknown as RendererWindow).easyEpi.exportData.csv({
          outputPath,
          encoding: 'one_hot',
          fileEncoding: 'gbk',
          scope: 'all'
        }),
        { outputPath: exportPath }
      )
    ).resolves.toMatchObject({ success: true, recordCount: 1 })
    await expect(
      window.evaluate(
        ({ outputPath }) => (globalThis as unknown as RendererWindow).easyEpi.baseline.export({
          outputPath,
          selectedQuestionIds: ['phase4-exe-age']
        }),
        { outputPath: baselinePath }
      )
    ).resolves.toMatchObject({ success: true })
    const rawExport = await readFile(exportPath)
    expect([...rawExport.subarray(0, 3)]).not.toEqual([0xef, 0xbb, 0xbf])
    expect(iconv.decode(rawExport, 'gbk')).toContain('participant_id')
    expect([...(await readFile(baselinePath)).subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])

    await expect(
      window.evaluate(() => (globalThis as unknown as RendererWindow).easyEpi.admin.changePassword({
        oldPassword: 'old-password',
        newPassword: 'new-password'
      }))
    ).resolves.toMatchObject({ success: true })
    expect((await readFile(projectFile)).includes(Buffer.from('P01'))).toBe(false)
    expect((await readFile(dataFile)).includes(Buffer.from('P01'))).toBe(false)

    await window.evaluate(() => (globalThis as unknown as RendererWindow).easyEpi.project.close())
    await expect(
      window.evaluate(
        ({ filePath }) => (globalThis as unknown as RendererWindow).easyEpi.project.open({
          filePath,
          password: 'old-password'
        }),
        { filePath: projectFile }
      )
    ).resolves.toMatchObject({ ok: false })
    await expect(
      window.evaluate(
        ({ filePath }) => (globalThis as unknown as RendererWindow).easyEpi.project.open({
          filePath,
          password: 'new-password'
        }),
        { filePath: projectFile }
      )
    ).resolves.toMatchObject({ ok: true })
    await expect(
      window.evaluate(() => (globalThis as unknown as RendererWindow).easyEpi.record.list())
    ).resolves.toMatchObject({ total: 1 })
  } finally {
    await closePortable(session)
  }
})

test('imports and reopens encrypted EpiData records in the packaged executable', async () => {
  const paths = readPackagedPaths()
  test.skip(!basename(paths.executablePath).toLowerCase().includes('-portable-'))
  await access(paths.executablePath)
  const sourceFolder = join(paths.userDataDir, 'm5-epidata-source')
  const targetFolder = join(paths.userDataDir, 'm5-epidata-target')
  await mkdir(sourceFolder, { recursive: true })
  await mkdir(targetFolder, { recursive: true })
  const qesFilePath = join(sourceFolder, 'people.qes')
  const projectFile = join(targetFolder, 'M5 EXE import.easyepi')
  await writeFile(
    qesFilePath,
    ['Packaged EpiData', '{name} Participant name __________', '{age} Participant age ###'].join('\r\n'),
    'utf8'
  )
  await writeFile(
    join(sourceFolder, 'people.rec'),
    [
      '2 1 VLAB Filelabel: People',
      epidataHeaderField('name', 1, 10, 'Participant name'),
      epidataHeaderField('age', 0, 3, 'Participant age'),
      'Alice      42!',
      ''
    ].join('\r\n'),
    'latin1'
  )

  let session: PortableSession | undefined
  try {
    session = await launchPortable(paths)
    const preview = await session.window.evaluate(
      ({ filePath }) =>
        (globalThis as unknown as RendererWindow).easyEpi.epidata.preview({ qesFilePath: filePath }),
      { filePath: qesFilePath }
    )
    expect(preview).toMatchObject({ fieldCount: 2, recordCount: 1, encoding: 'utf-8' })

    const result = await session.window.evaluate(
      ({ filePath, targetPath }) =>
        (globalThis as unknown as RendererWindow).easyEpi.epidata.import({
          qesFilePath: filePath,
          targetProjectPath: targetPath,
          projectName: 'M5 EXE import',
          password: 'm5-exe-password'
        }),
      { filePath: qesFilePath, targetPath: targetFolder }
    )
    expect(result).toMatchObject({ success: true, recordCount: 1, projectPath: projectFile })
    await expect(
      session.window.evaluate(() => (globalThis as unknown as RendererWindow).easyEpi.record.list())
    ).resolves.toMatchObject({ total: 1 })

    const rawProject = await readFile(projectFile, 'utf8')
    const rawData = await readFile(join(targetFolder, 'M5 EXE import.easyepi_data'), 'utf8')
    expect(rawProject).not.toContain('Alice')
    expect(rawData).not.toContain('Alice')

    await session.window.evaluate(() =>
      (globalThis as unknown as RendererWindow).easyEpi.project.close()
    )
    await expect(
      session.window.evaluate(
        ({ filePath }) =>
          (globalThis as unknown as RendererWindow).easyEpi.project.open({
            filePath,
            password: 'm5-exe-password'
          }),
        { filePath: projectFile }
      )
    ).resolves.toMatchObject({ ok: true })
    await expect(
      session.window.evaluate(() => (globalThis as unknown as RendererWindow).easyEpi.record.list())
    ).resolves.toMatchObject({
      total: 1
    })
  } finally {
    await closePortable(session)
  }
})

test('runs the M6 derived, quality, export and double-entry workflow in the packaged executable', async () => {
  const paths = readPackagedPaths()
  test.skip(!basename(paths.executablePath).toLowerCase().includes('-portable-'))
  await access(paths.executablePath)
  const projectFolder = join(paths.userDataDir, 'm6-packaged-project')
  const exportPath = join(paths.userDataDir, 'm6-packaged-export.csv')
  const secondaryPath = join(paths.userDataDir, 'm6-secondary.csv')
  await mkdir(projectFolder, { recursive: true })
  await writeFile(secondaryPath, 'pid,age\nP01,31\n', 'utf8')

  let session: PortableSession | undefined
  try {
    session = await launchPortable(paths)
    const { window } = session
    await window.evaluate(
      async ({ folderPath }) => {
        const api = (globalThis as unknown as RendererWindow).easyEpi
        await api.project.create({
          name: 'M6 EXE workflow',
          folderPath,
          password: 'm6-exe-password'
        })
        const adminSession = await api.admin.login({ password: 'm6-exe-password' })
        if (!adminSession.success) throw new Error('M6_ADMIN_LOGIN_FAILED')
        await api.qnaire.addQuestion({
          id: 'm6-key',
          content: 'Participant ID',
          variableName: 'pid',
          type: 'fixed_length',
          options: [],
          constraint: { type: 'alphanumeric', fixedLength: 3 },
          isKey: true,
          allowSkip: false,
          order: 0
        })
        await api.qnaire.addQuestion({
          id: 'm6-age',
          content: 'Age',
          variableName: 'age',
          type: 'numeric_range',
          options: [],
          constraint: { type: 'integer', minValue: 0, maxValue: 120 },
          isKey: false,
          allowSkip: false,
          order: 1
        })
        const derived = await api.derived.add({
          variableName: 'double_age',
          label: 'Double age',
          formula: '{age} * 2',
          resultType: 'numeric',
          displayDecimals: 0
        })
        if (!derived.ok) throw new Error('M6_DERIVED_ADD_FAILED')
        await api.project.save({ folderPath })
        const submitted = await api.record.submit({ 'm6-key': 'P01', 'm6-age': '27' })
        if (!submitted.ok) throw new Error(submitted.error ?? 'M6_SUBMIT_FAILED')
      },
      { folderPath: projectFolder }
    )

    await expect(
      window.evaluate(() => (globalThis as unknown as RendererWindow).easyEpi.record.list())
    ).resolves.toMatchObject({
      total: 1,
      records: [{ answers: expect.objectContaining({ double_age: '54' }) }]
    })
    await expect(
      window.evaluate(() => (globalThis as unknown as RendererWindow).easyEpi.admin.login({ password: 'm6-exe-password' }))
    ).resolves.toMatchObject({ success: true })
    await expect(
      window.evaluate(() => (globalThis as unknown as RendererWindow).easyEpi.quality.getSummary())
    ).resolves.toMatchObject({
      ok: true,
      summary: expect.objectContaining({ records: 1, outliers: [], contradictions: [], duplicates: [] })
    })

    const exported = await window.evaluate(
      ({ outputPath }) => (globalThis as unknown as RendererWindow).easyEpi.exportData.csv({
        outputPath,
        encoding: 'multi_category',
        scope: 'all'
      }),
      { outputPath: exportPath }
    )
    expect(exported).toMatchObject({ success: true, recordCount: 1 })
    await expect(readFile(exportPath, 'utf8')).resolves.toContain('double_age')
    await expect(readFile(exported.dictionaryPath!, 'utf8')).resolves.toContain('衍生变量')

    const comparison = await window.evaluate(
      ({ secondaryFilePath }) => (globalThis as unknown as RendererWindow).easyEpi.doubleEntry.compare({
        secondaryFilePath
      }),
      { secondaryFilePath: secondaryPath }
    )
    expect(comparison).toMatchObject({
      ok: true,
      comparison: expect.objectContaining({ matchedWithDiffs: 1 })
    })
    const recordId = comparison.comparison!.matched[0]!.primaryRecordId
    await window.evaluate(
      ({ id }) => (globalThis as unknown as RendererWindow).easyEpi.admin.updateRecord({
        id,
        data: { answers: { age: '31' } }
      }),
      { id: recordId }
    )
    await expect(
      window.evaluate(() => (globalThis as unknown as RendererWindow).easyEpi.record.list())
    ).resolves.toMatchObject({
      total: 1,
      records: [{ answers: expect.objectContaining({ 'm6-age': '31', double_age: '62' }) }]
    })
    await expect(
      window.evaluate(
        ({ secondaryFilePath }) => (globalThis as unknown as RendererWindow).easyEpi.doubleEntry.compare({
          secondaryFilePath
        }),
        { secondaryFilePath: secondaryPath }
      )
    ).resolves.toMatchObject({
      ok: true,
      comparison: expect.objectContaining({ matchedIdentical: 1, matchedWithDiffs: 0 })
    })
  } finally {
    await closePortable(session)
  }
})

test('creates and restores a complete questionnaire and record snapshot in the packaged executable', async () => {
  const paths = readPackagedPaths()
  test.skip(!basename(paths.executablePath).toLowerCase().includes('-portable-'))
  await access(paths.executablePath)
  const projectFolder = join(paths.userDataDir, 'm7-packaged-backup')
  await mkdir(projectFolder, { recursive: true })

  let session: PortableSession | undefined
  try {
    session = await launchPortable(paths)
    const { window } = session
    await window.evaluate(
      async ({ folderPath }) => {
        const api = (globalThis as unknown as RendererWindow).easyEpi
        const created = await api.project.create({
          name: 'M7 backup EXE',
          folderPath,
          password: 'm7-backup-password'
        })
        if (!created.ok) throw new Error(created.error ?? 'M7_CREATE_FAILED')
        await api.qnaire.addQuestion({
          id: 'm7-key',
          content: 'Participant ID',
          variableName: 'participant_id',
          type: 'fixed_length',
          options: [],
          constraint: { type: 'alphanumeric', fixedLength: 3 },
          isKey: true,
          allowSkip: false,
          order: 0
        })
        await api.project.save({ folderPath })
        const first = await api.record.submit({ 'm7-key': 'P01' })
        if (!first.ok) throw new Error(first.error ?? 'M7_FIRST_SUBMIT_FAILED')
      },
      { folderPath: projectFolder }
    )

    await expect(window.getByRole('button', { name: '项目备份与恢复' })).toBeVisible()
    const initialBackups = await window.evaluate(() =>
      (globalThis as unknown as RendererWindow).easyEpi.project.listBackups()
    )
    const noDataBackupPath = initialBackups.backups.find((entry) => !entry.hasData)?.filePath
    if (noDataBackupPath === undefined) throw new Error('M7_NO_DATA_BACKUP_MISSING')
    await expect(
      window.evaluate(
        ({ backupPath }) =>
          (globalThis as unknown as RendererWindow).easyEpi.project.restore({ backupPath }),
        { backupPath: noDataBackupPath }
      )
    ).resolves.toMatchObject({ ok: true })
    await expect(
      window.evaluate(() => (globalThis as unknown as RendererWindow).easyEpi.record.list())
    ).resolves.toMatchObject({ total: 0 })
    await window.evaluate(async ({ folderPath }) => {
      const api = (globalThis as unknown as RendererWindow).easyEpi
      await api.qnaire.addQuestion({
        id: 'm7-key',
        content: 'Participant ID',
        variableName: 'participant_id',
        type: 'fixed_length',
        options: [],
        constraint: { type: 'alphanumeric', fixedLength: 3 },
        isKey: true,
        allowSkip: false,
        order: 0
      })
      await api.project.save({ folderPath })
    }, { folderPath: projectFolder })
    await expect(
      window.evaluate(() =>
        (globalThis as unknown as RendererWindow).easyEpi.record.submit({ 'm7-key': 'P01' })
      )
    ).resolves.toMatchObject({ ok: true })

    const backup = await window.evaluate(() =>
      (globalThis as unknown as RendererWindow).easyEpi.project.backup()
    )
    expect(backup).toMatchObject({ ok: true })
    const backups = await window.evaluate(() =>
      (globalThis as unknown as RendererWindow).easyEpi.project.listBackups()
    )
    expect(backups).toMatchObject({
      ok: true,
      backups: expect.arrayContaining([expect.objectContaining({ hasData: true })])
    })
    const backupPath = backups.backups.find((entry) => entry.hasData)?.filePath
    if (backupPath === undefined) throw new Error('M7_BACKUP_LIST_EMPTY')

    await expect(
      window.evaluate(() =>
        (globalThis as unknown as RendererWindow).easyEpi.record.submit({ 'm7-key': 'P02' })
      )
    ).resolves.toMatchObject({ ok: true })
    await expect(
      window.evaluate(() => (globalThis as unknown as RendererWindow).easyEpi.record.list())
    ).resolves.toMatchObject({ total: 2 })

    await expect(
      window.evaluate(
        ({ backupPath }) =>
          (globalThis as unknown as RendererWindow).easyEpi.project.restore({ backupPath }),
        { backupPath }
      )
    ).resolves.toMatchObject({ ok: true })
    await expect(
      window.evaluate(() => (globalThis as unknown as RendererWindow).easyEpi.record.list())
    ).resolves.toMatchObject({
      total: 1,
      records: [{ answers: { 'm7-key': 'P01' } }]
    })
  } finally {
    await closePortable(session)
  }
})
