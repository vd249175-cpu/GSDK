/** Keep success and failure replies on one stable IPC shape. */
export function createRecorderSnapshot(rawState, overrides = {}) {
  const state = rawState && typeof rawState === 'object' && !Array.isArray(rawState) ? rawState : {}
  return {
    status: overrides.status ?? state.status ?? 'idle',
    sessionId: state.sessionId ?? null,
    sources: Array.isArray(state.sources) ? state.sources : ['desktop', 'browser'],
    handles: state.handles ?? { desktop: null, browser: null },
    eventCount: state.eventCount ?? 0,
    events: Array.isArray(state.events) ? state.events : [],
    applications: Array.isArray(state.applications) ? state.applications : [],
    artifactPath: state.artifactPath ?? null,
    sessionDir: state.sessionDir ?? null,
    agentTranscriptPath: state.agentTranscriptPath ?? null,
    agentTranscriptContent: state.agentTranscriptContent ?? null,
    screenshotsDirectory: state.screenshotsDirectory ?? null,
    nativeExports: state.nativeExports ?? { browser: null, desktop: null },
    browserActions: state.browserActions ?? null,
    startedAt: state.startedAt ?? null,
    completedAt: state.completedAt ?? null,
    lastError: overrides.lastError ?? state.lastError ?? null,
    progressLog: Array.isArray(state.progressLog) ? state.progressLog : [],
    narrationStartedAt: state.narrationStartedAt ?? null,
    subtitles: Array.isArray(state.subtitles) ? state.subtitles : [],
    audioClips: Array.isArray(state.audioClips) ? state.audioClips : [],
    browserAlive: overrides.browserAlive === true,
    revision: overrides.revision ?? 0,
  }
}
