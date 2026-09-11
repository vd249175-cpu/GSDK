import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ProjectNode } from '@graphvideo/client-sdk'

export type NodePropertyField = 'description' | 'content' | 'prompt'
export type NodePropertyPatch = Partial<Pick<ProjectNode, NodePropertyField>>

export interface NodePropertyDraftValues {
  description: string
  content: string
  prompt: string
}

interface NodePropertyDraftState {
  nodeId: string | null
  values: NodePropertyDraftValues
}

function valuesFromNode(node: ProjectNode | undefined): NodePropertyDraftValues {
  return {
    description: node?.description ?? '',
    content: node?.content ?? '',
    prompt: node?.prompt ?? '',
  }
}

function hasPatch(patch: NodePropertyPatch) {
  return Object.keys(patch).length > 0
}

function sameValues(left: NodePropertyDraftValues, right: NodePropertyDraftValues) {
  return left.description === right.description
    && left.content === right.content
    && left.prompt === right.prompt
}

export function useNodePropertyDraft(
  node: ProjectNode | undefined,
  persist: (nodeId: string, patch: NodePropertyPatch, historyGroupId?: string) => Promise<{ revision: number }>,
  projectionRevision = 0,
  delay = 400,
) {
  const [draft, setDraft] = useState<NodePropertyDraftState>(() => ({
    nodeId: node?.id ?? null,
    values: valuesFromNode(node),
  }))
  const activeNodeIdRef = useRef(node?.id ?? null)
  const draftSessionRef = useRef(0)
  const dirtyPatchRef = useRef<NodePropertyPatch>({})
  // Retain local values until a projection at/after the write acknowledgement.
  // React may skip the intermediate projection whose values exactly match the patch.
  const pendingPatchRef = useRef<NodePropertyPatch>({})
  const acknowledgedRevisionsRef = useRef<Partial<Record<NodePropertyField, number>>>({})
  const editSequenceRef = useRef(0)
  const fieldEditsRef = useRef<Partial<Record<NodePropertyField, number>>>({})
  const [acknowledgement, setAcknowledgement] = useState(0)
  const persistRef = useRef(persist)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [editing, setEditing] = useState(false)
  const composingRef = useRef(false)
  const historyGroupRef = useRef<string | null>(null)

  useLayoutEffect(() => { persistRef.current = persist }, [persist])

  const clearTimer = useCallback(() => {
    if (!timerRef.current) return
    clearTimeout(timerRef.current)
    timerRef.current = null
  }, [])

  const flush = useCallback(async () => {
    clearTimer()
    const nodeId = activeNodeIdRef.current
    const patch = dirtyPatchRef.current
    if (!nodeId || !hasPatch(patch)) return
    dirtyPatchRef.current = {}
    const draftSession = draftSessionRef.current
    const fieldEdits = { ...fieldEditsRef.current }
    try {
      const result = await persistRef.current(nodeId, patch, historyGroupRef.current ?? undefined)
      if (activeNodeIdRef.current !== nodeId || draftSessionRef.current !== draftSession) return
      for (const field of Object.keys(patch) as NodePropertyField[]) {
        if (fieldEditsRef.current[field] === fieldEdits[field]) {
          acknowledgedRevisionsRef.current[field] = result.revision
        }
      }
      setAcknowledgement((value) => value + 1)
    } catch {
      if (activeNodeIdRef.current === nodeId && draftSessionRef.current === draftSession) {
        const retry: NodePropertyPatch = {}
        for (const field of Object.keys(patch) as NodePropertyField[]) {
          if (fieldEditsRef.current[field] === fieldEdits[field]) retry[field] = patch[field]
        }
        dirtyPatchRef.current = { ...retry, ...dirtyPatchRef.current }
      }
    }
  }, [clearTimer])

  const schedule = useCallback(() => {
    clearTimer()
    if (composingRef.current) return
    timerRef.current = setTimeout(() => { void flush() }, delay)
  }, [clearTimer, delay, flush])

  const update = useCallback((field: NodePropertyField, value: string) => {
    setDraft((current) => ({
      ...current,
      values: { ...current.values, [field]: value },
    }))
    dirtyPatchRef.current = { ...dirtyPatchRef.current, [field]: value }
    pendingPatchRef.current = { ...pendingPatchRef.current, [field]: value }
    fieldEditsRef.current[field] = ++editSequenceRef.current
    delete acknowledgedRevisionsRef.current[field]
    schedule()
  }, [schedule])

  const beginEditing = useCallback(() => {
    setEditing(true)
    if (!historyGroupRef.current) {
      historyGroupRef.current = `property:${activeNodeIdRef.current ?? 'none'}:${Date.now()}`
    }
  }, [])

  const endEditing = useCallback(() => {
    setEditing(false)
    void flush()
    historyGroupRef.current = null
  }, [flush])

  const beginComposition = useCallback(() => {
    composingRef.current = true
    clearTimer()
  }, [clearTimer])

  const endComposition = useCallback(() => {
    composingRef.current = false
    schedule()
  }, [schedule])

  useLayoutEffect(() => {
    const nextNodeId = node?.id ?? null
    if (activeNodeIdRef.current === nextNodeId) return
    void flush()
    activeNodeIdRef.current = nextNodeId
    draftSessionRef.current += 1
    dirtyPatchRef.current = {}
    pendingPatchRef.current = {}
    acknowledgedRevisionsRef.current = {}
    fieldEditsRef.current = {}
    setEditing(false)
    composingRef.current = false
    historyGroupRef.current = null
    setDraft({ nodeId: nextNodeId, values: valuesFromNode(node) })
  }, [flush, node])

  useEffect(() => {
    if (draft.nodeId !== (node?.id ?? null)) return
    const nextValues = valuesFromNode(node)
    for (const field of Object.keys(pendingPatchRef.current) as NodePropertyField[]) {
      const revision = acknowledgedRevisionsRef.current[field]
      if (!(field in dirtyPatchRef.current) && revision !== undefined && projectionRevision >= revision) {
        delete pendingPatchRef.current[field]
        delete acknowledgedRevisionsRef.current[field]
      }
    }
    if (editing || composingRef.current) return
    const protectedPatch = { ...pendingPatchRef.current, ...dirtyPatchRef.current }
    if (hasPatch(protectedPatch)) {
      const mergedValues: NodePropertyDraftValues = {
        description: 'description' in protectedPatch ? draft.values.description : nextValues.description,
        content: 'content' in protectedPatch ? draft.values.content : nextValues.content,
        prompt: 'prompt' in protectedPatch ? draft.values.prompt : nextValues.prompt,
      }
      setDraft((current) => sameValues(current.values, mergedValues)
        ? current
        : { ...current, values: mergedValues })
      return
    }
    setDraft((current) => sameValues(current.values, nextValues)
      ? current
      : { ...current, values: nextValues })
  }, [acknowledgement, draft.nodeId, editing, node, projectionRevision])

  useEffect(() => () => {
    clearTimer()
    void flush()
  }, [clearTimer, flush])

  const values = draft.nodeId === (node?.id ?? null) ? draft.values : valuesFromNode(node)

  return {
    values,
    update,
    flush,
    fieldEvents: {
      onFocus: beginEditing,
      onBlur: endEditing,
      onCompositionStart: beginComposition,
      onCompositionEnd: endComposition,
    },
  }
}
