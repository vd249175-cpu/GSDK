import * as THREE from 'three'

/**
 * 快速确定性伪随机数发生器 (Mulberry32)
 */
export function createPRNG(seed: number) {
  let s = seed | 0
  return function next(): number {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function hashString(str: string): number {
  let hash = 5381
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i)
  }
  return hash >>> 0
}

// 共享材质缓存，避免海量材质实例造成 DrawCall 瓶颈
const sharedMaterials = {
  sand: new THREE.MeshStandardMaterial({ color: 0xf6d7b0, roughness: 0.9 }),
  grass: new THREE.MeshStandardMaterial({ color: 0x55a630, roughness: 0.8 }),
  dirt: new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.9 }),
  stone: new THREE.MeshStandardMaterial({ color: 0x78716c, roughness: 0.7 }),
  stoneMoss: new THREE.MeshStandardMaterial({ color: 0x576b50, roughness: 0.8 }),
  wood: new THREE.MeshStandardMaterial({ color: 0x92400e, roughness: 0.8 }),
  woodPlank: new THREE.MeshStandardMaterial({ color: 0xb45309, roughness: 0.7 }),
  whiteVoxel: new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.6 }),
  redVoxel: new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.6 }),
  yellowVoxel: new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.5 }),
  orangeVoxel: new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.6 }),
  cyanVoxel: new THREE.MeshStandardMaterial({ color: 0x06b6d4, roughness: 0.5 }),
  purpleVoxel: new THREE.MeshStandardMaterial({ color: 0xa855f7, roughness: 0.5 }),
  pinkVoxel: new THREE.MeshStandardMaterial({ color: 0xec4899, roughness: 0.5 }),
  waterShallow: new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.65 }),
  foliageGreen: new THREE.MeshStandardMaterial({ color: 0x22c55e, roughness: 0.8 }),
  foliageDark: new THREE.MeshStandardMaterial({ color: 0x15803d, roughness: 0.8 }),
  foliageAutumn: new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.8 }),
  foliageCherry: new THREE.MeshStandardMaterial({ color: 0xf472b6, roughness: 0.8 }),
  villagerSkin: new THREE.MeshStandardMaterial({ color: 0xfbcfe8, roughness: 0.6 }),
  villagerShirt: new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.7 }),
  villagerPants: new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.8 }),
  strawHat: new THREE.MeshStandardMaterial({ color: 0xfde047, roughness: 0.9 }),
  sailCloth: new THREE.MeshStandardMaterial({ color: 0xfffbeb, roughness: 0.4 }),
  lanternLight: new THREE.MeshBasicMaterial({ color: 0xfef08a }),
  crystalCyan: new THREE.MeshStandardMaterial({
    color: 0x22d3ee,
    emissive: 0x06b6d4,
    emissiveIntensity: 0.75,
    roughness: 0.2,
    metalness: 0.4,
  }),
  crystalGold: new THREE.MeshStandardMaterial({
    color: 0xfbbf24,
    emissive: 0xd97706,
    emissiveIntensity: 0.75,
    roughness: 0.2,
    metalness: 0.4,
  }),
  crystalPurple: new THREE.MeshStandardMaterial({
    color: 0xc084fc,
    emissive: 0x9333ea,
    emissiveIntensity: 0.75,
    roughness: 0.2,
    metalness: 0.4,
  }),
  sheepWool: new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.9 }),
  sheepFace: new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.8 }),
  bunnyWhite: new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.8 }),
  bunnyEars: new THREE.MeshStandardMaterial({ color: 0xfbcfe8, roughness: 0.7 }),
  fireFlame: new THREE.MeshBasicMaterial({ color: 0xf97316 }),
  fireSparks: new THREE.MeshBasicMaterial({ color: 0xfde047 }),
  beaconBeam: new THREE.MeshBasicMaterial({
    color: 0xfef08a,
    transparent: true,
    opacity: 0.35,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }),
}

/**
 * 1. 体素小岛基盘生成
 */
