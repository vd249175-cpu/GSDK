const { pathToFileURL } = require('node:url')
const { resolve } = require('node:path')
void import(pathToFileURL(resolve(__dirname, '../../desktop/host/native-graph-host.js')).href).then(async ({ createNativeGraphHost }) => {
  const host = createNativeGraphHost()
  const space = host.space
  space.register('smoke', { count: 0 }, (_info, ctx) => {
    ctx.write('count', ctx.read('count') + 1)
  })
  const submission = space.injectRoot('smoke', { type: 'SmokeInfo' })
  await space.waitForSubmission(submission)
  const node = space.readProjection().nodes.find((entry) => entry.nodeId === 'smoke')
  if (!node || node.version !== 1) throw new Error('Native SDK projection did not update')
  await space.dispose()
  console.log(`Electron native SDK smoke passed: ${process.versions.electron ?? 'run-as-node'}`)
}).catch((error) => {
  console.error(error)
  process.exitCode = 1
})
