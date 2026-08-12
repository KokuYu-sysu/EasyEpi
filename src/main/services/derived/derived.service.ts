import { randomUUID } from 'node:crypto'

import type { RecordData } from '@shared/types/record'
import type { QuestionDef, QuestionnaireDef } from '@shared/types/qnaire'
import { getDerivedVariables } from '@shared/types/qnaire'
import type { AnswerValue } from '@shared/types/record'
import {
  DERIVED_VARIABLE_NAME_PATTERN,
  type DerivedResultType,
  type DerivedVariableDef
} from '@shared/types/derived'
import {
  parseFormula,
  evaluate,
  inferResultType,
  type AstNode,
  type FormulaError
} from '@shared/derived'

export type DerivedMutationResult =
  | { ok: true; qnaire: QuestionnaireDef }
  | { ok: false; errors: FormulaError[] }

export function extractVariableReferences(formula: string): string[] {
  const parsed = parseFormula(formula)
  if (!parsed.ok) return []
  const names = new Set<string>()
  const visit = (node: AstNode): void => {
    switch (node.type) {
      case 'variable':
        names.add(node.name)
        break
      case 'binary':
      case 'compare':
        visit(node.left)
        visit(node.right)
        break
      case 'unary':
        visit(node.operand)
        break
      case 'call':
        node.args.forEach(visit)
        break
      default:
        break
    }
  }
  visit(parsed.ast)
  return [...names]
}

function validateVariableName(name: string): FormulaError | null {
  if (!DERIVED_VARIABLE_NAME_PATTERN.test(name)) {
    return {
      code: 'INVALID_VARIABLE_NAME',
      message: '衍生变量名需以字母开头，仅含字母、数字、下划线'
    }
  }
  return null
}

export interface FormulaValidationResult {
  ok: boolean
  errors: FormulaError[]
  inferredType?: DerivedResultType
}

export interface PreviewResult {
  ok: boolean
  value?: string | null
  type?: DerivedResultType
  error?: string
}

interface VariableReference {
  name: string
  position?: number
}

type FormulaStaticType = DerivedResultType | 'boolean'

function resultTypeOf(staticType: FormulaStaticType): DerivedResultType {
  return staticType === 'boolean' ? 'categorical' : staticType
}

function isLiteralZero(node: AstNode): boolean {
  return node.type === 'literal' && node.valueType === 'number' && node.value === 0
}

function validateAstTypes(
  ast: AstNode,
  variableTypes: Record<string, DerivedResultType>
): FormulaError[] {
  const errors: FormulaError[] = []
  const mismatch = (message: string): void => {
    errors.push({ code: 'TYPE_MISMATCH', message })
  }
  const requireNumeric = (type: FormulaStaticType, context: string): void => {
    if (type !== 'numeric') mismatch(`${context}需要数值参数`)
  }

  const visit = (node: AstNode): FormulaStaticType => {
    switch (node.type) {
      case 'literal':
        return node.valueType === 'number' ? 'numeric' : 'categorical'
      case 'variable':
        return variableTypes[node.name] ?? 'categorical'
      case 'unary': {
        requireNumeric(visit(node.operand), '一元运算符')
        return 'numeric'
      }
      case 'binary': {
        const left = visit(node.left)
        const right = visit(node.right)
        requireNumeric(left, `运算符 ${node.op} 左侧`)
        requireNumeric(right, `运算符 ${node.op} 右侧`)
        if (node.op === '/' && isLiteralZero(node.right)) {
          errors.push({ code: 'DIVISION_BY_ZERO', message: '除数不能为 0' })
        }
        return 'numeric'
      }
      case 'compare': {
        const left = visit(node.left)
        const right = visit(node.right)
        if (node.op !== '==' && node.op !== '!=') {
          requireNumeric(left, `比较运算符 ${node.op} 左侧`)
          requireNumeric(right, `比较运算符 ${node.op} 右侧`)
        }
        return 'boolean'
      }
      case 'call': {
        const args = node.args.map(visit)
        if (['ROUND', 'ABS', 'SQRT', 'LOG', 'LN', 'EXP', 'POW', 'MEAN', 'SUM'].includes(node.name)) {
          args.forEach((type, index) => requireNumeric(type, `函数 ${node.name} 的第 ${index + 1} 个参数`))
          return 'numeric'
        }
        if (node.name === 'DATE_DIFF') {
          if (!['date', 'categorical'].includes(args[0]!)) mismatch('函数 DATE_DIFF 的第 1 个参数需要日期')
          if (!['date', 'categorical'].includes(args[1]!)) mismatch('函数 DATE_DIFF 的第 2 个参数需要日期')
          if (args[2] !== 'categorical') mismatch('函数 DATE_DIFF 的单位参数需要文本')
          return 'numeric'
        }
        if (node.name === 'YEAR' || node.name === 'MONTH') {
          if (!['date', 'categorical'].includes(args[0]!)) mismatch(`函数 ${node.name} 需要日期参数`)
          return 'numeric'
        }
        if (node.name === 'TODAY') return 'date'
        if (node.name === 'SUBSTR') {
          if (args[0] !== 'categorical') mismatch('函数 SUBSTR 的第 1 个参数需要文本')
          requireNumeric(args[1]!, '函数 SUBSTR 的第 2 个参数')
          if (args[2] !== undefined) requireNumeric(args[2], '函数 SUBSTR 的第 3 个参数')
          return 'categorical'
        }
        if (node.name === 'CONCAT') return 'categorical'
        if (node.name === 'IF') {
          return resultTypeOf(args[1]!) === resultTypeOf(args[2]!)
            ? args[1]!
            : 'categorical'
        }
        return 'categorical'
      }
    }
  }

  visit(ast)
  return errors
}

