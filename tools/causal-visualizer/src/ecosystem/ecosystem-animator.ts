import * as THREE from 'three'

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

export interface EcosystemAnimationContext {
  elements: AnimatedEcosystemElement[]
  villagers: THREE.Group[]
  lighthouseBeam?: THREE.Mesh
  lighthouseBeamMaterial?: THREE.MeshBasicMaterial
  fishingBobber?: THREE.Mesh
  fishingVillager?: THREE.Group
}

export class EcosystemAnimator {
  private ctx: EcosystemAnimationContext
  private jumpCooldown = 0.0
  private lighthouseIntensity = 0.0

  constructor(ctx: EcosystemAnimationContext) {
    this.ctx = ctx
  }

  public triggerJump(): void {
    this.jumpCooldown = 1.0
  }

  public triggerLighthouseSweep(): void {
    this.lighthouseIntensity = 1.0
    if (this.ctx.lighthouseBeamMaterial) {
      this.ctx.lighthouseBeamMaterial.visible = true
      this.ctx.lighthouseBeamMaterial.opacity = 0.65
    }
  }

  public update(time: number, isRunning: boolean): void {
    const { elements, villagers, lighthouseBeam, lighthouseBeamMaterial, fishingBobber, fishingVillager } = this.ctx

    // A. 观察悬崖灯塔光锥巡夜扫海（仅在有遥测或处于运行状态时点亮）
    if (lighthouseBeam && lighthouseBeamMaterial) {
      if (isRunning && this.lighthouseIntensity < 0.4) {
        this.lighthouseIntensity = 0.55
        lighthouseBeamMaterial.visible = true
      }

      if (this.lighthouseIntensity > 0) {
        this.lighthouseIntensity = Math.max(0, this.lighthouseIntensity - 0.012)
        lighthouseBeam.rotation.y += 0.05
        lighthouseBeamMaterial.opacity = this.lighthouseIntensity * 0.65
        if (this.lighthouseIntensity <= 0 && !isRunning) {
          lighthouseBeamMaterial.visible = false
        }
      } else {
        lighthouseBeamMaterial.visible = false
      }
    }

    // B. 执行水边垂钓栈桥鱼浮与老翁动作
    if (fishingBobber) {
      fishingBobber.position.y = 0.15 + Math.sin(time * 3.2) * 0.06
    }
    if (fishingVillager) {
      fishingVillager.rotation.z = Math.sin(time * 1.5) * 0.04
    }

    // C. 岛民漫步与变迁跳跃
    if (this.jumpCooldown > 0) {
      this.jumpCooldown -= 0.03
      const jumpY = Math.sin((1.0 - this.jumpCooldown) * Math.PI) * 0.6
      for (const v of villagers) {
        v.position.y = 1.3 + jumpY
        v.rotation.y += 0.15
      }
    } else {
      for (let i = 0; i < villagers.length; i++) {
        const v = villagers[i]
        const vPhase = i * 1.5
        if (isRunning) {
          v.position.y = 1.3 + Math.abs(Math.sin(time * 6 + vPhase)) * 0.3
          v.rotation.y += 0.03
        } else {
          v.position.y = 1.3
          v.rotation.y += Math.sin(time * 0.5 + vPhase) * 0.005
        }
      }
    }

    // D. 遍历所有生态要素进行生命律动
    for (const elem of elements) {
      const { object, kind, basePos, baseRot, phase, speed, orbitRadius, customParts } = elem

      switch (kind) {
        case 'tree': {
          const sway = Math.sin(time * speed + phase) * 0.05
          object.rotation.z = baseRot.z + sway
          object.rotation.x = baseRot.x + sway * 0.6
          break
        }

        case 'flower': {
          const fSway = Math.sin(time * speed + phase) * 0.07
          object.rotation.z = baseRot.z + fSway
          break
        }

        case 'sheep': {
          if (customParts?.head) {
            const graze = Math.max(0, Math.sin(time * speed + phase)) * 0.35
            customParts.head.rotation.x = graze
          }
          break
        }

        case 'rabbit': {
          const hop = Math.max(0, Math.sin(time * speed + phase))
          object.position.y = basePos.y + hop * 0.22
          if (customParts?.ears) {
            customParts.ears.rotation.x = Math.sin(time * 5 + phase) * 0.15
          }
          break
        }

        case 'bird': {
          if (orbitRadius) {
            const angle = time * speed + phase
            object.position.x = Math.cos(angle) * orbitRadius
            object.position.z = Math.sin(angle) * orbitRadius
            object.position.y = basePos.y + Math.sin(time * 1.8 + phase) * 0.4
            object.rotation.y = -angle + Math.PI / 2
            if (customParts?.wingL && customParts?.wingR) {
              const flap = Math.sin(time * 10 + phase) * 0.38
              customParts.wingL.rotation.z = flap
              customParts.wingR.rotation.z = -flap
            }
          }
          break
        }

        case 'crystal': {
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
          if (customParts?.blades) {
            customParts.blades.rotation.z += 0.02 * speed
          }
          break
        }

        case 'fire': {
          if (customParts?.flame) {
            const flameScale = 1.0 + Math.sin(time * speed + phase) * 0.25
            customParts.flame.scale.set(1.0, flameScale, 1.0)
          }
          break
        }

        case 'firefly': {
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
}
