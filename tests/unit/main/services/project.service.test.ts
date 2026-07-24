import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  createProject,
  decryptProjectData,
  getProjectFilePath,
  readProjectHeader,
  verifyAndDeriveKey
} from '../../../../src/main/services/project.service'

describe('ProjectService project file round trip', () => {
  const folders: string[] = []

  afterEach(() => {
    for (const folder of folders.splice(0)) {
      rmSync(folder, { recursive: true, force: true })
    }
  })

  it('reopens a newly created project with its password', () => {
    const folder = mkdtempSync(join(tmpdir(), 'easyepi-project-'))
    folders.push(folder)

    const created = createProject(folder, 'round-trip', 'correct horse battery staple')
    const filePath = getProjectFilePath(folder, 'round-trip')
    const header = readProjectHeader(filePath)

    expect(header.saltHex).toBe(created.salt)
    expect(header.hashHex).toBe(created.passwordHash)

    const key = verifyAndDeriveKey('correct horse battery staple', header.saltHex, header.hashHex)
    expect(key).not.toBeNull()
    expect(decryptProjectData(filePath, key!)).toMatchObject({
      meta: { name: 'round-trip', folderPath: folder },
      questionnaire: { name: 'round-trip' }
    })
  })

  it('does not overwrite an existing project with the same name', () => {
    const folder = mkdtempSync(join(tmpdir(), 'easyepi-project-'))
    folders.push(folder)
    createProject(folder, 'existing', 'first-password')

    expect(() => createProject(folder, 'existing', 'second-password')).toThrow(
      'PROJECT_ALREADY_EXISTS'
    )
  })
})