export function createVoxelIslandMesh(radius: number, seed: number, primaryColor: string): THREE.Group {
  const group = new THREE.Group()
  const rng = createPRNG(seed)

  // 水下坚实基岩海床 (Submerged Bedrock Base - 沉于水下扎根海床，杜绝浮碟空悬感)
  const bedrockGeo = new THREE.CylinderGeometry(radius * 1.15, radius * 0.9, 1.2, 14)
  const bedrockMesh = new THREE.Mesh(bedrockGeo, sharedMaterials.stone)
  bedrockMesh.position.y = -0.55
  group.add(bedrockMesh)

  // 浅水环礁海岸 (Reef / Shore Ring)
  const reefGeo = new THREE.CylinderGeometry(radius * 1.25, radius * 1.35, 0.35, 16)
  const reefMesh = new THREE.Mesh(reefGeo, sharedMaterials.waterShallow)
  reefMesh.position.y = 0.05
  group.add(reefMesh)

  // 沙滩底层 (Sand Tier)
  const sandGeo = new THREE.CylinderGeometry(radius * 1.1, radius * 1.2, 0.5, 14)
  const sandMesh = new THREE.Mesh(sandGeo, sharedMaterials.sand)
  sandMesh.position.y = 0.25
  group.add(sandMesh)

  // 草甸主地块 (Grass Main Land)
  const grassMat = primaryColor
    ? new THREE.MeshStandardMaterial({ color: new THREE.Color(primaryColor).lerp(new THREE.Color(0x38a169), 0.5), roughness: 0.8 })
    : sharedMaterials.grass
  const grassGeo = new THREE.CylinderGeometry(radius * 0.95, radius * 1.05, 0.8, 12)
  const grassMesh = new THREE.Mesh(grassGeo, grassMat)
  grassMesh.position.y = 0.85
  group.add(grassMesh)

  // 随机小土丘/高地 (Elevation Bump)
  const bumpCount = 1 + Math.floor(rng() * 3)
  for (let i = 0; i < bumpCount; i++) {
    const bRadius = radius * (0.28 + rng() * 0.22)
    const bAngle = rng() * Math.PI * 2
    const bDist = radius * 0.4 * rng()
    const bumpGeo = new THREE.CylinderGeometry(bRadius * 0.8, bRadius, 0.6, 8)
    const bump = new THREE.Mesh(bumpGeo, grassMat)
    bump.position.set(Math.cos(bAngle) * bDist, 1.4, Math.sin(bAngle) * bDist)
    group.add(bump)
  }

  return group
}

/**
 * 2. 像素灯塔（观察节点专有建筑）
 */
export function createLighthouseMesh(): {
  group: THREE.Group
  beam: THREE.Mesh
  beamMesh: THREE.Mesh
  beamMaterial: THREE.MeshBasicMaterial
} {
  const group = new THREE.Group()

  // 基石
  const baseGeo = new THREE.BoxGeometry(1.6, 0.6, 1.6)
  const base = new THREE.Mesh(baseGeo, sharedMaterials.stone)
  base.position.y = 0.3
  group.add(base)

  // 塔身分层（红白相间像素体素）
  const layerCount = 5
  const towerHeight = 0.8
  for (let i = 0; i < layerCount; i++) {
    const bottomR = 0.7 - i * 0.07
    const topR = 0.63 - i * 0.07
    const layerGeo = new THREE.CylinderGeometry(topR, bottomR, towerHeight, 8)
    const mat = i % 2 === 0 ? sharedMaterials.whiteVoxel : sharedMaterials.redVoxel
    const layer = new THREE.Mesh(layerGeo, mat)
    layer.position.y = 0.6 + i * towerHeight + towerHeight / 2
    group.add(layer)
  }

  // 瞭望平台与护栏
  const platformY = 0.6 + layerCount * towerHeight
  const platformGeo = new THREE.CylinderGeometry(0.85, 0.85, 0.15, 8)
  const platform = new THREE.Mesh(platformGeo, sharedMaterials.stone)
  platform.position.y = platformY
  group.add(platform)

  // 灯室玻璃与光源核心
  const lanternRoomGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.6, 8)
  const lanternRoom = new THREE.Mesh(lanternRoomGeo, sharedMaterials.lanternLight)
  lanternRoom.position.y = platformY + 0.38
  group.add(lanternRoom)

  // 灯塔圆顶
  const roofGeo = new THREE.ConeGeometry(0.65, 0.5, 8)
  const roof = new THREE.Mesh(roofGeo, sharedMaterials.redVoxel)
  roof.position.y = platformY + 0.9
  group.add(roof)

  // 探海光锥旋转枢轴 (Lantern Room Pivot)
  const beamPivot = new THREE.Group()
  beamPivot.position.set(0, platformY + 0.38, 0)

  const beamLength = 22.0
  const beamGeo = new THREE.ConeGeometry(4.2, beamLength, 16, 1, true)
  // 将锥体顶点精准平移至原点 (0, 0, 0)
  beamGeo.translate(0, -beamLength / 2, 0)
  // 将锥体旋转至沿 +Z 轴水平向外照射
  beamGeo.rotateX(-Math.PI / 2)

  // 独立光锥材质：默认静默不放光，仅在发生观察事实时动态亮起扫海
  const beamMaterial = new THREE.MeshBasicMaterial({
    color: 0xfef08a,
    transparent: true,
    opacity: 0.0,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    visible: false,
  })

  const beamMesh = new THREE.Mesh(beamGeo, beamMaterial)
  beamPivot.add(beamMesh)
  group.add(beamPivot)

  return { group, beam: beamPivot as unknown as THREE.Mesh, beamMesh, beamMaterial }
}

