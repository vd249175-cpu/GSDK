import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
export class CausalScene3D {
    container;
    scene;
    camera;
    renderer;
    controls;
    nodeVisuals = new Map();
    edgeVisuals = new Map();
    photons = [];
    shockwaves = [];
    stars;
    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();
    onNodeSelectedCallback;
    animFrameId;
    isDisposed = false;
    constructor(container, onNodeSelected) {
        this.container = container;
        this.onNodeSelectedCallback = onNodeSelected;
        // 1. 场景
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color('#07090e');
        this.scene.fog = new THREE.FogExp2('#07090e', 0.01);
        // 2. 摄像机
        const width = container.clientWidth || window.innerWidth;
        const height = container.clientHeight || window.innerHeight;
        this.camera = new THREE.PerspectiveCamera(45, width / height, 0.5, 600);
        this.camera.position.set(0, 20, 48);
        // 3. 渲染器
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
        this.renderer.setSize(width, height);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.2;
        container.appendChild(this.renderer.domElement);
        // 4. 轨道控制器
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.maxDistance = 200;
        this.controls.minDistance = 6;
        // 5. 光源
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.9);
        this.scene.add(ambientLight);
        const dirLight = new THREE.DirectionalLight(0x38bdf8, 2.0);
        dirLight.position.set(30, 50, 30);
        this.scene.add(dirLight);
        const dirLight2 = new THREE.DirectionalLight(0xa855f7, 1.5);
        dirLight2.position.set(-30, -20, -30);
        this.scene.add(dirLight2);
        // 6. 星空粒子
        this.initStars();
        // 7. 事件绑定
        this.onResize = this.onResize.bind(this);
        this.onPointerDown = this.onPointerDown.bind(this);
        window.addEventListener('resize', this.onResize);
        this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown);
        // 8. 启动渲染循环
        this.animate = this.animate.bind(this);
        this.animate();
    }
    initStars() {
        const starGeo = new THREE.BufferGeometry();
        const starCount = 1500;
        const starPos = new Float32Array(starCount * 3);
        for (let i = 0; i < starCount * 3; i += 3) {
            starPos[i] = (Math.random() - 0.5) * 250;
            starPos[i + 1] = (Math.random() - 0.5) * 160;
            starPos[i + 2] = (Math.random() - 0.5) * 250;
        }
        starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
        const starMat = new THREE.PointsMaterial({
            color: 0x64748b,
            size: 0.7,
            transparent: true,
            opacity: 0.35,
        });
        this.stars = new THREE.Points(starGeo, starMat);
        this.scene.add(this.stars);
    }
    setAutoRotate(enabled) {
        this.controls.autoRotate = enabled;
        this.controls.autoRotateSpeed = 1.0;
    }
    resetCamera() {
        this.camera.position.set(0, 20, 48);
        this.controls.target.set(0, 0, 0);
        this.controls.update();
    }
    focusNode(nodeId) {
        const visual = this.nodeVisuals.get(nodeId);
        if (!visual)
            return;
        const pos = visual.group.position;
        this.controls.target.copy(pos);
        this.camera.position.set(pos.x, pos.y + 6, pos.z + 16);
        this.controls.update();
    }
    /**
     * 图无关拓扑更新：接收任意节点与边并更新 3D 场景
     */
    updateTopology(nodes, edges) {
        const currentNodes = new Set(nodes.map((n) => n.id));
        const currentEdges = new Set(edges.map((e) => e.id));
        // 1. 移除已消失的节点
        for (const [id, visual] of this.nodeVisuals.entries()) {
            if (!currentNodes.has(id)) {
                this.scene.remove(visual.group);
                this.nodeVisuals.delete(id);
            }
        }
        // 2. 移除已消失的边
        for (const [id, visual] of this.edgeVisuals.entries()) {
            if (!currentEdges.has(id)) {
                this.scene.remove(visual.lineMesh);
                this.edgeVisuals.delete(id);
            }
        }
        // 3. 更新或创建节点
        for (const node of nodes) {
            const existing = this.nodeVisuals.get(node.id);
            if (existing) {
                existing.node = node;
                existing.group.position.set(...node.position);
                this.updateNodeSprite(existing);
            }
            else {
                const visual = this.createNodeVisual(node);
                this.nodeVisuals.set(node.id, visual);
                this.scene.add(visual.group);
            }
        }
        // 4. 更新或创建边
        for (const edge of edges) {
            const fromNode = this.nodeVisuals.get(edge.from);
            const toNode = this.nodeVisuals.get(edge.to);
            if (!fromNode || !toNode)
                continue;
            const existing = this.edgeVisuals.get(edge.id);
            if (existing) {
                existing.edge = edge;
            }
            else {
                const visual = this.createEdgeVisual(edge, fromNode.group.position, toNode.group.position);
                this.edgeVisuals.set(edge.id, visual);
                this.scene.add(visual.lineMesh);
            }
        }
    }
    createNodeVisual(node) {
        const group = new THREE.Group();
        group.position.set(...node.position);
        const color = new THREE.Color(node.color || '#38bdf8');
        // 核心球体
        const coreGeo = new THREE.SphereGeometry(1.2, 32, 32);
        const coreMat = new THREE.MeshStandardMaterial({
            color,
            emissive: color,
            emissiveIntensity: 0.8,
            roughness: 0.2,
            metalness: 0.5,
        });
        const core = new THREE.Mesh(coreGeo, coreMat);
        group.add(core);
        // 外围全息能量环
        const ringGeo = new THREE.TorusGeometry(1.8, 0.05, 16, 64);
        const ringMat = new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: 0.55,
        });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.rotation.x = Math.PI / 2;
        group.add(ring);
        // 2D 状态徽标
        const sprite = this.createNodeSprite(node);
        sprite.position.set(0, 2.2, 0);
        group.add(sprite);
        group.userData = { nodeId: node.id };
        core.userData = { nodeId: node.id };
        return { group, core, ring, sprite, node, glowIntensity: 0 };
    }
    createNodeSprite(node) {
        const canvas = document.createElement('canvas');
        canvas.width = 340;
        canvas.height = 100;
        const ctx = canvas.getContext('2d');
        this.drawSpriteCanvas(ctx, node);
        const texture = new THREE.CanvasTexture(canvas);
        const mat = new THREE.SpriteMaterial({ map: texture, transparent: true });
        const sprite = new THREE.Sprite(mat);
        sprite.scale.set(6.8, 2.0, 1);
        sprite.userData = { canvas, texture };
        return sprite;
    }
    updateNodeSprite(visual) {
        const sprite = visual.sprite;
        const { canvas, texture } = sprite.userData;
        if (!canvas || !texture)
            return;
        const ctx = canvas.getContext('2d');
        if (!ctx)
            return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        this.drawSpriteCanvas(ctx, visual.node);
        texture.needsUpdate = true;
    }
    drawSpriteCanvas(ctx, node) {
        ctx.fillStyle = 'rgba(10, 14, 22, 0.88)';
        ctx.strokeStyle = node.color || '#38bdf8';
        ctx.lineWidth = 3;
        const x = 6, y = 6, w = 328, h = 88, r = 16;
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        // 节点名称
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 24px monospace';
        ctx.fillText(node.name || node.id, 20, 42);
        // 代次与状态
        ctx.fillStyle = '#94a3b8';
        ctx.font = '19px monospace';
        const genText = node.generation !== null ? `Gen ${node.generation}` : 'Dropped';
        const verText = `v${node.version}`;
        ctx.fillText(`${genText} · ${verText}`, 20, 72);
        // 运行态光点
        ctx.fillStyle = node.status === 'RUNNING' ? '#22c55e' : (node.color || '#38bdf8');
        ctx.beginPath();
        ctx.arc(300, 50, 8, 0, Math.PI * 2);
        ctx.fill();
    }
    createEdgeVisual(edge, fromPos, toPos) {
        const midPoint = new THREE.Vector3().addVectors(fromPos, toPos).multiplyScalar(0.5);
        const dist = fromPos.distanceTo(toPos);
        midPoint.y += Math.max(2.5, dist * 0.16);
        const curve = new THREE.CubicBezierCurve3(fromPos.clone(), new THREE.Vector3(fromPos.x * 0.7 + midPoint.x * 0.3, fromPos.y + 1.2, fromPos.z * 0.7 + midPoint.z * 0.3), new THREE.Vector3(toPos.x * 0.7 + midPoint.x * 0.3, toPos.y + 1.2, toPos.z * 0.7 + midPoint.z * 0.3), toPos.clone());
        const tubeGeo = new THREE.TubeGeometry(curve, 48, 0.08, 8, false);
        const lineMat = new THREE.MeshBasicMaterial({
            color: new THREE.Color(edge.color || '#38bdf8'),
            transparent: true,
            opacity: 0.35,
        });
        const lineMesh = new THREE.Mesh(tubeGeo, lineMat);
        return { lineMesh, curve, edge, glowIntensity: 0 };
    }
    /**
     * 触发边发光与光子飞驰（由真实的 ctx.send 遥测触发）
     */
    triggerInfoTransmission(fromNodeId, toNodeId, infoType, payloadSummary) {
        let targetVisual;
        for (const visual of this.edgeVisuals.values()) {
            if (visual.edge.from === fromNodeId && visual.edge.to === toNodeId) {
                targetVisual = visual;
                break;
            }
        }
        const fromNode = this.nodeVisuals.get(fromNodeId);
        if (targetVisual) {
            // 1. 边高能强发光
            targetVisual.glowIntensity = 1.0;
            targetVisual.lineMesh.material.opacity = 0.95;
            // 2. 发射光子脉冲
            const pulseId = `pulse-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
            this.spawnPhoton(targetVisual.curve, pulseId, infoType, toNodeId, payloadSummary);
        }
        if (fromNode) {
            fromNode.glowIntensity = 0.8;
        }
    }
    spawnPhoton(curve, pulseId, infoType, targetNodeId, payloadSummary) {
        const group = new THREE.Group();
        const coreGeo = new THREE.SphereGeometry(0.36, 16, 16);
        const coreMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
        const coreMesh = new THREE.Mesh(coreGeo, coreMat);
        group.add(coreMesh);
        const haloGeo = new THREE.SphereGeometry(0.8, 16, 16);
        const haloMat = new THREE.MeshBasicMaterial({
            color: 0x38bdf8,
            transparent: true,
            opacity: 0.65,
        });
        const haloMesh = new THREE.Mesh(haloGeo, haloMat);
        group.add(haloMesh);
        this.scene.add(group);
        const pulse = {
            id: pulseId,
            edgeId: '',
            from: [curve.v0.x, curve.v0.y, curve.v0.z],
            to: [curve.v3.x, curve.v3.y, curve.v3.z],
            progress: 0,
            speed: 0.024,
            color: '#38bdf8',
            infoType,
            payloadSummary,
        };
        this.photons.push({ pulse, mesh: group, curve, targetNodeId });
    }
    /**
     * 触发目标节点吸收震荡波
     */
    triggerNodeImpact(nodeId) {
        const visual = this.nodeVisuals.get(nodeId);
        if (!visual)
            return;
        visual.glowIntensity = 1.0;
        const ringGeo = new THREE.RingGeometry(1.2, 1.6, 32);
        const ringMat = new THREE.MeshBasicMaterial({
            color: new THREE.Color(visual.node.color || '#38bdf8'),
            transparent: true,
            opacity: 0.8,
            side: THREE.DoubleSide,
        });
        const waveMesh = new THREE.Mesh(ringGeo, ringMat);
        waveMesh.position.copy(visual.group.position);
        waveMesh.rotation.x = Math.PI / 2;
        this.scene.add(waveMesh);
        const wave = {
            id: `wave-${Date.now()}`,
            nodeId,
            position: [visual.group.position.x, visual.group.position.y, visual.group.position.z],
            radius: 1.2,
            maxRadius: 4.8,
            opacity: 0.8,
            color: visual.node.color || '#38bdf8',
        };
        this.shockwaves.push({ wave, mesh: waveMesh });
    }
    onPointerDown(event) {
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        this.raycaster.setFromCamera(this.mouse, this.camera);
        const meshes = [];
        for (const visual of this.nodeVisuals.values()) {
            meshes.push(visual.core);
        }
        const intersects = this.raycaster.intersectObjects(meshes, false);
        if (intersects.length > 0) {
            const hit = intersects[0].object;
            const nodeId = hit.userData?.nodeId;
            if (nodeId && this.onNodeSelectedCallback) {
                this.onNodeSelectedCallback(nodeId);
            }
        }
        else {
            if (this.onNodeSelectedCallback) {
                this.onNodeSelectedCallback(null);
            }
        }
    }
    onResize() {
        if (!this.container || this.isDisposed)
            return;
        const width = this.container.clientWidth;
        const height = this.container.clientHeight;
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
    }
    animate() {
        if (this.isDisposed)
            return;
        this.animFrameId = requestAnimationFrame(this.animate);
        this.controls.update();
        if (this.stars) {
            this.stars.rotation.y += 0.0003;
        }
        for (const visual of this.nodeVisuals.values()) {
            visual.ring.rotation.z += 0.015;
            if (visual.glowIntensity > 0) {
                visual.glowIntensity -= 0.02;
                if (visual.glowIntensity < 0)
                    visual.glowIntensity = 0;
                const emissive = 0.8 + visual.glowIntensity * 1.5;
                visual.core.material.emissiveIntensity = emissive;
            }
        }
        for (const visual of this.edgeVisuals.values()) {
            if (visual.glowIntensity > 0) {
                visual.glowIntensity -= 0.015;
                if (visual.glowIntensity < 0)
                    visual.glowIntensity = 0;
                const opacity = 0.35 + visual.glowIntensity * 0.6;
                visual.lineMesh.material.opacity = opacity;
            }
        }
        for (let i = this.photons.length - 1; i >= 0; i--) {
            const pVisual = this.photons[i];
            const { pulse, mesh, curve, targetNodeId } = pVisual;
            pulse.progress += pulse.speed;
            if (pulse.progress >= 1.0) {
                this.scene.remove(mesh);
                this.photons.splice(i, 1);
                this.triggerNodeImpact(targetNodeId);
            }
            else {
                const pt = curve.getPointAt(pulse.progress);
                mesh.position.copy(pt);
                mesh.rotation.y += 0.05;
            }
        }
        for (let i = this.shockwaves.length - 1; i >= 0; i--) {
            const sVisual = this.shockwaves[i];
            const { wave, mesh } = sVisual;
            wave.radius += 0.12;
            wave.opacity -= 0.025;
            if (wave.opacity <= 0) {
                this.scene.remove(mesh);
                this.shockwaves.splice(i, 1);
            }
            else {
                const scale = wave.radius / 1.2;
                mesh.scale.set(scale, scale, 1);
                mesh.material.opacity = Math.max(0, wave.opacity);
            }
        }
        this.renderer.render(this.scene, this.camera);
    }
    dispose() {
        this.isDisposed = true;
        if (this.animFrameId)
            cancelAnimationFrame(this.animFrameId);
        window.removeEventListener('resize', this.onResize);
        this.renderer.domElement.removeEventListener('pointerdown', this.onPointerDown);
        this.controls.dispose();
        this.renderer.dispose();
        if (this.renderer.domElement.parentNode) {
            this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
        }
    }
}
