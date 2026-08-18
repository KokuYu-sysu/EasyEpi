import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, unlinkSync, statSync } from 'node:fs'
import { join, basename, dirname } from 'node:path'

const BACKUP_DIR = '.backups'
const MAX_BACKUPS = 10
const BACKUP_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes

interface BackupInfo {
  filePath: string
  timestamp: number
  size: number
}

/**
 * Get the backup directory for a project file
 */
function getBackupDir(projectFilePath: string): string {
  const dir = dirname(projectFilePath)
  return join(dir, BACKUP_DIR)
}

/**
 * Get all backups for a project file, sorted by timestamp (newest first)
 */
export function getBackups(projectFilePath: string): BackupInfo[] {
  const backupDir = getBackupDir(projectFilePath)
  if (!existsSync(backupDir)) return []

  const projectBaseName = basename(projectFilePath)
  try {
    const files = readdirSync(backupDir)
    const backups: BackupInfo[] = []

    for (const file of files) {
      if (!file.startsWith(projectBaseName + '.')) continue
      const filePath = join(backupDir, file)
      try {
        const stats = statSync(filePath)
        const timestampMatch = file.match(/\.(\d+)\.bak$/)
        if (timestampMatch && timestampMatch[1]) {
          backups.push({
            filePath,
            timestamp: parseInt(timestampMatch[1], 10),
            size: stats.size
          })
        }
      } catch {
        // Skip files that can't be read
      }
    }

    return backups.sort((a, b) => b.timestamp - a.timestamp)
  } catch {
    return []
  }
}

/**
 * Create a backup of the project file
 */
export function createBackup(projectFilePath: string): string | null {
  try {
    if (!existsSync(projectFilePath)) return null

    const backupDir = getBackupDir(projectFilePath)
    if (!existsSync(backupDir)) {
      mkdirSync(backupDir, { recursive: true })
    }

    const projectBaseName = basename(projectFilePath)
    const timestamp = Date.now()
    const backupFileName = `${projectBaseName}.${timestamp}.bak`
    const backupPath = join(backupDir, backupFileName)

    // Copy the file
    const content = readFileSync(projectFilePath)
    writeFileSync(backupPath, content)

    // Clean up old backups
    cleanupOldBackups(projectFilePath)

    return backupPath
  } catch {
    return null
  }
}

/**
 * Clean up old backups, keeping only the most recent ones
 */
function cleanupOldBackups(projectFilePath: string): void {
  const backups = getBackups(projectFilePath)
  if (backups.length <= MAX_BACKUPS) return

  // Delete the oldest backups
  const toDelete = backups.slice(MAX_BACKUPS)
  for (const backup of toDelete) {
    try {
      unlinkSync(backup.filePath)
    } catch {
      // Ignore errors when deleting old backups
    }
  }
}

/**
 * Restore a project file from a backup
 */
export function restoreFromBackup(backupPath: string, projectFilePath: string): boolean {
  try {
    if (!existsSync(backupPath)) return false

    const content = readFileSync(backupPath)
    writeFileSync(projectFilePath, content)
    return true
  } catch {
    return false
  }
}

/**
 * Check if a backup should be created based on the interval
 */
let lastBackupTime = 0
export function shouldCreateBackup(): boolean {
  const now = Date.now()
  if (now - lastBackupTime >= BACKUP_INTERVAL_MS) {
    lastBackupTime = now
    return true
  }
  return false
}

/**
 * Reset the backup timer (e.g., after manual backup)
 */
export function resetBackupTimer(): void {
  lastBackupTime = Date.now()
}
