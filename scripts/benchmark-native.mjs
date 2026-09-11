import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const platformTag = process.platform === 'win32'
  ? `win32-${process.arch}-msvc`
  : process.platform === 'linux'
    ? `linux-${process.arch}-gnu`
    : process.platform === 'darwin'
      ? `darwin-${process.arch}`
      : null
if (!platformTag) throw new Error(`Unsupported native target: ${process.platform}-${process.arch}`)
const bindingPath = process.env.GRAPHVIDEO_NATIVE_NODE
  ?? resolve(root, 'crates', 'kernel-node', `graphvideo-kernel-node.${platformTag}.node`)
if (!existsSync(bindingPath)) throw new Error(`Native binding missing: ${bindingPath}`)

const require = createRequire(import.meta.url)
const { RuleSpace } = require(bindingPath)
const iterationsIndex = process.argv.indexOf('--iterations')
const iterations = iterationsIndex >= 0 ? Number(process.argv[iterationsIndex + 1]) : 50_000
const roundsIndex = process.argv.indexOf('--rounds')
const rounds = roundsIndex >= 0 ? Number(process.argv[roundsIndex + 1]) : 5
if (!Number.isSafeInteger(iterations) || iterations <= 0) throw new Error('iterations must be positive')
if (!Number.isSafeInteger(rounds) || rounds <= 0) throw new Error('rounds must be positive')

const space = new RuleSpace()
space.admit('worker')
const roundResults = []
global.gc?.()
const memoryBefore = process.memoryUsage()

for (let round = 0; round < rounds; round++) {
  const started = performance.now()
  for (let index = 0; index < iterations; index++) {
    const feedback = space.send('benchmark', 'BenchmarkInfo', '{}', 'worker', null)
    if (feedback.status !== 'enqueued') throw new Error(`enqueue failed: ${feedback.reason}`)
  }
  let executed = 0
  for (;;) {
    const polled = space.pollNext()
    if (!polled) break
    if (!space.settleChange(polled.token, null)) throw new Error('change settlement failed')
    executed++
  }
  if (executed !== iterations || space.pendingTotal() !== 0) {
    throw new Error(`round did not settle: executed=${executed} pending=${space.pendingTotal()}`)
  }
  const elapsedMs = performance.now() - started
  global.gc?.()
  const memory = process.memoryUsage()
  roundResults.push({
    round: round + 1,
    elapsedMs: Number(elapsedMs.toFixed(3)),
    changesPerSecond: Math.round(iterations / (elapsedMs / 1000)),
    rssBytes: memory.rss,
    heapUsedBytes: memory.heapUsed,
  })
}

const replaceSamples = []
const replaceIterations = Math.min(iterations, 10_000)
for (let index = 0; index < replaceIterations; index++) {
  const started = performance.now()
  space.replace('worker')
  replaceSamples.push((performance.now() - started) * 1000)
}
replaceSamples.sort((left, right) => left - right)
const percentile = (value) => replaceSamples[Math.min(
  replaceSamples.length - 1,
  Math.floor(replaceSamples.length * value),
)]
global.gc?.()
const memoryAfter = process.memoryUsage()

console.log(JSON.stringify({
  environment: {
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    napi: process.versions.napi,
    bindingPath,
  },
  workload: { iterationsPerRound: iterations, rounds, replaceIterations },
  rounds: roundResults,
  replaceMicroseconds: {
    p50: Number(percentile(0.50).toFixed(3)),
    p95: Number(percentile(0.95).toFixed(3)),
    p99: Number(percentile(0.99).toFixed(3)),
  },
  retainedMemoryDelta: {
    rssBytes: memoryAfter.rss - memoryBefore.rss,
    heapUsedBytes: memoryAfter.heapUsed - memoryBefore.heapUsed,
  },
}, null, 2))
