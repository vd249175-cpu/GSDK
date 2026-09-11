void import('@graphvideo/backend-sdk').then(async ({ NativeRuleSpace }) => {
  const space = new NativeRuleSpace({
    idProvider: { nextId: () => 'smoke/submission' },
  })
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
