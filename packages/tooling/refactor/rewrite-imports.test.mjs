import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rewriteImports } from './rewrite-imports.mjs'
test('updates imports, type queries and test mocks while preserving documentation strings', () => {
  const code = `// old-package
import { value } from 'old-package'
type T = import('old-package').Value
vi.mock('old-package', () => ({}))
const documentation = 'old-package'
`
  const result = rewriteImports(code, 'fixture.ts', (name) => name === 'old-package' ? './local' : name)
  assert.equal(result.count, 3)
  assert.match(result.text, /vi.mock\('\.\/local'/)
  assert.match(result.text, /const documentation = 'old-package'/)
})
