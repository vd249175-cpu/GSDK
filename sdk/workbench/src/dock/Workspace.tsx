import { PictureInPicture2 } from 'lucide-react'
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useWorkbenchServices, useWorkbenchWorkspace } from '../context/WorkbenchHostContext'
import type { DockNode, DockSplitState } from './workspaceTypes'
import { FloatingScrollbars } from '../ui/FloatingScrollbars'
import { AreaShell } from './AreaShell'
import { prepareFloatingWindow, type FloatingDocument } from './floatingWindow'
import { excludeAreas, findArea, listAreas } from './layout'
import { createSplitResizeGesture } from './splitResizeGesture'

interface FloatingArea extends FloatingDocument {
  window: Window
}

interface DockNodeViewProps {
  workspaceId: string
  node: DockNode
  getAreaElement(areaId: string): HTMLDivElement
}

function AreaContainerHost({ container, className }: { container: HTMLDivElement; className: string }) {
  const hostRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host) return
    host.append(container)
    return () => {
      if (container.parentElement === host) container.remove()
    }
  }, [container])
  return <div className={className} ref={hostRef} />
}

function SplitView({ workspaceId, split, getAreaElement }: {
  workspaceId: string
  split: DockSplitState
  getAreaElement(areaId: string): HTMLDivElement
}) {
  const { commands } = useWorkbenchServices()
  const [previewRatio, setPreviewRatio] = useState<number | null>(null)
  const gestureRef = useRef<ReturnType<typeof createSplitResizeGesture> | null>(null)

  useEffect(() => () => {
    gestureRef.current?.abort(false)
    document.body.classList.remove('is-resizing')
  }, [])

  function beginResize(event: React.PointerEvent<HTMLButtonElement>) {
    event.preventDefault()
    const container = event.currentTarget.parentElement
    if (!container) return
    const bounds = container.getBoundingClientRect()
    event.currentTarget.setPointerCapture(event.pointerId)
    document.body.classList.add('is-resizing')
    gestureRef.current = createSplitResizeGesture({
      direction: split.direction,
      bounds,
      initialRatio: split.ratio,
      startX: event.clientX,
      startY: event.clientY,
      scheduleFrame: (callback) => window.requestAnimationFrame(callback),
      cancelFrame: (frameId) => window.cancelAnimationFrame(frameId),
      preview: setPreviewRatio,
      commit: (ratio) => {
        void Promise.resolve(commands.execute('workspace.split.resize', {
          workspaceId, splitId: split.id, ratio,
        })).then(() => setPreviewRatio(null), () => setPreviewRatio(null))
      },
      cancel: () => setPreviewRatio(null),
    })
  }

  function moveResize(event: React.PointerEvent<HTMLButtonElement>) {
    gestureRef.current?.move(event.clientX, event.clientY)
  }

  function endResize(event: React.PointerEvent<HTMLButtonElement>) {
    const gesture = gestureRef.current
    if (!gesture) return
    gestureRef.current = null
    gesture.finish(event.clientX, event.clientY)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    document.body.classList.remove('is-resizing')
  }

  function cancelResize(event: React.PointerEvent<HTMLButtonElement>) {
    gestureRef.current?.abort()
    gestureRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    document.body.classList.remove('is-resizing')
  }

  const ratio = previewRatio ?? split.ratio
  const style = split.direction === 'horizontal'
    ? { gridTemplateColumns: `${ratio}fr 4px ${1 - ratio}fr` }
    : { gridTemplateRows: `${ratio}fr 4px ${1 - ratio}fr` }

  return (
    <div className={`dock-split is-${split.direction}`} style={style}>
      <div className="dock-pane"><DockNodeView workspaceId={workspaceId} node={split.first} getAreaElement={getAreaElement} /></div>
      <button
        aria-label={split.direction === 'horizontal' ? '调整左右区域宽度' : '调整上下区域高度'}
        className="dock-resizer"
        type="button"
        onPointerDown={beginResize}
        onPointerMove={moveResize}
        onPointerUp={endResize}
        onPointerCancel={cancelResize}
      />
      <div className="dock-pane"><DockNodeView workspaceId={workspaceId} node={split.second} getAreaElement={getAreaElement} /></div>
    </div>
  )
}

function DockNodeView({ workspaceId, node, getAreaElement }: DockNodeViewProps) {
  if (node.kind === 'area') {
    return <AreaContainerHost container={getAreaElement(node.id)} className="area-slot" />
  }
  return <SplitView workspaceId={workspaceId} split={node} getAreaElement={getAreaElement} />
}

export interface WorkspaceProps {
  workspaceId: string
  active: boolean
}

