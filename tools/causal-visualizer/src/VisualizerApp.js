import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from 'react';
import { CausalScene3D } from './causal-scene';
import { computeGraphAgnosticLayout } from './layout-engine';
import { visualizerClient } from './visualizer-client';
import './visualizer.css';
export function VisualizerApp() {
    const containerRef = useRef(null);
    const sceneRef = useRef(null);
    const [nodes, setNodes] = useState([]);
    const [edges, setEdges] = useState([]);
    const [logs, setLogs] = useState([]);
    const [selectedNodeId, setSelectedNodeId] = useState(null);
    const [autoRotate, setAutoRotate] = useState(false);
    const [revision, setRevision] = useState(0);
    // 内部维护活跃节点与边的映射，确保图无关动态发现
    const nodesRef = useRef([]);
    const edgesRef = useRef([]);
    const edgeSetRef = useRef(new Set());
    const syncTopology = async () => {
        try {
            const snapshot = await visualizerClient.fetchLiveTopology();
            if (snapshot?.nodes && snapshot.nodes.length > 0) {
                setRevision(snapshot.revision);
                const rawEdges = (snapshot.routes || []).map((r) => ({
                    from: r.from,
                    to: r.to,
                    infoType: r.infoType,
                }));
                // 保留运行时已发现的动态边
                for (const e of edgesRef.current) {
                    if (!rawEdges.some((re) => re.from === e.from && re.to === e.to)) {
                        rawEdges.push({ from: e.from, to: e.to, infoType: e.lastInfoType });
                    }
                }
                const layout = computeGraphAgnosticLayout(snapshot.nodes, rawEdges);
                nodesRef.current = layout.nodes;
                edgesRef.current = layout.edges;
                edgeSetRef.current = new Set(layout.edges.map((e) => `${e.from}->${e.to}`));
                setNodes([...layout.nodes]);
                setEdges([...layout.edges]);
                sceneRef.current?.updateTopology(layout.nodes, layout.edges);
            }
        }
        catch (err) {
            console.warn('[VisualizerApp] Sync live topology fallback:', err);
        }
    };
    useEffect(() => {
        if (!containerRef.current)
            return;
        const scene = new CausalScene3D(containerRef.current, (nodeId) => {
            setSelectedNodeId(nodeId);
        });
        sceneRef.current = scene;
        // 订阅微内核原生遥测流（纯被动监听，图无关）
        const unsubscribe = visualizerClient.subscribe((event) => {
            setLogs((prev) => [event, ...prev.slice(0, 99)]);
            switch (event.type) {
                case 'info_sent': {
                    const edgeKey = `${event.fromNodeId}->${event.toNodeId}`;
                    // 动态发现新边：若当前拓扑中尚无此光轨，立刻在 3D 空间动态建立！
                    if (!edgeSetRef.current.has(edgeKey)) {
                        const newEdge = {
                            id: edgeKey,
                            from: event.fromNodeId,
                            to: event.toNodeId,
                            color: '#38bdf8',
                            active: true,
                            lastSentTime: event.timestamp,
                            lastInfoType: event.info.type,
                        };
                        edgesRef.current.push(newEdge);
                        edgeSetRef.current.add(edgeKey);
                        setEdges([...edgesRef.current]);
                        scene.updateTopology(nodesRef.current, edgesRef.current);
                    }
                    // 触发高能发光与光子飞驰
                    const payloadSummary = event.info ? JSON.stringify(event.info).slice(0, 32) : undefined;
                    scene.triggerInfoTransmission(event.fromNodeId, event.toNodeId, event.info.type, payloadSummary);
                    break;
                }
                case 'change_start': {
                    const node = nodesRef.current.find((n) => n.id === event.nodeId);
                    if (node) {
                        node.status = 'RUNNING';
                        setNodes([...nodesRef.current]);
                        scene.updateTopology(nodesRef.current, edgesRef.current);
                    }
                    break;
                }
                case 'change_end': {
                    const node = nodesRef.current.find((n) => n.id === event.nodeId);
                    if (node) {
                        node.status = 'IDLE';
                        setNodes([...nodesRef.current]);
                        scene.updateTopology(nodesRef.current, edgesRef.current);
                    }
                    break;
                }
                case 'state_mutated': {
                    const node = nodesRef.current.find((n) => n.id === event.nodeId);
                    if (node) {
                        node.version = event.version;
                        node.state = event.state;
                        setNodes([...nodesRef.current]);
                        scene.updateTopology(nodesRef.current, edgesRef.current);
                    }
                    break;
                }
                case 'node_admitted': {
                    let node = nodesRef.current.find((n) => n.id === event.nodeId);
                    if (!node) {
                        // 动态准入新节点：触发全图自适应重排
                        syncTopology();
                    }
                    else {
                        node.generation = event.generation;
                        node.status = 'IDLE';
                        setNodes([...nodesRef.current]);
                        scene.updateTopology(nodesRef.current, edgesRef.current);
                    }
                    break;
                }
                case 'node_evicted': {
                    const node = nodesRef.current.find((n) => n.id === event.nodeId);
                    if (node) {
                        node.generation = null;
                        node.status = 'DROPPED';
                        setNodes([...nodesRef.current]);
                        scene.updateTopology(nodesRef.current, edgesRef.current);
                    }
                    break;
                }
                default:
                    break;
            }
        });
        // 初次拉取内核实时拓扑
        syncTopology();
        return () => {
            unsubscribe();
            scene.dispose();
        };
    }, []);
    const handleToggleAutoRotate = () => {
        const next = !autoRotate;
        setAutoRotate(next);
        sceneRef.current?.setAutoRotate(next);
    };
    const handleResetCamera = () => {
        sceneRef.current?.resetCamera();
    };
    const handleFocusSelected = () => {
        if (selectedNodeId) {
            sceneRef.current?.focusNode(selectedNodeId);
        }
    };
    const handleClearLogs = () => {
        setLogs([]);
    };
    const selectedNode = nodes.find((n) => n.id === selectedNodeId);
    return (_jsxs("div", { className: "visualizer-root", children: [_jsx("div", { ref: containerRef, className: "canvas-container" }), _jsxs("header", { className: "top-bar", children: [_jsxs("div", { className: "title-group", children: [_jsx("span", { className: "logo-badge", children: "\uD83E\uDE90" }), _jsxs("div", { children: [_jsx("h1", { children: "GSDK 3D \u56E0\u679C\u6570\u636E\u6D41\u5168\u606F\u89C2\u6D4B\u5668" }), _jsx("div", { className: "subtitle", children: "\u7EAF\u56FE\u65E0\u5173 \u00B7 \u8C03\u5EA6\u5185\u6838\u6570\u5B57\u5B6A\u751F" })] }), _jsx("span", { className: "kernel-tag", children: "NativeRuleSpace Live" })] }), _jsxs("div", { className: "stats-group", children: [_jsxs("div", { className: "stat-item", children: [_jsx("span", { className: "label", children: "\u5FAE\u5185\u6838\u6D3B\u8DC3\u8282\u70B9" }), _jsxs("span", { className: "value", children: [nodes.filter((n) => n.generation !== null).length, " / ", nodes.length] })] }), _jsxs("div", { className: "stat-item", children: [_jsx("span", { className: "label", children: "\u52A8\u6001\u56E0\u679C\u5149\u8F68" }), _jsxs("span", { className: "value", children: [edges.length, " \u6761"] })] }), _jsxs("div", { className: "stat-item", children: [_jsx("span", { className: "label", children: "\u9065\u6D4B\u4E8B\u4EF6\u5E27" }), _jsx("span", { className: "value", children: logs.length })] }), revision > 0 && (_jsxs("div", { className: "stat-item", children: [_jsx("span", { className: "label", children: "\u5185\u6838\u7248\u672C" }), _jsxs("span", { className: "value", children: ["r", revision] })] }))] })] }), _jsxs("footer", { className: "bottom-dock", children: [_jsx("button", { className: "btn-ctrl", onClick: handleResetCamera, title: "\u91CD\u7F6E\u6444\u50CF\u673A\u4F4D\u7F6E", children: "\uD83C\uDFAF \u590D\u4F4D\u89C6\u89D2" }), _jsx("button", { className: "btn-ctrl", style: { borderColor: autoRotate ? 'var(--vis-accent)' : undefined }, onClick: handleToggleAutoRotate, title: "\u5F00\u542F/\u505C\u6B62 3D \u7A7A\u95F4\u7F13\u6162\u81EA\u8F6C", children: autoRotate ? '⏸️ 暂停自转' : '🔄 空间自转' }), selectedNodeId && (_jsx("button", { className: "btn-ctrl", onClick: handleFocusSelected, title: "\u955C\u5934\u63A8\u8FDB\u805A\u7126\u5230\u9009\u4E2D\u7684\u8282\u70B9", children: "\uD83D\uDD0D \u805A\u7126\u8282\u70B9" })), _jsx("div", { className: "dock-divider" }), _jsx("button", { className: "btn-ctrl", onClick: syncTopology, title: "\u91CD\u65B0\u4ECE\u5FAE\u5185\u6838\u62C9\u53D6\u6700\u65B0\u62D3\u6251\u5FEB\u7167", children: "\uD83C\uDF0C \u540C\u6B65\u62D3\u6251" }), _jsx("button", { className: "btn-ctrl", onClick: handleClearLogs, title: "\u6E05\u7A7A\u5386\u53F2\u4E8B\u4EF6\u6D41", children: "\uD83E\uDDF9 \u6E05\u7A7A\u6D41" })] }), _jsxs("aside", { className: "event-feed", children: [_jsxs("div", { className: "feed-header", children: [_jsx("span", { children: "\u26A1 \u5FAE\u5185\u6838\u5B9E\u65F6\u9065\u6D4B\u6D41" }), _jsx("span", { style: { fontSize: 10, color: 'var(--vis-accent)' }, children: "\u25CF \u5B9E\u65F6\u76D1\u542C\u4E2D" })] }), _jsx("div", { className: "feed-list", children: logs.length === 0 ? (_jsxs("div", { style: { color: 'var(--vis-text-muted)', fontSize: 11, padding: 12, lineHeight: 1.5 }, children: ["\u89C2\u6D4B\u5668\u5DF2\u5C31\u7EEA\u3002", _jsx("br", {}), "\u5F53\u5FAE\u5185\u6838\u53D1\u751F ctx.send\u3001\u72B6\u6001\u53D8\u66F4\u6216\u8C03\u5EA6\u65F6\uFF0C\u5149\u8F68\u5C06\u5373\u65F6\u53D1\u5149\u5E76\u5728\u6B64\u5448\u73B0\u3002"] })) : (logs.slice(0, 20).map((log, idx) => (_jsxs("div", { className: `feed-item ${log.type}`, children: [_jsx("div", { className: "feed-type", children: log.type }), _jsxs("div", { className: "feed-desc", children: [log.type === 'info_sent' && `${log.fromNodeId} ➔ ${log.toNodeId} (${log.info.type})`, log.type === 'state_mutated' && `${log.nodeId} State 变迁至 v${log.version}`, log.type === 'root_injected' && `根因果注入 ➔ ${log.targetNodeId} (${log.info.type})`, log.type === 'change_start' && `调度单飞: ${log.nodeId} (${log.info.type})`, log.type === 'change_end' && `完成调度: ${log.nodeId} (${log.durationMs.toFixed(1)}ms)`, log.type === 'node_admitted' && `节点准入: ${log.nodeId}@Gen${log.generation}`, log.type === 'node_evicted' && `节点卸载: ${log.nodeId}`] })] }, idx)))) })] }), selectedNode && (_jsxs("section", { className: "inspector-drawer", children: [_jsxs("div", { className: "inspector-header", children: [_jsxs("div", { children: [_jsx("h2", { children: selectedNode.name }), _jsx("div", { style: { fontSize: 11, color: 'var(--vis-text-muted)', marginTop: 2 }, children: selectedNode.id })] }), _jsx("button", { className: "close-btn", onClick: () => setSelectedNodeId(null), children: "\u00D7" })] }), _jsxs("div", { className: "node-meta-grid", children: [_jsxs("div", { className: "meta-card", children: [_jsx("div", { className: "label", children: "\u4EE3\u6B21 (Gen)" }), _jsx("div", { className: "val", children: selectedNode.generation !== null ? `Gen ${selectedNode.generation}` : '已卸载' })] }), _jsxs("div", { className: "meta-card", children: [_jsx("div", { className: "label", children: "\u7248\u672C (Ver)" }), _jsxs("div", { className: "val", children: ["v", selectedNode.version] })] }), _jsxs("div", { className: "meta-card", children: [_jsx("div", { className: "label", children: "\u8C03\u5EA6\u72B6\u6001" }), _jsx("div", { className: "val", style: { color: selectedNode.status === 'RUNNING' ? '#22c55e' : undefined }, children: selectedNode.status })] }), _jsxs("div", { className: "meta-card", children: [_jsx("div", { className: "label", children: "\u56E0\u679C\u5C42\u7EA7 (Tier)" }), _jsx("div", { className: "val", children: selectedNode.tier !== undefined ? `Level ${selectedNode.tier}` : '-' })] })] }), _jsxs("div", { className: "state-viewer", children: [_jsx("div", { className: "state-viewer-header", children: "\u79C1\u6709 State \u6295\u5F71 (\u53EA\u8BFB\u89C2\u5BDF)" }), _jsx("pre", { className: "state-json", children: Object.keys(selectedNode.state).length === 0
                                    ? '// 暂无状态字段'
                                    : JSON.stringify(selectedNode.state, null, 2) })] })] }))] }));
}
