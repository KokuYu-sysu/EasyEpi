import type { QuestionnaireDef } from './qnaire'
import type { AIAssistantProjectData } from '../ai-assistant-contract'

export interface ProjectMeta {
  /** Stable identity; optional only while loading projects created before v0.8. */
  readonly projectId?: string
  name: string
  folderPath: string
  createdAt: string
  lastModifiedAt: string
}

export interface ProjectData {
  meta: ProjectMeta
  /** Stable until content changes; optional only while loading legacy projects. */
  questionnaireRevision?: string
  questionnaire: QuestionnaireDef
  passwordHash?: string
  recoveryKeyHash?: string
  /** Optional for backward compatibility with projects created before AI support. */
  aiAssistant?: AIAssistantProjectData
}

export const PROJECT_MAGIC = 0x4550_4901
export const PROJECT_VERSION = 1
export const DATA_MAGIC = 0x4550_4401
export const DATA_VERSION = 1
