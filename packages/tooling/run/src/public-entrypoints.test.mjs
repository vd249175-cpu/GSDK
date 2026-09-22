import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import * as run from '../index.mjs'

const toolingRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

test('tooling packages declare resolvable root entrypoints', () => {
  for (const packageName of ['run', 'refactor', 'causal-visualizer']) {
    const directory = resolve(toolingRoot, packageName)
    const manifest = JSON.parse(readFileSync(resolve(directory, 'package.json'), 'utf8'))
    const rootExport = manifest.exports?.['.']
    const target = typeof rootExport === 'string' ? rootExport : rootExport?.default
    assert.equal(typeof target, 'string', `${packageName} root export`)
    assert.equal(existsSync(resolve(directory, target)), true, `${packageName} root target`)
  }
})

test('run root exposes composition and authenticated control contracts', () => {
  for (const name of [
    'RUN_CONFIG_VERSION',
    'parseRunConfig',
    'defineRunAssemblyContribution',
    'loadRunConfig',
    'startRun',
    'stopRun',
    'serveRunControl',
    'callRunControl',
  ]) {
    assert.equal(typeof run[name] === 'function' || typeof run[name] === 'number', true, name)
  }
})