/**
 * 3. 垂钓码头（操作执行节点专有建筑）
 */
export function createFishingPierMesh(): { group: THREE.Group; bobber: THREE.Mesh; villager: THREE.Group } {
  const group = new THREE.Group()

  // 伸入水中的木栈桥
  const plankLength = 4.2
  const plankWidth = 1.3
  const pierGeo = new THREE.BoxGeometry(plankWidth, 0.16, plankLength)
  const pier = new THREE.Mesh(pierGeo, sharedMaterials.woodPlank)
  pier.position.set(0, 0.6, plankLength / 2)
  group.add(pier)

  // 栈桥支柱（扎入水中）
  const postGeo = new THREE.CylinderGeometry(0.12, 0.12, 1.4, 6)
  const p1 = new THREE.Mesh(postGeo, sharedMaterials.wood)
  p1.position.set(-plankWidth / 2 + 0.15, -0.1, plankLength - 0.3)
  group.add(p1)

  const p2 = new THREE.Mesh(postGeo, sharedMaterials.wood)
  p2.position.set(plankWidth / 2 - 0.15, -0.1, plankLength - 0.3)
  group.add(p2)

  // 垂钓小人（坐在栈桥末端）
  const villager = createVoxelVillager(true)
  villager.position.set(0, 0.68, plankLength - 0.4)
  villager.rotation.y = 0
  group.add(villager)

  // 鱼竿与鱼线
  const rodGeo = new THREE.CylinderGeometry(0.04, 0.06, 2.4, 4)
  const rod = new THREE.Mesh(rodGeo, sharedMaterials.wood)
  rod.position.set(0.3, 1.35, plankLength + 0.5)
  rod.rotation.x = Math.PI / 3.5
  group.add(rod)

  // 水面鱼浮 (Bobber)
  const bobberGeo = new THREE.SphereGeometry(0.18, 6, 6)
  const bobberMat = new THREE.MeshBasicMaterial({ color: 0xef4444 })
  const bobber = new THREE.Mesh(bobberGeo, bobberMat)
  bobber.position.set(0.3, 0.15, plankLength + 2.0)
  group.add(bobber)

  return { group, bobber, villager }
}

/**
 * 4. 像素体素小人 (Villager)
 */
export function createVoxelVillager(isFisher = false): THREE.Group {
  const group = new THREE.Group()

  // 身体/衣服
  const bodyGeo = new THREE.BoxGeometry(0.5, 0.6, 0.35)
  const body = new THREE.Mesh(bodyGeo, isFisher ? sharedMaterials.villagerShirt : sharedMaterials.villagerShirt)
  body.position.y = 0.55
  group.add(body)

  // 裤子/双腿
  const legGeo = new THREE.BoxGeometry(0.46, 0.4, 0.32)
  const legs = new THREE.Mesh(legGeo, sharedMaterials.villagerPants)
  legs.position.y = 0.2
  group.add(legs)

  // 头部
  const headGeo = new THREE.BoxGeometry(0.42, 0.42, 0.42)
  const head = new THREE.Mesh(headGeo, sharedMaterials.villagerSkin)
  head.position.y = 1.05
  group.add(head)

  // 帽子（垂钓者草帽，普通岛民棕发）
  if (isFisher) {
    const hatBrimGeo = new THREE.CylinderGeometry(0.55, 0.55, 0.08, 8)
    const hatBrim = new THREE.Mesh(hatBrimGeo, sharedMaterials.strawHat)
    hatBrim.position.y = 1.28
    group.add(hatBrim)

    const hatTopGeo = new THREE.CylinderGeometry(0.32, 0.38, 0.24, 8)
    const hatTop = new THREE.Mesh(hatTopGeo, sharedMaterials.strawHat)
    hatTop.position.y = 1.4
    group.add(hatTop)
  } else {
    const hairGeo = new THREE.BoxGeometry(0.44, 0.15, 0.44)
    const hair = new THREE.Mesh(hairGeo, sharedMaterials.dirt)
    hair.position.y = 1.26
    group.add(hair)
  }

  group.scale.set(0.85, 0.85, 0.85)
  return group
}

