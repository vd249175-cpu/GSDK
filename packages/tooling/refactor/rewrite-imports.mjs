import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

export function rewriteImports(text, file, replace) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  const edits = []
  function visit(node) {
    let literal
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) literal = node.moduleSpecifier
    else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) literal = node.argument.literal
    else if (ts.isCallExpression(node) && ['import', 'require', 'vi.mock', 'vi.doMock'].includes(node.expression.getText(source))) literal = node.arguments[0]
    else if (ts.isNewExpression(node) && node.expression.getText(source) === 'URL' && node.arguments?.[1]?.getText(source) === 'import.meta.url') literal = node.arguments[0]
    if (literal && ts.isStringLiteralLike(literal)) {
      const value = replace(literal.text)
      if (value !== literal.text) edits.push({ start: literal.getStart(source) + 1, end: literal.end - 1, value })
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  for (const edit of edits.sort((a, b) => b.start - a.start)) text = text.slice(0, edit.start) + edit.value + text.slice(edit.end)
  return { text, count: edits.length }
}
function walk(directory) {
  if (fs.statSync(directory).isFile()) return [directory]
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isSymbolicLink() || entry.name.startsWith('.legacy-') || ['node_modules', 'dist', 'target', '__pycache__', '.test-temp'].includes(entry.name)) return []
    const file = path.join(directory, entry.name)
    return entry.isDirectory() ? walk(file) : /\.(?:[cm]?ts|tsx|[cm]?js)$/.test(file) ? [file] : []
  })
}
if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  const [scope, specifier, replacement, mode] = process.argv.slice(2)
  if (!replacement) throw new Error('Usage: rewrite-imports.mjs <scope> <specifier> <replacement> [--file-target]')
  let count = 0
  for (const file of walk(path.resolve(scope))) {
    const result = rewriteImports(fs.readFileSync(file, 'utf8'), file, (spec) => {
      if (/\.(?:ts|tsx)$/.test(spec) && spec.startsWith('.')) spec = spec.replace(/\.(?:ts|tsx)$/, '')
      if (spec !== specifier) return spec
      if (mode !== '--file-target') return replacement
      let relative = path.relative(path.dirname(file), path.resolve(replacement)).split(path.sep).join('/').replace(/\.(?:ts|tsx)$/, '')
      return relative.startsWith('.') ? relative : './' + relative
    })
    if (result.count) fs.writeFileSync(file, result.text)
    count += result.count
  }
  console.log(`AST module references updated: ${count}`)
}
