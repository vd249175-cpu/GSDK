export class VisualizerClient {
    listeners = new Set();
    unsubscribeIpc;
    isElectron = typeof window !== 'undefined' && Boolean(window.graphvideoDesktop?.graphKernel);
    constructor() {
        this.connect();
    }
    connect() {
        if (this.isElectron) {
            const kernel = window.graphvideoDesktop.graphKernel;
            this.unsubscribeIpc = kernel.subscribe('causal:telemetry', (event) => {
                this.emit(event);
            });
        }
    }
    subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
    emit(event) {
        for (const listener of this.listeners) {
            try {
                listener(event);
            }
            catch (err) {
                console.error('[VisualizerClient] telemetry listener error:', err);
            }
        }
    }
    /**
     * 从正在运行的微内核拉取实时投影快照
     */
    async fetchLiveTopology() {
        if (this.isElectron) {
            const res = await window.graphvideoDesktop.graphKernel.request('graph.topology.read');
            return res || { revision: 0, nodes: [] };
        }
        return { revision: 0, nodes: [] };
    }
    dispose() {
        if (this.unsubscribeIpc) {
            this.unsubscribeIpc();
            this.unsubscribeIpc = undefined;
        }
        this.listeners.clear();
    }
}
export const visualizerClient = new VisualizerClient();
