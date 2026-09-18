import type { ClientStateStore } from './clientStateStore'
import type { ClientWorkspaceState } from './workspaceTypes'

interface WorkspaceHistoryEntry {
  id: string
  label: string
  mergeKey?: string
  before: ClientWorkspaceState
  after: ClientWorkspaceState
}

export interface ClientWorkspaceHistorySnapshot {
  canUndo: boolean
  canRedo: boolean
  undoLabel: string | null
  redoLabel: string | null
  revision: number
}

export type ClientHistoryActivity = { type: 'recorded'; historyId: string; label: string }

export class ClientWorkspaceHistory {
  private past: WorkspaceHistoryEntry[] = []
  private future: WorkspaceHistoryEntry[] = []
  private sequence = 0
  private readonly listeners = new Set<() => void>()
  private readonly activityListeners = new Set<(activity: ClientHistoryActivity) => void>()
  private snapshot: ClientWorkspaceHistorySnapshot = {
    canUndo: false,
    canRedo: false,
    undoLabel: null,
    redoLabel: null,
    revision: 0,
  }

  constructor(private readonly state: ClientStateStore) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = () => this.snapshot

  onActivity = (listener: (activity: ClientHistoryActivity) => void) => {
    this.activityListeners.add(listener)
    return () => this.activityListeners.delete(listener)
  }

  record(label: string, before: ClientWorkspaceState, after: ClientWorkspaceState, mergeKey?: string) {
    if (Object.is(before, after)) return
    const previous = this.past.at(-1)
    if (mergeKey && previous?.mergeKey === mergeKey) {
      previous.after = structuredClone(after)
      previous.label = label
    } else {
      this.sequence += 1
      this.past.push({
        id: `client-history-${this.sequence}`,
        label,
        mergeKey,
        before: structuredClone(before),
        after: structuredClone(after),
      })
      if (this.past.length > 100) this.past.shift()
    }
    this.future = []
    this.emit()
    const entry = this.past.at(-1)!
    this.activityListeners.forEach((listener) => listener({
      type: 'recorded', historyId: entry.id, label: entry.label,
    }))
  }

  undo() {
    const entry = this.past.pop()
    if (!entry) return null
    this.state.replaceWorkspaces(structuredClone(entry.before))
    this.future.push(entry)
    this.emit()
    return entry.id
  }

  redo() {
    const entry = this.future.pop()
    if (!entry) return null
    this.state.replaceWorkspaces(structuredClone(entry.after))
    this.past.push(entry)
    this.emit()
    return entry.id
  }

  discardFuture() {
    if (this.future.length === 0) return
    this.future = []
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
