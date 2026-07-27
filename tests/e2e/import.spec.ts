import { expect, test, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { DesktopApi } from '../../src/shared/desktop-api'

const projectRoot = fileURLToPath(new URL('../..', import.meta.url))
const mainEntry = fileURLToPath(new URL('../../out/main/index.js', import.meta.url))
const e2eRoot = join(projectRoot, '.e2e-epidata')
type RendererWindow = Window & { easyEpi: DesktopApi }

function headerField(name: string, typeCode: number, width: number, question: string): string {
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

async function launch(userDataDir: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [mainEntry, `--user-data-dir=${userDataDir}`],
    cwd: projectRoot
  })
  const page = await app.firstWindow()
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  return { app, page }
}

test('imports real EpiData files into an encrypted project and reopens the records', async () => {
  await mkdir(e2eRoot, { recursive: true })
  const working = await mkdtemp(join(e2eRoot, 'run-'))
  const source = join(working, 'source')
  const target = join(working, 'target')
  const userData = join(working, 'user-data')
  await mkdir(source, { recursive: true })
  await mkdir(target, { recursive: true })
  const qesFilePath = join(source, 'people.qes')
  await writeFile(
    qesFilePath,
    ['People import', '{name} Participant name __________', '{age} Participant age ###'].join('\r\n'),
    'utf8'
  )
  await writeFile(
    join(source, 'people.rec'),
    [
      '2 1 VLAB Filelabel: People',
      headerField('name', 1, 10, 'Participant name'),
      headerField('age', 0, 3, 'Participant age'),
      'Alice      42!',
      ''
    ].join('\r\n'),
    'latin1'
  )

  let running: { app: ElectronApplication; page: Page } | undefined
  try {
    running = await launch(userData)
    const preview = await running.page.evaluate(
      (path) => (window as unknown as RendererWindow).easyEpi.epidata.preview({ qesFilePath: path }),
      qesFilePath
    )
    expect(preview).toMatchObject({ fieldCount: 2, recordCount: 1, encoding: 'utf-8' })

    const result = await running.page.evaluate(
      ({ qesFilePath: qes, targetProjectPath }) =>
        (window as unknown as RendererWindow).easyEpi.epidata.import({
          qesFilePath: qes,
          targetProjectPath,
          projectName: 'Imported people',
          password: 'secure-password'
        }),
      { qesFilePath, targetProjectPath: target }
    )
    expect(result).toMatchObject({ success: true, recordCount: 1 })
    await expect(
      running.page.evaluate(() => (window as unknown as RendererWindow).easyEpi.qnaire.getData())
    ).resolves.toMatchObject({
      questions: [
        { variableName: 'name', type: 'free_text' },
        { variableName: 'age', type: 'numeric_range' }
      ]
    })
    await expect(
      running.page.evaluate(() => (window as unknown as RendererWindow).easyEpi.record.list())
    ).resolves.toMatchObject({ total: 1, records: [{ answers: expect.any(Object) }] })

    const projectFile = join(target, 'Imported people.easyepi')
    const dataFile = join(target, 'Imported people.easyepi_data')
    expect((await readFile(projectFile)).includes(Buffer.from('Alice'))).toBe(false)
    expect((await readFile(dataFile)).includes(Buffer.from('Alice'))).toBe(false)

    await running.app.close()
    running = await launch(userData)
    await expect(
      running.page.evaluate(
        ({ filePath }) =>
          (window as unknown as RendererWindow).easyEpi.project.open({
            filePath,
            password: 'secure-password'
          }),
        { filePath: projectFile }
      )
    ).resolves.toMatchObject({ ok: true })
    await expect(
      running.page.evaluate(() => (window as unknown as RendererWindow).easyEpi.record.list())
    ).resolves.toMatchObject({ total: 1 })
  } finally {
    await running?.app.close()
    await rm(working, { recursive: true, force: true })
    await rm(e2eRoot, { recursive: true, force: true })
  }
})
