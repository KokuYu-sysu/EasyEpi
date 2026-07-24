import type { QuestionnaireDef } from './qnaire'

export interface ProjectMeta {
  name: string
  folderPath: string
  createdAt: string
  lastModifiedAt: string
}

export interface ProjectData {
  meta: ProjectMeta
  questionnaire: QuestionnaireDef
  passwordHash?: string
  recoveryKeyHash?: string
}

export const PROJECT_MAGIC = 0x4550_4901
export const PROJECT_VERSION = 1
export const DATA_MAGIC = 0x4550_4401
export const DATA_VERSION = 1