function collectVariableRefs(ast: AstNode): VariableReference[] {
  const refs: VariableReference[] = []
  const visit = (node: AstNode): void => {
    switch (node.type) {
      case 'variable':
        refs.push({ name: node.name })
        break
      case 'binary':
      case 'compare':
        visit(node.left)
        visit(node.right)
        break
      case 'unary':
        visit(node.operand)
        break
      case 'call':
        node.args.forEach(visit)
        break
      default:
        break
    }
  }
  visit(ast)
  return refs
}

function materializeValue(
  value: { type: string; value: unknown },
  displayDecimals?: number
): string | null {
  if (value.value === null || value.value === undefined) return null
  if (typeof value.value === 'boolean') return value.value ? 'true' : 'false'
  if (typeof value.value === 'number' && displayDecimals !== undefined) {
    return String(Number(value.value.toFixed(displayDecimals)))
  }
  return String(value.value)
}

function orderByDependencies(derived: DerivedVariableDef[]): DerivedVariableDef[] {
  const byName = new Map(derived.map((item) => [item.variableName, item]))
  const visited = new Set<string>()
  const visiting = new Set<string>()
  const ordered: DerivedVariableDef[] = []

  const visit = (item: DerivedVariableDef): void => {
    if (visited.has(item.id)) return
    if (visiting.has(item.id)) return
    visiting.add(item.id)
    for (const reference of extractVariableReferences(item.formula)) {
      const dependency = byName.get(reference)
      if (dependency) visit(dependency)
    }
    visiting.delete(item.id)
    visited.add(item.id)
    ordered.push(item)
  }

  for (const item of [...derived].sort((a, b) => a.order - b.order)) visit(item)
  return ordered
}

function buildContextFromQuestionnaire(
  qnaire: QuestionnaireDef,
  answers: Record<string, unknown>
): Record<string, unknown> {
  const context: Record<string, unknown> = {}
  for (const question of qnaire.questions) {
    const raw = answers[question.id] ?? answers[question.variableName]
    if (raw !== undefined) context[question.variableName] = raw
  }
  return context
}