/**
 * 5. 像素体素树木（根据种子生成棕榈树、橡树或松树）
 */
export function createVoxelTree(type: 'palm' | 'pine' | 'oak', seed: number): THREE.Group {
  const group = new THREE.Group()
  const rng = createPRNG(seed)

  if (type === 'palm') {
    // 弯曲的棕榈树干
    const trunkHeight = 2.4 + rng() * 0.8
    const trunkSegments = 5
    let curX = 0, curZ = 0, curY = 0
    const leanX = (rng() - 0.5) * 0.4
    const leanZ = (rng() - 0.5) * 0.4

    for (let i = 0; i < trunkSegments; i++) {
      const segH = trunkHeight / trunkSegments
      const trunkGeo = new THREE.BoxGeometry(0.26 - i * 0.02, segH, 0.26 - i * 0.02)
      const trunkMesh = new THREE.Mesh(trunkGeo, sharedMaterials.wood)
      trunkMesh.position.set(curX, curY + segH / 2, curZ)
      group.add(trunkMesh)
      curX += leanX
      curZ += leanZ
      curY += segH
    }

    // 4 片体素棕榈叶
    const leavesCount = 4
    for (let k = 0; k < leavesCount; k++) {
      const leafAngle = (k / leavesCount) * Math.PI * 2
      const leafGeo = new THREE.BoxGeometry(1.4, 0.12, 0.6)
      const leaf = new THREE.Mesh(leafGeo, sharedMaterials.foliageGreen)
      leaf.position.set(curX + Math.cos(leafAngle) * 0.7, curY, curZ + Math.sin(leafAngle) * 0.7)
      leaf.rotation.y = leafAngle
      leaf.rotation.z = 0.25
      group.add(leaf)
    }
  } else if (type === 'pine') {
    // 松树（分层圆锥体素）
    const trunkGeo = new THREE.CylinderGeometry(0.18, 0.24, 1.4, 6)
    const trunk = new THREE.Mesh(trunkGeo, sharedMaterials.wood)
    trunk.position.y = 0.7
    group.add(trunk)

    for (let i = 0; i < 3; i++) {
      const fGeo = new THREE.ConeGeometry(1.3 - i * 0.35, 1.1, 7)
      const foliage = new THREE.Mesh(fGeo, sharedMaterials.foliageDark)
      foliage.position.y = 1.3 + i * 0.75
      group.add(foliage)
    }
  } else {
    // 橡树/果树
    const trunkGeo = new THREE.CylinderGeometry(0.2, 0.26, 1.3, 6)
    const trunk = new THREE.Mesh(trunkGeo, sharedMaterials.wood)
    trunk.position.y = 0.65
    group.add(trunk)

    const fGeo = new THREE.DodecahedronGeometry(1.15, 0)
    const foliage = new THREE.Mesh(fGeo, rng() > 0.3 ? sharedMaterials.foliageGreen : sharedMaterials.foliageAutumn)
    foliage.position.y = 1.9
    group.add(foliage)
  }

  return group
}

/**
 * 6. 像素小木屋 / 仓库
 */
export function createVoxelHouse(seed: number): THREE.Group {
  const group = new THREE.Group()
  const rng = createPRNG(seed)

  // 房屋主体
  const bodyW = 1.6 + rng() * 0.4
  const bodyH = 1.2
  const bodyD = 1.4
  const houseBodyGeo = new THREE.BoxGeometry(bodyW, bodyH, bodyD)
  const houseBody = new THREE.Mesh(houseBodyGeo, sharedMaterials.woodPlank)
  houseBody.position.y = bodyH / 2
  group.add(houseBody)

  // 屋顶（斜切体素屋顶）
  const roofGeo = new THREE.ConeGeometry(bodyW * 0.85, 0.9, 4)
  const roof = new THREE.Mesh(roofGeo, sharedMaterials.redVoxel)
  roof.position.y = bodyH + 0.45
  roof.rotation.y = Math.PI / 4
  group.add(roof)

  // 门
  const doorGeo = new THREE.BoxGeometry(0.45, 0.7, 0.1)
  const door = new THREE.Mesh(doorGeo, sharedMaterials.wood)
  door.position.set(0, 0.35, bodyD / 2 + 0.05)
  group.add(door)

  // 烟囱
  const chimneyGeo = new THREE.BoxGeometry(0.3, 0.6, 0.3)
  const chimney = new THREE.Mesh(chimneyGeo, sharedMaterials.stone)
  chimney.position.set(bodyW * 0.3, bodyH + 0.5, 0)
  group.add(chimney)

  return group
}

