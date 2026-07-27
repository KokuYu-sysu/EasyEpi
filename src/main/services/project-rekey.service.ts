import { randomUUID } from 'node:crypto'
import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { basename, dirname, join } from 'node:path'

import type { ProjectIpcState } from '../ipc/project.ipc'

import { deriveKey, hashPassword } from './crypto.service'
import { createProjectFileContents, verifyAndDeriveKey } from './project.service'
import {
  createReencryptedDataFileContents,
  resolveProjectDataFilePath
} from './record.service'

const MANIFEST_VERSION = 1
const TRANSACTION_ID_PATTERN = /^[0-9a-f-]{36}$/i

interface TransactionFile {
  target: string
  staged: string
  backup: string
  contents: Buffer<ArrayBufferLike>
}

interface ProjectRekeyManifest {
  version: 1
  transactionId: string
  dataFileName?: string
}

export interface ProjectRekeyDependencies {
  rename?: (source: string, target: string) => void
  remove?: (path: string) => void
}

export interface ProjectRekeyResult {
  success: true
}

export function getProjectRekeyManifestPath(projectPath: string): string {
  return `${projectPath}.rekey-transaction.json`
}

export function getProjectRekeyManifestTemporaryPath(
  projectPath: string,
  transactionId: string
): string {
  return `${getProjectRekeyManifestPath(projectPath)}.pending-${transactionId}`
}

function transactionFile(
  target: string,
  transactionId: string,
  contents: Buffer<ArrayBufferLike> = Buffer.alloc(0)
): TransactionFile {
  return {
    target,
    staged: `${target}.rekey-${transactionId}.tmp`,
    backup: `${target}.rekey-${transactionId}.bak`,
    contents
  }
}

