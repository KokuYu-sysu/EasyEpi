import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { basename, dirname, extname, join, resolve } from 'node:path'

import { atomicWriteFile } from './record.service'

const BACKUP_DIR = '.backups'
const MAX_BACKUPS = 10
const BACKUP_INTERVAL_MS = 5 * 60 * 1000

export function startBackupTimer(createSnapshot: () => void): () => void {
  const timer = setInterval(createSnapshot, BACKUP_INTERVAL_MS)
  timer.unref?.()
  return () => clearInterval(timer)
}

export interface BackupInfo {
  filePath: string
  timestamp: number
  size: number
  hasData: boolean
}

export interface RestoreBackupOptions {
  dataFilePath?: string
  validateProject?: (backupPath: string) => void
  validateData?: (backupPath: string) => void
}

function getBackupDir(projectFilePath: string): string {
  return join(dirname(projectFilePath), BACKUP_DIR)
}

function inferredDataFilePath(projectFilePath: string): string {
  return join(
    dirname(projectFilePath),
    `${basename(projectFilePath, extname(projectFilePath))}.easyepi_data`
  )
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function backupNamePattern(projectFilePath: string): RegExp {
  return new RegExp(`^${escapeRegExp(basename(projectFilePath))}\\.(\\d+)\\.bak$`)
}

function getBackupTimestamp(backupPath: string, projectFilePath: string): number | null {
  if (resolve(dirname(backupPath)) !== resolve(getBackupDir(projectFilePath))) return null
  const match = backupNamePattern(projectFilePath).exec(basename(backupPath))
  if (!match?.[1]) return null
  const timestamp = Number(match[1])
  return Number.isSafeInteger(timestamp) ? timestamp : null
}

function dataBackupPath(dataFilePath: string, timestamp: number): string {
  return join(dirname(dataFilePath), BACKUP_DIR, `${basename(dataFilePath)}.${timestamp}.bak`)
}

function dataAbsenceMarkerPath(dataFilePath: string, timestamp: number): string {
  return join(dirname(dataFilePath), BACKUP_DIR, `${basename(dataFilePath)}.${timestamp}.none`)
}

function writeSnapshotFile(targetPath: string, contents: Buffer): void {
  atomicWriteFile(targetPath, contents)
}

export function getBackups(
  projectFilePath: string,
  dataFilePath = inferredDataFilePath(projectFilePath)
): BackupInfo[] {
  const backupDir = getBackupDir(projectFilePath)
  if (!existsSync(backupDir)) return []

  const pattern = backupNamePattern(projectFilePath)
  try {
    const backups: BackupInfo[] = []
    for (const file of readdirSync(backupDir)) {
      const match = pattern.exec(file)
      if (!match?.[1]) continue
      const timestamp = Number(match[1])
      if (!Number.isSafeInteger(timestamp)) continue
      const filePath = join(backupDir, file)
      try {
        const stats = statSync(filePath)
        if (!stats.isFile()) continue
        const hasData = existsSync(dataBackupPath(dataFilePath, timestamp))
        const marksNoData = existsSync(dataAbsenceMarkerPath(dataFilePath, timestamp))
        if (hasData === marksNoData) continue
        backups.push({
          filePath,
          timestamp,
          size: stats.size,
          hasData
        })
      } catch {
        // A concurrently removed or unreadable backup is omitted.
      }
    }
    return backups.sort((left, right) => right.timestamp - left.timestamp)
  } catch {
    return []
  }
}

export function createBackup(
  projectFilePath: string,
  dataFilePath = inferredDataFilePath(projectFilePath)
): string | null {
  if (!existsSync(projectFilePath)) return null

  const backupDir = getBackupDir(projectFilePath)
  try {
    mkdirSync(backupDir, { recursive: true })
    let timestamp = Date.now()
    let backupPath = join(backupDir, `${basename(projectFilePath)}.${timestamp}.bak`)
    while (existsSync(backupPath)) {
      timestamp += 1
      backupPath = join(backupDir, `${basename(projectFilePath)}.${timestamp}.bak`)
    }

    const backupDataPath = dataBackupPath(dataFilePath, timestamp)
    const backupDataAbsenceMarkerPath = dataAbsenceMarkerPath(dataFilePath, timestamp)
    writeSnapshotFile(backupPath, readFileSync(projectFilePath))
    try {
      if (existsSync(dataFilePath)) {
        writeSnapshotFile(backupDataPath, readFileSync(dataFilePath))
      } else {
        writeSnapshotFile(backupDataAbsenceMarkerPath, Buffer.alloc(0))
      }
    } catch (error) {
      rmSync(backupPath, { force: true })
      rmSync(backupDataPath, { force: true })
      rmSync(backupDataAbsenceMarkerPath, { force: true })
      throw error
    }

    cleanupOldBackups(projectFilePath, dataFilePath)
    return backupPath
  } catch {
    return null
  }
}

function cleanupOldBackups(projectFilePath: string, dataFilePath: string): void {
  const backups = getBackups(projectFilePath, dataFilePath)
  for (const backup of backups.slice(MAX_BACKUPS)) {
    rmSync(backup.filePath, { force: true })
    rmSync(dataBackupPath(dataFilePath, backup.timestamp), { force: true })
    rmSync(dataAbsenceMarkerPath(dataFilePath, backup.timestamp), { force: true })
  }
}

export function restoreFromBackup(
  backupPath: string,
  projectFilePath: string,
  options: RestoreBackupOptions = {}
): boolean {
  const timestamp = getBackupTimestamp(backupPath, projectFilePath)
  if (timestamp === null || !existsSync(backupPath)) return false

  const dataFilePath = options.dataFilePath ?? inferredDataFilePath(projectFilePath)
  const backupDataPath = dataBackupPath(dataFilePath, timestamp)
  const backupDataAbsenceMarkerPath = dataAbsenceMarkerPath(dataFilePath, timestamp)
  const currentHasData = existsSync(dataFilePath)
  const backupHasData = existsSync(backupDataPath)
  const backupMarksNoData = existsSync(backupDataAbsenceMarkerPath)
  if (backupHasData === backupMarksNoData) return false

  try {
    options.validateProject?.(backupPath)
    if (backupHasData) options.validateData?.(backupDataPath)

    const previousProject = readFileSync(projectFilePath)
    const previousData = currentHasData ? readFileSync(dataFilePath) : null
    const restoredProject = readFileSync(backupPath)
    const restoredData = backupHasData ? readFileSync(backupDataPath) : null

    try {
      writeSnapshotFile(projectFilePath, restoredProject)
      if (restoredData !== null) {
        writeSnapshotFile(dataFilePath, restoredData)
      } else {
        rmSync(dataFilePath, { force: true })
      }
    } catch (error) {
      writeSnapshotFile(projectFilePath, previousProject)
      if (previousData !== null) {
        writeSnapshotFile(dataFilePath, previousData)
      } else {
        rmSync(dataFilePath, { force: true })
      }
      throw error
    }
    return true
  } catch {
    return false
  }
}

const lastBackupTimes = new Map<string, number>()

export function shouldCreateBackup(projectFilePath = ''): boolean {
  const now = Date.now()
  const lastBackupTime = lastBackupTimes.get(projectFilePath) ?? 0
  return now - lastBackupTime >= BACKUP_INTERVAL_MS
}

export function resetBackupTimer(projectFilePath = ''): void {
  lastBackupTimes.set(projectFilePath, Date.now())
}
