import { randomUUID } from 'node:crypto'

const ownerId = 'node-application-lifecycle'

async function bounded(operation, timeoutMs, label) {
  let timer
  try {
    return await Promise.race([operation, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), timeoutMs)
    })])
  } finally { clearTimeout(timer) }
}

/** Studio composition policy. No application semantics enter the Rust kernel. */
export function createStudioApplicationLifecycle({
  host, hasProject = () => false, closeIngress = () => {},
  waitForBoot = async () => {}, waitForAcceptedWork = async () => {},
  stopSources = async () => {}, closeServices = async () => {},
  timeoutMs = 15_000, cleanupTimeoutMs = 5_000,
}) {
  let closing = false
  let stopped = false
  let exitPromise
  let startPromise
  let abortPromise
  host.space.errorTargetNodeId = ownerId

  async function inject(info) {
    if (!host.space.admittedEntities().includes(ownerId)) throw new Error('Application lifecycle node is not mounted')
    const submission = host.space.injectRoot(ownerId, info)
    await bounded(host.space.waitForSubmission(submission), timeoutMs, info.type)
  }

  async function waitForPhase(requestId, expected) {
    let unsubscribe = () => {}
    let interval
    try {
      await bounded(new Promise((resolve, reject) => {
        const check = () => {
          const state = host.readNodeState(ownerId)
          if (!state || state.requestId !== requestId) return
          if (state.phase === 'StartFailed' || state.phase === 'ShutdownFailed') reject(new Error(state.lastError || state.phase))
          else if (state.phase === expected) resolve()
        }
        unsubscribe = host.space.subscribeProjection(check)
        interval = setInterval(() => { void host.space.pump().then(check, reject) }, 10)
        check()
      }), timeoutMs, expected)
    } catch (error) {
      throw new Error(`${error.message}: ${JSON.stringify(host.readNodeState(ownerId))}`, { cause: error })
    } finally { unsubscribe(); clearInterval(interval) }
  }

  function recordFailure(requestId, error) {
    // A late completion must not turn a timed-out operation into success.
    host.space.injectRoot(ownerId, { type: 'SystemLifecycleTimeoutObservedInfo', requestId, error: error.message })
    void host.space.pump().catch((failure) => console.error('[Studio] Lifecycle failure observation:', failure))
  }

  return {
    get closing() { return closing },
    get stopped() { return stopped },
    start() {
      if (closing) return Promise.reject(new Error('Application is closing'))
      if (startPromise) return startPromise
      startPromise = (async () => {
        const requestId = randomUUID()
        try {
          await inject({ type: 'SystemStartRequestedInfo', requestId })
          await waitForPhase(requestId, 'Ready')
        } catch (error) { recordFailure(requestId, error); throw error }
      })()
      void startPromise.catch(() => { startPromise = undefined })
      return startPromise
    },
    shutdown() {
      if (exitPromise) return exitPromise
      if (stopped) return Promise.resolve()
      closing = true
      closeIngress()
      exitPromise = (async () => {
        await bounded(waitForBoot(), timeoutMs, 'bootstrap')
        if (stopped) return
        if (!host.space.admittedEntities().length) {
          host.stopAccepting()
          await bounded(stopSources(), cleanupTimeoutMs, 'event sources')
          await host.shutdown()
          stopped = true
          await bounded(closeServices(), cleanupTimeoutMs, 'host services')
          return
        }
        // Pause cyclic work before waiting for existing IPC submissions to drain.
        if (host.space.admittedEntities().includes('node-generation-task')) {
          const submission = host.space.injectRoot('node-generation-task', {
            type: 'StudioGenerationPrepareShutdownInfo', requestId: `quiesce/${randomUUID()}`,
          })
          await bounded(host.space.waitForSubmission(submission), timeoutMs, 'generation quiescence')
        }
        await bounded(waitForAcceptedWork(), timeoutMs, 'accepted host commands')
        host.stopAccepting()
        const requestId = randomUUID()
        try {
          await inject({ type: 'SystemShutdownRequestedInfo', requestId, hasProject: hasProject() })
          await waitForPhase(requestId, 'AwaitingDrain')
          const scheduler = host.readProjection().scheduler
          if (scheduler.pendingDeliveries || scheduler.activeChanges) throw new Error('Graph has unsettled work')
          await inject({ type: 'SystemShutdownDrainObservedInfo', requestId })
          await waitForPhase(requestId, 'ShutdownReady')
        } catch (error) { recordFailure(requestId, error); throw error }

        await bounded(stopSources(), cleanupTimeoutMs, 'event sources')
        await bounded(host.space.pump(), timeoutMs, 'final observations')
        const results = await host.evict([...host.space.admittedEntities()].reverse(), { timeoutMs: cleanupTimeoutMs })
        const errors = results.flatMap((result) => result.error ? [result.error] : [])
        try { await host.shutdown(); stopped = true } catch (error) { errors.push(error) }
        if (stopped) {
          try { await bounded(closeServices(), cleanupTimeoutMs, 'host services') } catch (error) { errors.push(error) }
        }
        if (errors.length) throw new AggregateError(errors, 'Application teardown failed')
      })()
      const current = exitPromise
      void current.catch(() => { if (!stopped && exitPromise === current) exitPromise = undefined })
      return current
    },
    abortBootstrap() {
      if (abortPromise) return abortPromise
      closing = true
      closeIngress()
      host.stopAccepting()
      abortPromise = (async () => {
        const errors = []
        try { await bounded(stopSources(), cleanupTimeoutMs, 'event sources') } catch (error) { errors.push(error) }
        try { await host.dispose({ timeoutMs: cleanupTimeoutMs }) } catch (error) { errors.push(error) }
        try { await bounded(closeServices(), cleanupTimeoutMs, 'host services') } catch (error) { errors.push(error) }
        if (errors.length) throw new AggregateError(errors, 'Bootstrap cleanup failed')
        stopped = true
      })()
      return abortPromise
    },
  }
}