function writeDurableFile(filePath: string, contents: Buffer<ArrayBufferLike>): void {
  const descriptor = openSync(filePath, 'wx')
  try {
    writeFileSync(descriptor, contents)
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
}

function removeIfPresent(path: string): void {
  if (existsSync(path)) rmSync(path, { force: true })
}

function bestEffortCleanup(paths: string[], remove: (path: string) => void): void {
  for (const path of paths) {
    try {
      if (existsSync(path)) remove(path)
    } catch {
      // A committed transaction remains valid if an encrypted backup cannot be removed.
    }
  }
}

function parseManifest(projectPath: string, raw: string): { manifest: ProjectRekeyManifest; files: TransactionFile[] } {
  const parsed = JSON.parse(raw) as Partial<ProjectRekeyManifest>
  if (parsed.version !== MANIFEST_VERSION || typeof parsed.transactionId !== 'string' || !TRANSACTION_ID_PATTERN.test(parsed.transactionId)) {
    throw new Error('INVALID_REKEY_MANIFEST')
  }
  const files = [transactionFile(projectPath, parsed.transactionId)]
  if (parsed.dataFileName !== undefined) {
    if (
      typeof parsed.dataFileName !== 'string' ||
      basename(parsed.dataFileName) !== parsed.dataFileName ||
      !parsed.dataFileName.endsWith('.easyepi_data')
    ) {
      throw new Error('INVALID_REKEY_MANIFEST')
    }
    files.push(transactionFile(join(dirname(projectPath), parsed.dataFileName), parsed.transactionId))
  }
  return { manifest: parsed as ProjectRekeyManifest, files }
}

export function recoverProjectRekeyTransaction(projectPath: string): boolean {
  const manifestPath = getProjectRekeyManifestPath(projectPath)
  if (!existsSync(manifestPath)) return false
  let files: TransactionFile[]
  try {
    files = parseManifest(projectPath, readFileSync(manifestPath, 'utf8')).files
    for (const file of [...files].reverse()) {
      if (existsSync(file.backup)) {
        removeIfPresent(file.target)
        renameSync(file.backup, file.target)
      }
      removeIfPresent(file.staged)
    }
    removeIfPresent(manifestPath)
    return true
  } catch (error) {
    throw new Error('PROJECT_REKEY_RECOVERY_FAILED', { cause: error })
  }
}

function rollbackTransaction(
  files: TransactionFile[],
  backedUp: TransactionFile[],
  installed: TransactionFile[],
  manifestPath: string,
  rename: (source: string, target: string) => void,
  remove: (path: string) => void
): void {
  try {
    for (const file of [...installed].reverse()) {
      if (existsSync(file.target)) remove(file.target)
    }
    for (const file of [...backedUp].reverse()) {
      if (existsSync(file.target)) remove(file.target)
      if (existsSync(file.backup)) rename(file.backup, file.target)
    }
    bestEffortCleanup(files.map(({ staged }) => staged), remove)
    if (existsSync(manifestPath)) remove(manifestPath)
  } catch (error) {
    // Keep the manifest and any remaining encrypted backups for recovery on next open.
    throw new Error('PROJECT_REKEY_ROLLBACK_FAILED', { cause: error })
  }
}

function replaceFilesTransactionally(
  projectPath: string,
  dataPath: string | undefined,
  files: TransactionFile[],
  rename: (source: string, target: string) => void,
  remove: (path: string) => void
): void {
  const manifestPath = getProjectRekeyManifestPath(projectPath)
  const manifest: ProjectRekeyManifest = {
    version: MANIFEST_VERSION,
    transactionId: files[0]!.staged.match(/\.rekey-([0-9a-f-]{36})\.tmp$/i)?.[1] ?? '',
    dataFileName: dataPath === undefined ? undefined : basename(dataPath)
  }
  const manifestTemporaryPath = getProjectRekeyManifestTemporaryPath(
    projectPath,
    manifest.transactionId
  )
  const backedUp: TransactionFile[] = []
  const installed: TransactionFile[] = []

  try {
    for (const file of files) writeDurableFile(file.staged, file.contents)
    writeDurableFile(manifestTemporaryPath, Buffer.from(JSON.stringify(manifest), 'utf8'))
    renameSync(manifestTemporaryPath, manifestPath)
  } catch (error) {
    bestEffortCleanup(
      [...files.map(({ staged }) => staged), manifestTemporaryPath],
      remove
    )
    throw error
  }

  try {
    for (const file of files) {
      rename(file.target, file.backup)
      backedUp.push(file)
      rename(file.staged, file.target)
      installed.push(file)
    }
    // Removing the manifest is the commit marker. Backup cleanup must never trigger rollback.
    remove(manifestPath)
  } catch (error) {
    rollbackTransaction(files, backedUp, installed, manifestPath, rename, remove)
    throw error
  }

  bestEffortCleanup(files.flatMap(({ staged, backup }) => [staged, backup]), remove)
}

export function changeProjectPassword(
  state: ProjectIpcState,
  oldPassword: string,
  newPassword: string,
  dependencies: ProjectRekeyDependencies = {}
): ProjectRekeyResult {
  const project = state.currentProject
  const projectPath = state.currentFilePath
  const oldKey = state.auth.encryptionKey
  if (!project || !projectPath) throw new Error('NO_PROJECT_OPEN')
  if (!oldKey) throw new Error('PROJECT_NOT_UNLOCKED')
  if (newPassword.length < 8) throw new Error('WEAK_NEW_PASSWORD')
  if (oldPassword === newPassword) throw new Error('PASSWORD_UNCHANGED')

  recoverProjectRekeyTransaction(projectPath)
  const verifiedOldKey = verifyAndDeriveKey(oldPassword, state.currentSaltHex, state.currentHashHex)
  if (!verifiedOldKey || !verifiedOldKey.equals(oldKey)) throw new Error('INVALID_OLD_PASSWORD')

  const { hash, salt } = hashPassword(newPassword)
  const newKey = deriveKey(newPassword, Buffer.from(salt, 'hex'))
  const timestamp = Date.now()
  const transactionId = randomUUID()
  const resolvedDataPath = resolveProjectDataFilePath(projectPath, project.meta.name)
  const dataPath = existsSync(resolvedDataPath) ? resolvedDataPath : undefined
  const files: TransactionFile[] = [
    transactionFile(
      projectPath,
      transactionId,
      createProjectFileContents(project, newKey, salt, hash, timestamp)
    )
  ]
  if (dataPath !== undefined) {
    files.push(transactionFile(
      dataPath,
      transactionId,
      createReencryptedDataFileContents(dataPath, oldKey, newKey, timestamp)
    ))
  }

  replaceFilesTransactionally(
    projectPath,
    dataPath,
    files,
    dependencies.rename ?? renameSync,
    dependencies.remove ?? ((path) => rmSync(path, { force: true }))
  )

  state.currentProject = {
    ...project,
    meta: { ...project.meta, lastModifiedAt: new Date(timestamp).toISOString() }
  }
  state.currentSaltHex = salt
  state.currentHashHex = hash
  state.auth.encryptionKey = newKey
  state.auth.passwordData = { hash, salt }
  return { success: true }
}
