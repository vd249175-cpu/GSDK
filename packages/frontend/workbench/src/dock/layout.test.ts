import { describe, expect, it } from 'vitest'
import type { DockNode } from './workspaceTypes'
import {
  canCloseArea, closeArea, excludeAreas, findArea, listAreas, resizeSplit, splitArea,
  swapAreaPanels, switchAreaPanel,
} from './layout'

const area = (id: string, panel: string): DockNode => ({
  kind: 'area', id, activePanelId: panel, panelHistory: [panel],
  panelInstanceIds: { [panel]: `instance-${id}-${panel}` },
})

describe('Dock layout', () => {
  it('splits and closes an area by merging its sibling', () => {
    const split = splitArea(area('a', 'outliner'), 'a', 'vertical', {
      areaId: 'b', splitId: 's', panelInstanceId: 'instance-b-outliner',
    })
    expect(listAreas(split).map((item) => item.id)).toEqual(['a', 'b'])
    expect(closeArea(split, 'b')).toMatchObject({ kind: 'area', id: 'a' })
  })

  it('keeps the final area and ignores unknown close targets', () => {
    const onlyArea = area('a', 'outliner')
    expect(canCloseArea(onlyArea, 'a')).toBe(false)
    expect(closeArea(onlyArea, 'a')).toBe(onlyArea)

    const split = splitArea(onlyArea, 'a', 'vertical', {
      areaId: 'b', splitId: 's', panelInstanceId: 'instance-b-outliner',
    })
    expect(canCloseArea(split, 'missing')).toBe(false)
    expect(closeArea(split, 'missing')).toBe(split)
  })

  it('resizes a nested split within safe bounds', () => {
    const split = splitArea(area('a', 'outliner'), 'a', 'horizontal', {
      areaId: 'b', splitId: 's', panelInstanceId: 'instance-b-outliner',
    })
    expect((resizeSplit(split, 's', 0.99) as { ratio: number }).ratio).toBe(0.85)
  })

  it('swaps panel instances between dock positions', () => {
    const split = splitArea(area('a', 'outliner'), 'a', 'horizontal', {
      areaId: 'b', splitId: 's', panelInstanceId: 'instance-b-outliner',
    })
    const withProperties = {
      ...split,
      second: area('b', 'properties'),
    } as DockNode
    const swapped = swapAreaPanels(withProperties, 'a', 'b')
    expect(findArea(swapped, 'a')?.activePanelId).toBe('properties')
    expect(findArea(swapped, 'b')?.activePanelId).toBe('outliner')
    expect(findArea(swapped, 'a')?.panelInstanceIds.properties).toBe('instance-b-properties')
    expect(findArea(swapped, 'b')?.panelInstanceIds.outliner).toBe('instance-a-outliner')
  })

  it('retains previously mounted panel instances when switching type', () => {
    const switched = switchAreaPanel(area('a', 'outliner'), 'a', 'properties', 'instance-properties')
    expect(findArea(switched, 'a')?.panelHistory).toEqual(['outliner', 'properties'])
    expect(findArea(switched, 'a')?.panelInstanceIds.properties).toBe('instance-properties')
  })

  it('collapses floated branches so remaining areas fill the dock', () => {
    const left = splitArea(area('a', 'outliner'), 'a', 'vertical', {
      areaId: 'b', splitId: 'left', panelInstanceId: 'instance-b-outliner',
    })
    const layout = {
      kind: 'split', id: 'root', direction: 'horizontal', ratio: 0.4,
      first: left, second: area('c', 'properties'),
    } as DockNode
    const visible = excludeAreas(layout, new Set(['c']))
    expect(visible).toBe(left)
    expect(listAreas(visible as DockNode).map((item) => item.id)).toEqual(['a', 'b'])
    expect(excludeAreas(layout, new Set(['a', 'b', 'c']))).toBeNull()
  })
})
