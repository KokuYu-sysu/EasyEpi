import { expect, test, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { DesktopApi } from '../../src/shared/desktop-api'

const projectRoot = fileURLToPath(new URL('../..', import.meta.url))
const mainEntry = fileURLToPath(new URL('../../out/main/index.js', import.meta.url))
const userDataRoot = join(projectRoot, '.e2e-admin-data')

type RendererWindow = Window & { easyEpi: DesktopApi }

async function navigateHash(page: Page, path: string): Promise<void> {
  await page.evaluate((target) => {
    window.location.hash = `#${target}`
  }, path)
}

test('completes the encrypted phase-four administrator workflow', async () => {
  await mkdir(userDataRoot, { recursive: true })
  const userDataDir = await mkdtemp(join(userDataRoot, 'easyepi-'))
  const projectFolder = join(userDataDir, 'phase4-project')
  const exportPath = join(userDataDir, 'phase4-export.csv')
  const baselinePath = join(userDataDir, 'phase4-baseline.csv')
  const projectFile = join(projectFolder, '阶段四验收.easyepi')
  const dataFile = join(projectFolder, '阶段四验收.easyepi_data')
  await mkdir(projectFolder, { recursive: true })

  let app: ElectronApplication | undefined
  try {
    app = await electron.launch({
      args: [mainEntry, `--user-data-dir=${userDataDir}`],
      cwd: projectRoot
    })
    const page = await app.firstWindow()
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

    await page.evaluate(
      async ({ folderPath }) => {
        const api = (window as unknown as RendererWindow).easyEpi
        await api.project.create({
          name: '阶段四验收',
          folderPath,
          password: 'old-password'
        })
        await api.qnaire.addQuestion({
          id: 'admin-q1',
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
          id: 'admin-q2',
          content: '研究组别',
          variableName: 'study_group',
          type: 'single_choice',
          options: [
            { value: 'control', label: '对照组' },
            { value: 'case', label: '病例组' }
          ],
          constraint: { type: 'none' },
          isKey: false,
          allowSkip: false,
          order: 1
        })
        await api.qnaire.addQuestion({
          id: 'admin-q3',
          content: '年龄',
          variableName: 'age',
          type: 'numeric_range',
          options: [],
          constraint: { type: 'integer', minValue: 0, maxValue: 120 },
          isKey: false,
          allowSkip: false,
          order: 2
        })
        await api.project.save({ folderPath })
        for (const answers of [
          { 'admin-q1': 'A01', 'admin-q2': 'control', 'admin-q3': '30' },
          { 'admin-q1': 'B02', 'admin-q2': 'case', 'admin-q3': '42' },
          { 'admin-q1': 'C03', 'admin-q2': 'case', 'admin-q3': '55' }
        ]) {
          const result = await api.record.submit(answers)
          if (!result.ok) throw new Error(result.error ?? 'RECORD_SUBMIT_FAILED')
        }
      },
      { folderPath: projectFolder }
    )

    await navigateHash(page, '/admin/data')
    await expect(page.getByRole('heading', { level: 2, name: '管理员验证' })).toBeVisible()
    await page.getByLabel('当前项目密码').fill('incorrect-password')
    await page.getByRole('button', { name: '登录管理后台' }).click()
    await expect(page.getByText('项目密码不正确。')).toBeVisible()
    await page.getByLabel('当前项目密码').fill('old-password')
    await page.getByRole('button', { name: '登录管理后台' }).click()

    await expect(page.getByText('共 3 条记录')).toBeVisible()
    await page.getByLabel('搜索记录').fill('B02')
    await page.getByRole('button', { name: '搜索', exact: true }).click()
    await expect(page.getByRole('row', { name: /B02/ })).toBeVisible()
    await expect(page.getByText('共 1 条记录')).toBeVisible()
    await page.getByLabel('搜索记录').fill('')
    await page.getByRole('button', { name: '搜索', exact: true }).click()
    await expect(page.getByText('共 3 条记录')).toBeVisible()

    const firstRow = page.getByRole('row', { name: /A01/ })
    await firstRow.getByRole('button', { name: '编辑' }).click()
    const editDialog = page.getByRole('dialog', { name: '编辑调查记录' })
    await editDialog.getByLabel('年龄 (age)').fill('31')
    await editDialog.getByRole('button', { name: '保存到加密文件' }).click()
    await expect(page.getByText('记录已写入加密数据文件。')).toBeVisible()
    await expect(page.getByRole('row', { name: /A01.*31/ })).toBeVisible()

    const lastRow = page.getByRole('row', { name: /C03/ })
    await lastRow.getByRole('button', { name: '删除' }).click()
    await page.getByRole('alertdialog', { name: '删除调查记录' })
      .getByRole('button', { name: '确认删除' })
      .click()
    await expect(page.getByText('共 2 条记录')).toBeVisible()

    const exported = await page.evaluate(
      ({ outputPath }) => (window as unknown as RendererWindow).easyEpi.exportData.csv({
        outputPath,
        encoding: 'dummy',
        dummyReference: 'first',
        scope: 'all'
      }),
      { outputPath: exportPath }
    )
    expect(exported).toMatchObject({ success: true, recordCount: 2 })
    const csv = await readFile(exportPath)
    expect([...csv.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    expect(csv.toString('utf8')).toContain('participant_id')
    await expect(readFile(exported.dictionaryPath!, 'utf8')).resolves.toContain('study_group')

    await page.getByRole('tab', { name: '基线表' }).click()
    await page.getByRole('button', { name: '打开基线表生成器' }).click()
    await page.getByRole('button', { name: '生成基线表' }).click()
    await expect(page.getByText(/已根据当前加密数据生成/)).toBeVisible()
    await expect(page.getByRole('table', { name: 'Table 1. 基线特征' })).toBeVisible()
    const baseline = await page.evaluate(
      ({ outputPath }) => (window as unknown as RendererWindow).easyEpi.baseline.export({
        outputPath,
        selectedQuestionIds: ['admin-q2', 'admin-q3'],
        groupQuestionId: 'admin-q2'
      }),
      { outputPath: baselinePath }
    )
    expect(baseline).toMatchObject({ success: true })
    expect([...(await readFile(baselinePath)).subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])

    await navigateHash(page, '/admin/data')
    await page.getByRole('button', { name: '退出管理后台' }).click()
    await expect(page.getByRole('heading', { level: 2, name: '管理员验证' })).toBeVisible()
    await expect(
      page.evaluate(() => (window as unknown as RendererWindow).easyEpi.admin.checkSession())
    ).resolves.toMatchObject({ isAuthenticated: false })
    await page.getByLabel('当前项目密码').fill('old-password')
    await page.getByRole('button', { name: '登录管理后台' }).click()
    await expect(page.getByText('共 2 条记录')).toBeVisible()
    await page.getByRole('tab', { name: '设置' }).click()
    await page.getByLabel('当前项目密码').fill('old-password')
    await page.getByLabel('新项目密码', { exact: true }).fill('new-password')
    await page.getByLabel('确认新项目密码').fill('new-password')
    await page.getByRole('button', { name: '重新加密并修改密码' }).click()
    await expect(page.getByText('项目与数据文件已使用新密码重新加密。')).toBeVisible()

    expect((await readFile(projectFile)).includes(Buffer.from('A01'))).toBe(false)
    expect((await readFile(dataFile)).includes(Buffer.from('A01'))).toBe(false)
    await page.evaluate(() => (window as unknown as RendererWindow).easyEpi.project.close())
    await expect(
      page.evaluate(
        ({ filePath }) => (window as unknown as RendererWindow).easyEpi.project.open({
          filePath,
          password: 'old-password'
        }),
        { filePath: projectFile }
      )
    ).resolves.toMatchObject({ ok: false })
    await expect(
      page.evaluate(
        ({ filePath }) => (window as unknown as RendererWindow).easyEpi.project.open({
          filePath,
          password: 'new-password'
        }),
        { filePath: projectFile }
      )
    ).resolves.toMatchObject({ ok: true })
    await expect(
      page.evaluate(() => (window as unknown as RendererWindow).easyEpi.record.list())
    ).resolves.toMatchObject({
      total: 2,
      records: expect.arrayContaining([
        expect.objectContaining({ answers: expect.objectContaining({ 'admin-q1': 'A01', 'admin-q3': 31 }) })
      ])
    })
    await expect(
      page.evaluate(() => (window as unknown as RendererWindow).easyEpi.admin.checkSession())
    ).resolves.toMatchObject({ isAuthenticated: false })

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await expect(
        page.evaluate(() => (window as unknown as RendererWindow).easyEpi.admin.login({
          password: 'incorrect-password'
        }))
      ).resolves.toMatchObject({ success: false, error: 'INVALID_ADMIN_PASSWORD' })
    }
    await navigateHash(page, '/admin/login')
    await page.getByLabel('当前项目密码').fill('incorrect-password')
    await page.getByRole('button', { name: '登录管理后台' }).click()
    await expect(page.getByText('密码错误次数过多，管理员登录已暂时锁定。')).toBeVisible()
    await expect(page.getByText(/请在 \d+ 秒后重试。/)).toBeVisible()
  } finally {
    await app?.close()
    await rm(userDataDir, { recursive: true, force: true })
    await rm(userDataRoot, { recursive: true, force: true })
  }
})
