import * as THREE from 'three'

export class OceanEnvironment {
  private scene: THREE.Scene
  private skyMesh?: THREE.Mesh
  private oceanMesh?: THREE.Mesh
  private oceanGeometry?: THREE.PlaneGeometry
  private clouds: THREE.Group[] = []
  private lights: THREE.Light[] = []

  constructor(scene: THREE.Scene) {
    this.scene = scene

    // 1. 海天大气背景与晨雾
    this.scene.background = new THREE.Color('#7dd3fc')
    this.scene.fog = new THREE.Fog('#7dd3fc', 60, 420)

    // 2. 光照体系
    this.initLights()

    // 3. 天空穹顶渐变
    this.initSkyDome()

    // 4. 低多边形波光海洋水面
    this.initOcean()

    // 5. 漂浮海云
    this.initClouds()
  }

  private initLights(): void {
    const hemiLight = new THREE.HemisphereLight(0xbae6fd, 0x0284c7, 1.8)
    this.scene.add(hemiLight)
    this.lights.push(hemiLight)

    const sunLight = new THREE.DirectionalLight(0xfffbeb, 2.8)
    sunLight.position.set(60, 95, 45)
    this.scene.add(sunLight)
    this.lights.push(sunLight)

    const fillLight = new THREE.DirectionalLight(0x38bdf8, 1.2)
    fillLight.position.set(-45, 25, -45)
    this.scene.add(fillLight)
    this.lights.push(fillLight)
  }

  private initSkyDome(): void {
    const skyGeo = new THREE.SphereGeometry(480, 32, 16)
    const canvas = document.createElement('canvas')
    canvas.width = 2
    canvas.height = 512
    const ctx = canvas.getContext('2d')!
    const grad = ctx.createLinearGradient(0, 0, 0, 512)
    grad.addColorStop(0.0, '#0284c7')
    grad.addColorStop(0.4, '#38bdf8')
    grad.addColorStop(0.8, '#7dd3fc')
    grad.addColorStop(1.0, '#bae6fd')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, 2, 512)

    const texture = new THREE.CanvasTexture(canvas)
    const skyMat = new THREE.MeshBasicMaterial({
      map: texture,
      side: THREE.BackSide,
      depthWrite: false,
    })
    this.skyMesh = new THREE.Mesh(skyGeo, skyMat)
    this.scene.add(this.skyMesh)
  }

  private initOcean(): void {
    const size = 1200
    const segments = 64
    this.oceanGeometry = new THREE.PlaneGeometry(size, size, segments, segments)
    this.oceanGeometry.rotateX(-Math.PI / 2)

    const oceanMat = new THREE.MeshStandardMaterial({
      color: 0x0284c7,
      roughness: 0.15,
      metalness: 0.12,
      flatShading: true,
      transparent: true,
      opacity: 0.94,
    })
    this.oceanMesh = new THREE.Mesh(this.oceanGeometry, oceanMat)
    this.oceanMesh.position.y = 0.0
    this.scene.add(this.oceanMesh)
  }

  private initClouds(): void {
    const cloudMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.9,
      flatShading: true,
      transparent: true,
      opacity: 0.92,
    })

    const cloudCount = 14
    for (let c = 0; c < cloudCount; c++) {
      const cloud = new THREE.Group()
      const boxCount = 3 + (c % 3)
      for (let b = 0; b < boxCount; b++) {
        const bw = 6 + ((c * 3 + b) % 5)
        const bh = 2.4 + (b % 2) * 0.8
        const bd = 5 + ((c + b) % 4)
        const box = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), cloudMat)
        box.position.set((b - boxCount / 2) * 3.8, (b % 2) * 0.9, ((b * 2) % 3) - 1.8)
        cloud.add(box)
      }

      const angle = (c / cloudCount) * Math.PI * 2
      const radius = 135 + (c % 4) * 28
      const height = 75 + (c % 3) * 12
      const speed = 0.0006 + (c % 3) * 0.0003

      cloud.position.set(Math.cos(angle) * radius, height, Math.sin(angle) * radius)
      cloud.scale.setScalar(1.4 + (c % 3) * 0.4)
      cloud.userData = { angle, radius, height, speed }

      this.scene.add(cloud)
      this.clouds.push(cloud)
    }
  }

  public update(time: number): void {
    // 1. 低多边形海面波浪微波起伏
    if (this.oceanGeometry) {
      const posAttr = this.oceanGeometry.attributes.position
      for (let i = 0; i < posAttr.count; i++) {
        const x = posAttr.getX(i)
        const z = posAttr.getZ(i)
        const waveY =
          Math.sin(x * 0.04 + time * 1.2) * Math.cos(z * 0.04 + time * 1.0) * 0.08 +
          Math.sin(x * 0.08 - time * 1.6 + z * 0.05) * 0.04
        posAttr.setY(i, waveY)
      }
      posAttr.needsUpdate = true
      this.oceanGeometry.computeVertexNormals()
    }

    // 2. 高空白云随海风绕外圈缓速环游，绝不遮挡摄像机视线
    for (const cloud of this.clouds) {
      const data = cloud.userData as { angle: number; radius: number; height: number; speed: number }
      if (data) {
        data.angle += data.speed
        cloud.position.x = Math.cos(data.angle) * data.radius
        cloud.position.z = Math.sin(data.angle) * data.radius
      }
    }
  }

  public dispose(): void {
    if (this.oceanGeometry) this.oceanGeometry.dispose()
    if (this.oceanMesh && this.oceanMesh.material) {
      ;(this.oceanMesh.material as THREE.Material).dispose()
    }
    if (this.skyMesh) {
      this.skyMesh.geometry.dispose()
      if (this.skyMesh.material) (this.skyMesh.material as THREE.Material).dispose()
    }
    for (const light of this.lights) {
      this.scene.remove(light)
      light.dispose()
    }
    for (const cloud of this.clouds) {
      this.scene.remove(cloud)
      cloud.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh
          if (mesh.geometry) mesh.geometry.dispose()
          if (mesh.material) (mesh.material as THREE.Material).dispose()
        }
      })
    }
  }
}
