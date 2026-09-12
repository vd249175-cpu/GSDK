import * as THREE from 'three'
import type { CausalNode3D, InspectItemData } from '../types'

export function tagObjectInspectData(obj: THREE.Object3D, data: InspectItemData): void {
  obj.userData.inspectData = data
  obj.userData.nodeId = data.nodeId
  obj.traverse((child) => {
    child.userData.inspectData = data
    child.userData.nodeId = data.nodeId
  })
}

export function createLandmarkInspectData(
  node: CausalNode3D,
  kind: 'lighthouse' | 'fishingPier' | 'house',
): InspectItemData {
  if (kind === 'lighthouse') {
    return {
      id: `lh-${node.id}`,
      nodeId: node.id,
      nodeName: node.name,
      itemType: 'lighthouse',
      itemName: '观察悬崖灯塔',
      itemIcon: '🔭',
      category: 'system_landmark',
      stateKey: 'role',
      stateValue: 'ObservationWorldNode',
      valueType: 'System Role',
      description: '物理世界感知端点。持续监听外部物理事实，封装为 Info 注入规则空间。零主动写操作；发生观察事实时向洋流发射 360° 探海光锥。',
    }
  }

  if (kind === 'fishingPier') {
    return {
      id: `pier-${node.id}`,
      nodeId: node.id,
      nodeName: node.name,
      itemType: 'fishingPier',
      itemName: '执行垂钓栈桥',
      itemIcon: '🎣',
      category: 'system_landmark',
      stateKey: 'role',
      stateValue: 'ExecutionWorldNode',
      valueType: 'System Role',
      description: '物理世界动作下发端点。向物理系统派发动作用以修改外部状态，动作结算即离，零持续监听职责。',
    }
  }

  const stateKeys = Object.keys(node.state || {})
  return {
    id: `house-${node.id}`,
    nodeId: node.id,
    nodeName: node.name,
    itemType: 'house',
    itemName: '聚落中心木屋',
    itemIcon: '🏡',
    category: 'system_landmark',
    stateKey: 'PureDomainCore',
    stateValue: `Owner State Root (${stateKeys.length} 个私有属性)`,
    valueType: 'Pure Domain',
    description: '纯领域核心状态机，零 I/O、零系统 API。State 只能由 Owner Node 在当前 change ctx 中写入。',
  }
}

export function createVillagerInspectData(
  node: CausalNode3D,
  villagerIndex: number,
): InspectItemData {
  return {
    id: `villager-${node.id}-${villagerIndex + 1}`,
    nodeId: node.id,
    nodeName: node.name,
    itemType: 'villager',
    itemName: `变迁岛民 #${villagerIndex + 1}`,
    itemIcon: '🧑‍🌾',
    category: 'change_villager',
    stateKey: `version: v${node.version}`,
    stateValue: {
      currentVersion: node.version,
      status: node.status,
      generation: node.generation,
      workerRole: `Change Agent #${villagerIndex + 1}`,
    },
    valueType: 'Change Agent',
    description: '因果变迁实体（一个小岛上有多少 change 就有多少岛民）。驱动该节点状态演进；微内核调度中跳动工作，变迁收敛时欢呼跳跃。',
  }
}