/**
 * 7. 航海帆船（代替原有光子粒子，承载真实 ctx.send 消息航行）
 */
export function createVoxelBoat(infoType: string, color: string): THREE.Group {
  const group = new THREE.Group()

  // 船体（尖头小木船）
  const hullGeo = new THREE.BoxGeometry(0.8, 0.4, 1.8)
  const hull = new THREE.Mesh(hullGeo, sharedMaterials.woodPlank)
  hull.position.y = 0.2
  group.add(hull)

  // 船首尖锥
  const bowGeo = new THREE.ConeGeometry(0.48, 0.7, 4)
  const bow = new THREE.Mesh(bowGeo, sharedMaterials.woodPlank)
  bow.position.set(0, 0.2, 1.1)
  bow.rotation.x = Math.PI / 2
  bow.rotation.y = Math.PI / 4
  group.add(bow)

  // 桅杆
  const mastGeo = new THREE.CylinderGeometry(0.05, 0.06, 1.8, 4)
  const mast = new THREE.Mesh(mastGeo, sharedMaterials.wood)
  mast.position.set(0, 1.1, 0)
  group.add(mast)

  // 白帆
  const sailGeo = new THREE.BoxGeometry(0.04, 1.1, 0.9)
  const sailMat = new THREE.MeshStandardMaterial({
    color: color ? new THREE.Color(color) : new THREE.Color(0xfffbeb),
    roughness: 0.5,
  })
  const sail = new THREE.Mesh(sailGeo, sailMat)
  sail.position.set(0, 1.2, 0.2)
  sail.rotation.y = 0.25 // 迎风迎角
  group.add(sail)

  // 桅杆顶部小旗帜
  const flagGeo = new THREE.BoxGeometry(0.02, 0.22, 0.4)
  const flagMat = new THREE.MeshBasicMaterial({ color: 0xef4444 })
  const flag = new THREE.Mesh(flagGeo, flagMat)
  flag.position.set(0, 1.9, -0.2)
  group.add(flag)

  group.scale.set(0.9, 0.9, 0.9)
  return group
}

/**
 * 8. 花丛与植被地被 (Flower Patch)
 */
export function createVoxelFlowerPatch(seed: number, count = 4, primaryColor?: string): THREE.Group {
  const group = new THREE.Group()
  const rng = createPRNG(seed)
  const petalMats = [
    sharedMaterials.redVoxel,
    sharedMaterials.yellowVoxel,
    sharedMaterials.pinkVoxel,
    sharedMaterials.purpleVoxel,
    sharedMaterials.cyanVoxel,
    sharedMaterials.whiteVoxel,
  ]

  const stemGeo = new THREE.BoxGeometry(0.04, 0.35, 0.04)
  const stemMat = sharedMaterials.foliageDark
  const petalGeo = new THREE.BoxGeometry(0.18, 0.16, 0.18)

  for (let i = 0; i < count; i++) {
    const fGroup = new THREE.Group()
    const stem = new THREE.Mesh(stemGeo, stemMat)
    stem.position.y = 0.17
    fGroup.add(stem)

    const mat = primaryColor
      ? new THREE.MeshStandardMaterial({ color: primaryColor, roughness: 0.5 })
      : petalMats[Math.floor(rng() * petalMats.length)]
    const petal = new THREE.Mesh(petalGeo, mat)
    petal.position.y = 0.38
    fGroup.add(petal)

    const angle = rng() * Math.PI * 2
    const dist = rng() * 0.65
    fGroup.position.set(Math.cos(angle) * dist, 0, Math.sin(angle) * dist)
    fGroup.rotation.y = rng() * Math.PI * 2
    fGroup.scale.setScalar(0.7 + rng() * 0.5)
    group.add(fGroup)
  }

  return group
}

/**
 * 9. 奇幻蘑菇圈 (Mushroom Cluster)
 */
