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

  it('观察节点灯塔默认静默不放光，仅在触发观察事件时亮起光锥扫海', () => {
    const obsNode: CausalNode3D = {
      id: 'src-radar-telemetry',
      name: 'RadarTelemetry',
      generation: 0,
      version: 1,
      status: 'IDLE',
      state: {},
      role: 'observation',
      color: '#0284c7',
      position: [0, 0, 0],
    }

    const assembly = generateIslandAssembly(obsNode)
    expect(assembly.lighthouseBeam).toBeDefined()
    expect(assembly.lighthouseBeamMaterial).toBeDefined()

    // 默认空闲静默状态下：灯塔光锥不可见，透明度为 0
    assembly.updateEcosystem(0.0, false)
    expect(assembly.lighthouseBeamMaterial?.visible).toBe(false)
    expect(assembly.lighthouseBeamMaterial?.opacity).toBe(0)

    // 触发观察事实遥测时：光锥点亮扫海
    assembly.triggerLighthouseSweep()
    expect(assembly.lighthouseBeamMaterial?.visible).toBe(true)
    expect(assembly.lighthouseBeamMaterial?.opacity).toBeGreaterThan(0.5)

    // 随着时间推移，光锥逐渐消隐
    for (let step = 0; step < 100; step++) {
      assembly.updateEcosystem(step * 0.05, false)
    }
    expect(assembly.lighthouseBeamMaterial?.visible).toBe(false)
  })

  it('应当为岛屿上的村民和生态物品附着 InspectItemData 字段属性数据', () => {
    const node: CausalNode3D = {
      id: 'actor-cluster-test',
      name: 'ActorCluster',
      generation: 1,
      version: 3,
      status: 'RUNNING',
      state: {
        workerCount: 8,
        isStreamActive: true,
        clusterTags: ['gpu', 'vulkan'],
      },
      role: 'domain',
      color: '#38bdf8',
      position: [0, 0, 0],
    }

    const assembly = generateIslandAssembly(node)
    expect(assembly.inspectableItems.length).toBeGreaterThanOrEqual(4)

    // 必须包含变迁岛民
    const villagers = assembly.inspectableItems.filter((i) => i.category === 'change_villager')
    expect(villagers.length).toBeGreaterThanOrEqual(1)
    expect(villagers[0].stateKey).toContain('version')

    // 必须包含状态字段物品
    const fields = assembly.inspectableItems.filter((i) => i.category === 'state_field')
    const fieldKeys = fields.map((f) => f.stateKey)
    expect(fieldKeys).toContain('workerCount')
    expect(fieldKeys).toContain('isStreamActive')
    expect(fieldKeys).toContain('clusterTags')

    // 检查 3D Mesh 上的 userData 穿透标记
    let foundMeshWithInspectData = false
    assembly.rootGroup.traverse((child) => {
      if (child.userData?.inspectData) {
        foundMeshWithInspectData = true
      }
    })
    expect(foundMeshWithInspectData).toBe(true)
  })
})
