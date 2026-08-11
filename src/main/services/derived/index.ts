// Re-export the pure formula engine under the documented TECH_STACK §10 paths
// so `formula-parser.ts` / `formula-evaluator.ts` / `builtin-functions.ts`
// resolve for consumers that import by that convention.
export * from '@shared/derived'
export { DerivedService } from './derived.service'
export type { FormulaValidationResult, PreviewResult, DerivedMutationResult } from './derived.service'