export function createVoxelMushroomCluster(seed: number): THREE.Group {
  const group = new THREE.Group()
  const rng = createPRNG(seed)
  const mCount = 2 + Math.floor(rng() * 3)

  for (let i = 0; i < mCount; i++) {
    const m = new THREE.Group()
    const h = 0.3 + rng() * 0.3
    const stemGeo = new THREE.CylinderGeometry(0.08, 0.1, h, 6)
    const stem = new THREE.Mesh(stemGeo, sharedMaterials.whiteVoxel)
    stem.position.y = h / 2
    m.add(stem)

    const capR = 0.25 + rng() * 0.15
    const capGeo = new THREE.ConeGeometry(capR, 0.25, 6)
    const capMat = rng() > 0.4 ? sharedMaterials.redVoxel : sharedMaterials.cyanVoxel
    const cap = new THREE.Mesh(capGeo, capMat)
    cap.position.y = h + 0.12
    m.add(cap)

    const angle = (i / mCount) * Math.PI * 2 + rng() * 0.4
    const dist = 0.3 + rng() * 0.4
    m.position.set(Math.cos(angle) * dist, 0, Math.sin(angle) * dist)
    group.add(m)
  }

  return group
}

/**
 * 10. 耕地菜园 (Crop Patch)
 */
export function createVoxelCropPatch(seed: number): THREE.Group {
  const group = new THREE.Group()
  const rng = createPRNG(seed)

  // 耕垄泥土
  const soilGeo = new THREE.BoxGeometry(1.4, 0.12, 1.4)
  const soil = new THREE.Mesh(soilGeo, sharedMaterials.dirt)
  soil.position.y = 0.06
  group.add(soil)

  // 作物幼苗/南瓜/胡萝卜
  const cropRows = 3
  const isPumpkin = rng() > 0.5
  for (let r = 0; r < cropRows; r++) {
    for (let c = 0; c < cropRows; c++) {
      if (rng() > 0.2) {
        const crop = new THREE.Mesh(
          new THREE.BoxGeometry(0.2, 0.2, 0.2),
          isPumpkin ? sharedMaterials.orangeVoxel : sharedMaterials.foliageGreen,
        )
        crop.position.set(-0.45 + r * 0.45, 0.2, -0.45 + c * 0.45)
        crop.rotation.y = rng() * Math.PI
        group.add(crop)
      }
    }
  }

  return group
}

/**
 * 11. 像素体素绵羊 (Voxel Sheep)
 */
export function createVoxelSheep(seed: number): { group: THREE.Group; head: THREE.Group } {
  const group = new THREE.Group()
  const rng = createPRNG(seed)

  // 羊毛身躯
  const bodyGeo = new THREE.BoxGeometry(0.7, 0.55, 0.9)
  const body = new THREE.Mesh(bodyGeo, sharedMaterials.sheepWool)
  body.position.y = 0.55
  group.add(body)

  // 4 条深色羊腿
  const legGeo = new THREE.BoxGeometry(0.14, 0.32, 0.14)
  const legOffsets = [
    [-0.22, 0.16, -0.3],
    [0.22, 0.16, -0.3],
    [-0.22, 0.16, 0.3],
    [0.22, 0.16, 0.3],
  ]
  for (const [lx, ly, lz] of legOffsets) {
    const leg = new THREE.Mesh(legGeo, sharedMaterials.sheepFace)
    leg.position.set(lx, ly, lz)
    group.add(leg)
  }

  // 羊头 (带下探吃草关节)
  const head = new THREE.Group()
  const headGeo = new THREE.BoxGeometry(0.36, 0.36, 0.38)
  const headMesh = new THREE.Mesh(headGeo, sharedMaterials.sheepFace)
  head.add(headMesh)

  // 羊头顶白毛
  const headWoolGeo = new THREE.BoxGeometry(0.36, 0.16, 0.24)
  const headWool = new THREE.Mesh(headWoolGeo, sharedMaterials.sheepWool)
  headWool.position.set(0, 0.22, -0.06)
  head.add(headWool)

  head.position.set(0, 0.72, 0.52)
  group.add(head)

  group.scale.setScalar(0.75)
  return { group, head }
}

/**
 * 12. 像素体素白兔 (Voxel Rabbit)
 */
