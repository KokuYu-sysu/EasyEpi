import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createSourceFile,
  isArrowFunction,
  isBlock,
  isCallExpression,
  isExpressionStatement,
  isIdentifier,
  isImportDeclaration,
  isNamedImports,
  isPropertyAccessExpression,
  isStringLiteral,
  isVoidExpression,
  ScriptTarget,
  SyntaxKind,
  type ArrowFunction,
  type CallExpression,
  type SourceFile,
  type Statement
} from 'typescript'

function getTopLevelCall(statement: Statement): CallExpression | undefined {
  if (!isExpressionStatement(statement)) return undefined
  if (isCallExpression(statement.expression)) return statement.expression
  if (isVoidExpression(statement.expression) && isCallExpression(statement.expression.expression)) {
    return statement.expression.expression
  }
  return undefined
}

function isWhenReadyThenCall(call: CallExpression): boolean {
  if (!isPropertyAccessExpression(call.expression)) return false
  const readyCall = call.expression.expression
  const callback = call.arguments.at(0)
  return (
    call.expression.name.text === 'then' &&
    isCallExpression(readyCall) &&
    isPropertyAccessExpression(readyCall.expression) &&
    isIdentifier(readyCall.expression.expression) &&
    readyCall.expression.expression.text === 'app' &&
    readyCall.expression.name.text === 'whenReady' &&
    callback !== undefined &&
    isArrowFunction(callback)
  )
}

function getWhenReadyCallback(sourceFile: SourceFile): ArrowFunction | undefined {
  for (const statement of sourceFile.statements) {
    const call = getTopLevelCall(statement)
    const callback = call?.arguments.at(0)
    if (call && isWhenReadyThenCall(call) && callback && isArrowFunction(callback)) {
      return callback
    }
  }
  return undefined
}

function isMenuRemovalCall(call: CallExpression): boolean {
  return (
    isPropertyAccessExpression(call.expression) &&
    isIdentifier(call.expression.expression) &&
    call.expression.expression.text === 'Menu' &&
    call.expression.name.text === 'setApplicationMenu' &&
    call.arguments.length === 1 &&
    call.arguments.at(0)?.kind === SyntaxKind.NullKeyword
  )
}

function isCreateMainWindowCall(call: CallExpression): boolean {
  return (
    isIdentifier(call.expression) &&
    call.expression.text === 'createMainWindow' &&
    call.arguments.length === 0
  )
}

function findDirectCallIndex(
  statements: readonly Statement[],
  predicate: (call: CallExpression) => boolean
): number {
  return statements.findIndex((statement) => {
    if (!isExpressionStatement(statement) || !isCallExpression(statement.expression)) {
      return false
    }
    return predicate(statement.expression)
  })
}

function parseSource(source: string, fileName = 'startup.ts'): SourceFile {
  return createSourceFile(fileName, source, ScriptTarget.Latest, true)
}

describe('application menu startup policy', () => {
  it('removes the native application menu before creating the main window', () => {
    const mainSourcePath = resolve(
      fileURLToPath(import.meta.url),
      '..',
      '..',
      '..',
      '..',
      'src/main/index.ts'
    )
    const sourceFile = parseSource(readFileSync(mainSourcePath, 'utf8'), mainSourcePath)
    const importsMenu = sourceFile.statements.some(
      (statement) =>
        isImportDeclaration(statement) &&
        isStringLiteral(statement.moduleSpecifier) &&
        statement.moduleSpecifier.text === 'electron' &&
        statement.importClause?.namedBindings !== undefined &&
        isNamedImports(statement.importClause.namedBindings) &&
        statement.importClause.namedBindings.elements.some(
          (element) => element.name.text === 'Menu'
        )
    )
    expect(importsMenu).toBe(true)

    const whenReadyCallback = getWhenReadyCallback(sourceFile)
    expect(whenReadyCallback).toBeDefined()
    expect(whenReadyCallback && isBlock(whenReadyCallback.body)).toBe(true)
    if (!whenReadyCallback || !isBlock(whenReadyCallback.body)) return

    const removeMenuIndex = findDirectCallIndex(
      whenReadyCallback.body.statements,
      isMenuRemovalCall
    )
    const createWindowIndex = findDirectCallIndex(
      whenReadyCallback.body.statements,
      isCreateMainWindowCall
    )

    expect(removeMenuIndex).toBeGreaterThanOrEqual(0)
    expect(createWindowIndex).toBeGreaterThan(removeMenuIndex)
  })

  it('rejects menu removal hidden in nested startup scopes', () => {
    const sourceFile = parseSource(`
      void app.whenReady().then(() => {
        function neverCalled() {
          Menu.setApplicationMenu(null)
        }
        if (false) {
          Menu.setApplicationMenu(null)
        }
        createMainWindow()
      })
    `)
    const whenReadyCallback = getWhenReadyCallback(sourceFile)
    expect(whenReadyCallback).toBeDefined()
    if (!whenReadyCallback || !isBlock(whenReadyCallback.body)) return

    expect(
      findDirectCallIndex(whenReadyCallback.body.statements, isMenuRemovalCall)
    ).toBe(-1)
  })
})
