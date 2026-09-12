import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

export class CameraController {
  public camera: THREE.PerspectiveCamera
  public controls: OrbitControls

  private isTransitioning = false
  private cameraStartPos = new THREE.Vector3()
  private cameraEndPos = new THREE.Vector3()
  private targetStartPos = new THREE.Vector3()
  private targetEndPos = new THREE.Vector3()
  private transitionProgress = 1.0
  private readonly transitionDuration = 0.65 // 秒

  private onExitIslandCallback?: () => void

  constructor(
    domElement: HTMLElement,
    width: number,
    height: number,
    onExitIsland?: () => void,
  ) {
    this.onExitIslandCallback = onExitIsland

    // 1. 摄像机初始化（默认处于海面俯瞰全景视角）
    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.5, 650)
    this.camera.position.set(0, 36, 62)

    // 2. 轨道控制器初始化
    this.controls = new OrbitControls(this.camera, domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.05
    this.controls.maxDistance = 260
    this.controls.minDistance = 6
    this.controls.maxPolarAngle = Math.PI / 2 - 0.04 // 禁止穿入海底

    // 当用户手动拖拽镜头时，立即停止镜头自动滑行过渡，避免视角被锁死
    this.controls.addEventListener('start', () => {
      this.isTransitioning = false
    })

    // 监听 ESC 键一键退回海图全景
    this.onKeyDown = this.onKeyDown.bind(this)
    window.addEventListener('keydown', this.onKeyDown)
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      this.returnToOverview()
      this.onExitIslandCallback?.()
    }
  }

  public setAutoRotate(enabled: boolean): void {
    this.controls.autoRotate = enabled
    this.controls.autoRotateSpeed = 0.8
  }

  /**
   * 优雅平滑切角推进至海岛微观视角 (Close-up Island View)
   */
  public focusIsland(pos: THREE.Vector3 | { x: number; y: number; z: number }): void {
    this.cameraStartPos.copy(this.camera.position)
    this.targetStartPos.copy(this.controls.target)

    this.targetEndPos.set(pos.x, 1.25, pos.z)
    this.cameraEndPos.set(pos.x, 7.2, pos.z + 13.5)

    this.transitionProgress = 0.0
    this.isTransitioning = true
  }

  /**
   * 平滑滑行返回高空海图全景视角
   */
  public returnToOverview(): void {
    this.cameraStartPos.copy(this.camera.position)
    this.targetStartPos.copy(this.controls.target)

    this.targetEndPos.set(0, 0, 0)
    this.cameraEndPos.set(0, 36, 62)

    this.transitionProgress = 0.0
    this.isTransitioning = true
  }

  public resetCamera(): void {
    this.returnToOverview()
  }

  public onResize(width: number, height: number): void {
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
  }

  /**
   * 逐帧更新摄像机过渡与控制器阻尼
   */
  public update(delta: number): void {
    if (this.isTransitioning) {
      this.transitionProgress += delta / this.transitionDuration

      if (this.transitionProgress >= 1.0) {
        this.transitionProgress = 1.0
        this.isTransitioning = false
        this.camera.position.copy(this.cameraEndPos)
        this.controls.target.copy(this.targetEndPos)
      } else {
        // Ease-out cubic 减速缓动
        const t = 1 - Math.pow(1 - this.transitionProgress, 3)
        this.camera.position.lerpVectors(this.cameraStartPos, this.cameraEndPos, t)
        this.controls.target.lerpVectors(this.targetStartPos, this.targetEndPos, t)
      }
    }

    this.controls.update()
  }

  public dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown)
    this.controls.dispose()
  }
}