export function createVoxelRabbit(seed: number): { group: THREE.Group; ears: THREE.Group } {
  const group = new THREE.Group()
  const rng = createPRNG(seed)

  // 兔身
  const bodyGeo = new THREE.BoxGeometry(0.32, 0.3, 0.42)
  const body = new THREE.Mesh(bodyGeo, sharedMaterials.bunnyWhite)
  body.position.y = 0.22
  group.add(body)

  // 兔头
  const headGeo = new THREE.BoxGeometry(0.24, 0.24, 0.24)
  const head = new THREE.Mesh(headGeo, sharedMaterials.bunnyWhite)
  head.position.set(0, 0.38, 0.2)
  group.add(head)

  // 两只长耳朵
  const ears = new THREE.Group()
  const earGeo = new THREE.BoxGeometry(0.06, 0.28, 0.04)
  const earL = new THREE.Mesh(earGeo, sharedMaterials.bunnyEars)
  earL.position.set(-0.08, 0.14, 0)
  ears.add(earL)
  const earR = new THREE.Mesh(earGeo, sharedMaterials.bunnyEars)
  earR.position.set(0.08, 0.14, 0)
  ears.add(earR)
  ears.position.set(0, 0.48, 0.18)
  group.add(ears)

  // 小尾巴
  const tailGeo = new THREE.BoxGeometry(0.1, 0.1, 0.1)
  const tail = new THREE.Mesh(tailGeo, sharedMaterials.bunnyWhite)
  tail.position.set(0, 0.24, -0.24)
  group.add(tail)

  group.scale.setScalar(0.65)
  return { group, ears }
}

/**
 * 13. 海鸥与候鸟 (Voxel Bird)
 */
export function createVoxelBird(seed: number): { group: THREE.Group; wingL: THREE.Mesh; wingR: THREE.Mesh } {
  const group = new THREE.Group()

  // 鸟身
  const bodyGeo = new THREE.BoxGeometry(0.2, 0.18, 0.5)
  const body = new THREE.Mesh(bodyGeo, sharedMaterials.whiteVoxel)
  group.add(body)

  // 黄色鸟喙
  const beakGeo = new THREE.BoxGeometry(0.08, 0.06, 0.16)
  const beak = new THREE.Mesh(beakGeo, sharedMaterials.yellowVoxel)
  beak.position.set(0, -0.02, 0.3)
  group.add(beak)

  // 左右翅膀
  const wingGeo = new THREE.BoxGeometry(0.42, 0.04, 0.25)
  const wingL = new THREE.Mesh(wingGeo, sharedMaterials.whiteVoxel)
  wingL.position.set(-0.25, 0.04, 0)
  group.add(wingL)

  const wingR = new THREE.Mesh(wingGeo, sharedMaterials.whiteVoxel)
  wingR.position.set(0.25, 0.04, 0)
  group.add(wingR)

  group.scale.setScalar(0.6)
  return { group, wingL, wingR }
}

/**
 * 14. 状态水晶簇 (State Crystal Spire)
 */
export function createVoxelCrystalCluster(seed: number, primaryColor?: string, scale = 1.0): THREE.Group {
  const group = new THREE.Group()
  const rng = createPRNG(seed)
  const mats = [sharedMaterials.crystalCyan, sharedMaterials.crystalGold, sharedMaterials.crystalPurple]
  const mat = primaryColor
    ? new THREE.MeshStandardMaterial({
        color: primaryColor,
        emissive: primaryColor,
        emissiveIntensity: 0.8,
        roughness: 0.2,
        metalness: 0.5,
      })
    : mats[Math.floor(rng() * mats.length)]

  const spireCount = 2 + Math.floor(rng() * 3)
  for (let i = 0; i < spireCount; i++) {
    const h = (1.2 + rng() * 1.4) * scale
    const r = (0.22 + rng() * 0.12) * scale
    const spireGeo = new THREE.ConeGeometry(r, h, 5)
    const spire = new THREE.Mesh(spireGeo, mat)
    const angle = (i / spireCount) * Math.PI * 2 + rng() * 0.3
    const dist = (0.2 + rng() * 0.35) * scale
    spire.position.set(Math.cos(angle) * dist, h / 2, Math.sin(angle) * dist)
    spire.rotation.x = (rng() - 0.5) * 0.35
    spire.rotation.z = (rng() - 0.5) * 0.35
    group.add(spire)
  }

  return group
}

/**
 * 15. 苔藓叠石石堆 (Mossy Rock Cairn)
 */
