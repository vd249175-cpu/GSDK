import type { GraphVideoApplicationClient } from '../app/applicationClient'
import type { ClientWorkspaceHistory } from './clientWorkspaceHistory'

interface TimelineEntry {
  scope: 'application' | 'workspace'
  historyId: string
  label: string
}

export interface ClientHistorySnapshot {
  canUndo: boolean
  canRedo: boolean
  undoLabel: string | null
  redoLabel: string | null
  revision: number
}

export class ClientHistoryCoordinator {
  private past: TimelineEntry[] = []
  private future: TimelineEntry[] = []
  private readonly listeners = new Set<() => void>()
  private readonly disposers: Array<() => void>
  private replaying = false
  private snapshot: ClientHistorySnapshot = {
    canUndo: false,
    canRedo: false,
    undoLabel: null,
    redoLabel: null,
    revision: 0,
  }

  constructor(
    private readonly application: GraphVideoApplicationClient,
    private readonly workspace: ClientWorkspaceHistory,
  ) {
    this.disposers = [
      application.history.onRecorded(({ historyId, label }) => {
        this.record({ scope: 'application', historyId, label })
      }),
      application.history.onCleared(() => this.removeScope('application')),
      workspace.onActivity(({ historyId, label }) => {
        this.record({ scope: 'workspace', historyId, label })
      }),
    ]
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = () => this.snapshot

  async undo() {
    const entry = this.past.at(-1)
    if (!entry) return
    this.replaying = true
    try {
      if (entry.scope === 'application') await this.application.history.undo()
      else this.workspace.undo()
      this.past.pop()
      this.future.push(entry)
      this.emit()
    } finally {
      this.replaying = false
    }
  }

  async redo() {
    const entry = this.future.at(-1)
    if (!entry) return
    this.replaying = true
    try {
      if (entry.scope === 'application') await this.application.history.redo()
      else this.workspace.redo()
      this.future.pop()
      this.past.push(entry)
      this.emit()
    } finally {
      this.replaying = false
    }
  }

  dispose() {
    this.disposers.forEach((dispose) => dispose())
    this.listeners.clear()
  }

  private record(entry: TimelineEntry) {
    if (this.replaying) return
    const previous = this.past.at(-1)
    if (previous?.scope === entry.scope && previous.historyId === entry.historyId) {
      previous.label = entry.label
    } else this.past.push(entry)
    this.future = []
    if (entry.scope === 'application') this.workspace.discardFuture()
    else void this.application.history.clearRedo().catch(() => undefined)
    this.emit()
  }

  private removeScope(scope: TimelineEntry['scope']) {
    if (this.replaying) return
    this.past = this.past.filter((entry) => entry.scope !== scope)
    this.future = this.future.filter((entry) => entry.scope !== scope)
    this.emit()
  }

  private emit() {
    this.snapshot = {
      canUndo: this.past.length > 0,
      canRedo: this.future.length > 0,
      undoLabel: this.past.at(-1)?.label ?? null,
      redoLabel: this.future.at(-1)?.label ?? null,
      revision: this.snapshot.revision + 1,
    }
    this.listeners.forEach((listener) => listener())
  }
}
