import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

describe('frontend package public entrypoints', () => {
  it('gives every frontend package one resolvable root export', () => {
    for (const packageName of ['client', 'context', 'theme', 'ui', 'workbench']) {
      const directory = resolve(frontendRoot, packageName)
      const manifest = JSON.parse(readFileSync(resolve(directory, 'package.json'), 'utf8'))
      const rootExport = manifest.exports['.']
      const target = typeof rootExport === 'string' ? rootExport : rootExport.default
      expect(target, `${packageName} root export`).toBeTypeOf('string')
      expect(existsSync(resolve(directory, target))).toBe(true)
    }
  })
})
