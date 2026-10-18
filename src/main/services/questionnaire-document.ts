import {
  CONDITION_OPERATOR_LABELS,
  type QuestionType,
  type OptionItem,
  type QuestionnaireDef
} from '@shared/types/qnaire'
import {
  QUESTIONNAIRE_EXPORT_MAX_CELLS_PER_QUESTION,
  QUESTIONNAIRE_EXPORT_MAX_TOTAL_CELLS
} from '@shared/questionnaire-export-contract'

export interface DocumentQuestion {
  number: number
  content: string
  type: QuestionType
  isKey: boolean
  options: OptionItem[]
  fixedLength?: number
  rangeHint?: string
  notes: string[]
}

export interface QuestionnaireDocument {
  name: string
  description: string
  questions: DocumentQuestion[]
}

export function buildQuestionnaireDocument(qnaire: QuestionnaireDef): QuestionnaireDocument {
  if (qnaire.questions.length === 0) throw new Error('EMPTY_QUESTIONNAIRE')
  let totalCells = 0
  for (const question of qnaire.questions) {
    if (question.type !== 'fixed_length') continue
    const length = question.constraint.fixedLength
    if (!Number.isSafeInteger(length) || length! < 1) throw new Error('INVALID_QUESTIONNAIRE')
    totalCells += length!
    if (
      length! > QUESTIONNAIRE_EXPORT_MAX_CELLS_PER_QUESTION ||
      totalCells > QUESTIONNAIRE_EXPORT_MAX_TOTAL_CELLS
    ) {
      throw new Error('QUESTIONNAIRE_TOO_LARGE')
    }
  }
  const ordered = [...qnaire.questions].sort((a, b) => a.order - b.order)
  const byId = new Map(ordered.map((q, index) => [q.id, { question: q, number: index + 1 }]))
  const notes = new Map<string, string[]>()
  const actions = { show: '显示本题', skip: '跳过本题', require: '本题必填' }
  for (const rule of qnaire.conditionRules) {
    const source = byId.get(rule.sourceQuestionId)
    if (!source || !rule.conditions.length) throw new Error('INVALID_QUESTIONNAIRE')
    const conditions = rule.conditions
      .map((condition) => {
        const entry = byId.get(condition.questionId)
        if (!entry) throw new Error('INVALID_QUESTIONNAIRE')
        const reference = `第 ${entry.number} 题“${entry.question.content}”`
        const operator = CONDITION_OPERATOR_LABELS[condition.operator]
        if (condition.operator === 'is_empty' || condition.operator === 'is_not_empty') {
          return `${reference}${operator}`
        }
        const numericComparison =
          condition.operator === 'greater_than' || condition.operator === 'less_than'
        const label = numericComparison
          ? condition.value
          : (entry.question.options.find((option) => option.value === condition.value)?.label ??
            condition.value)
        return `${reference}${operator}“${label}”`
      })
      .join(rule.logic === 'AND' ? '且' : '或')
    const note = `【条件（设置于第 ${source.number} 题）：当${conditions}时，${actions[rule.action]}。】`
    for (const targetId of rule.targetQuestionIds) {
      if (!byId.has(targetId)) throw new Error('INVALID_QUESTIONNAIRE')
      notes.set(targetId, [...(notes.get(targetId) ?? []), note])
    }
  }
  return {
    name: qnaire.name,
    description: qnaire.description ?? '',
    questions: ordered.map((question, index) => {
      const fixedLength =
        question.type === 'fixed_length' ? question.constraint.fixedLength : undefined
      const { minValue, maxValue } = question.constraint
      const rangeHint =
        question.type !== 'numeric_range'
          ? undefined
          : minValue !== undefined && maxValue !== undefined
            ? `范围：${minValue} 至 ${maxValue}`
            : minValue !== undefined
              ? `最小值：${minValue}`
              : maxValue !== undefined
                ? `最大值：${maxValue}`
                : undefined
      return {
        number: index + 1,
        content: question.content,
        type: question.type,
        isKey: question.isKey || qnaire.keyQuestionIds.includes(question.id),
        options: question.options.map(({ value, label }) => ({ value, label })),
        ...(fixedLength === undefined ? {} : { fixedLength }),
        ...(rangeHint === undefined ? {} : { rangeHint }),
        notes: notes.get(question.id) ?? []
      }
    })
  }
}

function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!
  )
}

export function renderQuestionnaireHtml(model: QuestionnaireDocument): string {
  const questions = model.questions
    .map((question) => {
      const title = `${question.number}. ${escapeHtml(question.content)}`
      let answer: string
      if (question.type === 'single_choice' || question.type === 'multiple_choice') {
        const shape = question.type === 'single_choice' ? 'circle' : 'square'
        answer = question.options
          .map(
            (option) =>
              `<div class="option"><span class="choice-${shape}"></span><span>${escapeHtml(option.label)}</span></div>`
          )
          .join('')
      } else if (question.type === 'fixed_length') {
        answer = `<div class="answer-cells">${Array.from({ length: question.fixedLength! }, () => '<span class="answer-cell"></span>').join('')}</div>`
      } else if (question.type === 'date') {
        answer = '<div class="date-answer">________ 年 ____ 月 ____ 日</div>'
      } else {
        answer = `<div class="answer-line"></div>${question.rangeHint ? `<div class="hint">${escapeHtml(question.rangeHint)}</div>` : ''}`
      }
      return `<section class="question" data-number="${question.number}">${question.notes.map((note) => `<p class="condition-note">${escapeHtml(note)}</p>`).join('')}<div class="question-title">${question.isKey ? `<strong class="key-title">${title}</strong>` : title}</div><div class="answer">${answer}</div></section>`
    })
    .join('')
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${escapeHtml(model.name)}</title><style>
@page { size: A4; margin: 20mm; }
* { box-sizing: border-box; }
body { margin: 0; color: #000; font-family: "Microsoft YaHei", "Noto Sans CJK SC", sans-serif; font-size: 11pt; line-height: 1.65; overflow-wrap: anywhere; }
h1 { margin: 0 0 5mm; text-align: center; font-size: 20pt; line-height: 1.4; }
.description { white-space: pre-wrap; margin: 0 0 8mm; }
.question { margin: 0 0 7mm; }
.question-title { font-weight: 400; white-space: pre-wrap; break-after: avoid; margin-bottom: 2.5mm; }
.condition-note { font-size: 9pt; margin: 0 0 2mm; white-space: pre-wrap; break-after: avoid; }
.option { display: flex; align-items: baseline; gap: 2.5mm; margin: 1.5mm 0 1.5mm 4mm; break-inside: avoid; white-space: pre-wrap; }
.option:first-child { break-before: avoid; }
.choice-circle, .choice-square { display: inline-block; flex: 0 0 3.5mm; width: 3.5mm; height: 3.5mm; border: 0.3mm solid black; position: relative; top: 0.3mm; }
.choice-circle { border-radius: 50%; }
.answer-cells { display: flex; flex-wrap: wrap; gap: 0; margin: 1mm 0; }
.answer-cell { display: inline-block; width: 6mm; height: 7mm; border: 0.25mm solid black; break-inside: avoid; }
.answer-line { border-bottom: 0.25mm solid black; width: 100%; height: 9mm; break-inside: avoid; }
.date-answer { padding-top: 2mm; break-inside: avoid; }
.hint { font-size: 9pt; margin-top: 1mm; }
</style></head><body><h1>${escapeHtml(model.name)}</h1>${model.description ? `<p class="description">${escapeHtml(model.description)}</p>` : ''}${questions}</body></html>`
}