export class DerivedService {
  /**
   * Parse a formula and validate every variable reference against the
   * questionnaire (question variableNames and earlier derived variables).
   */
  validateFormula(formula: string, qnaire: QuestionnaireDef): FormulaValidationResult {
    const parsed = parseFormula(formula)
    if (!parsed.ok) {
      return { ok: false, errors: parsed.errors }
    }

    const errors: FormulaError[] = []
    const questionNames = new Set(qnaire.questions.map((question) => question.variableName))
    const derived = getDerivedVariables(qnaire)

    for (const ref of collectVariableRefs(parsed.ast)) {
      if (!questionNames.has(ref.name) && !derived.some((item) => item.variableName === ref.name)) {
        errors.push({
          code: 'UNKNOWN_VARIABLE',
          message: `公式引用了不存在的变量 "${ref.name}"`,
          position: ref.position
        })
      }
    }

    const cycleError = this.detectDerivedCycle(derived, questionNames)
    if (cycleError) errors.push(cycleError)

    if (errors.length > 0) return { ok: false, errors }
    const variableTypes = this.variableTypes(qnaire)
    const typeErrors = validateAstTypes(parsed.ast, variableTypes)
    if (typeErrors.length > 0) return { ok: false, errors: typeErrors }
    return { ok: true, errors: [], inferredType: inferResultType(parsed.ast, variableTypes) }
  }

  inferType(formula: string, qnaire: QuestionnaireDef): DerivedResultType | undefined {
    const parsed = parseFormula(formula)
    if (!parsed.ok) return undefined
    return inferResultType(parsed.ast, this.variableTypes(qnaire))
  }

  private variableTypes(qnaire: QuestionnaireDef): Record<string, DerivedResultType> {
    const variableTypes: Record<string, DerivedResultType> = {}
    for (const question of qnaire.questions) {
      variableTypes[question.variableName] = typeOfQuestion(question)
    }
    for (const variable of getDerivedVariables(qnaire)) {
      variableTypes[variable.variableName] = variable.resultType
    }
    return variableTypes
  }

  private detectDerivedCycle(
    derived: DerivedVariableDef[],
    questionNames: Set<string>
  ): FormulaError | null {
    const byName = new Map(derived.map((item) => [item.variableName, item]))
    const visited = new Set<string>()
    const visiting = new Set<string>()

    const visit = (name: string): string | null => {
      if (questionNames.has(name)) return null
      const item = byName.get(name)
      if (!item) return null
      if (visiting.has(name)) return name
      if (visited.has(name)) return null
      visiting.add(name)
      const parsed = parseFormula(item.formula)
      if (parsed.ok) {
        for (const ref of collectVariableRefs(parsed.ast)) {
          const cycleAt = visit(ref.name)
          if (cycleAt) return cycleAt
        }
      }
      visiting.delete(name)
      visited.add(name)
      return null
    }

    for (const item of derived) {
      const cycleAt = visit(item.variableName)
      if (cycleAt) {
        return {
          code: 'CIRCULAR_REFERENCE',
          message: `衍生变量 "${cycleAt}" 存在循环引用，请检查公式依赖`
        }
      }
    }
    return null
  }

  /**
   * Compute the value of a single formula against a sample context.
   */
  previewResult(formula: string, qnaire: QuestionnaireDef, sample: Record<string, unknown>): PreviewResult {
    const validation = this.validateFormula(formula, qnaire)
    if (!validation.ok) {
      return { ok: false, error: validation.errors[0]?.message ?? '公式校验失败' }
    }
    const parsed = parseFormula(formula)
    if (!parsed.ok) return { ok: false, error: '公式语法错误' }
    const context = buildContextFromQuestionnaire(qnaire, sample)
    const value = evaluate(parsed.ast, context)
    return {
      ok: true,
      value: materializeValue(value),
      type: validation.inferredType
    }
  }

  /**
   * Compute derived values for one record. `answers` is keyed by question id
   * (the canonical record shape). Returns values keyed by derived variableName.
   */
  computeForRecord(qnaire: QuestionnaireDef, answers: Record<string, unknown>): Record<string, AnswerValue> {
    const context = buildContextFromQuestionnaire(qnaire, answers)
    return this.computeFromContext(qnaire, context)
  }

  /**
   * Compute derived values given a context already keyed by variableName.
   */
  computeFromContext(
    qnaire: QuestionnaireDef,
    context: Record<string, unknown>
  ): Record<string, AnswerValue> {
    const result: Record<string, AnswerValue> = {}
    const working = { ...context }
    const derived = orderByDependencies(getDerivedVariables(qnaire))
    for (const item of derived) {
      const parsed = parseFormula(item.formula)
      if (!parsed.ok) {
        result[item.variableName] = null
        continue
      }
      const value = evaluate(parsed.ast, working)
      const materialized = materializeValue(value, item.displayDecimals)
      result[item.variableName] = materialized
      if (materialized !== null) working[item.variableName] = materialized
    }
    return result
  }

