/**
 * 纯图无关 3D 拓扑排布引擎 (Graph-Agnostic 3D Layout Engine)
 * 接收任意无预设的节点集合与连线，基于图论拓扑层次与 3D 圆柱环轨数学模型，
 * 全自动计算各节点的 3D 空间坐标与色彩方案。
 */
export function computeGraphAgnosticLayout(rawNodes, rawEdges) {
    const nodeCount = rawNodes.length;
    if (nodeCount === 0)
        return { nodes: [], edges: [] };
    const nodeMap = new Map();
    for (const n of rawNodes)
        nodeMap.set(n.nodeId, n);
    // 1. 构建邻接表与入度/出度统计
    const adj = new Map();
    const inDegree = new Map();
    const outDegree = new Map();
    for (const n of rawNodes) {
        adj.set(n.nodeId, new Set());
        inDegree.set(n.nodeId, 0);
        outDegree.set(n.nodeId, 0);
    }
    for (const e of rawEdges) {
        if (adj.has(e.from) && adj.has(e.to)) {
            adj.get(e.from).add(e.to);
            outDegree.set(e.from, (outDegree.get(e.from) || 0) + 1);
            inDegree.set(e.to, (inDegree.get(e.to) || 0) + 1);
        }
    }
    // 2. 拓扑分层 (BFS / Longest Path Layering)
    const tiers = new Map();
    const roots = [];
    for (const n of rawNodes) {
        if ((inDegree.get(n.nodeId) || 0) === 0) {
            roots.push(n.nodeId);
            tiers.set(n.nodeId, 0);
        }
    }
    // 若存在环路导致无纯根节点，取第一个节点作为起始层
    if (roots.length === 0 && rawNodes.length > 0) {
        roots.push(rawNodes[0].nodeId);
        tiers.set(rawNodes[0].nodeId, 0);
    }
    const queue = [...roots];
    const visited = new Set(roots);
    while (queue.length > 0) {
        const curr = queue.shift();
        const currTier = tiers.get(curr) || 0;
        const neighbors = adj.get(curr) || new Set();
        for (const nxt of neighbors) {
            const existingTier = tiers.get(nxt) ?? -1;
            if (currTier + 1 > existingTier) {
                tiers.set(nxt, currTier + 1);
            }
            if (!visited.has(nxt)) {
                visited.add(nxt);
                queue.push(nxt);
            }
        }
    }
    // 未遍历到的孤立节点归入默认层 0
    for (const n of rawNodes) {
        if (!tiers.has(n.nodeId))
            tiers.set(n.nodeId, 0);
    }
    // 3. 计算总层数与每层节点清单
    let maxTier = 0;
    const tierBuckets = new Map();
    for (const [nodeId, t] of tiers.entries()) {
        if (t > maxTier)
            maxTier = t;
        if (!tierBuckets.has(t))
            tierBuckets.set(t, []);
        tierBuckets.get(t).push(nodeId);
    }
    // 4. 空间 3D 映射 (X 轴沿因果流向展开，Y-Z 轴沿三维圆环放射排布)
    const layerSpacing = 16;
    const totalWidth = maxTier * layerSpacing;
    const startX = -totalWidth / 2;
    const finalNodes = [];
    for (let t = 0; t <= maxTier; t++) {
        const bucket = tierBuckets.get(t) || [];
        const layerX = maxTier === 0 ? 0 : startX + t * layerSpacing;
        const count = bucket.length;
        // 每层的环状半径根据该层节点数量自适应扩大
        const radius = count <= 1 ? 0 : Math.max(6, Math.sqrt(count) * 4.2);
        const angleOffset = (t * Math.PI) / 6; // 错位旋转增强 3D 纵深感
        bucket.forEach((nodeId, idx) => {
            const raw = nodeMap.get(nodeId);
            let y = 0;
            let z = 0;
            if (count === 1) {
                y = 0;
                z = 0;
            }
            else {
                const angle = (idx / count) * Math.PI * 2 + angleOffset;
                y = Math.sin(angle) * radius;
                z = Math.cos(angle) * radius;
            }
            // 色彩根据因果层级赋予梯度能量色 (Amber -> Cyan -> Purple -> Emerald)
            const color = pickTierColor(t, maxTier, nodeId);
            finalNodes.push({
                id: nodeId,
                name: nodeId,
                color,
                position: [layerX, y, z],
                generation: raw.generation !== undefined ? raw.generation : 0,
                version: raw.version || 0,
                status: raw.status || 'IDLE',
                state: raw.state || {},
                tier: t,
            });
        });
    }
    // 5. 组装边
    const finalEdges = rawEdges.map((e) => {
        const sourceNode = finalNodes.find((n) => n.id === e.from);
        const color = sourceNode?.color || '#38bdf8';
        return {
            id: `${e.from}->${e.to}`,
            from: e.from,
            to: e.to,
            color,
            active: false,
        };
    });
    return { nodes: finalNodes, edges: finalEdges };
}
/**
 * 根据层级或名称特征选择和谐的三维能量色彩
 */
function pickTierColor(tier, maxTier, nodeId) {
    if (maxTier === 0) {
        // 只有一层时，通过哈希生成散列色
        return hashColor(nodeId);
    }
    const ratio = tier / maxTier;
    if (ratio === 0)
        return '#f59e0b'; // 起始源：琥珀金
    if (ratio < 0.35)
        return '#38bdf8'; // 转换处理层：电光青
    if (ratio < 0.7)
        return '#a855f7'; // 核心中枢与控制层：深邃幽紫
    return '#10b981'; // 终端与持久层：星石翡翠绿
}
function hashColor(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const h = Math.abs(hash) % 360;
    return `hsl(${h}, 80%, 65%)`;
}
