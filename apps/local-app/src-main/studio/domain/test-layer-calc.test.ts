import { describe, it } from 'vitest'
import { LaunchpadScheduler } from './launchpad-scheduler'

describe('test user structure layer', () => {
  it('calculates layers correctly', () => {
    const nodes = {
      'node_video': { id: 'node_video', type: 'video' as const, title: '寝室极速绝杀', prompt: '' },
      'node_shot1': { id: 'node_shot1', type: 'image' as const, title: '寝室极速绝杀起幅帧', prompt: '' },
      'node_char': { id: 'node_char', type: 'image' as const, title: '主角阿橘', prompt: '--- \n model: nano-banana \n --- \n 阿橘立绘' },
      'node_room': { id: 'node_room', type: 'image' as const, title: '大学男生寝室', prompt: '--- \n model: nano-banana \n --- \n 寝室' },
      'node_kb': { id: 'node_kb', type: 'image' as const, title: '发光机械键盘', prompt: '--- \n model: nano-banana \n --- \n 键盘' },
      'node_style': { id: 'node_style', type: 'style' as const, title: '大学回忆暖金微尘调', prompt: '' },
    }

    const tree = [
      {
        key: 'item_video',
        kind: 'node' as const,
        title: '寝室极速绝杀',
        nodeId: 'node_video',
        nodeType: 'video' as const,
        depth: 0,
        line: 1,
        relation: 'structure' as const,
        children: [
          {
            key: 'item_shot1',
            kind: 'node' as const,
            title: '寝室极速绝杀起幅帧',
            nodeId: 'node_shot1',
            nodeType: 'image' as const,
            depth: 1,
            line: 2,
            relation: 'structure' as const,
            children: [
              { key: 'item_char', kind: 'node' as const, title: '主角阿橘', nodeId: 'node_char', nodeType: 'image' as const, depth: 2, line: 3, relation: 'structure' as const, children: [] },
              { key: 'item_room', kind: 'node' as const, title: '大学男生寝室', nodeId: 'node_room', nodeType: 'image' as const, depth: 2, line: 4, relation: 'structure' as const, children: [] },
              { key: 'item_kb', kind: 'node' as const, title: '发光机械键盘', nodeId: 'node_kb', nodeType: 'image' as const, depth: 2, line: 5, relation: 'structure' as const, children: [] },
              { key: 'item_style', kind: 'node' as const, title: '大学回忆暖金微尘调', nodeId: 'node_style', nodeType: 'style' as const, depth: 2, line: 6, relation: 'structure' as const, children: [] },
            ]
          }
        ]
      }
    ]

    const items = LaunchpadScheduler.buildLaunchpadItems(nodes, tree)
    console.log('Results:')
    for (const it of items) {
      console.log(`- ${it.title} (${it.id}): Layer = L${it.layer}, deps = [${it.dependencies.join(', ')}]`)
    }
  })
})