  /**
   * Recompute derived values for a full record list and merge into each record's
   * answers. Used at export time so pre-M6 records (without stored derived keys)
   * and admin-edited records always carry correct derived columns.
   */
  computeAll(qnaire: QuestionnaireDef, records: RecordData[]): Record<string, AnswerValue>[] {
    return records.map((record) => ({
      ...record.answers,
      ...this.computeForRecord(qnaire, record.answers)
    }))
  }

  /**
   * Add a derived variable definition to the questionnaire. The draft excludes
   * `id`/`order` which are assigned here.
   */
  static addDerivedVariable(
    qnaire: QuestionnaireDef,
    draft: Omit<DerivedVariableDef, 'id' | 'order'>
  ): DerivedMutationResult {
    const nameError = validateVariableName(draft.variableName)
    if (nameError) return { ok: false, errors: [nameError] }

    const usedNames = new Set([
      ...qnaire.questions.map((question) => question.variableName),
      ...getDerivedVariables(qnaire).map((item) => item.variableName)
    ])
    if (usedNames.has(draft.variableName)) {
      return {
        ok: false,
        errors: [{ code: 'DUPLICATE_VARIABLE', message: `变量名 "${draft.variableName}" 已被占用` }]
      }
    }
    if (draft.label.trim().length === 0) {
      return { ok: false, errors: [{ code: 'EMPTY_LABEL', message: '请填写衍生变量标签' }] }
    }
    if (draft.formula.trim().length === 0) {
      return { ok: false, errors: [{ code: 'EMPTY_FORMULA', message: '请填写衍生变量公式' }] }
    }

    const nextOrder = getDerivedVariables(qnaire).reduce((max, item) => Math.max(max, item.order), -1) + 1
    const def: DerivedVariableDef = {
      id: randomUUID(),
      variableName: draft.variableName,
      label: draft.label.trim(),
      formula: draft.formula.trim(),
      resultType: draft.resultType,
      ...(draft.displayDecimals === undefined ? {} : { displayDecimals: draft.displayDecimals }),
      order: nextOrder
    }
    // Validate the full set including the new variable so self-references,
    // forward references, and cycles introduced by this add are rejected.
    const fullQnaire = { ...qnaire, derivedVariables: [...getDerivedVariables(qnaire), def] }
    const fullValidation = new DerivedService().validateDerivedVariables(fullQnaire)
    if (!fullValidation.ok) return { ok: false, errors: fullValidation.errors }
    return { ok: true, qnaire: fullQnaire }
  }

  /**
   * Update a derived variable definition by id. The patched definition is
   * re-validated against the questionnaire (excluding itself).
   */
  static updateDerivedVariable(
    qnaire: QuestionnaireDef,
    id: string,
    patch: Partial<Omit<DerivedVariableDef, 'id' | 'order'>>
  ): DerivedMutationResult {
    const derived = getDerivedVariables(qnaire)
    const existing = derived.find((item) => item.id === id)
    if (!existing) {
      return { ok: false, errors: [{ code: 'NOT_FOUND', message: '衍生变量不存在' }] }
    }
    const merged: Omit<DerivedVariableDef, 'id' | 'order'> = {
      variableName: patch.variableName ?? existing.variableName,
      label: patch.label ?? existing.label,
      formula: patch.formula ?? existing.formula,
      resultType: patch.resultType ?? existing.resultType,
      ...(patch.displayDecimals !== undefined
        ? { displayDecimals: patch.displayDecimals }
        : existing.displayDecimals === undefined
          ? {}
          : { displayDecimals: existing.displayDecimals })
    }

    const nameError = validateVariableName(merged.variableName)
    if (nameError) return { ok: false, errors: [nameError] }

    const usedNames = new Set([
      ...qnaire.questions.map((question) => question.variableName),
      ...derived.filter((item) => item.id !== id).map((item) => item.variableName)
    ])
    if (usedNames.has(merged.variableName)) {
      return {
        ok: false,
        errors: [{ code: 'DUPLICATE_VARIABLE', message: `变量名 "${merged.variableName}" 已被占用` }]
      }
    }
    if (merged.label.trim().length === 0) {
      return { ok: false, errors: [{ code: 'EMPTY_LABEL', message: '请填写衍生变量标签' }] }
    }
    if (merged.formula.trim().length === 0) {
      return { ok: false, errors: [{ code: 'EMPTY_FORMULA', message: '请填写衍生变量公式' }] }
    }

    const updated: DerivedVariableDef = {
      ...existing,
      ...merged,
      variableName: merged.variableName,
      label: merged.label.trim(),
      formula: merged.formula.trim(),
      ...(merged.displayDecimals === undefined
        ? {}
        : { displayDecimals: merged.displayDecimals })
    }
    // Validate the full set including the patched variable so cycles and
    // forward references introduced by this edit are rejected.
    const next = derived.map((item) => (item.id === id ? updated : item))
    const fullQnaire = { ...qnaire, derivedVariables: next }
    const fullValidation = new DerivedService().validateDerivedVariables(fullQnaire)
    if (!fullValidation.ok) return { ok: false, errors: fullValidation.errors }
    return { ok: true, qnaire: fullQnaire }
  }

