import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { loadApplication, runtimeRoot } from '../application.mjs'

const forbidden = ['@graphvideo/sdk/node', '@graphvideo/sdk/testing', '@graphvideo/sdk/analysis', '@graphvideo/sdk/plugin', '@graphvideo/sdk/effect']
function collect(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (['node_modules', 'dist'].includes(entry.name)) return []
    const file = resolve(directory, entry.name)
    return entry.isDirectory() ? collect(file) : /\.[jt]sx?$/.test(file) && !/\.test\.[jt]sx?$/.test(file) ? [file] : []
  })
}
const app = loadApplication()
const directories = [resolve(runtimeRoot, 'renderer/src'), ...app.plugins.flatMap((plugin) => ['frontend', 'elements'].map((name) => resolve(plugin.directory, name)))]
const violations = []
for (const directory of directories) {
  try {
    for (const file of collect(directory)) {
      const tree = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
      function visit(node) {
        let spec
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) spec = node.moduleSpecifier.text
        else if (ts.isCallExpression(node) && ['import', 'require'].includes(node.expression.getText(tree)) && ts.isStringLiteralLike(node.arguments[0])) spec = node.arguments[0].text
        if (spec && (spec.startsWith('node:') || forbidden.some((entry) => spec === entry || spec.startsWith(entry + '/')))) {
          violations.push(`${file}: ${spec}`)
        }
        ts.forEachChild(node, visit)
      }
      visit(tree)
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error }
}
console.log(violations.length ? violations.join('\n') : 'Renderer AST boundary: clean')
if (violations.length) process.exitCode = 1