export const Workspace = memo(function Workspace({
  workspaceId, active,
}: WorkspaceProps) {
  const { commands, panels } = useWorkbenchServices()
  const workspace = useWorkbenchWorkspace((state) => state.items[workspaceId])
  const [floatingAreas, setFloatingAreas] = useState<Map<string, FloatingArea>>(new Map())
  const [areaElements] = useState(() => new Map<string, HTMLDivElement>())
  const floatingAreasRef = useRef(floatingAreas)

  const getAreaElement = useCallback((areaId: string) => {
    const existing = areaElements.get(areaId)
    if (existing) return existing
    const element = document.createElement('div')
    element.className = 'area-render-root'
    areaElements.set(areaId, element)
    return element
  }, [areaElements])

  const closeFloating = useCallback((areaId: string, closeWindow: boolean) => {
    const floating = floatingAreasRef.current.get(areaId)
    if (!floating) return
    floating.disconnect()
    const next = new Map(floatingAreasRef.current)
    next.delete(areaId)
    floatingAreasRef.current = next
    setFloatingAreas(next)
    if (closeWindow && !floating.window.closed) floating.window.close()
  }, [])

  const toggleFloating = useCallback((areaId: string) => {
    const existing = floatingAreasRef.current.get(areaId)
    if (existing) {
      closeFloating(areaId, true)
      return
    }
    const area = findArea(workspace.layout, areaId)
    if (!area) return
    const title = panels.get(area.activePanelId)?.title ?? 'GraphVideo Panel'
    const popup = window.open(
      'about:blank',
      `graphvideo-floating-${workspaceId}-${areaId}`,
      'popup=yes,width=760,height=560,resizable=yes',
    )
    if (!popup) return
    const floating = { window: popup, ...prepareFloatingWindow(popup, `GraphVideo · ${title}`) }
    popup.addEventListener('beforeunload', () => closeFloating(areaId, false), { once: true })
    const next = new Map(floatingAreasRef.current).set(areaId, floating)
    floatingAreasRef.current = next
    setFloatingAreas(next)
  }, [closeFloating, panels, workspace.layout, workspaceId])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (active && (event.ctrlKey || event.metaKey) && event.code === 'Space') {
        event.preventDefault()
        void commands.execute('workspace.area.maximize', {
          workspaceId,
          areaId: workspace.focusedAreaId,
        })
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [active, commands, workspace.focusedAreaId, workspaceId])

  useEffect(() => {
    const orphanedAreas = [...floatingAreas.keys()].filter((areaId) => (
      !findArea(workspace.layout, areaId)
    ))
    if (orphanedAreas.length === 0) return
    const timer = window.setTimeout(() => {
      orphanedAreas.forEach((areaId) => closeFloating(areaId, true))
    }, 0)
    return () => window.clearTimeout(timer)
  }, [closeFloating, floatingAreas, workspace.layout])

  useEffect(() => {
    const currentIds = new Set(listAreas(workspace.layout).map((area) => area.id))
    for (const areaId of areaElements.keys()) {
      if (!currentIds.has(areaId)) areaElements.delete(areaId)
    }
  }, [areaElements, workspace.layout])

  useEffect(() => {
    floatingAreasRef.current = floatingAreas
  }, [floatingAreas])

  useEffect(() => () => {
    for (const floating of floatingAreasRef.current.values()) {
      floating.disconnect()
      if (!floating.window.closed) floating.window.close()
    }
  }, [])

  const maximizedArea = workspace.maximizedAreaId
    ? findArea(workspace.layout, workspace.maximizedAreaId)
    : null
  const visibleLayout = excludeAreas(workspace.layout, new Set(floatingAreas.keys()))
  const visibleMaximizedArea = maximizedArea && !floatingAreas.has(maximizedArea.id)
    ? maximizedArea
    : null

  return (
    <div
      className={`workspace workspace-page ${active ? 'is-active' : 'is-inactive'}`}
      aria-hidden={!active}
      inert={!active}
    >
      {visibleMaximizedArea
        ? <DockNodeView workspaceId={workspaceId} node={visibleMaximizedArea} getAreaElement={getAreaElement} />
        : visibleLayout
          ? <DockNodeView workspaceId={workspaceId} node={visibleLayout} getAreaElement={getAreaElement} />
          : (
            <div className="floating-area-placeholder">
              <PictureInPicture2 size={22} />
              <span>所有区域均已在悬浮窗口中打开</span>
              <button type="button" onClick={() => {
                for (const areaId of floatingAreas.keys()) closeFloating(areaId, true)
              }}>全部放回主窗口</button>
            </div>
          )}
      {listAreas(workspace.layout).map((area) => createPortal(
        <AreaShell workspaceId={workspaceId} area={area} floating={floatingAreas.has(area.id)} onFloatToggle={toggleFloating} />,
        getAreaElement(area.id),
        area.id,
      ))}
      {[...floatingAreas].map(([areaId, floating]) => {
        const area = findArea(workspace.layout, areaId)
        return area ? createPortal(
          <>
            <FloatingScrollbars ownerDocument={floating.window.document} />
            <AreaContainerHost container={getAreaElement(areaId)} className="floating-area-content" />
          </>,
          floating.container,
          `floating-host-${areaId}`,
        ) : null
      })}
    </div>
  )
})
