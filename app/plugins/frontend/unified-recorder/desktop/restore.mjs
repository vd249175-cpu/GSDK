/** Restore persisted narration only after its Owner Node is accepting input. */
export function createNarrationRestorer({ targetNodeId, readIndex, callControl }) {
  let restored = false
  let inFlight = null
  return async (projection) => {
    if (restored || !projection?.nodes?.[targetNodeId]) return projection
    if (!inFlight) {
      inFlight = (async () => {
        const health = await callControl('health')
        if (health.state !== 'running') return projection
        const saved = await readIndex()
        if (!Array.isArray(saved?.subtitles) || !Array.isArray(saved?.audioClips)) {
          throw new Error('Saved narration index is invalid')
        }
        if (saved.subtitles.length || saved.audioClips.length) {
          await callControl('inject-renderer', {
            targetNodeId,
            info: { type: 'RestoreSubtitlesInfo', ...saved },
          })
          restored = true
          return callControl('projection')
        }
        restored = true
        return projection
      })()
    }
    try { return await inFlight }
    finally { inFlight = null }
  }
}