  static deleteDerivedVariable(qnaire: QuestionnaireDef, id: string): DerivedMutationResult {
    const derived = getDerivedVariables(qnaire)
    const existing = derived.find((item) => item.id === id)
    if (!existing) {
      return { ok: false, errors: [{ code: 'NOT_FOUND', message: '衍生变量不存在' }] }
    }
    const dependent = derived.find(
      (item) => item.id !== id && extractVariableReferences(item.formula).includes(existing.variableName)
    )
    if (dependent) {
      return {
        ok: false,
        errors: [{
          code: 'DERIVED_VARIABLE_IN_USE',
          message: `衍生变量 "${existing.variableName}" 正被 "${dependent.variableName}" 引用`
        }]
      }
    }
    return { ok: true, qnaire: {
      ...qnaire,
      derivedVariables: derived.filter((item) => item.id !== id)
    } }
  }

  static reorderDerivedVariables(qnaire: QuestionnaireDef, ids: string[]): QuestionnaireDef {
    const derived = getDerivedVariables(qnaire)
    const byId = new Map(derived.map((item) => [item.id, item]))
    if (ids.length !== derived.length || ids.some((id) => !byId.has(id))) {
      throw new Error('INVALID_DERIVED_REORDER')
    }
    const next = ids
      .map((id, index) => {
        const item = byId.get(id)
        return item ? { ...item, order: index } : null
      })
      .filter((item): item is DerivedVariableDef => item !== null)
    return { ...qnaire, derivedVariables: next }
  }

  /**
   * Validate the entire derived-variable set (variableName collisions,
   * formula references, circular dependencies).
   */
  validateDerivedVariables(qnaire: QuestionnaireDef): { ok: boolean; errors: FormulaError[] } {
    const derived = getDerivedVariables(qnaire)
    const usedNames = new Set(qnaire.questions.map((question) => question.variableName))
    const errors: FormulaError[] = []

    for (const item of derived) {
      const nameError = validateVariableName(item.variableName)
      if (nameError) {
        errors.push({ ...nameError, message: `衍生变量 "${item.variableName}": ${nameError.message}` })
        continue
      }
      if (usedNames.has(item.variableName)) {
        errors.push({
          code: 'DUPLICATE_VARIABLE',
          message: `变量名 "${item.variableName}" 与题目或其他衍生变量重复`
        })
      }
      usedNames.add(item.variableName)

      const validation = new DerivedService().validateFormula(item.formula, qnaire)
      if (!validation.ok) {
        errors.push(
          ...validation.errors.map((error) => ({
            ...error,
            message: `衍生变量 "${item.variableName}": ${error.message}`
          }))
        )
      } else if (validation.inferredType !== item.resultType) {
        errors.push({
          code: 'RESULT_TYPE_MISMATCH',
          message: `衍生变量 "${item.variableName}" 的公式结果为 ${validation.inferredType}，与声明类型 ${item.resultType} 不一致`
        })
      }
    }

    return errors.length > 0 ? { ok: false, errors } : { ok: true, errors: [] }
  }
}

function typeOfQuestion(question: QuestionDef): DerivedResultType {
  switch (question.type) {
    case 'numeric_range':
      return 'numeric'
    case 'date':
      return 'date'
    default:
      return 'categorical'
  }
}
