import type {
  AIPublicAttemptFailure,
  AIPublicFailureDetails,
  AIPublicValidationIssue
} from '@shared/ai-assistant-contract'
import {
  AI_PUBLIC_VALIDATION_SUMMARIES,
  isAIPublicValidationCode,
  type AIPublicValidationCode
} from '@shared/ai-public-validation'

export const PUBLIC_VALIDATION_CODES = AI_PUBLIC_VALIDATION_SUMMARIES

export interface AIInternalValidationIssue {
  code?: unknown
  path?: unknown
  field?: unknown
  message?: unknown
}

export interface AIInternalAttemptFailure {
  attempt: unknown
  errors?: readonly AIInternalValidationIssue[]
  issues?: readonly AIInternalValidationIssue[]
}

const VALIDATION_FIELD_PATTERN =
  /^\$(?:\.[A-Za-z][A-Za-z0-9]*|\[(?:0|[1-9][0-9]{0,2})\]){0,12}$/
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/gu
const MAX_PUBLIC_ISSUES = 20

function stripControlCharacters(value: string, maxLength: number): string {
  return value.replace(CONTROL_CHARACTERS, '').trim().slice(0, maxLength)
}

function publicCode(value: unknown): AIPublicValidationCode {
  if (typeof value !== 'string') return 'AI_VALIDATION_ERROR'
  const code = stripControlCharacters(value, 128)
  return isAIPublicValidationCode(code) ? code : 'AI_VALIDATION_ERROR'
}

export function sanitizeAIValidationField(value: unknown): string {
  if (typeof value !== 'string' || value.length > 256) return '$'
  if (stripControlCharacters(value, 256) !== value) return '$'
  return VALIDATION_FIELD_PATTERN.test(value) ? value : '$'
}

function publicIssue(issue: AIInternalValidationIssue): AIPublicValidationIssue {
  const code = publicCode(issue.code)
  const summary = stripControlCharacters(PUBLIC_VALIDATION_CODES[code], 200)
  return {
    code,
    field: sanitizeAIValidationField(issue.field ?? issue.path),
    summary
  }
}

export function toAIPublicAttemptFailure(
  attempt: 1 | 2 | 3,
  issues: readonly AIInternalValidationIssue[]
): AIPublicAttemptFailure {
  const publicIssues: AIPublicValidationIssue[] = []
  const seen = new Set<string>()
  let truncated = false
  for (const issue of issues) {
    const sanitized = publicIssue(issue)
    const key = `${sanitized.code}\0${sanitized.field}`
    if (seen.has(key)) continue
    seen.add(key)
    if (publicIssues.length < MAX_PUBLIC_ISSUES) publicIssues.push(sanitized)
    else truncated = true
  }
  return { attempt, issues: publicIssues, truncated }
}

export function toAIPublicFailureDetails(
  attempts: readonly AIInternalAttemptFailure[]
): AIPublicFailureDetails {
  const byAttempt = new Map<1 | 2 | 3, AIPublicAttemptFailure>()
  for (const input of [...attempts].sort((left, right) => Number(left.attempt) - Number(right.attempt))) {
    if (input.attempt !== 1 && input.attempt !== 2 && input.attempt !== 3) continue
    if (byAttempt.has(input.attempt)) continue
    byAttempt.set(
      input.attempt,
      toAIPublicAttemptFailure(input.attempt, input.errors ?? input.issues ?? [])
    )
  }
  return { attempts: [...byAttempt.values()].slice(0, 3) }
}
