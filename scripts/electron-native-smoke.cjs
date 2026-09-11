const { createRequire } = require('node:module')

const bindingPath = process.env.GRAPHVIDEO_NATIVE_NODE
if (!bindingPath) throw new Error('GRAPHVIDEO_NATIVE_NODE is required')

const binding = createRequire(__filename)(bindingPath)
const space = new binding.RuleSpace()
space.admit('smoke')
const feedback = space.injectRoot('smoke', 'SmokeInfo', '{}', 'smoke/submission')
if (feedback.status !== 'enqueued') throw new Error(`Unexpected feedback: ${feedback.status}`)
const polled = space.pollNext()
if (!polled) throw new Error('Native rule space did not return the smoke delivery')
if (!space.settleChange(polled.token, null)) throw new Error('Native smoke change did not settle')
if (space.submissionState('smoke/submission') !== 'completed') {
  throw new Error('Native smoke submission did not complete')
}
console.log(`Electron native smoke passed: ${process.versions.electron ?? 'run-as-node'}`)
