import type { QualitySummary } from './types/quality'

export const QUALITY_GET_SUMMARY_CHANNEL = 'quality:getSummary' as const

export const ALL_QUALITY_CHANNELS = [QUALITY_GET_SUMMARY_CHANNEL] as const

export type QualityChannel = (typeof ALL_QUALITY_CHANNELS)[number]

export type QualityGetSummaryResult =
  | { ok: true; summary: QualitySummary }
  | { ok: false; error: string }
