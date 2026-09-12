import { describe, it, expect } from 'vitest'
import { generateIslandAssembly } from './island-generator'
import type { CausalNode3D } from './types'

describe('Graph-Agnostic Island & Ecosystem Generator (像素海岛生态测试)', () => {
  it('应当图无关地为任意状态结构生成海岛生态装配体', () => {
    // 模拟图 A：文本翻译与文档处理图
    const nodeA: CausalNode3D = {
      id: 'doc-parser-01',
      name: 'DocParser',
      generation: 1,
      version: 4,
      status: 'IDLE',
      state: {
        charCount: 4200,
        isCompleted: true,
        authors: ['Alice', 'Bob'],
        documentTitle: 'Graph Manifesto',
      },
      role: 'domain',
      color: '#38bdf8',
      position: [0, 0, 0],
    }

    const assemblyA = generateIslandAssembly(nodeA)
    expect(assemblyA.rootGroup).toBeDefined()
    expect(assemblyA.islandMesh).toBeDefined()
    expect(assemblyA.house).toBeDefined()
    expect(assemblyA.trees.length).toBeGreaterThanOrEqual(1)
    expect(assemblyA.villagers.length).toBeGreaterThanOrEqual(1)
    expect(assemblyA.ecosystemElements.length).toBeGreaterThan(0)

    // 检查不同数据类型映射出的生态景观
    const kinds = assemblyA.ecosystemElements.map((e) => e.kind)
    expect(kinds).toContain('tree')
    expect(kinds).toContain('bird') // 盘旋海鸟
    // 包含状态派生的生态要素
    expect(kinds.some((k) => ['crystal', 'crop', 'windmill', 'fire', 'sheep', 'rabbit', 'flower', 'firefly'].includes(k))).toBe(true)
  })

  it('应当为观察节点正确装配悬崖像素灯塔，为执行节点装配临水垂钓栈桥', () => {
    const obsNode: CausalNode3D = {
      id: 'src-camera-feed',
      name: 'CameraFeed',
      generation: 0,
      version: 1,
      status: 'RUNNING',
      state: { fps: 60 },
      role: 'observation',
      color: '#00f0ff',
      position: [-10, 0, 0],
    }

    const execNode: CausalNode3D = {
      id: 'sink-disk-recorder',
      name: 'DiskRecorder',
      generation: 2,
      version: 2,
      status: 'IDLE',
      state: { activeWriting: false },
      role: 'execution',
      color: '#f59e0b',
      position: [10, 0, 0],
    }

    const obsAssembly = generateIslandAssembly(obsNode)
    expect(obsAssembly.lighthouseBeam).toBeDefined()
    expect(obsAssembly.fishingBobber).toBeUndefined()

    const execAssembly = generateIslandAssembly(execNode)
    expect(execAssembly.fishingBobber).toBeDefined()
    expect(execAssembly.fishingVillager).toBeDefined()
    expect(execAssembly.lighthouseBeam).toBeUndefined()
  })

  it('空状态节点应当生成荒野原生态（叠石、野兔与花草）', () => {
    const emptyNode: CausalNode3D = {
      id: 'virgin-island-zero',
      name: 'Wilderness',
      generation: 0,
      version: 0,
      status: 'IDLE',
      state: {},
      role: 'domain',
      color: '#22c55e',
      position: [0, 0, 0],
    }

    const assembly = generateIslandAssembly(emptyNode)
    expect(assembly.rootGroup).toBeDefined()
    const kinds = assembly.ecosystemElements.map((e) => e.kind)
    expect(kinds).toContain('tree')
    expect(kinds).toContain('flower')
    expect(kinds).toContain('rabbit')
  })

  it('周期性生态律动 (updateEcosystem) 应稳定推进各元素姿态与动画', () => {
    const dynamicNode: CausalNode3D = {
      id: 'ai-reasoning-core',
      name: 'ReasoningEngine',
      generation: 1,
      version: 8,
      status: 'RUNNING',
      state: {
        tokensGenerated: 1024,
        isStreamActive: true,
        contextWindow: ['system', 'user', 'assistant'],
        systemModel: 'GraphVoxel-3D',
      },
      role: 'domain',
      color: '#a855f7',
      isHub: true,
      position: [0, 0, 0],
    }

    const assembly = generateIslandAssembly(dynamicNode)

    // 测试不同时间步的周期变化不会抛出异常
    expect(() => {
      assembly.updateEcosystem(0.0, true)
      assembly.updateEcosystem(1.5, true)
      assembly.updateEcosystem(3.0, false)
      assembly.triggerJump()
      assembly.updateEcosystem(3.05, false)
    }).not.toThrow()
  })
})
