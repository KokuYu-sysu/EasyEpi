import { expect, test, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { DesktopApi } from '../../src/shared/desktop-api'

const projectRoot = fileURLToPath(new URL('../..', import.meta.url))
const mainEntry = fileURLToPath(new URL('../../out/main/index.js', import.meta.url))
const userDataRoot = join(projectRoot, '.e2e-derived-data')

type RendererWindow = Window & { easyEpi: DesktopApi }

async function navigateHash(page: Page, path: string): Promise<void> {
  await page.evaluate((target) => {
    window.location.hash = `#${target}`
  }, path)
}

test('computes derived variables on entry and exports them as columns', async () => {
  await mkdir(userDataRoot, { recursive: true })
  const userDataDir = await mkdtemp(join(userDataRoot, 'easyepi-'))
  const projectFolder = join(userDataDir, 'derived-project')
  const exportPath = join(userDataDir, 'derived-export.csv')
  const secondaryPath = join(userDataDir, 'secondary.csv')
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
          name: '衍生变量验收',
          folderPath,
          password: 'derived-password'
        })
        await api.qnaire.addQuestion({
          id: 'q-age',
          content: '年龄',
          variableName: 'age',
          type: 'numeric_range',
          options: [],
          constraint: { type: 'integer', minValue: 0, maxValue: 120 },
          isKey: false,
          allowSkip: false,
          order: 0
        })
        await api.qnaire.addQuestion({
          id: 'q-weight',
          content: '体重(kg)',
          variableName: 'weight',
          type: 'numeric_range',
          options: [],
          constraint: { type: 'none' },
          isKey: false,
          allowSkip: false,
          order: 1
        })
        await api.qnaire.addQuestion({
          id: 'q-height',
          content: '身高(cm)',
          variableName: 'height',
          type: 'numeric_range',
          options: [],
          constraint: { type: 'none' },
          isKey: false,
          allowSkip: false,
          order: 2
        })
        await api.qnaire.addQuestion({
          id: 'q-sex',
          content: '性别',
          variableName: 'sex',
          type: 'single_choice',
          options: [{ value: '1', label: '男' }, { value: '2', label: '女' }],
          constraint: { type: 'none' },
          isKey: true,
          allowSkip: false,
          order: 3
        })
        const added = await api.derived.add({
          variableName: 'bmi',
          label: 'BMI',
          formula: '{weight} / ({height} / 100) ^ 2',
          resultType: 'numeric',
          displayDecimals: 1
        })
        if (!added.ok) throw new Error('DERIVED_ADD_FAILED')
        const group = await api.derived.add({
          variableName: 'age_group',
          label: '年龄分组',
          formula: 'IF({age} >= 60, "老年", IF({age} >= 18, "成年", "未成年"))',
          resultType: 'categorical'
        })
        if (!group.ok) throw new Error('DERIVED_ADD_FAILED')
        await api.project.save({ folderPath })
      },
      { folderPath: projectFolder }
    )

    await navigateHash(page, '/derived')
    await expect(page.getByRole('heading', { level: 1, name: '衍生变量' })).toBeVisible()
    await expect(page.getByText('可用变量（点击插入当前公式）')).toBeVisible()
    await expect(page.getByText('bmi', { exact: false })).toBeVisible()

    await expect(
      page.evaluate(() => (window as unknown as RendererWindow).easyEpi.derived.getAll())
    ).resolves.toMatchObject({ ok: true, derivedVariables: expect.arrayContaining([
      expect.objectContaining({ variableName: 'bmi' }),
      expect.objectContaining({ variableName: 'age_group' })
    ]) })

    const submitted = await page.evaluate(
      async () => {
        const api = (window as unknown as RendererWindow).easyEpi
        return api.record.submit({
          'q-age': '70',
          'q-weight': '70',
          'q-height': '170',
          'q-sex': '1'
        })
      }
    )
    expect(submitted).toMatchObject({ ok: true })

    const listed = await page.evaluate(
      () => (window as unknown as RendererWindow).easyEpi.record.list()
    )
    expect(listed).toMatchObject({ total: 1 })
    const recordAnswers = listed.records[0]!.answers
    expect(Number(recordAnswers['bmi'])).toBeCloseTo(24.22, 1)
    expect(recordAnswers['age_group']).toBe('老年')

    await navigateHash(page, '/admin/login')
    await page.getByLabel('当前项目密码').fill('derived-password')
    await page.getByRole('button', { name: '登录管理后台' }).click()
    await expect(page.getByText('共 1 条记录')).toBeVisible()

    const exported = await page.evaluate(
      ({ outputPath }) => (window as unknown as RendererWindow).easyEpi.exportData.csv({
        outputPath,
        encoding: 'multi_category',
        scope: 'all'
      }),
      { outputPath: exportPath }
    )
    expect(exported).toMatchObject({ success: true, recordCount: 1 })
    const csv = await readFile(exportPath)
    expect(csv.toString('utf8')).toContain('bmi')
    expect(csv.toString('utf8')).toContain('age_group')
    expect(csv.toString('utf8')).toContain('老年')
    const dictionary = await readFile(exported.dictionaryPath!, 'utf8')
    expect(dictionary).toContain('bmi')
    expect(dictionary).toContain('衍生变量')

    await page.getByRole('tab', { name: '数据质量' }).click()
    await expect(page.getByText('整体完整率')).toBeVisible()
    await expect(page.getByText('100.0%').first()).toBeVisible()

    await writeFile(
      secondaryPath,
      'age,weight,height,sex\n70,70,170,男\n',
      'utf8'
    )
    await expect(
      page.evaluate(
        ({ filePath }) => (window as unknown as RendererWindow).easyEpi.doubleEntry.compare({
          secondaryFilePath: filePath
        }),
        { filePath: secondaryPath }
      )
    ).resolves.toMatchObject({ ok: true, comparison: expect.objectContaining({ matchedIdentical: 1 }) })
  } finally {
    await app?.close()
    await rm(userDataDir, { recursive: true, force: true })
    await rm(userDataRoot, { recursive: true, force: true })
  }
})
