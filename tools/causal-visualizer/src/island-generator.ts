import * as THREE from 'three'
import type { CausalNode3D } from './types'
import {
  createPRNG,
  hashString,
  createVoxelIslandMesh,
  createLighthouseMesh,
  createFishingPierMesh,
  createVoxelTree,
  createVoxelHouse,
  createVoxelVillager,
  createVoxelFlowerPatch,
  createVoxelMushroomCluster,
  createVoxelCropPatch,
  createVoxelSheep,
  createVoxelRabbit,
  createVoxelBird,
  createVoxelCrystalCluster,
  createVoxelRockCairn,
  createVoxelCampfire,
  createVoxelWindmill,
  createVoxelFireflies,
} from './voxel-models'

export interface AnimatedEcosystemElement {
  object: THREE.Object3D
  kind: 'tree' | 'flower' | 'mushroom' | 'sheep' | 'rabbit' | 'bird' | 'crystal' | 'crop' | 'rock' | 'fire' | 'windmill' | 'firefly'
  basePos: THREE.Vector3
  baseRot: THREE.Euler
  baseScale: THREE.Vector3
  phase: number
  speed: number
  orbitRadius?: number
  customParts?: {
    head?: THREE.Group
    ears?: THREE.Group
    wingL?: THREE.Mesh
    wingR?: THREE.Mesh
    blades?: THREE.Group
    flame?: THREE.Mesh
    particles?: THREE.Mesh[]
  }
}

export interface IslandVisualAssembly {
  rootGroup: THREE.Group
  islandMesh: THREE.Group
  lighthouseBeam?: THREE.Mesh
  lighthouseBeamMaterial?: THREE.MeshBasicMaterial
  fishingBobber?: THREE.Mesh
  fishingVillager?: THREE.Group
  villagers: THREE.Group[]
  trees: THREE.Group[]
  house?: THREE.Group
  ecosystemElements: AnimatedEcosystemElement[]
  node: CausalNode3D
  updateEcosystem: (time: number, isRunning: boolean) => void
  triggerJump: () => void
  triggerLighthouseSweep: () => void
}

/**
 * 纯图无关海岛生态生成器 (Graph-Agnostic Procedural Ecosystem & Island Generator)
 * - 地形基底：由 hash(node.id) 确定性派生；
 * - 角色地标：
 *   - observation: 悬崖红白像素灯塔 + 360°旋转探海光锥
 *   - execution: 临水垂钓木栈桥 + 草帽小人 + 水面起伏鱼浮
 *   - domain: 城镇中心红顶小木屋
 * - 生态景观（State 投影）：
 *   - 纯图无关解算：任意业务状态的结构、键数量与数据类型映射为自然生态：
 *     - 数值型 (number) -> 变色数据水晶簇 / 旋转风车 / 丰收菜园
 *     - 布尔型 (boolean) -> 营地篝火（真则炽烈跳动，假则余烬微光）
 *     - 集合型 (array/object) -> 像素小绵羊 / 白兔窝 / 奇幻蘑菇仙女环
 *     - 文本型 (string) -> 绚丽花海地被 / 苔藓叠石堆
 * - 周期性生命律动 (Periodic Changes)：
 *   - 海风吹拂树木与花草轻柔摆动
 *   - 绵羊低头吃草、白兔不定期微跳
 *   - 候鸟绕岛巡游翱翔、翅膀扇动
 *   - 水晶周期性呼吸辉光、萤火虫微光游弋
 *   - 灯塔巡夜扫海、鱼浮水波荡漾
 *   - 岛民在变迁 (Change) 发生时欢欣跳跃
 */
