import * as THREE from 'three'
import type { CausalNode3D, InspectItemData } from './types'
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
import {
  EcosystemAnimator,
  type AnimatedEcosystemElement,
} from './ecosystem/ecosystem-animator'
import {
  tagObjectInspectData,
  createLandmarkInspectData,
  createVillagerInspectData,
  createStateFieldInspectData,
} from './ecosystem/state-inspector-mapper'

export type { AnimatedEcosystemElement }

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
  inspectableItems: InspectItemData[]
  node: CausalNode3D
  updateEcosystem: (time: number, isRunning: boolean) => void
  triggerJump: () => void
  triggerLighthouseSweep: () => void
}

/**
 * 纯图无关海岛生态生成器 (Graph-Agnostic Procedural Ecosystem & Island Generator)
 */
export function generateIslandAssembly(node: CausalNode3D): IslandVisualAssembly {
  const rootGroup = new THREE.Group()
  rootGroup.position.set(0, 0, 0)

  const seed = hashString(node.id)
  const rng = createPRNG(seed)

  const isHub = Boolean(node.isHub)
  const role = node.role || 'domain'
  const islandRadius = isHub ? 4.2 : 3.0

  const inspectableItems: InspectItemData[] = []

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
    const { group: lhGroup, beam, beamMaterial } = createLighthouseMesh()
    lhGroup.position.set(islandRadius * 0.42, 1.2, -islandRadius * 0.35)
    rootGroup.add(lhGroup)
    lighthouseBeam = beam
    lighthouseBeamMaterial = beamMaterial

    const lhItem = createLandmarkInspectData(node, 'lighthouse')
    tagObjectInspectData(lhGroup, lhItem)
    inspectableItems.push(lhItem)
  } else if (role === 'execution') {
    const { group: pierGroup, bobber, villager } = createFishingPierMesh()
    pierGroup.position.set(0, 0.2, islandRadius * 0.55)
    rootGroup.add(pierGroup)
    fishingBobber = bobber
    fishingVillager = villager

    const pierItem = createLandmarkInspectData(node, 'fishingPier')
    tagObjectInspectData(pierGroup, pierItem)
    inspectableItems.push(pierItem)
  } else {
    const stateKeys = Object.keys(node.state || {})
    if (stateKeys.length > 0 || isHub) {
      house = createVoxelHouse(seed)
      house.position.set(-0.2, 1.35, -0.3)
      rootGroup.add(house)

      const houseItem = createLandmarkInspectData(node, 'house')
      tagObjectInspectData(house, houseItem)
      inspectableItems.push(houseItem)
    }
  }

  // 3. 收集动态动画生态元素
  const ecosystemElements: AnimatedEcosystemElement[] = []
  const trees: THREE.Group[] = []

  let slotIndex = 0
  const totalSlots = 14
  function getNextSlotPos(minR = 0.38, maxR = 0.82): { x: number; z: number } {
    const angle = (slotIndex / totalSlots) * Math.PI * 2 + (rng() - 0.5) * 0.35
    slotIndex = (slotIndex + 3) % totalSlots
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

    const treeItem: InspectItemData = {
      id: `tree-${node.id}-${i + 1}`,
      nodeId: node.id,
      nodeName: node.name,
      itemType: 'tree',
      itemName: `天然林木 #${i + 1}`,
      itemIcon: '🌴',
      category: 'island_flora',
      stateKey: 'generation',
      stateValue: node.generation !== null ? `Gen ${node.generation}` : 'DROPPED',
      valueType: 'Ecosystem Flora',
      description: `扎根于海岛基盘的天然植被，随海风轻柔摇曳。当前代次 Gen ${node.generation}。`,
    }
    tagObjectInspectData(tree, treeItem)
    if (i === 0) inspectableItems.push(treeItem)

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

  // 5. 图无关 State 动态生态投影
  const stateEntries = Object.entries(node.state || {})

  if (stateEntries.length === 0) {
    const rock = createVoxelRockCairn(seed)
    const posR = getNextSlotPos()
    rock.position.set(posR.x, 1.2, posR.z)
    rootGroup.add(rock)

    const rkItem: InspectItemData = {
      id: `rock-${node.id}`,
      nodeId: node.id,
      nodeName: node.name,
      itemType: 'rock',
      itemName: '荒野叠石',
      itemIcon: '🪨',
      category: 'island_flora',
      stateKey: 'state',
      stateValue: '{} (空私有状态)',
      valueType: 'Empty State',
      description: '该海岛目前处于原生荒野状态，尚未写入私有 State 键值。',
    }
    tagObjectInspectData(rock, rkItem)
    inspectableItems.push(rkItem)

    const flowers = createVoxelFlowerPatch(seed, 4)
    const posF = getNextSlotPos()
    flowers.position.set(posF.x, 1.3, posF.z)
    rootGroup.add(flowers)

    const flItem: InspectItemData = {
      id: `flower-${node.id}`,
      nodeId: node.id,
      nodeName: node.name,
      itemType: 'flower',
      itemName: '野生自然花丛',
      itemIcon: '🌸',
      category: 'island_flora',
      stateKey: 'wildFlora',
      stateValue: 'Wild Flora',
      valueType: 'Flora',
      description: '海岛基盘上的野生花丛，随海风轻柔起伏。',
    }
    tagObjectInspectData(flowers, flItem)
    inspectableItems.push(flItem)

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

    const rbItem: InspectItemData = {
      id: `rabbit-${node.id}`,
      nodeId: node.id,
      nodeName: node.name,
      itemType: 'rabbit',
      itemName: '海岛原生萌兔',
      itemIcon: '🐰',
      category: 'island_flora',
      stateKey: 'fauna',
      stateValue: 'Wild Rabbit',
      valueType: 'Fauna',
      description: '野生像素小白兔，在空闲草地上自由跳跃嬉戏。',
    }
    tagObjectInspectData(bunny, rbItem)
    inspectableItems.push(rbItem)

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
    stateEntries.forEach(([key, val]) => {
      const entrySeed = hashString(`${node.id}::${key}`)
      const entryRng = createPRNG(entrySeed)
      const slot = getNextSlotPos()

      if (typeof val === 'number') {
        const choice = entrySeed % 3
        if (choice === 0) {
          const hScale = Math.min(1.6, Math.max(0.7, Math.log10(Math.max(1, Math.abs(val))) * 0.4 + 0.8))
          const crystal = createVoxelCrystalCluster(entrySeed, node.color, hScale)
          crystal.position.set(slot.x, 1.25, slot.z)
          rootGroup.add(crystal)

          const item = createStateFieldInspectData(node, key, val, 'crystal')
          tagObjectInspectData(crystal, item)
          inspectableItems.push(item)

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
          const { group: windmill, blades } = createVoxelWindmill(entrySeed)
          windmill.position.set(slot.x, 1.25, slot.z)
          rootGroup.add(windmill)

          const item = createStateFieldInspectData(node, key, val, 'windmill')
          tagObjectInspectData(windmill, item)
          inspectableItems.push(item)

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
          const crops = createVoxelCropPatch(entrySeed)
          crops.position.set(slot.x, 1.25, slot.z)
          rootGroup.add(crops)

          const item = createStateFieldInspectData(node, key, val, 'crop')
          tagObjectInspectData(crops, item)
          inspectableItems.push(item)
        }
      } else if (typeof val === 'boolean') {
        const { group: campfire, flame } = createVoxelCampfire(entrySeed, val)
        campfire.position.set(slot.x, 1.25, slot.z)
        rootGroup.add(campfire)

        const item = createStateFieldInspectData(node, key, val, 'campfire')
        tagObjectInspectData(campfire, item)
        inspectableItems.push(item)

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
        const choice = entrySeed % 3
        if (choice === 0) {
          const { group: sheep, head } = createVoxelSheep(entrySeed)
          sheep.position.set(slot.x, 1.3, slot.z)
          sheep.rotation.y = entryRng() * Math.PI * 2
          rootGroup.add(sheep)

          const item = createStateFieldInspectData(node, key, val, 'sheep')
          tagObjectInspectData(sheep, item)
          inspectableItems.push(item)

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

          const item = createStateFieldInspectData(node, key, val, 'mushroom')
          tagObjectInspectData(mushrooms, item)
          inspectableItems.push(item)
        } else {
          const { group: bunny, ears } = createVoxelRabbit(entrySeed)
          bunny.position.set(slot.x, 1.3, slot.z)
          bunny.rotation.y = entryRng() * Math.PI * 2
          rootGroup.add(bunny)

          const item = createStateFieldInspectData(node, key, val, 'rabbit')
          tagObjectInspectData(bunny, item)
          inspectableItems.push(item)

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
        const choice = entrySeed % 2
        if (choice === 0) {
          const flowers = createVoxelFlowerPatch(entrySeed, 4, node.color)
          flowers.position.set(slot.x, 1.3, slot.z)
          rootGroup.add(flowers)

          const item = createStateFieldInspectData(node, key, val, 'flower')
          tagObjectInspectData(flowers, item)
          inspectableItems.push(item)

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

          const item = createStateFieldInspectData(node, key, val, 'rock')
          tagObjectInspectData(rock, item)
          inspectableItems.push(item)
        }
      }
    })
  }

  // 6. 候鸟与萤火虫
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

  // 7. 生成变迁岛民
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

    const villagerItem = createVillagerInspectData(node, v)
    tagObjectInspectData(villager, villagerItem)
    inspectableItems.push(villagerItem)
  }

  // 8. 周期性生态动画执行器
  const animator = new EcosystemAnimator({
    elements: ecosystemElements,
    villagers,
    lighthouseBeam,
    lighthouseBeamMaterial,
    fishingBobber,
    fishingVillager,
  })

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
    inspectableItems,
    node,
    updateEcosystem: (time, isRunning) => animator.update(time, isRunning),
    triggerJump: () => animator.triggerJump(),
    triggerLighthouseSweep: () => animator.triggerLighthouseSweep(),
  }
}