export function createVoxelRockCairn(seed: number): THREE.Group {
  const group = new THREE.Group()
  const rng = createPRNG(seed)

  const baseGeo = new THREE.DodecahedronGeometry(0.65 + rng() * 0.2, 0)
  const baseRock = new THREE.Mesh(baseGeo, sharedMaterials.stone)
  baseRock.position.y = 0.5
  group.add(baseRock)

  const topGeo = new THREE.DodecahedronGeometry(0.42 + rng() * 0.15, 0)
  const topRock = new THREE.Mesh(topGeo, sharedMaterials.stoneMoss)
  topRock.position.set((rng() - 0.5) * 0.2, 1.1, (rng() - 0.5) * 0.2)
  group.add(topRock)

  return group
}

/**
 * 16. 篝火营地 (Campfire)
 */
export function createVoxelCampfire(seed: number, isLit = true): { group: THREE.Group; flame?: THREE.Mesh } {
  const group = new THREE.Group()
  const rng = createPRNG(seed)

  // 石头围圈
  const stoneCount = 6
  const stoneGeo = new THREE.BoxGeometry(0.18, 0.14, 0.18)
  for (let i = 0; i < stoneCount; i++) {
    const sAngle = (i / stoneCount) * Math.PI * 2
    const stone = new THREE.Mesh(stoneGeo, sharedMaterials.stone)
    stone.position.set(Math.cos(sAngle) * 0.45, 0.08, Math.sin(sAngle) * 0.45)
    group.add(stone)
  }

  // 交叉柴火木
  const logGeo = new THREE.BoxGeometry(0.1, 0.1, 0.6)
  const log1 = new THREE.Mesh(logGeo, sharedMaterials.wood)
  log1.position.y = 0.12
  log1.rotation.y = Math.PI / 4
  group.add(log1)

  const log2 = new THREE.Mesh(logGeo, sharedMaterials.wood)
  log2.position.y = 0.12
  log2.rotation.y = -Math.PI / 4
  group.add(log2)

  let flame: THREE.Mesh | undefined
  if (isLit) {
    const flameGeo = new THREE.ConeGeometry(0.24, 0.55, 5)
    flame = new THREE.Mesh(flameGeo, sharedMaterials.fireFlame)
    flame.position.y = 0.42
    group.add(flame)
  }

  return { group, flame }
}

/**
 * 17. 旋转木风车 (Windmill)
 */
export function createVoxelWindmill(seed: number): { group: THREE.Group; blades: THREE.Group } {
  const group = new THREE.Group()

  // 塔身
  const towerGeo = new THREE.CylinderGeometry(0.45, 0.65, 2.2, 6)
  const tower = new THREE.Mesh(towerGeo, sharedMaterials.woodPlank)
  tower.position.y = 1.1
  group.add(tower)

  // 圆锥屋顶
  const roofGeo = new THREE.ConeGeometry(0.65, 0.6, 6)
  const roof = new THREE.Mesh(roofGeo, sharedMaterials.redVoxel)
  roof.position.y = 2.4
  group.add(roof)

  // 4 叶风车轮扇
  const blades = new THREE.Group()
  const bladeGeo = new THREE.BoxGeometry(0.14, 1.2, 0.04)
  for (let b = 0; b < 4; b++) {
    const blade = new THREE.Mesh(bladeGeo, sharedMaterials.whiteVoxel)
    blade.position.y = 0.55
    blade.rotation.z = (b * Math.PI) / 2
    blades.add(blade)
  }
  blades.position.set(0, 2.0, 0.5)
  group.add(blades)

  group.scale.setScalar(0.85)
  return { group, blades }
}

/**
 * 18. 飞舞萤火虫 / 幻彩微光粒 (Fireflies)
 */
export function createVoxelFireflies(seed: number, count = 5): { group: THREE.Group; particles: THREE.Mesh[] } {
  const group = new THREE.Group()
  const rng = createPRNG(seed)
  const pGeo = new THREE.BoxGeometry(0.1, 0.1, 0.1)
  const pMat = new THREE.MeshBasicMaterial({ color: 0xfef08a })
  const particles: THREE.Mesh[] = []

  for (let i = 0; i < count; i++) {
    const p = new THREE.Mesh(pGeo, pMat)
    const angle = rng() * Math.PI * 2
    const dist = 0.5 + rng() * 1.5
    p.position.set(Math.cos(angle) * dist, 1.2 + rng() * 1.2, Math.sin(angle) * dist)
    group.add(p)
    particles.push(p)
  }

  return { group, particles }
}

