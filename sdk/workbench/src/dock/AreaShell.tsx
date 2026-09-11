import {
  ChevronsUp, Columns2, Maximize2, Minimize2, PictureInPicture2, Rows2, X,
} from 'lucide-react'
import { useEffect, useSyncExternalStore } from 'react'
import { useWorkbenchServices, useWorkbenchWorkspace } from '../context/WorkbenchHostContext'
import type { AreaState } from './workspaceTypes'
import { ExtensionSlot } from '../elements/ExtensionSlot'
import type { ElementRuntimeHandle, PanelDefinition } from '../elements/types'
import { InlineSelect } from '../ui/InlineSelect'
import { canCloseArea } from './layout'
import { isOutsideViewport } from './floatingWindow'

interface AreaShellProps {
  workspaceId: string
  area: AreaState
  floating?: boolean
  onFloatToggle?(areaId: string): void
}

function PanelInstanceView({
  workspaceId,
  area,
  panel,
  runtime,
}: {
  workspaceId: string
  area: AreaState
  panel: PanelDefinition
  runtime: ElementRuntimeHandle
}) {
  const Panel = panel.component
  const instanceId = area.panelInstanceIds[panel.id]
  const viewId = `${workspaceId}:${area.id}:${panel.id}`
  useEffect(() => {
    runtime.attach(viewId)
    return () => runtime.detach(viewId)
  }, [runtime, viewId])
  return (
    <>
      <Panel
        workspaceId={workspaceId}
        areaId={area.id}
        viewId={viewId}
        instanceId={instanceId}
        runtime={runtime}
      />
      <ExtensionSlot
        point={`panel:${panel.id}:overlay`}
        className="extension-slot-overlay"
        panelId={panel.id}
        workspaceId={workspaceId}
        areaId={area.id}
        viewId={viewId}
        instanceId={instanceId}
        runtime={runtime}
      />
    </>
  )
}

export function AreaShell({ workspaceId, area, floating = false, onFloatToggle }: AreaShellProps) {
  const { commands, panels, elementRuntimes } = useWorkbenchServices()
  const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform)
  useSyncExternalStore(panels.subscribe, panels.getSnapshot)
  useSyncExternalStore(elementRuntimes.subscribe, elementRuntimes.getSnapshot)
  const workspace = useWorkbenchWorkspace((state) => state.items[workspaceId])
  const focused = workspace?.focusedAreaId === area.id
  const maximized = workspace?.maximizedAreaId === area.id
  const canClose = workspace ? canCloseArea(workspace.layout, area.id) : false
  const definition = panels.get(area.activePanelId)
  const PanelIcon = definition?.icon ?? ChevronsUp
  const activeOwner = panels.ownerOf(area.activePanelId)
  const activeInstanceId = area.panelInstanceIds[area.activePanelId]
  const activeRuntime = activeOwner && activeInstanceId
    ? elementRuntimes.getOrCreate(activeOwner, activeInstanceId)
    : null
  const activeViewId = `${workspaceId}:${area.id}:${area.activePanelId}`

  return (
    <article
      className={`area-shell ${focused ? 'is-focused' : ''}`}
      onPointerDown={() => void commands.execute('workspace.area.focus', { workspaceId, areaId: area.id })}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault()
        const source = event.dataTransfer.getData('application/x-graphvideo-area').split(':')
        if (source.length === 2 && source[0] === workspaceId) void commands.execute('workspace.area.swap', {
          workspaceId,
          sourceAreaId: source[1],
          targetAreaId: area.id,
        })
      }}
    >
      <header
        className="area-header"
        draggable={!floating}
        onDragStart={(event) => {
          if ((event.target as HTMLElement).closest('button, .inline-select')) {
            event.preventDefault()
            return
          }
          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setData('application/x-graphvideo-area', `${workspaceId}:${area.id}`)
        }}
        onDragEnd={(event) => {
          if (onFloatToggle && isOutsideViewport(
            event.clientX, event.clientY, window.innerWidth, window.innerHeight,
          )) onFloatToggle(area.id)
        }}
      >
        <PanelIcon size={14} />
        <InlineSelect
          ariaLabel="切换面板"
          className="area-panel-select"
          value={area.activePanelId}
          options={[
            ...(!definition ? [{ value: area.activePanelId, label: `未加载 · ${area.activePanelId}` }] : []),
            ...panels.list().map((panel) => ({ value: panel.id, label: panel.title })),
          ]}
          onChange={(panelId) => void commands.execute('workspace.panel.switch', {
            workspaceId,
            areaId: area.id,
            panelId,
          })}
        />
        {definition && activeRuntime && (
          <ExtensionSlot
            point={`panel:${definition.id}:header`}
            panelId={definition.id}
            workspaceId={workspaceId}
            areaId={area.id}
            viewId={activeViewId}
            instanceId={activeInstanceId}
            runtime={activeRuntime}
          />
        )}
        <span className="area-header-spacer" />
        <button className="area-header-button" type="button" title={floating ? '放回主窗口' : '弹出为悬浮窗口'} onClick={() => onFloatToggle?.(area.id)}><PictureInPicture2 size={13} /></button>
        <button className="area-header-button" type="button" title="左右切分" onClick={() => void commands.execute('workspace.area.split', { workspaceId, areaId: area.id, direction: 'horizontal' })}><Columns2 size={13} /></button>
        <button className="area-header-button" type="button" title="上下切分" onClick={() => void commands.execute('workspace.area.split', { workspaceId, areaId: area.id, direction: 'vertical' })}><Rows2 size={13} /></button>
        <button className="area-header-button" type="button" title={maximized ? (isMac ? '恢复区域 (⌘+Space)' : '恢复区域 (Ctrl+Space)') : (isMac ? '最大化区域 (⌘+Space)' : '最大化区域 (Ctrl+Space)')} onClick={() => void commands.execute('workspace.area.maximize', { workspaceId, areaId: area.id })}>
          {maximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
        </button>
        <button className="area-header-button" type="button" title={canClose ? '关闭并与相邻区域合并' : '至少保留一个区域'} disabled={!canClose} onClick={() => void commands.execute('workspace.area.close', { workspaceId, areaId: area.id })}><X size={13} /></button>
      </header>
      <div className="area-content">
        {area.panelHistory.map((panelId) => {
          const panel = panels.get(panelId)
          const owner = panels.ownerOf(panelId)
          const instanceId = area.panelInstanceIds[panelId]
          if (!panel || !owner || !instanceId) return panelId === area.activePanelId ? (
            <div className="panel-instance is-active" key={panelId}>
              <div className="missing-element-panel">
                <ChevronsUp size={24} />
                <strong>Element 当前未加载</strong>
                <span>{panelId}</span>
              </div>
            </div>
          ) : null
          const runtime = elementRuntimes.getOrCreate(owner, instanceId)
          return (
            <div className={`panel-instance ${panelId === area.activePanelId ? 'is-active' : ''}`} key={panelId}>
              <PanelInstanceView
                workspaceId={workspaceId}
                area={area}
                panel={panel}
                runtime={runtime}
              />
            </div>
          )
        })}
      </div>
    </article>
  )
}