export function generateIslandAssembly(node: CausalNode3D): IslandVisualAssembly {
  const rootGroup = new THREE.Group()
  rootGroup.position.set(0, 0, 0)

  const seed = hashString(node.id)
  const rng = createPRNG(seed)

  const isHub = Boolean(node.isHub)
  const role = node.role || 'domain'
  const islandRadius = isHub ? 4.2 : 3.0

  // 1. 生成体素分层岛屿基盘
  const islandMesh = createVoxelIslandMesh(islandRadius, seed, node.color)
  rootGroup.add(islandMesh)

  let lighthouseBeam: THREE.Mesh | undefined
  let lighthouseBeamMaterial: THREE.MeshBasicMaterial | undefined
  let fishingBobber: THREE.Mesh | undefined
  let fishingVillager: THREE.Group | undefined
  let house: THREE.Group | undefined

  // 2. 根据节点系统角色装配标志性建筑
  if (role === 'observation') {
    // 观察类海岛：在北角悬崖建造灯塔
    const { group: lhGroup, beam, beamMaterial } = createLighthouseMesh()
    lhGroup.position.set(islandRadius * 0.42, 1.2, -islandRadius * 0.35)
    rootGroup.add(lhGroup)
    lighthouseBeam = beam
    lighthouseBeamMaterial = beamMaterial
  } else if (role === 'execution') {
    // 执行类海岛：在南角水边建造垂钓木栈桥
    const { group: pierGroup, bobber, villager } = createFishingPierMesh()
    pierGroup.position.set(0, 0.2, islandRadius * 0.55)
    rootGroup.add(pierGroup)
    fishingBobber = bobber
    fishingVillager = villager
  } else {
    // 纯领域核心海岛：若有状态数据或为中心，生成城镇木屋
    const stateKeys = Object.keys(node.state || {})
    if (stateKeys.length > 0 || isHub) {
      house = createVoxelHouse(seed)
      house.position.set(-0.2, 1.35, -0.3)
      rootGroup.add(house)
    }
  }

  // 3. 收集动态动画生态元素
  const ecosystemElements: AnimatedEcosystemElement[] = []
  const trees: THREE.Group[] = []

  // 辅助函数：均匀计算外围放置点，避让中心地标
  let slotIndex = 0
  const totalSlots = 14
  function getNextSlotPos(minR = 0.38, maxR = 0.82): { x: number; z: number } {
    const angle = (slotIndex / totalSlots) * Math.PI * 2 + (rng() - 0.5) * 0.35
    slotIndex = (slotIndex + 3) % totalSlots // 步进取模，自然分散
    const dist = islandRadius * (minR + rng() * (maxR - minR))
    return {
      x: Math.cos(angle) * dist,
      z: Math.sin(angle) * dist,
    }
  }

  // 4. 植树绿化（天然植被）
  const stateKeys = Object.keys(node.state || {})
  const treeCount = Math.min(4, Math.max(1, Math.floor(stateKeys.length * 0.5) + (isHub ? 2 : 1)))
  const treeTypes: Array<'palm' | 'pine' | 'oak'> = ['palm', 'oak', 'pine']

  for (let i = 0; i < treeCount; i++) {
    const tType = treeTypes[Math.floor(rng() * treeTypes.length)]
    const tSeed = (seed + i * 37) >>> 0
    const tree = createVoxelTree(tType, tSeed)
    const pos = getNextSlotPos(0.4, 0.85)
    tree.position.set(pos.x, 1.25, pos.z)
    const scale = 0.75 + rng() * 0.3
    tree.scale.set(scale, scale, scale)
    tree.rotation.y = rng() * Math.PI * 2
    rootGroup.add(tree)
    trees.push(tree)

    ecosystemElements.push({
      object: tree,
      kind: 'tree',
      basePos: tree.position.clone(),
      baseRot: tree.rotation.clone(),
      baseScale: tree.scale.clone(),
      phase: rng() * Math.PI * 2,
      speed: 1.6 + rng() * 0.8,
    })
  }

  // 5. 图无关 State 动态生态投影 (Graph-Agnostic State-driven Ecosystem)
  const stateEntries = Object.entries(node.state || {})

  if (stateEntries.length === 0) {
    // 零状态荒岛：放置安静的自然奇景（叠石、野兔与花丛）
    const rock = createVoxelRockCairn(seed)
    const posR = getNextSlotPos()
    rock.position.set(posR.x, 1.2, posR.z)
    rootGroup.add(rock)

    const flowers = createVoxelFlowerPatch(seed, 4)
    const posF = getNextSlotPos()
    flowers.position.set(posF.x, 1.3, posF.z)
    rootGroup.add(flowers)
    ecosystemElements.push({
      object: flowers,
      kind: 'flower',
      basePos: flowers.position.clone(),
      baseRot: flowers.rotation.clone(),
      baseScale: flowers.scale.clone(),
      phase: rng() * Math.PI * 2,
      speed: 2.2,
    })

    const { group: bunny, ears } = createVoxelRabbit(seed)
    const posB = getNextSlotPos()
    bunny.position.set(posB.x, 1.3, posB.z)
    bunny.rotation.y = rng() * Math.PI * 2
    rootGroup.add(bunny)
    ecosystemElements.push({
      object: bunny,
      kind: 'rabbit',
      basePos: bunny.position.clone(),
      baseRot: bunny.rotation.clone(),
      baseScale: bunny.scale.clone(),
      phase: rng() * Math.PI * 2,
      speed: 3.5,
      customParts: { ears },
    })
  } else {
    // 有状态海岛：解析状态键值结构，并派生丰富的像素生态
    stateEntries.forEach(([key, val], idx) => {
      const entrySeed = hashString(`${node.id}::${key}`)
      const entryRng = createPRNG(entrySeed)
      const slot = getNextSlotPos()

      if (typeof val === 'number') {
        // 数值型属性：水晶簇 / 旋转风车 / 农田菜园
        const choice = entrySeed % 3
        if (choice === 0) {
          // 数据水晶簇（高度与数值量级正相关）
          const hScale = Math.min(1.6, Math.max(0.7, Math.log10(Math.max(1, Math.abs(val))) * 0.4 + 0.8))
          const crystal = createVoxelCrystalCluster(entrySeed, node.color, hScale)
          crystal.position.set(slot.x, 1.25, slot.z)
          rootGroup.add(crystal)
          ecosystemElements.push({
            object: crystal,
            kind: 'crystal',
            basePos: crystal.position.clone(),
            baseRot: crystal.rotation.clone(),
            baseScale: crystal.scale.clone(),
            phase: entryRng() * Math.PI * 2,
            speed: 2.0,
          })
        } else if (choice === 1) {
          // 旋转风车
          const { group: windmill, blades } = createVoxelWindmill(entrySeed)
          windmill.position.set(slot.x, 1.25, slot.z)
          rootGroup.add(windmill)
          ecosystemElements.push({
            object: windmill,
            kind: 'windmill',
            basePos: windmill.position.clone(),
            baseRot: windmill.rotation.clone(),
            baseScale: windmill.scale.clone(),
            phase: 0,
            speed: 1.5 + Math.min(2.5, Math.abs(val) * 0.1),
            customParts: { blades },
          })
        } else {
          // 菜园农田
          const crops = createVoxelCropPatch(entrySeed)
          crops.position.set(slot.x, 1.25, slot.z)
          rootGroup.add(crops)
        }
      } else if (typeof val === 'boolean') {
        // 布尔型属性：篝火营地（真则旺盛跳动，假则石圈余烬）
        const { group: campfire, flame } = createVoxelCampfire(entrySeed, val)
        campfire.position.set(slot.x, 1.25, slot.z)
        rootGroup.add(campfire)
        if (flame) {
          ecosystemElements.push({
            object: campfire,
            kind: 'fire',
            basePos: campfire.position.clone(),
            baseRot: campfire.rotation.clone(),
            baseScale: campfire.scale.clone(),
            phase: entryRng() * Math.PI * 2,
            speed: 8.0,
            customParts: { flame },
          })
        }
      } else if (Array.isArray(val) || (typeof val === 'object' && val !== null)) {
        // 集合/对象型属性：小绵羊群 / 蘑菇仙女环 / 白兔
        const choice = entrySeed % 3
        if (choice === 0) {
          const { group: sheep, head } = createVoxelSheep(entrySeed)
          sheep.position.set(slot.x, 1.3, slot.z)
          sheep.rotation.y = entryRng() * Math.PI * 2
          rootGroup.add(sheep)
          ecosystemElements.push({
            object: sheep,
            kind: 'sheep',
            basePos: sheep.position.clone(),
            baseRot: sheep.rotation.clone(),
            baseScale: sheep.scale.clone(),
            phase: entryRng() * Math.PI * 2,
            speed: 2.2,
            customParts: { head },
          })
        } else if (choice === 1) {
          const mushrooms = createVoxelMushroomCluster(entrySeed)
          mushrooms.position.set(slot.x, 1.3, slot.z)
          rootGroup.add(mushrooms)
        } else {
          const { group: bunny, ears } = createVoxelRabbit(entrySeed)
          bunny.position.set(slot.x, 1.3, slot.z)
          bunny.rotation.y = entryRng() * Math.PI * 2
          rootGroup.add(bunny)
          ecosystemElements.push({
            object: bunny,
            kind: 'rabbit',
            basePos: bunny.position.clone(),
            baseRot: bunny.rotation.clone(),
            baseScale: bunny.scale.clone(),
            phase: entryRng() * Math.PI * 2,
            speed: 3.5,
            customParts: { ears },
          })
        }
      } else {
        // 字符串型属性：鲜艳花丛 / 苔藓叠石
        const choice = entrySeed % 2
        if (choice === 0) {
          const flowers = createVoxelFlowerPatch(entrySeed, 4, node.color)
          flowers.position.set(slot.x, 1.3, slot.z)
          rootGroup.add(flowers)
          ecosystemElements.push({
            object: flowers,
            kind: 'flower',
            basePos: flowers.position.clone(),
            baseRot: flowers.rotation.clone(),
            baseScale: flowers.scale.clone(),
            phase: entryRng() * Math.PI * 2,
            speed: 2.4,
          })
        } else {
          const rock = createVoxelRockCairn(entrySeed)
          rock.position.set(slot.x, 1.25, slot.z)
          rootGroup.add(rock)
        }
      }
    })
  }

  // 6. 候鸟翱翔与萤火虫浮游
  // 盘旋海鸟
  const { group: bird, wingL, wingR } = createVoxelBird(seed)
  bird.position.set(0, 4.5 + rng() * 1.5, 0)
  rootGroup.add(bird)
  ecosystemElements.push({
    object: bird,
    kind: 'bird',
    basePos: bird.position.clone(),
    baseRot: bird.rotation.clone(),
    baseScale: bird.scale.clone(),
    phase: rng() * Math.PI * 2,
    speed: 0.9,
    orbitRadius: islandRadius * (1.1 + rng() * 0.4),
    customParts: { wingL, wingR },
  })

  // 若为 Hub 或状态丰富节点，装配飞舞萤火虫
  if (isHub || stateEntries.length >= 3) {
    const { group: fireflies, particles } = createVoxelFireflies(seed, 6)
    fireflies.position.set(0, 0.4, 0)
    rootGroup.add(fireflies)
    ecosystemElements.push({
      object: fireflies,
      kind: 'firefly',
      basePos: fireflies.position.clone(),
      baseRot: fireflies.rotation.clone(),
      baseScale: fireflies.scale.clone(),
      phase: rng() * Math.PI * 2,
      speed: 2.0,
      customParts: { particles },
    })
  }

  // 7. 根据版本演进生成岛民 (Islanders / Change Agents)
  const villagerCount = Math.min(4, Math.max(1, Math.floor(Math.log2(Math.max(1, node.version) + 1))))
  const villagers: THREE.Group[] = []

  for (let v = 0; v < villagerCount; v++) {
    const villager = createVoxelVillager(false)
    const vAngle = (v / villagerCount) * Math.PI * 2 + 0.5
    const vDist = islandRadius * 0.42
    villager.position.set(Math.cos(vAngle) * vDist, 1.3, Math.sin(vAngle) * vDist)
    villager.rotation.y = rng() * Math.PI * 2
    rootGroup.add(villager)
    villagers.push(villager)
  }

  // 8. 周期性生态动画生命周期 (Periodic Ecosystem Lifecycle)
  let jumpCooldown = 0
  let lighthouseIntensity = 0.0

  function triggerJump() {
    jumpCooldown = 1.0
  }

  function triggerLighthouseSweep() {
    lighthouseIntensity = 1.0
    if (lighthouseBeamMaterial) {
      lighthouseBeamMaterial.visible = true
      lighthouseBeamMaterial.opacity = 0.65
    }
  }

  function updateEcosystem(time: number, isRunning: boolean) {
    // A. 观察节点灯塔：仅在发生观察事实/遥测或处于运行状态时放光探海，平时静默不放光
    if (lighthouseBeam && lighthouseBeamMaterial) {
      if (isRunning && lighthouseIntensity < 0.4) {
        lighthouseIntensity = 0.55
        lighthouseBeamMaterial.visible = true
      }

      if (lighthouseIntensity > 0) {
        lighthouseIntensity = Math.max(0, lighthouseIntensity - 0.012)
        lighthouseBeam.rotation.y += 0.05 // 快速扫海
        lighthouseBeamMaterial.opacity = lighthouseIntensity * 0.65
        if (lighthouseIntensity <= 0 && !isRunning) {
          lighthouseBeamMaterial.visible = false
        }
      } else {
        lighthouseBeamMaterial.visible = false
      }
    }

    // B. 执行节点垂钓者与鱼浮起伏
    if (fishingBobber) {
      fishingBobber.position.y = 0.15 + Math.sin(time * 3.2) * 0.06
    }
    if (fishingVillager) {
      fishingVillager.rotation.z = Math.sin(time * 1.5) * 0.04
    }

    // C. 岛民漫步与跳跃
    if (jumpCooldown > 0) {
      jumpCooldown -= 0.03
      const jumpY = Math.sin((1.0 - jumpCooldown) * Math.PI) * 0.6
      for (const v of villagers) {
        v.position.y = 1.3 + jumpY
        v.rotation.y += 0.15
      }
    } else {
      for (let i = 0; i < villagers.length; i++) {
        const v = villagers[i]
        const vPhase = i * 1.5
        if (isRunning) {
          // 活跃处理中：小步跳动工作
          v.position.y = 1.3 + Math.abs(Math.sin(time * 6 + vPhase)) * 0.3
          v.rotation.y += 0.03
        } else {
          // 空闲状态：悠闲微摆
          v.position.y = 1.3
          v.rotation.y += Math.sin(time * 0.5 + vPhase) * 0.005
        }
      }
    }

    // D. 遍历所有生态景观要素进行周期性变换
    for (const elem of ecosystemElements) {
      const { object, kind, basePos, baseRot, phase, speed, orbitRadius, customParts } = elem

      switch (kind) {
        case 'tree': {
          // 海风吹拂：树冠微幅周期性摇曳
          const sway = Math.sin(time * speed + phase) * 0.05
          object.rotation.z = baseRot.z + sway
          object.rotation.x = baseRot.x + sway * 0.6
          break
        }

        case 'flower': {
          // 花海波浪舞动
          const fSway = Math.sin(time * speed + phase) * 0.07
          object.rotation.z = baseRot.z + fSway
          break
        }

        case 'sheep': {
          // 绵羊周期性低头吃草与抬头发呆
          if (customParts?.head) {
            const graze = Math.max(0, Math.sin(time * speed + phase)) * 0.35
            customParts.head.rotation.x = graze
          }
          break
        }

        case 'rabbit': {
          // 白兔周期性轻跳
          const hop = Math.max(0, Math.sin(time * speed + phase))
          object.position.y = basePos.y + hop * 0.22
          if (customParts?.ears) {
            customParts.ears.rotation.x = Math.sin(time * 5 + phase) * 0.15
          }
          break
        }

        case 'bird': {
          // 海鸟环岛巡弋飞行与展翅
          if (orbitRadius) {
            const angle = time * speed + phase
            object.position.x = Math.cos(angle) * orbitRadius
            object.position.z = Math.sin(angle) * orbitRadius
            object.position.y = basePos.y + Math.sin(time * 1.8 + phase) * 0.4
            // 鸟头面朝切线飞行方向
            object.rotation.y = -angle + Math.PI / 2
            // 左右扇翅
            if (customParts?.wingL && customParts?.wingR) {
              const flap = Math.sin(time * 10 + phase) * 0.38
              customParts.wingL.rotation.z = flap
              customParts.wingR.rotation.z = -flap
            }
          }
          break
        }

        case 'crystal': {
          // 水晶能量呼吸脉动（发光材质强度周期性呼吸）
          object.traverse((child) => {
            if ((child as THREE.Mesh).isMesh) {
              const mesh = child as THREE.Mesh
              if ((mesh.material as THREE.MeshStandardMaterial).emissiveIntensity !== undefined) {
                const mat = mesh.material as THREE.MeshStandardMaterial
                mat.emissiveIntensity = 0.5 + 0.45 * Math.sin(time * speed + phase)
              }
            }
          })
          break
        }

        case 'windmill': {
          // 风车风叶恒速旋转
          if (customParts?.blades) {
            customParts.blades.rotation.z += 0.02 * speed
          }
          break
        }

        case 'fire': {
          // 篝火火焰跳跃闪烁
          if (customParts?.flame) {
            const flameScale = 1.0 + Math.sin(time * speed + phase) * 0.25
            customParts.flame.scale.set(1.0, flameScale, 1.0)
          }
          break
        }

        case 'firefly': {
          // 萤火虫在微风中慢速漂浮浮游
          if (customParts?.particles) {
            for (let pIdx = 0; pIdx < customParts.particles.length; pIdx++) {
              const p = customParts.particles[pIdx]
              const pPhase = phase + pIdx * 1.2
              p.position.y = 1.2 + Math.sin(time * 2.2 + pPhase) * 0.4
              p.position.x += Math.sin(time * 1.1 + pPhase) * 0.006
              p.position.z += Math.cos(time * 1.1 + pPhase) * 0.006
            }
          }
          break
        }
      }
    }
  }

  return {
    rootGroup,
    islandMesh,
    lighthouseBeam,
    lighthouseBeamMaterial,
    fishingBobber,
    fishingVillager,
    villagers,
    trees,
    house,
    ecosystemElements,
    node,
    updateEcosystem,
    triggerJump,
    triggerLighthouseSweep,
  }
}