export function createStateFieldInspectData(
  node: CausalNode3D,
  key: string,
  val: unknown,
  itemType: 'crystal' | 'windmill' | 'crop' | 'campfire' | 'sheep' | 'mushroom' | 'rabbit' | 'flower' | 'rock',
): InspectItemData {
  if (itemType === 'crystal') {
    return {
      id: `crystal-${node.id}-${key}`,
      nodeId: node.id,
      nodeName: node.name,
      itemType: 'crystal',
      itemName: `数据水晶 · ${key}`,
      itemIcon: '💎',
      category: 'state_field',
      stateKey: key,
      stateValue: val,
      valueType: 'number',
      description: `数值状态属性 [${key}: ${val}]。水晶簇高度与发光律动由该数值确定性派生。`,
    }
  }

  if (itemType === 'windmill') {
    return {
      id: `windmill-${node.id}-${key}`,
      nodeId: node.id,
      nodeName: node.name,
      itemType: 'windmill',
      itemName: `动力风车 · ${key}`,
      itemIcon: '🌀',
      category: 'state_field',
      stateKey: key,
      stateValue: val,
      valueType: 'number',
      description: `数值状态属性 [${key}: ${val}]。风叶恒速旋转，象征持续运转的动态指标。`,
    }
  }

  if (itemType === 'crop') {
    return {
      id: `crop-${node.id}-${key}`,
      nodeId: node.id,
      nodeName: node.name,
      itemType: 'crop',
      itemName: `丰收菜园 · ${key}`,
      itemIcon: '🌾',
      category: 'state_field',
      stateKey: key,
      stateValue: val,
      valueType: 'number',
      description: `数值状态属性 [${key}: ${val}]。田垄上作物按数据丰产度排列生长。`,
    }
  }

  if (itemType === 'campfire') {
    return {
      id: `campfire-${node.id}-${key}`,
      nodeId: node.id,
      nodeName: node.name,
      itemType: 'campfire',
      itemName: `状态篝火 · ${key}`,
      itemIcon: '🔥',
      category: 'state_field',
      stateKey: key,
      stateValue: val,
      valueType: 'boolean',
      description: `布尔状态属性 [${key}: ${String(val)}]。${val ? '条件为真 (true)，营地火焰炽烈燃烧跳动！' : '条件为假 (false)，余烬微光静候点燃。'}`,
    }
  }

  if (itemType === 'sheep') {
    return {
      id: `sheep-${node.id}-${key}`,
      nodeId: node.id,
      nodeName: node.name,
      itemType: 'sheep',
      itemName: `生态绵羊 · ${key}`,
      itemIcon: '🐑',
      category: 'state_field',
      stateKey: key,
      stateValue: val,
      valueType: Array.isArray(val) ? 'Array' : 'Object',
      description: `集合/对象属性 [${key}]，包含 ${Array.isArray(val) ? val.length : Object.keys(val || {}).length} 项子元素。绵羊在岛上悠闲低头吃草。`,
    }
  }

  if (itemType === 'mushroom') {
    return {
      id: `mushroom-${node.id}-${key}`,
      nodeId: node.id,
      nodeName: node.name,
      itemType: 'mushroom',
      itemName: `仙女蘑菇环 · ${key}`,
      itemIcon: '🍄',
      category: 'state_field',
      stateKey: key,
      stateValue: val,
      valueType: Array.isArray(val) ? 'Array' : 'Object',
      description: `复合结构属性 [${key}]。彩色小蘑菇环绕生长，象征结构体内部的数据簇。`,
    }
  }

  if (itemType === 'rabbit') {
    return {
      id: `rabbit-${node.id}-${key}`,
      nodeId: node.id,
      nodeName: node.name,
      itemType: 'rabbit',
      itemName: `生机野兔 · ${key}`,
      itemIcon: '🐰',
      category: 'state_field',
      stateKey: key,
      stateValue: val,
      valueType: Array.isArray(val) ? 'Array' : 'Object',
      description: `复合结构属性 [${key}]。长耳小兔在岛上轻快跳跃。`,
    }
  }

  if (itemType === 'flower') {
    return {
      id: `flower-${node.id}-${key}`,
      nodeId: node.id,
      nodeName: node.name,
      itemType: 'flower',
      itemName: `绚丽花海 · ${key}`,
      itemIcon: '🌸',
      category: 'state_field',
      stateKey: key,
      stateValue: val,
      valueType: 'string',
      description: `文本状态属性 [${key}: "${String(val)}"]。彩瓣花海随海风起伏摇曳。`,
    }
  }

  return {
    id: `rock-${node.id}-${key}`,
    nodeId: node.id,
    nodeName: node.name,
    itemType: 'rock',
    itemName: `静态叠石 · ${key}`,
    itemIcon: '🪨',
    category: 'state_field',
    stateKey: key,
    stateValue: val,
    valueType: 'string',
    description: `静态文本属性 [${key}: "${String(val)}"]。稳固叠石象征不可变基础配置。`,
  }
}
