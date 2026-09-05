import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  createSourceFile,
  isArrowFunction,
  isCallExpression,
  isIdentifier,
  isImportDeclaration,
  isNamedImports,
  isPropertyAccessExpression,
  isStringLiteral,
  ScriptTarget,
  SyntaxKind,
  type CallExpression,
  type Node
} from 'typescript'

function findNode<T extends Node>(node: Node, predicate: (candidate: Node) => candidate is T): T | undefined {
  if (predicate(node)) return node
  let result: T | undefined
  node.forEachChild((child) => {
    result ??= findNode(child, predicate)
  })
  return result
}

describe('application menu startup policy', () => {
  it('removes the native application menu before creating the main window', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/main/index.ts'), 'utf8')
    const sourceFile = createSourceFile('src/main/index.ts', source, ScriptTarget.Latest, true)
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

    const whenReadyCall = findNode<CallExpression>(sourceFile, (node): node is CallExpression => {
      if (!isCallExpression(node) || !isPropertyAccessExpression(node.expression)) return false
      const readyCall = node.expression.expression
      const callback = node.arguments.at(0)
      return (
        node.expression.name.text === 'then' &&
        isCallExpression(readyCall) &&
        isPropertyAccessExpression(readyCall.expression) &&
        isIdentifier(readyCall.expression.expression) &&
        readyCall.expression.expression.text === 'app' &&
        readyCall.expression.name.text === 'whenReady' &&
        callback !== undefined &&
        isArrowFunction(callback)
      )
    })
    const whenReadyCallback = whenReadyCall?.arguments[0]
    expect(whenReadyCallback).toBeDefined()
    if (!whenReadyCallback || !isArrowFunction(whenReadyCallback)) return

    const removeMenuCall = findNode<CallExpression>(whenReadyCallback.body, (node): node is CallExpression =>
      isCallExpression(node) &&
      isPropertyAccessExpression(node.expression) &&
      isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'Menu' &&
      node.expression.name.text === 'setApplicationMenu' &&
      node.arguments.length === 1 &&
      node.arguments.at(0)?.kind === SyntaxKind.NullKeyword
    )
    const createWindowCall = findNode<CallExpression>(whenReadyCallback.body, (node): node is CallExpression =>
      isCallExpression(node) &&
      isIdentifier(node.expression) &&
      node.expression.text === 'createMainWindow' &&
      node.arguments.length === 0
    )

    expect(removeMenuCall).toBeDefined()
    expect(createWindowCall).toBeDefined()
    expect(removeMenuCall!.getStart(sourceFile)).toBeLessThan(createWindowCall!.getStart(sourceFile))
  })
})
