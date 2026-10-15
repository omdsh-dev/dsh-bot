/** Copy an emitted Host entry and its local JS chunk closure into a companion archive. */
import { cpSync, mkdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { runtime } from './common.mjs'
const ts = createRequire(join(runtime, 'package.json'))('typescript')
export function copyHostEntry(source, destination) {
  const sourceRoot = dirname(source), copied = new Set()
  const visit = file => {
    const name = relative(sourceRoot, file)
    if (name.startsWith(`..${sep}`) || name === '..' || !name.endsWith('.js')) throw new Error(`Unexpected Host chunk: ${name}`)
    if (copied.has(name)) return
    copied.add(name)
    const target = join(destination, name); mkdirSync(dirname(target), { recursive: true }); cpSync(file, target)
    const syntax = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
    const inspect = node => {
      const specifier = (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) ? node.moduleSpecifier
        : ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword ? node.arguments[0] : undefined
      if (specifier && ts.isStringLiteral(specifier) && specifier.text.startsWith('.')) visit(resolve(dirname(file), specifier.text))
      ts.forEachChild(node, inspect)
    }
    inspect(syntax)
  }
  visit(source)
  return [...copied]
}
