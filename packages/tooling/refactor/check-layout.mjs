import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

const root = path.resolve(import.meta.dirname, '../../..')
function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isSymbolicLink() || entry.name.startsWith('.legacy-') || ['node_modules', 'dist', 'target', '.test-temp', '__pycache__', '.pytest_cache'].includes(entry.name)) return []
    const file = path.join(directory, entry.name)
    return entry.isDirectory() ? files(file) : /\.(?:[cm]?ts|tsx|[cm]?js)$/.test(file) ? [file] : []
  })
}
const findings = []
for (const file of [...files(path.join(root, 'packages')), ...files(path.join(root, 'app/plugins'))]) {
  const rel = path.relative(root, file).split(path.sep).join('/')
  const tree = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  const testing = /\.(?:test|fixture)\.[^.]+$/.test(file) || rel.includes('/tests/') || rel.includes('/scripts/')
  function check(node) {
    let literal
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) literal = node.moduleSpecifier
    else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) literal = node.argument.literal
    else if (ts.isCallExpression(node) && ['import', 'require', 'vi.mock', 'vi.doMock'].includes(node.expression.getText(tree))) literal = node.arguments[0]
    if (literal && ts.isStringLiteralLike(literal)) {
      const spec = literal.text
      if (spec.startsWith('.')) {
        const target = path.resolve(path.dirname(file), spec)
        const targetRel = path.relative(root, target).split(path.sep).join('/')
        if (!testing && rel.startsWith('packages/') && targetRel.startsWith('app/plugins/')) findings.push(`${rel}: platform imports product ${spec}`)
        const owner = rel.match(/^app\/plugins\/([^/]+)\//)?.[1]
        const targetOwner = targetRel.match(/^app\/plugins\/([^/]+)\//)?.[1]
        if (!testing && owner && targetOwner && owner !== targetOwner) findings.push(`${rel}: imports sibling plugin ${spec}`)
        if (![target, target.replace(/\.mjs$/, '.d.mts'), ...['.ts', '.tsx', '.mjs', '.js', '.d.mts', '/index.ts'].map((suffix) => target + suffix)].some((candidate) => fs.existsSync(candidate))) {
          if (!/\.js$/.test(target) || !fs.existsSync(target.slice(0, -3) + '.ts')) findings.push(`${rel}: missing ${spec}`)
        }
      }
      if (spec === '@graphvideo/tokens' || spec === '@graphvideo/client-sdk' || spec === '@graphvideo/domain') findings.push(`${rel}: retired alias ${spec}`)
    }
    ts.forEachChild(node, check)
  }
  check(tree)
}
console.log(findings.length ? findings.join('\n') : 'AST layout and dependency boundaries: clean')
if (findings.length) process.exitCode = 1
