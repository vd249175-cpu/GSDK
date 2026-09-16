// ../packages/sdk/javascript/src/plugin/plugin.ts
function defineNodeFactory(factory) {
  return (input) => {
    const node = factory(input);
    if (!node.id) throw new Error("NodeFactory \u5FC5\u987B\u4EA7\u51FA\u5177\u6709\u975E\u7A7A id \u7684 Node");
    return node;
  };
}
function defineGraphFactory(factory) {
  return (input) => {
    const nodes = factory(input);
    const ids = /* @__PURE__ */ new Set();
    for (const node of nodes) {
      if (!node.id) throw new Error("GraphFactory \u5FC5\u987B\u4EA7\u51FA\u5177\u6709\u975E\u7A7A id \u7684 Node");
      if (ids.has(node.id)) throw new Error(`GraphFactory \u4EA7\u51FA\u4E86\u91CD\u590D Node ID: ${node.id}`);
      ids.add(node.id);
    }
    return nodes;
  };
}
function defineBackendPlugin(plugin) {
  if (!plugin.id.trim()) throw new Error("Backend Plugin id \u4E0D\u80FD\u4E3A\u7A7A");
  if (typeof plugin.createNodes !== "function") throw new Error(`Backend Plugin ${plugin.id} \u7F3A\u5C11 createNodes`);
  return Object.freeze(plugin);
}

// ../packages/sdk/javascript/src/node/observation.ts
var systemClock = {
  now: () => Date.now(),
  monotonicNow: () => typeof performance !== "undefined" ? performance.now() : Date.now()
};
var systemRandomSource = {
  next: () => Math.random()
};
var TimeRandomIdProvider = class {
  constructor(clock = systemClock, randomSource = systemRandomSource) {
    this.clock = clock;
    this.randomSource = randomSource;
  }
  counter = 0;
  nextId(kind) {
    const timestamp = this.clock.now();
    const count = ++this.counter;
    const random = Math.floor(this.randomSource.next() * 65536).toString(16).padStart(4, "0");
    return `${kind}-${timestamp}-${count}-${random}`;
  }
};
var ValueCodec = class {
  constructor(defaultOptions = {}) {
    this.defaultOptions = defaultOptions;
  }
  encode(value, options = {}) {
    const opts = { ...this.defaultOptions, ...options };
    return this._encodeValue(value, opts.maxDepth ?? 8, opts.rootPath ?? [], opts);
  }
  _encodeValue(value, depthRemaining, path, options) {
    if (value === null || value === void 0) {
      return { $type: "primitive", value };
    }
    const type = typeof value;
    if (type === "string" || type === "number" || type === "boolean") {
      return { $type: "primitive", value };
    }
    if (type === "bigint" || type === "symbol" || type === "function") {
      return { $type: "ref", kind: type, summary: String(value) };
    }
    if (depthRemaining <= 0) {
      return { $type: "truncated", originalType: type, summary: "[Max Depth Reached]" };
    }
    if (value instanceof Map) {
      const entries = [];
      for (const [k, v] of value.entries()) {
        entries.push([
          this._encodeValue(k, depthRemaining - 1, [...path, String(k)], options),
          this._encodeValue(v, depthRemaining - 1, [...path, String(k)], options)
        ]);
      }
      return { $type: "map", entries };
    }
    if (value instanceof Set) {
      const items = Array.from(value.values()).map(
        (item, idx) => this._encodeValue(item, depthRemaining - 1, [...path, String(idx)], options)
      );
      return { $type: "set", values: items };
    }
    if (Array.isArray(value)) {
      const maxLen = options.maxArrayLength ?? 100;
      const items = value.slice(0, maxLen).map(
        (item, idx) => this._encodeValue(item, depthRemaining - 1, [...path, String(idx)], options)
      );
      return { $type: "array", value: items };
    }
    if (value instanceof Uint8Array || typeof Buffer !== "undefined" && Buffer.isBuffer(value)) {
      return {
        $type: "bytes",
        value: typeof Buffer !== "undefined" ? Buffer.from(value).toString("base64") : "",
        byteLength: value.byteLength
      };
    }
    if (type === "object") {
      const record = {};
      const obj = value;
      const keys = Object.keys(obj);
      for (const key of keys) {
        if (options.redactedKeys?.includes(key)) {
          record[key] = { $type: "ref", kind: "redacted", summary: "[REDACTED]" };
        } else {
          record[key] = this._encodeValue(obj[key], depthRemaining - 1, [...path, key], options);
        }
      }
      return { $type: "object", value: record };
    }
    return { $type: "primitive", value: String(value) };
  }
  decode(encoded) {
    if (!encoded || typeof encoded !== "object") return encoded;
    switch (encoded.$type) {
      case "primitive":
        return encoded.value;
      case "array":
        return encoded.value.map((item) => this.decode(item));
      case "map": {
        const map = /* @__PURE__ */ new Map();
        for (const [k, v] of encoded.entries) {
          map.set(this.decode(k), this.decode(v));
        }
        return map;
      }
      case "set": {
        const set = /* @__PURE__ */ new Set();
        for (const v of encoded.values) {
          set.add(this.decode(v));
        }
        return set;
      }
      case "object": {
        const result = {};
        for (const [key, val] of Object.entries(encoded.value)) {
          result[key] = this.decode(val);
        }
        return result;
      }
      case "bytes":
        return typeof Buffer !== "undefined" ? Buffer.from(encoded.value, "base64") : encoded.value;
      case "ref":
      case "truncated":
        return encoded.summary;
      default:
        return encoded;
    }
  }
};
var defaultValueCodec = new ValueCodec();

// ../packages/sdk/javascript/src/testing/internal-access.ts
var nodeRuntimeCapability = Symbol("node-runtime-capability");
var changeContextCapability = Symbol("change-context-capability");

// ../packages/sdk/javascript/src/node/context.ts
var ChangeContextImpl = class {
  constructor(node, rawInfo, changeId, envelope, signal) {
    this.node = node;
    this.rawInfo = rawInfo;
    this.changeId = changeId;
    this.envelope = envelope;
    this.signal = signal;
    const initialState = node.getState();
    if (initialState && typeof initialState === "object") {
      for (const key of Object.keys(initialState)) {
        this.traceValues.set(
          key,
          this.node.encodeTraceValue(key, initialState[key])
        );
      }
    }
  }
  reads = /* @__PURE__ */ new Set();
  writes = /* @__PURE__ */ new Set();
  spans = [];
  stateDeltas = [];
  traceValues = /* @__PURE__ */ new Map();
  read(key) {
    this.signal?.throwIfAborted();
    const keyStr = String(key);
    this.reads.add(keyStr);
    return this.node.getState()[key];
  }
  write(key, value) {
    this.signal?.throwIfAborted();
    const keyStr = String(key);
    this.writes.add(keyStr);
    const before = this.traceValues.get(keyStr) ?? this.node.encodeTraceValue(keyStr, void 0);
    const after = this.node.encodeTraceValue(keyStr, value);
    this.node.commitStateFromChange(
      changeContextCapability,
      this.changeId,
      { [key]: value },
      this.rawInfo
    );
    this.traceValues.set(keyStr, after);
    this.stateDeltas.push({
      ordinal: this.stateDeltas.length + 1,
      field: keyStr,
      before,
      after
    });
  }
  patchState(patch) {
    this.signal?.throwIfAborted();
    const keys = Object.keys(patch);
    for (const key of keys) {
      this.writes.add(key);
    }
    const beforeValues = new Map(
      keys.map((key) => [
        key,
        this.traceValues.get(key) ?? this.node.encodeTraceValue(key, void 0)
      ])
    );
    const afterValues = new Map(
      keys.map((key) => [key, this.node.encodeTraceValue(key, patch[key])])
    );
    this.node.commitStateFromChange(
      changeContextCapability,
      this.changeId,
      patch,
      this.rawInfo
    );
    for (const key of keys) {
      const after = afterValues.get(key);
      this.traceValues.set(key, after);
      this.stateDeltas.push({
        ordinal: this.stateDeltas.length + 1,
        field: key,
        before: beforeValues.get(key),
        after
      });
    }
  }
  send(info, target) {
    this.signal?.throwIfAborted();
    if (!target) return { status: "dropped", reason: "Empty target node id" };
    const infoId = this.node.runtimeId("info");
    return this.node._sendFromChange(changeContextCapability, info, target, {
      infoId,
      causedByChangeId: this.changeId,
      causeInfoId: this.envelope?.infoId,
      submissionId: this.envelope?.submissionId,
      signal: this.signal
    });
  }
  async effectAdapter(adapter, request, options = {}) {
    this.signal?.throwIfAborted();
    if (!this.node.isWorldNode) {
      throw new Error(
        `[Architecture Violation]: Pure domain node "${this.node.name}" (${this.node.id}) cannot execute physical effect! Side effects are strictly restricted to World nodes.`
      );
    }
    if (!adapter.id.trim()) throw new Error("EffectAdapter id \u4E0D\u80FD\u4E3A\u7A7A");
    const signal = options.signal ?? this.signal;
    signal?.throwIfAborted();
    const requestRef = this.node.runtimeValueRef("effect-request", request);
    const name = adapter.id;
    const effectId = this.node.runtimeId("effect");
    this.node.recordEffectRequested({
      effectId,
      changeId: this.changeId,
      nodeId: this.node.id,
      name,
      adapterId: adapter.id,
      requestRef
    });
    try {
      const result = await adapter.execute(request, {
        clock: {
          now: () => this.node.runtimeNow(),
          monotonicNow: () => this.node.runtimeMonotonicNow()
        },
        signal
      });
      signal?.throwIfAborted();
      const observationRef = this.node.runtimeValueRef("effect-observation", result);
      this.node.recordEffectObserved({
        effectId,
        changeId: this.changeId,
        nodeId: this.node.id,
        name,
        status: "succeeded",
        adapterId: adapter.id,
        requestRef,
        observationRef
      });
      return result;
    } catch (err) {
      this.node.recordEffectObserved({
        effectId,
        changeId: this.changeId,
        nodeId: this.node.id,
        name,
        status: "failed",
        adapterId: adapter.id,
        requestRef
      });
      throw err;
    }
  }
  async span(name, action) {
    this.signal?.throwIfAborted();
    const start = this.node.runtimeMonotonicNow();
    const timestamp = this.node.runtimeNow();
    try {
      const result = await action();
      const durationMs = this.node.runtimeMonotonicNow() - start;
      this.spans.push({ name, durationMs, timestamp });
      return result;
    } catch (err) {
      const durationMs = this.node.runtimeMonotonicNow() - start;
      this.spans.push({ name: `${name}:failed`, durationMs, timestamp });
      throw err;
    }
  }
};

// ../packages/sdk/javascript/src/node/node.ts
var fallbackIdProvider = new TimeRandomIdProvider(systemClock, systemRandomSource);
function cancellationError(signal) {
  if (signal.reason instanceof Error) return signal.reason;
  if (signal.reason && typeof signal.reason === "object") {
    const reason = signal.reason;
    if (typeof reason.message === "string") {
      const error2 = new Error(reason.message);
      if (typeof reason.name === "string") error2.name = reason.name;
      return error2;
    }
  }
  const error = new Error(
    typeof signal.reason === "string" ? signal.reason : "Graph execution canceled"
  );
  error.name = "AbortError";
  return error;
}
var Node = class {
  constructor(id, name, initialState = {}, factoryKey) {
    this.id = id;
    this.name = name;
    this.factoryKey = factoryKey || id;
    this.state = { ...initialState };
  }
  factoryKey;
  isWorldNode = false;
  status = "IDLE";
  executionCount = 0;
  lastActiveTime = 0;
  lastErrorMessage = null;
  generation = 0;
  _sealedForReplace = false;
  state;
  regionVersions = /* @__PURE__ */ new Map();
  globalVersion = 0;
  mailbox = [];
  drainingMailbox = false;
  activeChangeId;
  disposers = /* @__PURE__ */ new Set();
  abortController = new AbortController();
  kernel = null;
  getState() {
    return this.state;
  }
  getStateRegionVersions() {
    return Object.fromEntries(this.regionVersions.entries());
  }
  getGlobalStateVersion() {
    return this.globalVersion;
  }
  getMailboxSize() {
    return this.mailbox.length;
  }
  getActiveChangeId() {
    return this.activeChangeId;
  }
  _restoreStateSnapshot(capability, snapshot, decodedState) {
    if (capability !== nodeRuntimeCapability) throw new Error("[Kernel]: Invalid runtime capability");
    if (snapshot.nodeId !== this.id) {
      throw new Error(`State Snapshot \u8282\u70B9\u4E0D\u5339\u914D: \u671F\u671B ${this.id}\uFF0C\u5B9E\u9645 ${snapshot.nodeId}`);
    }
    this.state = decodedState;
    this.globalVersion = snapshot.globalVersion;
    this.regionVersions = new Map(Object.entries(snapshot.regionVersions || {}));
  }
  /** @internal Runtime ownership boundary. Domain nodes cannot reach the engine directly. */
  _mountKernel(capability, kernel) {
    if (capability !== nodeRuntimeCapability) throw new Error("[Kernel]: Invalid runtime capability");
    if (this.kernel && this.kernel !== kernel) {
      throw new Error(`[Kernel]: Node "${this.name}" (${this.id}) \u5DF2\u6302\u8F7D\u5230\u5176\u4ED6 Runtime`);
    }
    this.kernel = kernel;
  }
  /** @internal Runtime ownership boundary. */
  _unmountKernel(capability, kernel) {
    if (capability !== nodeRuntimeCapability) throw new Error("[Kernel]: Invalid runtime capability");
    if (this.kernel === kernel) this.kernel = null;
  }
  _enqueueMailbox(capability, info, envelope, options = {}) {
    if (capability !== nodeRuntimeCapability) {
      return Promise.reject(new Error("[Kernel]: Invalid runtime capability"));
    }
    return new Promise((resolve2, reject) => {
      this.mailbox.push({ info, envelope, options, resolve: resolve2, reject });
    });
  }
  async _drainMailbox(capability) {
    if (capability !== nodeRuntimeCapability) throw new Error("[Kernel]: Invalid runtime capability");
    if (this.drainingMailbox) return;
    this.drainingMailbox = true;
    try {
      while (this.mailbox.length > 0 && !this._sealedForReplace) {
        const item = this.mailbox.shift();
        try {
          if (item.options.signal?.aborted) {
            item.reject(cancellationError(item.options.signal));
            continue;
          }
          await this.runWithinChangeContext(item.info, item.envelope, item.options);
          item.resolve();
        } catch (error) {
          item.reject(error);
        }
      }
    } finally {
      this.drainingMailbox = false;
    }
  }
  async runWithinChangeContext(info, envelope, options = {}) {
    if (this.activeChangeId) {
      throw new Error(
        `[Single-Flight Violation]: \u8282\u70B9 "${this.name}" (${this.id}) \u6B63\u5728\u8FD0\u884C\u53D8\u8FC1 ${this.activeChangeId}\uFF0C\u4E25\u7981\u5E76\u53D1\u6267\u884C change`
      );
    }
    const changeId = this.runtimeId("change");
    this.activeChangeId = changeId;
    const versionBefore = this.globalVersion;
    const causeInfoId = envelope?.infoId || this.runtimeId("info-root");
    const causeInfoType = info.type || "Info";
    this.recordChangeStarted({
      changeId,
      nodeId: this.id,
      causeInfoId,
      causeInfoType,
      stateVersionBefore: versionBefore
    });
    this.kernel?.beginChangeExecution?.(changeId);
    const context = this.createChangeContext(info, changeId, envelope, options.signal);
    const startMonotonic = this.runtimeMonotonicNow();
    const startWall = this.runtimeNow();
    this.status = "RUNNING";
    try {
      await this.change(info, context);
      if (context.stateDeltas.length > 0) {
        this.kernel?.traceSession?.record?.({
          type: "StateDeltaCommitted",
          changeId,
          nodeId: this.id,
          stateVersionAfter: this.globalVersion,
          deltas: context.stateDeltas
        });
      }
      this.status = "IDLE";
      this.executionCount++;
      this.lastActiveTime = this.runtimeNow();
      const record = {
        changeId,
        nodeId: this.id,
        causeInfoId,
        causeInfoType,
        causedByChangeId: envelope?.causedByChangeId,
        stateVersionBefore: versionBefore,
        stateVersionAfter: this.globalVersion,
        reads: Array.from(context.reads),
        writes: Array.from(context.writes),
        stateDeltas: context.stateDeltas,
        spans: context.spans,
        durationMs: this.runtimeMonotonicNow() - startMonotonic,
        timestamp: startWall
      };
      this.recordChange(record);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const errName = err instanceof Error ? err.name : void 0;
      const isAbort = options.signal?.aborted || errName === "AbortError" || message.toLowerCase().includes("abort");
      this.status = isAbort ? "ABORTED" : "ERROR";
      this.lastErrorMessage = message;
      const record = {
        changeId,
        nodeId: this.id,
        causeInfoId,
        causeInfoType,
        causedByChangeId: envelope?.causedByChangeId,
        stateVersionBefore: versionBefore,
        stateVersionAfter: this.globalVersion,
        reads: Array.from(context.reads),
        writes: Array.from(context.writes),
        stateDeltas: context.stateDeltas,
        spans: context.spans,
        durationMs: this.runtimeMonotonicNow() - startMonotonic,
        timestamp: startWall,
        error: this.lastErrorMessage || void 0
      };
      this.recordChange(record);
      if (isAbort) throw err;
      this.routeNodeErrorAsInfo({
        changeId,
        causeInfoId,
        causeInfoType,
        submissionId: envelope?.submissionId,
        triggerInfoType: info.type,
        message,
        stack: err instanceof Error ? err.stack : void 0
      });
    } finally {
      this.kernel?.endChangeExecution?.(changeId);
      this.activeChangeId = void 0;
    }
  }
  createChangeContext(info, changeId, envelope, signal) {
    return new ChangeContextImpl(this, info, changeId, envelope, signal);
  }
  get stateVersion() {
    return this.globalVersion;
  }
  commitStateFromChange(capability, changeId, patch, causeInfo) {
    if (capability !== changeContextCapability) {
      throw new Error(`[State Write Violation]: Node ${this.id} \u62D2\u7EDD\u975E ChangeContext \u5199\u5165`);
    }
    if (!this.activeChangeId || this.activeChangeId !== changeId) {
      throw new Error(`[State Write Violation]: Node ${this.id} \u53EA\u80FD\u5728 change context \u5185\u63D0\u4EA4 State`);
    }
    const region = causeInfo?.type || "change";
    this.regionVersions.set(region, (this.regionVersions.get(region) || 0) + 1);
    this.globalVersion += 1;
    this.state = { ...this.state, ...patch };
  }
  _sendFromChange(capability, info, target, options) {
    if (capability !== changeContextCapability) {
      throw new Error(`[Send Violation]: Node ${this.id} \u62D2\u7EDD\u975E ChangeContext \u53D1\u4FE1`);
    }
    if (!this.activeChangeId || options?.causedByChangeId !== this.activeChangeId) {
      throw new Error(`[Send Violation]: Node ${this.id} \u53EA\u80FD\u901A\u8FC7\u5F53\u524D change context \u53D1\u4FE1`);
    }
    if (!this.kernel) {
      throw new Error(`[Kernel]: Node "${this.name}" (${this.id}) \u5C1A\u672A\u6302\u8F7D\uFF0C\u65E0\u6CD5\u53D1\u4FE1`);
    }
    return this.kernel._deliverSendFromChange(this, info, target, options);
  }
  routeNodeErrorAsInfo(input) {
    if (!this.kernel || typeof this.kernel._routeNodeError !== "function") return;
    if (input.triggerInfoType === "@error/NodeFailed") return;
    const errorInfo = {
      type: "@error/NodeFailed",
      nodeId: this.id,
      generation: this.generation,
      changeId: input.changeId,
      submissionId: input.submissionId,
      causeInfoId: input.causeInfoId,
      causeInfoType: input.causeInfoType,
      message: input.message,
      stack: input.stack
    };
    try {
      this.kernel._routeNodeError(this, errorInfo, input.submissionId);
    } catch {
    }
  }
  _discardMailbox(capability, reason) {
    if (capability !== nodeRuntimeCapability) throw new Error("[Kernel]: Invalid runtime capability");
    const discarded = this.mailbox.length;
    while (this.mailbox.length > 0) {
      const item = this.mailbox.shift();
      try {
        item.resolve();
      } catch {
      }
    }
    if (discarded > 0) {
      this.kernel?.traceSession?.record?.({
        type: "InfoDropped",
        nodeId: this.id,
        reason,
        count: discarded
      });
    }
    return discarded;
  }
  change(_info, _ctx) {
  }
  runtimeNow() {
    return this.kernel?.now?.() ?? systemClock.now();
  }
  runtimeMonotonicNow() {
    return this.kernel?.monotonicNow?.() ?? systemClock.monotonicNow();
  }
  runtimeId(kind) {
    return this.kernel?.nextId?.(kind) ?? fallbackIdProvider.nextId(kind);
  }
  encodeTraceValue(field, value) {
    return this.kernel?.encodeTraceValue?.(this.id, field, value) ?? {
      $type: "primitive",
      value: value ?? null
    };
  }
  runtimeValueRef(kind, value) {
    return this.kernel?.recordValueRef?.(kind, value) ?? `${kind}:${this.runtimeId("effect")}`;
  }
  recordChangeStarted(input) {
    this.kernel?.recordChangeStarted?.(input);
  }
  recordChange(record) {
    this.kernel?.recordChange?.(record);
  }
  recordEffectRequested(input) {
    this.kernel?.recordEffectRequested?.(input);
  }
  recordEffectObserved(input) {
    this.kernel?.recordEffectObserved?.(input);
  }
  onMount() {
  }
  onUnmount() {
  }
  registerDisposer(disposer) {
    this.disposers.add(disposer);
  }
  async dispose() {
    this.abort();
    for (const disposer of this.disposers) {
      try {
        await disposer();
      } catch (err) {
        console.error(`[Node ${this.id}] Disposer failed:`, err);
      }
    }
    this.disposers.clear();
    this.onUnmount();
    this.status = "IDLE";
  }
  abort(reason) {
    this.abortController.abort(reason);
    this.status = "ABORTED";
    this.lastErrorMessage = reason || "Execution aborted";
    this.abortController = new AbortController();
  }
  reset() {
    this.status = "IDLE";
    this.lastErrorMessage = null;
    this.mailbox.length = 0;
  }
};
var WorldNode = class extends Node {
  isWorldNode = true;
  worldKind;
};
var ExecutionWorldNode = class extends WorldNode {
  worldKind = "execution";
};
var ObservationWorldNode = class extends WorldNode {
  worldKind = "observation";
};

// ../packages/sdk/javascript/src/testing/effect-harness.ts
var defaultMaxFixtureBytes = 64 * 1024;

// ../plugins/graphvideo.studio/backend/effects/electron-window-adapter.ts
var electronWindowAdapterId = "graphvideo/electron-window-v1";
var InMemoryElectronWindowAdapter = class {
  id = electronWindowAdapterId;
  config = {
    title: "GraphVideo Desktop",
    width: 1400,
    height: 900,
    frameless: true
  };
  open = false;
  maximized = false;
  async execute(request) {
    if (request.type === "OPEN") {
      this.config = { ...request.config };
      this.open = true;
      return { type: "OPENED", isWindowOpen: true, config: this.config };
    }
    if (request.type === "CONFIGURE") {
      this.config = { ...this.config, ...request.config };
      return { type: "CONFIGURED", isWindowOpen: this.open, config: this.config };
    }
    if (request.type === "CLOSE") {
      this.open = false;
      return { type: "CLOSED", isWindowOpen: false, config: this.config };
    }
    if (request.type === "TOGGLE_MAXIMIZE") {
      this.maximized = !this.maximized;
      return {
        type: this.maximized ? "MAXIMIZED" : "UNMAXIMIZED",
        isWindowOpen: this.open,
        config: this.config
      };
    }
    return {
      type: request.type === "MINIMIZE" ? "MINIMIZED" : "RELOADED",
      isWindowOpen: this.open,
      config: this.config
    };
  }
};

// ../plugins/graphvideo.studio/backend/nodes/electron-host.ts
var ElectronHostNode = class extends Node {
  constructor(id = "host-el", name = "\u684C\u9762\u751F\u547D\u5468\u671F\u63A7\u5236\u5668") {
    super(id, name, {
      isWindowOpen: false,
      config: { title: "GraphVideo Desktop", width: 1440, height: 900, frameless: true },
      lastStatePayload: null,
      lastOperation: null,
      lastError: null
    });
    this.icon = "\u{1F5A5}\uFE0F";
    this.description = "\u684C\u9762\u7A97\u53E3\u7684\u5F00\u542F\u3001\u5173\u95ED\u548C\u64CD\u4F5C\u610F\u56FE\u7ECF Info \u8FDB\u5165\u56FE\uFF1B\u72B6\u6001\u53EA\u7531\u7A97\u53E3 Observation \u66F4\u65B0";
  }
  change(info, ctx) {
    if (info.type === "DesktopStartRequestedInfo" || info.type === "OpenWindowTaskInfo" || info.type === "BootInfo") {
      if (ctx.read("isWindowOpen")) return;
      const config = info.config && typeof info.config === "object" ? { ...ctx.read("config"), ...info.config } : ctx.read("config");
      ctx.send({ type: "ElectronWindowEffectRequestedInfo", request: { type: "OPEN", config } }, "sink-electron-window");
      return;
    }
    if (info.type === "DesktopCloseRequestedInfo") {
      if (!ctx.read("isWindowOpen")) return;
      ctx.send({ type: "ElectronWindowEffectRequestedInfo", request: { type: "CLOSE" } }, "sink-electron-window");
      return;
    }
    if (info.type === "ConfigureWindowTaskInfo" && info.config && typeof info.config === "object") {
      ctx.send({ type: "ElectronWindowEffectRequestedInfo", request: { type: "CONFIGURE", config: info.config } }, "sink-electron-window");
      return;
    }
    if (info.type === "WindowActionTaskInfo" && info.action) {
      const action = String(info.action).toUpperCase();
      if (action === "MINIMIZE" || action === "TOGGLE_MAXIMIZE" || action === "RELOAD" || action === "CLOSE") {
        ctx.send({ type: "ElectronWindowEffectRequestedInfo", request: { type: action } }, "sink-electron-window");
      }
      return;
    }
    if (info.type === "DesktopWindowObservedInfo" && info.observation && typeof info.observation === "object") {
      const observation = info.observation;
      ctx.patchState({
        isWindowOpen: observation.isWindowOpen,
        config: { ...ctx.read("config"), ...observation.config },
        lastOperation: observation.type,
        lastError: null
      });
      return;
    }
    if (info.type === "ElectronWindowEffectFailedInfo") {
      ctx.write("lastError", String(info.message));
      return;
    }
    if (info.type === "UiStateInfo") ctx.write("lastStatePayload", info.payload);
  }
};
var ElectronWindowExecutionNode = class extends ExecutionWorldNode {
  constructor(id = "sink-electron-window", name = "\u684C\u9762\u7A97\u53E3\u6267\u884C\u7AEF", adapter = new InMemoryElectronWindowAdapter()) {
    super(id, name, {});
    this.adapter = adapter;
  }
  async change(info, ctx) {
    if (info.type !== "ElectronWindowEffectRequestedInfo") return;
    try {
      const observation = await ctx.effectAdapter(this.adapter, info.request);
      ctx.send({ type: "ElectronWindowEffectObservedInfo", observation }, "src-electron-window");
    } catch (error) {
      ctx.send({
        type: "ElectronWindowEffectFailedInfo",
        message: error instanceof Error ? error.message : String(error)
      }, "host-el");
    }
  }
};
var ElectronWindowObservationNode = class extends ObservationWorldNode {
  constructor(id = "src-electron-window", name = "\u684C\u9762\u7A97\u53E3\u89C2\u6D4B\u7AEF") {
    super(id, name, {});
  }
  change(info, ctx) {
    if (info.type === "ElectronWindowEffectObservedInfo") {
      ctx.send({ type: "DesktopWindowObservedInfo", observation: info.observation }, "host-el");
    } else if (info.type === "ElectronWindowClosedObservedInfo") {
      ctx.send({
        type: "DesktopWindowObservedInfo",
        observation: { type: "CLOSED", isWindowOpen: false }
      }, "host-el");
    }
  }
};

// ../plugins/graphvideo.studio/backend/nodes/file-system.ts
var FileSystemSourceNode = class extends WorldNode {
  constructor(id = "src-fs-source", name = "\u6587\u4EF6\u7CFB\u7EDF\u8F93\u5165\u6E90") {
    super(id, name, {
      projectName: "\u672A\u6253\u5F00\u9879\u76EE",
      currentPath: ".graphvideo/nodes.sqlite",
      loadedBytes: 0,
      lastObservedAt: 0
    });
    this.icon = "\u{1F4C4}";
    this.description = "\u3010\u73B0\u5B9E\u89C2\u6D4B\u6E90\u3011\u89C2\u6D4B\u5916\u90E8\u6587\u4EF6\u7CFB\u7EDF\u53D8\u52A8\u4E0E\u5BFC\u5165\u7F51\u5173 (Import Gateway)\n\u3010\u534F\u8BAE\u63D0\u5347\u3011\u6587\u4EF6\u53D8\u52A8 -> ProjectConfigObservedInfo\n\u3010\u5355\u5411\u6D41\u3011\u5C06\u5916\u90E8\u5BFC\u5165\u4E0E\u73AF\u5883\u4E8B\u5B9E\u63A8\u6D41\u81F3\u4E0B\u6E38\u4E2D\u53F0";
  }
  async change(info, ctx) {
    const now = this.runtimeNow();
    if (info.type === "ProjectOpenedInfo" && info.project) {
      const project = info.project;
      ctx.patchState({
        projectName: project.name,
        currentPath: project.path,
        loadedBytes: project.markdown.length,
        lastObservedAt: now
      });
      ctx.send({
        type: "ProjectMetadataHydratedInfo",
        nodes: project.nodes,
        retainedNodes: project.retainedNodes,
        observedAt: now
      }, "node-sqlite");
      ctx.send({
        type: "ProjectMarkdownRunRequestedInfo",
        markdown: project.markdown,
        hydration: true
      }, "node-md-source");
      const configTargets = ["sink-sqlite-writer"];
      for (const target of configTargets) {
        ctx.send({
          type: "ProjectConfigObservedInfo",
          projectName: project.name,
          projectPath: project.path,
          config: {
            projectRoot: project.path,
            projectId: project.path,
            exportDirectory: project.path
          }
        }, target);
      }
      return;
    }
    if (info.type === "BootInfo") {
      {
        ctx.write("lastObservedAt", now);
      }
    } else if (info.type === "WatchPathInfo" && info.path) {
      {
        ctx.write("currentPath", String(info.path));
      }
    } else if (info.type === "ShutdownInfo") {
      {
        ctx.write("loadedBytes", 0);
        ctx.send({
          type: "StoppedInfo",
          nodeId: this.id
        }, "host-el");
      }
    }
  }
  getBodySummaryText() {
    return this.state.loadedBytes > 0 ? `\u3010\u5F53\u524D\u9879\u76EE\u3011${this.state.projectName}
\u3010\u5F53\u524D\u88C5\u8F7D\u3011${this.state.currentPath} (${this.state.loadedBytes} B)
\u3010\u534F\u8BAE\u8F93\u51FA\u3011ProjectFileObservedInfo` : this.description;
  }
};

// ../plugins/graphvideo.studio/backend/nodes/generation-security.ts
var SecurityGateNode = class extends Node {
  constructor(id = "node-sec-gate", name = "\u98CE\u63A7\u4E0E\u9884\u7B97\u5173\u53E3", options = {}) {
    super(id, name, {
      spentCredits: 0,
      maxCreditBudget: options.maxCreditBudget ?? 1e4,
      lastBlockReason: null,
      lastVerifiedArtifact: null
    });
    this.category = "decision";
    this.icon = "\u{1F6E1}\uFE0F";
    this.description = "\u3010\u9884\u7B97 Owner\u3011\u6309\u89E3\u6790\u540E\u7684\u6A21\u578B\u8BA1\u5212\u6838\u7B97\u5E76\u7B7E\u53D1\u6279\u6B21\n\u3010\u51C6\u5165\u51B3\u7B56\u3011\u9884\u7B97\u4E0D\u8DB3\u65F6\u62D2\u7EDD\u8FDB\u5165\u751F\u6210\u4EFB\u52A1\u72B6\u6001\u673A\n\u3010\u4E8B\u5B9E\u6838\u9500\u3011\u63A5\u6536\u7269\u7406\u843D\u76D8 Observation \u5E76\u8F6C\u4EA4 SQLite";
  }
  async change(info, ctx) {
    if (info.type === "GenerationBudgetConfiguredInfo") {
      const configured = info;
      if (!Number.isFinite(configured.maxBudget) || configured.maxBudget < 0) {
        throw new Error("\u751F\u6210\u9884\u7B97\u5FC5\u987B\u662F\u975E\u8D1F\u6709\u9650\u6570\u503C");
      }
      ctx.write("maxCreditBudget", configured.maxBudget);
      ctx.write("lastBlockReason", null);
      return;
    }
    if (info.type === "GenerationCreditsResetInfo") {
      void info;
      ctx.write("spentCredits", 0);
      ctx.write("lastBlockReason", null);
      return;
    }
    if (info.type === "GenerationBatchPlannedInfo") {
      const planned = info;
      ctx.send(planned, "node-generation-task");
      return;
    }
    if (info.type === "GenerationSubmitBatchRequestedInfo") {
      const planned = info;
      const cost = planned.tasks.reduce((sum, task) => sum + task.estimatedCredits, 0);
      const currentSpent = ctx.read("spentCredits");
      const maxBudget = ctx.read("maxCreditBudget");
      if (!Number.isFinite(cost) || cost < 0 || currentSpent + cost > maxBudget) {
        const reason = `\u62E6\u622A\uFF1A\u672C\u6279\u9700 ${cost} \u79EF\u5206\uFF0C\u5DF2\u6D88\u8017 ${currentSpent}\uFF0C\u8D85\u8FC7\u9884\u7B97 ${maxBudget} \u6216\u79EF\u5206\u65E0\u6548`;
        ctx.write("lastBlockReason", reason);
        ctx.send({
          type: "GenerationBatchSubmittedObservedInfo",
          batchId: planned.batchId,
          results: planned.tasks.map((task) => ({
            taskId: task.taskId,
            ok: false,
            provider: task.submit.provider,
            error: reason
          }))
        }, "node-generation-task");
        return;
      }
      ctx.write("spentCredits", currentSpent + cost);
      ctx.write("lastBlockReason", null);
      ctx.send(planned, "sink-generation-submit");
      return;
    }
    if (info.type === "ArtifactSavedObservedInfo" && info.relativePath) {
      const observed = info;
      {
        ctx.write("lastVerifiedArtifact", {
          id: observed.versionId,
          name: observed.filename,
          filename: observed.filename,
          kind: observed.mediaType,
          type: observed.mediaType,
          url: observed.relativePath
        });
        ctx.send(observed, "node-sqlite");
      }
      return;
    }
  }
  getSpentCredits() {
    return this.state.spentCredits;
  }
  getMaxCreditBudget() {
    return this.state.maxCreditBudget;
  }
  getLastBlockReason() {
    return this.state.lastBlockReason;
  }
  getBodySummaryText() {
    return this.state.lastBlockReason ? `\u98CE\u63A7\u62E6\u622A: ${this.state.lastBlockReason}` : this.description || `\u79EF\u5206\u653E\u884C: ${this.state.spentCredits}/${this.state.maxCreditBudget}`;
  }
};

// ../plugins/graphvideo.studio/backend/effects/generation-adapter-operation.ts
var generationAdapterOperationId = "graphvideo/generation-adapter-operation-v1";
var UnavailableGenerationAdapterOperation = class {
  id = generationAdapterOperationId;
  async execute(request, _context) {
    throw new Error(`Generation worker adapter is unavailable for ${request.operation}`);
  }
};

// ../plugins/graphvideo.studio/backend/nodes/generation-download.ts
var GenerationDownloadSinkNode = class extends WorldNode {
  constructor(id = "sink-generation-download", name = "\u751F\u6210\u4EA7\u7269\u4E0B\u8F7D\u7AEF", adapter = new UnavailableGenerationAdapterOperation(), taskTargetId = "node-generation-task") {
    super(id, name, {});
    this.adapter = adapter;
    this.taskTargetId = taskTargetId;
    this.icon = "\u{1F4E5}";
    this.description = "\u53EA\u4E0B\u8F7D\u5DF2\u7ECF\u7531\u8F6E\u8BE2\u786E\u8BA4 ready \u7684\u4EA7\u7269\uFF0C\u5E76\u8FD4\u56DE\u7269\u7406\u5199\u5165 Observation";
  }
  async change(info, ctx) {
    if (info.type !== "GenerationDownloadBatchRequestedInfo") return;
    const requested = info;
    await Promise.all(requested.tasks.map(async (task) => {
      let result;
      try {
        const observation = await ctx.effectAdapter(this.adapter, {
          operation: "download",
          artifact: task.artifact,
          destinationRelativePath: task.destinationRelativePath
        });
        if (observation.operation !== "download" || observation.status !== "downloaded") {
          throw new Error("\u751F\u6210 adapter \u4E0B\u8F7D\u8FD4\u56DE\u4E86\u9519\u8BEF\u7684 Observation");
        }
        result = {
          taskId: task.taskId,
          ok: true,
          bytesWritten: observation.bytesWritten,
          destinationRelativePath: observation.destinationRelativePath,
          contentType: observation.contentType,
          filename: task.artifact.filename
        };
      } catch (error) {
        result = {
          taskId: task.taskId,
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        };
      }
      const observedInfo = {
        type: "GenerationBatchDownloadedObservedInfo",
        batchId: requested.batchId,
        results: [result]
      };
      ctx.send(observedInfo, this.taskTargetId);
    }));
  }
};

// ../plugins/graphvideo.studio/backend/nodes/generation-poll.ts
var GenerationPollSourceNode = class extends WorldNode {
  constructor(id = "src-generation-poll", name = "\u751F\u6210\u72B6\u6001\u5355\u6B21\u89C2\u6D4B\u7AEF", adapter = new UnavailableGenerationAdapterOperation(), taskTargetId = "node-generation-task") {
    super(id, name, {});
    this.adapter = adapter;
    this.taskTargetId = taskTargetId;
    this.icon = "\u{1F50E}";
    this.description = "\u5BF9\u6279\u6B21\u5185\u6BCF\u4E2A handle \u5E76\u884C\u67E5\u8BE2\u4E00\u6B21\u72B6\u6001\uFF1Bpending \u4E0D\u4F1A\u81EA\u52A8\u518D\u6B21\u8F6E\u8BE2";
  }
  async change(info, ctx) {
    if (info.type !== "GenerationPollBatchRequestedInfo") return;
    const requested = info;
    const results = await Promise.all(requested.tasks.map(async (task) => {
      try {
        const observation = await ctx.effectAdapter(this.adapter, {
          operation: "poll",
          handle: task.handle
        });
        if (observation.operation !== "poll") {
          throw new Error("\u751F\u6210 adapter \u8F6E\u8BE2\u8FD4\u56DE\u4E86\u9519\u8BEF\u7684 Observation");
        }
        if (observation.status === "failed") {
          return { taskId: task.taskId, ok: false, error: observation.error };
        }
        return observation.status === "ready" ? {
          taskId: task.taskId,
          ok: true,
          status: "ready",
          progress: observation.progress,
          artifact: observation.artifact
        } : {
          taskId: task.taskId,
          ok: true,
          status: "pending",
          progress: observation.progress,
          remoteStatus: observation.remoteStatus
        };
      } catch (error) {
        return {
          taskId: task.taskId,
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    }));
    const observedInfo = {
      type: "GenerationBatchPolledObservedInfo",
      batchId: requested.batchId,
      results
    };
    ctx.send(observedInfo, this.taskTargetId);
  }
};

// ../plugins/graphvideo.studio/backend/effects/generation-poll-delay.ts
var GenerationPollDelayAdapter = class {
  id = "graphvideo/generation-poll-delay-v1";
  async execute(request, context) {
    if (!Number.isFinite(request.delayMs) || request.delayMs < 0) throw new Error("\u8F6E\u8BE2\u5EF6\u8FDF\u5FC5\u987B\u662F\u975E\u8D1F\u6570");
    await new Promise((resolve2, reject) => {
      const timer = setTimeout(resolve2, request.delayMs);
      const abort = () => {
        clearTimeout(timer);
        reject(context.signal?.reason ?? new Error("\u751F\u6210\u8F6E\u8BE2\u8C03\u5EA6\u5DF2\u53D6\u6D88"));
      };
      if (context.signal?.aborted) abort();
      else context.signal?.addEventListener("abort", abort, { once: true });
    });
    return { elapsed: true, taskIds: request.taskIds };
  }
};

// ../plugins/graphvideo.studio/backend/nodes/generation-poll-scheduler.ts
var GenerationPollSchedulerNode = class extends WorldNode {
  constructor(id = "src-generation-poll-scheduler", name = "\u751F\u6210\u8F6E\u8BE2\u8C03\u5EA6\u6E90", delayAdapter = new GenerationPollDelayAdapter(), taskTargetId = "node-generation-task") {
    super(id, name, {});
    this.delayAdapter = delayAdapter;
    this.taskTargetId = taskTargetId;
    this.icon = "\u23F1\uFE0F";
    this.description = "pending \u540E\u53EA\u7B49\u5F85\u4E00\u4E2A\u7269\u7406\u95F4\u9694\u5E76\u53D1\u51FA\u65B0\u7684\u8F6E\u8BE2\u610F\u56FE\uFF1B\u72B6\u6001\u67E5\u8BE2\u4ECD\u7531\u72EC\u7ACB poll Node \u6267\u884C";
  }
  async change(info, ctx) {
    if (info.type !== "GenerationPollScheduleRequestedInfo") return;
    const requested = info;
    const observation = await ctx.effectAdapter(this.delayAdapter, {
      delayMs: requested.delayMs ?? 1e3,
      taskIds: requested.taskIds
    });
    const pollInfo = {
      type: "GenerationTasksPollRequestedInfo",
      taskIds: observation.taskIds
    };
    ctx.send(pollInfo, this.taskTargetId);
  }
};

// ../plugins/graphvideo.studio/backend/nodes/generation-submit.ts
var GenerationSubmitSinkNode = class extends WorldNode {
  constructor(id = "sink-generation-submit", name = "\u751F\u6210\u8BF7\u6C42\u63D0\u4EA4\u7AEF", adapter = new UnavailableGenerationAdapterOperation(), taskTargetId = "node-generation-task") {
    super(id, name, {});
    this.adapter = adapter;
    this.taskTargetId = taskTargetId;
    this.icon = "\u{1F4E4}";
    this.description = "\u5E76\u884C\u63D0\u4EA4\u4E00\u4E2A\u51C6\u5165\u6279\u6B21\u7684\u7269\u7406\u8BF7\u6C42\uFF1B\u53EA\u8FD4\u56DE handle\uFF0C\u4E0D\u8F6E\u8BE2\u6216\u4E0B\u8F7D";
  }
  async change(info, ctx) {
    if (info.type !== "GenerationSubmitBatchRequestedInfo") return;
    const requested = info;
    const results = await Promise.all(requested.tasks.map(async (task) => {
      try {
        const observation = await ctx.effectAdapter(this.adapter, {
          operation: "submit",
          spec: task.submit
        });
        if (observation.operation !== "submit" || observation.status !== "submitted") {
          throw new Error("\u751F\u6210 adapter \u63D0\u4EA4\u8FD4\u56DE\u4E86\u9519\u8BEF\u7684 Observation");
        }
        return { taskId: task.taskId, ok: true, handle: observation.handle };
      } catch (error) {
        return {
          taskId: task.taskId,
          ok: false,
          provider: task.submit.provider,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    }));
    const observedInfo = {
      type: "GenerationBatchSubmittedObservedInfo",
      batchId: requested.batchId,
      results
    };
    ctx.send(observedInfo, this.taskTargetId);
  }
};

// ../plugins/graphvideo.studio/backend/nodes/generation-task.ts
function checkedDestination(value) {
  const normalized = value.replace(/\\/g, "/");
  const segments = normalized.split("/");
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) {
    throw new Error("\u751F\u6210\u4E0B\u8F7D\u76EE\u6807\u5FC5\u987B\u662F\u9879\u76EE\u5185\u76F8\u5BF9\u8DEF\u5F84");
  }
  if (segments.some((segment) => segment === "..")) {
    throw new Error("\u751F\u6210\u4E0B\u8F7D\u76EE\u6807\u4E0D\u5F97\u8D8A\u51FA\u9879\u76EE\u76EE\u5F55");
  }
  return normalized;
}
function checkedPlannedTasks(tasks) {
  if (tasks.length === 0) throw new Error("\u751F\u6210\u6279\u6B21\u4E0D\u80FD\u4E3A\u7A7A");
  const ids = /* @__PURE__ */ new Set();
  const targets = /* @__PURE__ */ new Set();
  return tasks.map((task) => {
    if (!task.taskId || !task.targetNodeId) throw new Error("\u751F\u6210\u4EFB\u52A1\u7F3A\u5C11\u7A33\u5B9A\u6807\u8BC6");
    if (ids.has(task.taskId)) throw new Error(`\u751F\u6210\u6279\u6B21\u5305\u542B\u91CD\u590D\u4EFB\u52A1: ${task.taskId}`);
    if (targets.has(task.targetNodeId)) throw new Error(`\u751F\u6210\u6279\u6B21\u5305\u542B\u91CD\u590D\u76EE\u6807: ${task.targetNodeId}`);
    if (!Number.isFinite(task.estimatedCredits) || task.estimatedCredits < 0) {
      throw new Error(`\u751F\u6210\u4EFB\u52A1\u79EF\u5206\u65E0\u6548: ${task.taskId}`);
    }
    if (task.maxGenerationWaitMs !== void 0 && (!Number.isFinite(task.maxGenerationWaitMs) || task.maxGenerationWaitMs < 0)) {
      throw new Error(`\u751F\u6210\u4EFB\u52A1\u7B49\u5F85\u65F6\u95F4\u65E0\u6548: ${task.taskId}`);
    }
    ids.add(task.taskId);
    targets.add(task.targetNodeId);
    return {
      ...task,
      destinationRelativePath: checkedDestination(task.destinationRelativePath)
    };
  });
}
var GenerationTaskNode = class extends Node {
  constructor(id = "node-generation-task", name = "\u751F\u6210\u4EFB\u52A1\u72B6\u6001\u63A7\u5236\u5668", submitTargetId = "node-sec-gate", pollTargetId = "src-generation-poll", downloadTargetId = "sink-generation-download", pollSchedulerTargetId = "src-generation-poll-scheduler", artifactObservedTargetId = "node-sec-gate") {
    super(id, name, { tasks: /* @__PURE__ */ new Map() });
    this.submitTargetId = submitTargetId;
    this.pollTargetId = pollTargetId;
    this.downloadTargetId = downloadTargetId;
    this.pollSchedulerTargetId = pollSchedulerTargetId;
    this.artifactObservedTargetId = artifactObservedTargetId;
    this.icon = "\u{1F9ED}";
    this.description = "\u751F\u6210\u4EFB\u52A1\u9636\u6BB5\u552F\u4E00 Owner\uFF1B\u6309 Info \u63A8\u8FDB\u63D0\u4EA4\u3001\u5355\u6B21\u8F6E\u8BE2\u4E0E\u4E0B\u8F7D\uFF0C\u4E0D\u6267\u884C\u7269\u7406 I/O";
  }
  async change(info, ctx) {
    if (info.type === "GenerationModelResolutionCompletedInfo") {
      void info;
      return;
    }
    if (info.type === "GenerationModelResolutionFailedInfo") {
      void info;
      return;
    }
    if (info.type === "GenerationBatchPlannedInfo") {
      const planned = info;
      const tasks = checkedPlannedTasks(planned.tasks);
      const next = new Map(ctx.read("tasks"));
      const startedAt = this.runtimeNow();
      const activeTargets = new Set([...next.values()].filter((task) => !["downloaded", "failed", "canceled"].includes(task.phase)).map((task) => task.targetNodeId));
      for (const task of tasks) {
        if (activeTargets.has(task.targetNodeId)) {
          throw new Error(`\u751F\u6210\u76EE\u6807\u4ECD\u5728\u6267\u884C: ${task.targetNodeId}`);
        }
        const existing = next.get(task.taskId);
        if (existing) {
          throw new Error(`\u751F\u6210\u4EFB\u52A1\u6807\u8BC6\u5DF2\u4F7F\u7528: ${task.taskId}`);
        }
        next.set(task.taskId, {
          taskId: task.taskId,
          batchId: planned.batchId,
          targetNodeId: task.targetNodeId,
          provider: task.submit.provider,
          destinationRelativePath: task.destinationRelativePath,
          versionId: task.versionId,
          mediaType: task.mediaType,
          phase: "submitting",
          progress: 0,
          handle: null,
          error: "",
          autoPoll: task.autoPoll === true,
          startedAt,
          maxGenerationWaitMs: Math.round(task.maxGenerationWaitMs ?? 0)
        });
      }
      ctx.write("tasks", next);
      const submitInfo = {
        type: "GenerationSubmitBatchRequestedInfo",
        batchId: planned.batchId,
        tasks
      };
      ctx.send(submitInfo, this.submitTargetId);
      return;
    }
    if (info.type === "GenerationBatchCancelRequestedInfo") {
      const requested = info;
      const next = new Map(ctx.read("tasks"));
      let changed = false;
      for (const [taskId, current] of next) {
        if (current.batchId !== requested.batchId || ["downloaded", "failed", "canceled"].includes(current.phase)) continue;
        next.set(taskId, {
          ...current,
          phase: "canceled",
          error: requested.reason?.trim() || "\u7528\u6237\u5DF2\u53D6\u6D88\u751F\u6210"
        });
        changed = true;
      }
      if (changed) ctx.write("tasks", next);
      return;
    }
    if (info.type === "GenerationBatchSubmittedObservedInfo") {
      const observed = info;
      const next = new Map(ctx.read("tasks"));
      const pollTasks = [];
      for (const result of observed.results) {
        const current = next.get(result.taskId);
        if (!current || current.phase !== "submitting") continue;
        if (!result.ok) {
          next.set(result.taskId, { ...current, phase: "failed", error: result.error });
          continue;
        }
        next.set(result.taskId, {
          ...current,
          phase: "polling",
          progress: 10,
          handle: result.handle,
          error: ""
        });
        pollTasks.push({ taskId: result.taskId, handle: result.handle });
      }
      ctx.write("tasks", next);
      if (pollTasks.length > 0) {
        const pollInfo = {
          type: "GenerationPollBatchRequestedInfo",
          batchId: observed.batchId,
          tasks: pollTasks
        };
        ctx.send(pollInfo, this.pollTargetId);
      }
      return;
    }
    if (info.type === "GenerationBatchPolledObservedInfo") {
      const observed = info;
      const next = new Map(ctx.read("tasks"));
      const downloads = [];
      const scheduledPollTaskIds = [];
      for (const result of observed.results) {
        const current = next.get(result.taskId);
        if (!current || current.phase !== "polling") continue;
        if (!result.ok) {
          next.set(result.taskId, { ...current, phase: "failed", progress: 0, error: result.error });
        } else if (result.status === "pending") {
          if (current.maxGenerationWaitMs > 0 && this.runtimeNow() - current.startedAt >= current.maxGenerationWaitMs) {
            next.set(result.taskId, {
              ...current,
              phase: "failed",
              progress: 0,
              error: `\u751F\u6210\u7B49\u5F85\u8D85\u8FC7 ${Math.round(current.maxGenerationWaitMs / 6e4)} \u5206\u949F`
            });
            continue;
          }
          next.set(result.taskId, {
            ...current,
            phase: "waiting",
            progress: result.progress,
            error: ""
          });
          if (current.autoPoll) scheduledPollTaskIds.push(result.taskId);
        } else {
          next.set(result.taskId, {
            ...current,
            phase: "downloading",
            progress: result.progress,
            error: ""
          });
          downloads.push({
            taskId: result.taskId,
            artifact: result.artifact,
            destinationRelativePath: current.destinationRelativePath
          });
        }
      }
      ctx.write("tasks", next);
      if (downloads.length > 0) {
        const downloadInfo = {
          type: "GenerationDownloadBatchRequestedInfo",
          batchId: observed.batchId,
          tasks: downloads
        };
        ctx.send(downloadInfo, this.downloadTargetId);
      }
      if (scheduledPollTaskIds.length > 0) {
        const scheduleInfo = {
          type: "GenerationPollScheduleRequestedInfo",
          taskIds: scheduledPollTaskIds
        };
        ctx.send(scheduleInfo, this.pollSchedulerTargetId);
      }
      return;
    }
    if (info.type === "GenerationBatchDownloadedObservedInfo") {
      const observed = info;
      const next = new Map(ctx.read("tasks"));
      for (const result of observed.results) {
        const current = next.get(result.taskId);
        if (!current || current.phase !== "downloading") continue;
        next.set(result.taskId, result.ok ? { ...current, phase: "persisting", progress: 100, error: "" } : { ...current, phase: "failed", progress: 0, error: result.error });
        if (result.ok) {
          const savedInfo = {
            type: "ArtifactSavedObservedInfo",
            taskId: result.taskId,
            targetNodeId: current.targetNodeId,
            versionId: current.versionId,
            relativePath: result.destinationRelativePath,
            filename: result.filename,
            mediaType: current.mediaType
          };
          ctx.send(savedInfo, this.artifactObservedTargetId);
        }
      }
      ctx.write("tasks", next);
      return;
    }
    if (info.type === "DatabaseSavedObservedInfo" || info.type === "DatabaseWriteFailedObservedInfo") {
      const taskId = String(info.taskId ?? "");
      const next = new Map(ctx.read("tasks"));
      const current = next.get(taskId);
      if (!current || current.phase !== "persisting") return;
      next.set(taskId, info.type === "DatabaseSavedObservedInfo" ? { ...current, phase: "downloaded", error: "" } : { ...current, phase: "failed", error: String(info.error ?? "\u751F\u6210\u4EA7\u7269\u5143\u6570\u636E\u5199\u5165\u5931\u8D25") });
      ctx.write("tasks", next);
      return;
    }
    if (info.type === "GenerationTasksPollRequestedInfo") {
      const requested = info;
      const next = new Map(ctx.read("tasks"));
      const pollTasks = [];
      let changed = false;
      for (const taskId of requested.taskIds) {
        const current = next.get(taskId);
        if (!current || current.phase !== "waiting" || !current.handle) continue;
        if (current.maxGenerationWaitMs > 0 && this.runtimeNow() - current.startedAt >= current.maxGenerationWaitMs) {
          next.set(taskId, {
            ...current,
            phase: "failed",
            progress: 0,
            error: `\u751F\u6210\u7B49\u5F85\u8D85\u8FC7 ${Math.round(current.maxGenerationWaitMs / 6e4)} \u5206\u949F`
          });
          changed = true;
          continue;
        }
        next.set(taskId, { ...current, phase: "polling", error: "" });
        changed = true;
        pollTasks.push({ taskId, handle: current.handle });
      }
      if (changed) ctx.write("tasks", next);
      if (pollTasks.length > 0) {
        const pollInfo = {
          type: "GenerationPollBatchRequestedInfo",
          batchId: `poll:${pollTasks.map((task) => task.taskId).join(",")}`,
          tasks: pollTasks
        };
        ctx.send(pollInfo, this.pollTargetId);
      }
    }
  }
};

// ../plugins/graphvideo.studio/backend/shared/generation-prompt.mjs
import { parse, stringify } from "yaml";
var modelIdPattern = /^[a-z0-9][a-z0-9_-]{0,63}$/;
function frontMatterParts(source) {
  if (typeof source !== "string") throw new Error("\u751F\u6210\u63D0\u793A\u8BCD\u5FC5\u987B\u662F\u5B57\u7B26\u4E32");
  const normalized = source.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  if (lines[0]?.trim() !== "---") {
    return { body: normalized, header: "", hasFrontMatter: false };
  }
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (end < 0) throw new Error("\u63D0\u793A\u8BCD YAML \u5934\u90E8\u7F3A\u5C11\u7ED3\u675F\u5206\u9694\u7B26 ---");
  return {
    header: lines.slice(1, end).join("\n"),
    body: lines.slice(end + 1).join("\n").replace(/^\n/, ""),
    hasFrontMatter: true
  };
}
function configRecord(value) {
  if (value === null || value === void 0) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("\u63D0\u793A\u8BCD YAML \u5934\u90E8\u5FC5\u987B\u662F\u5BF9\u8C61");
  }
  return value;
}
function validateGenerationModelId(value) {
  if (typeof value !== "string" || !modelIdPattern.test(value)) {
    throw new Error("model \u53EA\u80FD\u4F7F\u7528\u5C0F\u5199\u5B57\u6BCD\u3001\u6570\u5B57\u3001\u8FDE\u5B57\u7B26\u548C\u4E0B\u5212\u7EBF\uFF0C\u4E14\u4E0D\u8D85\u8FC7 64 \u4E2A\u5B57\u7B26");
  }
  return value;
}
function parseGenerationPrompt(source) {
  const parts = frontMatterParts(source);
  if (!parts.hasFrontMatter) {
    return { body: parts.body, config: {}, hasFrontMatter: false, modelId: null };
  }
  let config;
  try {
    config = configRecord(parse(parts.header) ?? {});
  } catch (error) {
    throw new Error(`\u63D0\u793A\u8BCD YAML \u65E0\u6548\uFF1A${error instanceof Error ? error.message : "\u65E0\u6CD5\u89E3\u6790"}`, {
      cause: error
    });
  }
  const modelId = config.model === void 0 ? null : validateGenerationModelId(config.model);
  return { body: parts.body, config, hasFrontMatter: true, modelId };
}

// ../plugins/graphvideo.studio/backend/shared/generation-model-intent-v2.mjs
function parameterValue(name, value, definition) {
  const valid = definition.type === "integer" ? Number.isInteger(value) : definition.type === "number" ? typeof value === "number" && Number.isFinite(value) : typeof value === definition.type;
  if (!valid) throw new Error(`\u53C2\u6570 ${name} \u5FC5\u987B\u662F ${definition.type}`);
  if (definition.enum && !definition.enum.includes(value)) throw new Error(`\u53C2\u6570 ${name} \u4E0D\u5728\u5141\u8BB8\u8303\u56F4\u5185`);
  if (definition.minimum !== void 0 && value < definition.minimum) throw new Error(`\u53C2\u6570 ${name} \u4E0D\u80FD\u5C0F\u4E8E ${definition.minimum}`);
  if (definition.maximum !== void 0 && value > definition.maximum) throw new Error(`\u53C2\u6570 ${name} \u4E0D\u80FD\u5927\u4E8E ${definition.maximum}`);
  return value;
}
function matchingVariant(model, values) {
  return model.variants.find((variant) => {
    const when = variant?.when;
    return when && typeof when.parameter === "string" && values[when.parameter] === when.equals;
  }) ?? null;
}
function resolvedParameters(model, config, requestedModelId) {
  const unknown = Object.keys(config).filter((name) => name !== "model" && !Object.hasOwn(model.parameters, name));
  if (unknown.length) throw new Error(`\u6A21\u578B ${model.id} \u4E0D\u652F\u6301\u53C2\u6570: ${unknown.join(", ")}`);
  const source = { ...model.defaults, ...model.aliasDefaults?.[requestedModelId] ?? {}, ...config };
  delete source.model;
  const variant = matchingVariant(model, source);
  const values = { ...source, ...variant?.defaults ?? {} };
  const effective = {};
  for (const [name, value] of Object.entries(values)) {
    const definition = model.parameters[name];
    if (!definition) throw new Error(`\u6A21\u578B ${model.id} \u4E0D\u652F\u6301\u53C2\u6570: ${name}`);
    effective[definition.outputName ?? name] = parameterValue(name, value, definition);
  }
  return { source: values, effective, variant };
}
function referenceReplacement(reference, ordinal, promptPolicy) {
  const type = reference.type ?? "image";
  const template = promptPolicy.aliases?.[type];
  if (typeof template === "string") {
    return template.replaceAll("{ordinal}", String(ordinal)).replaceAll("{id}", String(reference.id ?? "")).replaceAll("{title}", String(reference.title ?? "")).replaceAll("{content}", String(reference.content ?? reference.title ?? reference.id ?? ""));
  }
  if (type === "image") return `Image_${ordinal}`;
  if (type === "video") return `Video_${ordinal}`;
  if (type === "audio") return `Audio_${ordinal}`;
  return String(reference.content ?? reference.title ?? reference.id ?? "");
}
function compilePrompt(body, references, policy, sourceParameters) {
  let prompt = body;
  const aliases = {};
  const ordinal = {};
  for (const reference of references) {
    const type = reference.type ?? "image";
    ordinal[type] = (ordinal[type] ?? 0) + 1;
    const replacement = (policy.stripTypes ?? []).includes(type) ? "" : referenceReplacement(reference, ordinal[type], policy);
    const prefix = { image: "@", video: "%", audio: "~", style: "&", text: "$" }[type] ?? "";
    const candidates = [`[${prefix}${reference.title}]`, `${prefix}${reference.title}`, reference.id].filter(Boolean);
    for (const candidate of candidates) prompt = prompt.split(candidate).join(replacement);
    aliases[reference.id] = replacement;
    if (reference.title) aliases[`[${prefix}${reference.title}]`] = replacement;
  }
  if (Array.isArray(policy.stripTypes) && policy.stripTypes.length) {
    const prefixes = policy.stripTypes.map((type) => ({ image: "@", video: "%", audio: "~", style: "&", text: "$" })[type]).filter(Boolean).join("");
    if (prefixes) prompt = prompt.replace(new RegExp(`\\[[${prefixes}][^\\]]+\\]`, "g"), "");
  }
  if (policy.stripAllReferences === true) prompt = prompt.replace(/\[[~@&$%][^\]]+\]/g, "");
  const emotion = policy.emotion;
  if (emotion?.parameter && emotion.tags && !prompt.includes("<|emotion:") && !prompt.includes("<|style:")) {
    const tag = emotion.tags[String(sourceParameters[emotion.parameter] ?? "")];
    if (tag) prompt = `${tag}${prompt}`;
  }
  return { prompt: prompt.trim(), aliases };
}
function dependencyRules(model, variant) {
  return { ...model.dependencies, ...variant?.dependencies ?? {} };
}
function assertDependencies(model, variant, references, sourceParameters) {
  const rules = dependencyRules(model, variant);
  const counts = Object.fromEntries(["image", "video", "audio", "text", "style"].map((type) => [
    type,
    references.filter((reference) => reference.type === type).length
  ]));
  for (const [type, constraint] of Object.entries(rules.counts ?? {})) {
    const count = counts[type] ?? 0;
    if (constraint.minimum !== void 0 && count < constraint.minimum) throw new Error(constraint.message ?? `\u6A21\u578B ${model.id} \u81F3\u5C11\u9700\u8981 ${constraint.minimum} \u4E2A ${type} \u5F15\u7528`);
    if (constraint.maximum !== void 0 && count > constraint.maximum) throw new Error(constraint.message ?? `\u6A21\u578B ${model.id} \u6700\u591A\u652F\u6301 ${constraint.maximum} \u4E2A ${type} \u5F15\u7528`);
    if (constraint.exact !== void 0 && count !== constraint.exact) throw new Error(constraint.message ?? `\u6A21\u578B ${model.id} \u5FC5\u987B\u63D0\u4F9B ${constraint.exact} \u4E2A ${type} \u5F15\u7528`);
  }
  for (const [parameter, constraint] of Object.entries(rules.parameterMaximums ?? {})) {
    if (Number(sourceParameters[parameter]) > Number(constraint.maximum)) {
      throw new Error(constraint.message ?? `\u53C2\u6570 ${parameter} \u4E0D\u80FD\u5927\u4E8E ${constraint.maximum}`);
    }
  }
  for (const requirement of rules.atLeastOneReferenceOf ?? []) {
    const total = requirement.types.reduce((sum, type) => sum + (counts[type] ?? 0), 0);
    if (total === 0) {
      throw new Error(requirement.message ?? `\u6A21\u578B ${model.id} \u81F3\u5C11\u9700\u8981\u4E00\u4E2A ${requirement.types.join("/")} \u5F15\u7528`);
    }
  }
  for (const requirement of rules.requiredReferenceOrParameter ?? []) {
    if ((counts[requirement.type] ?? 0) === 0 && !String(sourceParameters[requirement.parameter] ?? "").trim()) {
      throw new Error(`\u6A21\u578B ${model.id} \u9700\u8981 ${requirement.type} \u5F15\u7528\u6216\u53C2\u6570 ${requirement.parameter}`);
    }
  }
  for (const requirement of rules.parameterRequiredWhenReferenced ?? []) {
    if ((counts[requirement.type] ?? 0) > 0 && !String(sourceParameters[requirement.parameter] ?? "").trim()) {
      throw new Error(`\u6A21\u578B ${model.id} \u4F7F\u7528 ${requirement.type} \u5F15\u7528\u65F6\u5FC5\u987B\u63D0\u4F9B\u53C2\u6570 ${requirement.parameter}`);
    }
  }
  for (const reference of references) {
    if (rules.referenceDurationAtMostParameter && reference.type === "audio") {
      const duration = reference.duration ?? reference.metadata?.duration;
      const maximum = sourceParameters[rules.referenceDurationAtMostParameter];
      if (duration && maximum && duration > maximum) throw new Error(`\u97F3\u9891\u53C2\u8003\u3010${reference.title || reference.id}\u3011\u7684\u65F6\u957F (${duration}s) \u8D85\u51FA\u4E86\u76EE\u6807\u89C6\u9891\u65F6\u957F (${maximum}s)`);
    }
    if (["image", "video", "audio"].includes(reference.type ?? "image") && rules.requireReady !== false && (!reference.isReady || !reference.filePath)) {
      throw new Error(`\u9884\u68C0\u5931\u8D25: \u4F9D\u8D56\u3010${reference.title || reference.id}\u3011\u5C1A\u672A\u5C31\u7EEA\u6216\u7F3A\u5C11\u672C\u5730\u5A92\u4F53\u6587\u4EF6`);
    }
    if (["text", "style"].includes(reference.type) && !String(reference.content ?? "").trim()) {
      throw new Error(`\u9884\u68C0\u5931\u8D25: \u4F9D\u8D56\u3010${reference.title || reference.id}\u3011\u7684\u6587\u672C\u5185\u5BB9\u4E3A\u7A7A`);
    }
  }
}
function budgetResult(rule, sourceParameters, options = {}) {
  const selected = rule ?? { kind: "free" };
  if (selected.kind === "free") return { estimatedCredits: 0, mode: selected.mode ?? "free", formula: selected.formula ?? "0", currency: selected.currency ?? "credits" };
  if (selected.kind === "fixed") return { estimatedCredits: Number(selected.credits), mode: selected.mode ?? "fixed", formula: selected.formula ?? `${selected.credits}`, currency: selected.currency ?? "credits" };
  const parameter = selected.parameter ?? "duration";
  const units = Number(options[parameter] ?? sourceParameters[parameter] ?? selected.baseUnits ?? 0);
  if (options.customRate !== void 0 && options.customRate !== null) {
    const rate = Number(options.customRate);
    const credits = Math.round(units * rate * 100) / 100;
    return { estimatedCredits: credits, mode: "custom_rate", formula: `${units}s \xD7 ${rate} \u79EF\u5206/\u79D2 = ${credits} Credits`, currency: selected.currency ?? "credits" };
  }
  if (selected.kind === "linear") {
    const rate = Number(options.customRate ?? selected.rate);
    const credits = Math.round(units * rate * 100) / 100;
    return { estimatedCredits: credits, mode: options.customRate !== void 0 ? "custom_rate" : selected.mode ?? "linear", formula: `${units} \xD7 ${rate}`, currency: selected.currency ?? "credits" };
  }
  if (selected.kind === "stepped") {
    const baseUnits = Number(selected.baseUnits ?? 0);
    const multiplierKey = String(sourceParameters[selected.multiplierParameter] ?? "").toLowerCase();
    const multiplier = Number(selected.multipliers?.[multiplierKey] ?? selected.defaultMultiplier ?? 1);
    const credits = Math.round((Number(selected.base) + Math.max(0, units - baseUnits) * Number(selected.perUnit)) * multiplier * 100) / 100;
    return { estimatedCredits: credits, mode: selected.mode ?? "stepped", formula: `[${selected.base} + max(0, ${units}-${baseUnits}) \xD7 ${selected.perUnit}] \xD7 ${multiplier} = ${credits.toFixed(1)} Credits`, currency: selected.currency ?? "credits" };
  }
  throw new Error(`\u9884\u7B97\u89C4\u5219\u4E0D\u53D7\u652F\u6301: ${selected.kind}`);
}
function compileModelIntentV2(snapshot, input) {
  if (!input?.prompt) throw new Error("\u7F3A\u5C11\u751F\u6210\u63D0\u793A\u8BCD prompt");
  const model = snapshot.model;
  const parsed = parseGenerationPrompt(input.prompt);
  if (!parsed.modelId) throw new Error("\u63D0\u793A\u8BCD YAML \u5934\u90E8\u5FC5\u987B\u58F0\u660E model: <model-id>");
  if (parsed.modelId !== model.id && !(model.aliases ?? []).includes(parsed.modelId)) throw new Error(`\u6A21\u578B\u5FEB\u7167 ${model.id} \u4E0E\u63D0\u793A\u8BCD\u6A21\u578B ${parsed.modelId} \u4E0D\u4E00\u81F4`);
  if (input.nodeType && model.mediaType !== input.nodeType) throw new Error(`\u6A21\u578B ${model.id} \u53EA\u80FD\u7528\u4E8E ${model.mediaType} \u8282\u70B9`);
  const parameters = resolvedParameters(model, parsed.config, parsed.modelId);
  const references = Array.isArray(input.references) ? input.references : [];
  const compiled = compilePrompt(parsed.body, references, model.prompt ?? {}, parameters.source);
  if (!compiled.prompt) throw new Error("\u9884\u68C0\u5931\u8D25: \u751F\u6210\u63D0\u793A\u8BCD\u6B63\u6587\u4E0D\u80FD\u4E3A\u7A7A");
  const budgetRule = parameters.variant?.budget ?? model.budget;
  return {
    model: structuredClone(model),
    body: parsed.body,
    prompt: compiled.prompt,
    aliases: compiled.aliases,
    effectiveConfig: parameters.effective,
    sourceConfig: parameters.source,
    estimatedCredits: budgetResult(budgetRule, parameters.source, input.budgetOptions).estimatedCredits,
    budget: budgetResult(budgetRule, parameters.source, input.budgetOptions),
    variant: parameters.variant ? structuredClone(parameters.variant) : null
  };
}
function buildModelRequestV2(snapshot, input) {
  const resolved = compileModelIntentV2(snapshot, input);
  const references = Array.isArray(input.references) ? input.references : [];
  assertDependencies(snapshot.model, resolved.variant, references, resolved.sourceConfig);
  return {
    kind: snapshot.execution.kind === "audio-task" ? "audio-payload" : "comfy-workflow",
    workflowType: snapshot.model.id,
    inputs: { prompt: resolved.prompt, ...resolved.effectiveConfig },
    references: references.map((reference) => ({ ...reference })),
    model: structuredClone(snapshot)
  };
}

// ../plugins/graphvideo.studio/backend/shared/generation-batch-planner.mjs
import { createHash } from "node:crypto";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";

// ../plugins/graphvideo.studio/backend/shared/generation-reference-order.mjs
var idCharacter = /[\p{L}\p{N}_-]/u;
var prefixByType = { text: "$", image: "@", video: "%", audio: "~", style: "&" };
var frameReferenceKeys = /* @__PURE__ */ new Set(["firstFrame", "first_frame", "lastFrame", "last_frame"]);
var scalarReferenceKeys = /* @__PURE__ */ new Set([
  "voiceReference",
  "voice_id",
  "voiceId",
  "ref_image",
  "ref_audio",
  "character_image"
]);
var listReferenceKeys = /* @__PURE__ */ new Set([
  "referenceImages",
  "referenceVideos",
  "referenceAudios",
  "references"
]);
function isBoundary(value) {
  return value === void 0 || !idCharacter.test(value);
}
function firstPatternIndex(prompt, pattern, needBoundary) {
  if (!pattern) return -1;
  let start = prompt.indexOf(pattern);
  while (start >= 0) {
    const end = start + pattern.length;
    if (!needBoundary || isBoundary(prompt[start - 1]) && isBoundary(prompt[end])) return start;
    start = prompt.indexOf(pattern, end);
  }
  return -1;
}
function firstMentionIndex(prompt, node) {
  const prefix = prefixByType[node.type] ?? "";
  const patterns = [];
  if (node.title) {
    if (prefix) {
      patterns.push([`[${prefix}${node.title}]`, false]);
      patterns.push([`${prefix}${node.title}`, true]);
      patterns.push([`[${prefix}${node.title}:${node.id}]`, false]);
    }
    patterns.push([`[${node.title}]`, false]);
  }
  patterns.push([`[${node.id}]`, false], [node.id, true]);
  const found = patterns.map(([pattern, needBoundary]) => firstPatternIndex(prompt, pattern, needBoundary)).filter((index) => index >= 0);
  return found.length > 0 ? Math.min(...found) : -1;
}
function explicitReferenceIds(config) {
  const ids = [];
  const firstFrame = config.firstFrame ?? config.first_frame;
  const lastFrame = config.lastFrame ?? config.last_frame;
  if (typeof firstFrame === "string") ids.push(firstFrame);
  if (typeof lastFrame === "string") ids.push(lastFrame);
  for (const [key, value] of Object.entries(config)) {
    if (frameReferenceKeys.has(key)) continue;
    if (scalarReferenceKeys.has(key) && typeof value === "string") ids.push(value);
    if (listReferenceKeys.has(key) && Array.isArray(value)) {
      ids.push(...value.filter((item) => typeof item === "string"));
    }
  }
  return ids;
}
function orderedGenerationReferenceIds({
  prompt = "",
  nodes = [],
  targetNodeId,
  structuralIds = []
}) {
  let promptBody = prompt;
  let config = {};
  try {
    const parsed = parseGenerationPrompt(prompt);
    promptBody = parsed.body;
    config = parsed.config;
  } catch {
  }
  const candidates = nodes.filter((node) => node?.id && node.id !== targetNodeId);
  const knownIds = new Set(candidates.map((node) => node.id));
  const promptReferences = candidates.map((node, sourceOrder) => ({ id: node.id, sourceOrder, index: firstMentionIndex(promptBody, node) })).filter((entry) => entry.index >= 0).sort((left, right) => left.index - right.index || left.sourceOrder - right.sourceOrder).map((entry) => entry.id);
  const ordered = [];
  const added = /* @__PURE__ */ new Set();
  const add = (id) => {
    if (!knownIds.has(id) || added.has(id)) return;
    added.add(id);
    ordered.push(id);
  };
  promptReferences.forEach(add);
  explicitReferenceIds(config).forEach(add);
  structuralIds.forEach(add);
  return ordered;
}

// ../plugins/graphvideo.studio/backend/shared/generation-batch-planner.mjs
var mediaTypes = /* @__PURE__ */ new Set(["image", "video", "audio"]);
function pathInside(root, candidate) {
  const rootPath = resolve(root);
  const target = resolve(rootPath, candidate);
  const nested = relative(rootPath, target);
  if (nested === "" || nested !== ".." && !nested.startsWith(`..${sep}`) && !isAbsolute(nested)) return target;
  throw new Error("\u9879\u76EE\u5A92\u4F53\u8DEF\u5F84\u8D8A\u51FA\u9879\u76EE\u76EE\u5F55");
}
function currentVersion(node) {
  return (node.history ?? []).find((entry) => entry.current) ?? null;
}
function structureDependencies(markdown, nodes) {
  const byTitle = new Map(nodes.flatMap((node) => [[node.title, node], [`${node.type}:${node.title}`, node]]));
  const dependencies = new Map(nodes.map((node) => [node.id, /* @__PURE__ */ new Set()]));
  const stack = [];
  let inside = false;
  for (const line of String(markdown ?? "").split(/\r?\n/)) {
    if (line.includes("<project-structure>")) {
      inside = true;
      continue;
    }
    if (line.includes("</project-structure>")) break;
    if (!inside || !line.trim()) continue;
    const indent = line.length - line.trimStart().length;
    const text = line.trim();
    const symbol = text[0];
    const type = { "$": "text", "@": "image", "%": "video", "~": "audio", "&": "style" }[symbol];
    const title = type || symbol === "#" ? text.slice(1).trim() : text;
    const node = (type ? byTitle.get(`${type}:${title}`) : null) ?? byTitle.get(title);
    while (stack.length && stack.at(-1).indent >= indent) stack.pop();
    if (node) {
      for (const ancestor of [...stack].reverse()) {
        if (ancestor.node && mediaTypes.has(ancestor.node.type) && ancestor.node.id !== node.id) {
          dependencies.get(ancestor.node.id).add(node.id);
          break;
        }
      }
    }
    stack.push({ indent, node });
  }
  return dependencies;
}
function dependencyIds(node, nodes, structural) {
  const prompt = node.prompt ?? "";
  return orderedGenerationReferenceIds({
    prompt,
    nodes,
    targetNodeId: node.id,
    structuralIds: [...structural.get(node.id) ?? []]
  });
}
function referenceFor(projectRoot, node, ordinal) {
  const version = currentVersion(node);
  let filePath;
  if (version?.relativePath) filePath = pathInside(projectRoot, version.relativePath);
  let metadata = {};
  if (node.type === "audio") {
    try {
      const config = parseGenerationPrompt(node.prompt ?? "").config;
      metadata = { voice_id: config.voice_id || config.voiceId };
    } catch {
    }
  }
  return {
    id: node.id,
    type: node.type,
    title: node.title,
    ordinal,
    content: node.content ?? "",
    filePath,
    isReady: mediaTypes.has(node.type) ? Boolean(version && filePath) : Boolean(String(node.content ?? "").trim()),
    metadata
  };
}
function audioProjectIdentity(projectRoot) {
  const canonical = resolve(projectRoot).replaceAll("\\", "/").toLowerCase();
  const digest = createHash("sha256").update(canonical).digest("hex").slice(0, 12);
  const prefix = basename(projectRoot).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 32) || "graphvideo";
  return { id: `${prefix}_${digest}`, name: basename(projectRoot) };
}
function extensionFor(mediaType) {
  return mediaType === "video" ? ".mp4" : mediaType === "audio" ? ".wav" : ".png";
}
function planGenerationBatch(project, requests, options) {
  if (!options?.batchId || typeof options.nextId !== "function") {
    throw new Error("\u751F\u6210\u6279\u6B21\u89C4\u5212\u5FC5\u987B\u7531 Owner Node \u63D0\u4F9B batchId \u4E0E nextId");
  }
  const nodes = project.nodes ?? [];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const structural = structureDependencies(project.markdown, nodes);
  const tasks = requests.map((request, index) => {
    const node = byId.get(request.nodeId);
    if (!node || !mediaTypes.has(node.type)) throw new Error(`\u627E\u4E0D\u5230\u53EF\u751F\u6210\u7684\u5A92\u4F53\u8282\u70B9: ${request.nodeId}`);
    const ids = dependencyIds(node, nodes, structural);
    const references = ids.map((id, ordinal) => referenceFor(project.path, byId.get(id), ordinal + 1));
    const versionId = `v-${options.nextId()}`;
    return {
      taskId: `${options.batchId}:${index}:${node.id}`,
      targetNodeId: node.id,
      versionId,
      destinationRelativePath: `nodes/${node.id}/media/${versionId}${extensionFor(node.type)}`,
      mediaType: node.type,
      input: { nodeType: node.type, prompt: request.prompt ?? node.prompt ?? "", references }
    };
  });
  return {
    batchId: options.batchId,
    project: { ...audioProjectIdentity(project.path), ...options.audioUrl ? { baseUrl: options.audioUrl } : {} },
    tasks
  };
}

// ../plugins/graphvideo.studio/backend/shared/generation-workflow-package-v2.mjs
var MAX_NODES = 256;
var MAX_JSON_DEPTH = 32;
var APPROVED_CLASS_TYPES = /* @__PURE__ */ new Set([
  "BasicGuider",
  "BasicScheduler",
  "ByteDance2FirstLastFrameNode",
  "ByteDance2ReferenceNodeV2",
  "CLIPLoader",
  "ComfyMathExpression",
  "ComfySwitchNode",
  "CreateVideo",
  "GeminiNanoBanana2V2",
  "KSamplerSelect",
  "LoadAudio",
  "LoadImage",
  "LoadVideo",
  "LoraLoaderModelOnly",
  "MiniMaxH3ReferenceToVideo",
  "PrimitiveBoolean",
  "PrimitiveFloat",
  "PrimitiveInt",
  "PrimitiveStringMultiline",
  "RandomNoise",
  "ResolutionSelector",
  "SamplerCustomAdvanced",
  "SaveImage",
  "SaveVideo",
  "UNETLoader",
  "VAEDecode",
  "VAEDecodeAudio",
  "VAELoader"
]);
var DENIED_KEY = /(api[_-]?key|authorization|cookie|password|secret|token)/i;
var PATH_KEY = /(file|filename|path|image|video|audio|vae_name|unet_name|clip_name|lora_name)/i;
function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label}\u5FC5\u987B\u662F\u5BF9\u8C61`);
  return value;
}
function exactKeys(value, allowed, label) {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) throw new Error(`${label}\u5305\u542B\u672A\u77E5\u5B57\u6BB5: ${unknown.join(", ")}`);
}
function inspectJson(value, depth = 0, key = "") {
  if (depth > MAX_JSON_DEPTH) throw new Error(`workflow JSON \u6DF1\u5EA6\u4E0D\u80FD\u8D85\u8FC7 ${MAX_JSON_DEPTH}`);
  if (typeof value === "string" && PATH_KEY.test(key)) {
    if (/^[A-Za-z]:[\\/]/.test(value) || value.startsWith("/") || value.split(/[\\/]/).includes("..")) {
      throw new Error(`workflow \u7981\u6B62\u7EDD\u5BF9\u8DEF\u5F84\u6216\u8DEF\u5F84\u7A7F\u8D8A: ${key}`);
    }
  }
  if (!value || typeof value !== "object") return;
  for (const [childKey, child] of Object.entries(value)) {
    if (DENIED_KEY.test(childKey)) throw new Error(`workflow \u7981\u6B62\u654F\u611F\u5B57\u6BB5: ${childKey}`);
    inspectJson(child, depth + 1, childKey);
  }
}
function validateComfyWorkflowPackage(workflow, outputKind) {
  const graph = object(workflow, "workflow.json");
  const entries = Object.entries(graph);
  if (entries.length === 0 || entries.length > MAX_NODES) throw new Error(`workflow \u8282\u70B9\u6570\u5FC5\u987B\u5728 1-${MAX_NODES} \u4E4B\u95F4`);
  inspectJson(graph);
  for (const [nodeId, rawNode] of entries) {
    if (!/^\d+$/.test(nodeId)) throw new Error(`workflow \u8282\u70B9 ID \u5FC5\u987B\u662F\u6570\u5B57\u5B57\u7B26\u4E32: ${nodeId}`);
    const node = object(rawNode, `workflow.${nodeId}`);
    if (!APPROVED_CLASS_TYPES.has(node.class_type)) throw new Error(`workflow class_type \u672A\u6279\u51C6: ${node.class_type}`);
    object(node.inputs ?? {}, `workflow.${nodeId}.inputs`);
  }
  const expectedSaver = outputKind === "image" ? "SaveImage" : outputKind === "video" ? "SaveVideo" : null;
  if (!expectedSaver || !entries.some(([, node]) => node.class_type === expectedSaver)) {
    throw new Error(`workflow \u5FC5\u987B\u7531\u6279\u51C6\u7684 ${expectedSaver ?? outputKind} \u8282\u70B9\u4EA7\u751F\u8F93\u51FA`);
  }
  return graph;
}
function bindingValue(binding, request) {
  if (binding.source === "prompt") return request.inputs.prompt;
  if (binding.source !== "parameter") throw new Error(`binding.source \u4E0D\u53D7\u652F\u6301: ${binding.source}`);
  if (!Object.hasOwn(request.inputs, binding.name)) throw new Error(`binding \u5F15\u7528\u4E86\u672A\u58F0\u660E\u53C2\u6570\u8F93\u51FA: ${binding.name}`);
  let value = request.inputs[binding.name];
  if (binding.transform === "number") value = Number(value);
  if (binding.transform === "aspectLabel") value = String(value).includes("16:9") ? "16:9 (Widescreen)" : "9:16 (Portrait)";
  if (binding.transform === "spaceUnderscore") value = String(value).replaceAll(" ", "_");
  if (binding.prefix || binding.suffix) value = `${binding.prefix ?? ""}${value}${binding.suffix ?? ""}`;
  return value;
}
function applyBindings(graph, bindings, request) {
  for (const [index, rawBinding] of bindings.entries()) {
    const binding = object(rawBinding, `execution.bindings.${index}`);
    exactKeys(binding, /* @__PURE__ */ new Set(["source", "name", "nodeId", "input", "when", "value", "transform", "prefix", "suffix"]), `execution.bindings.${index}`);
    if (!["prompt", "parameter"].includes(binding.source)) throw new Error(`binding.source \u4E0D\u53D7\u652F\u6301: ${binding.source}`);
    if (binding.when) {
      const when = object(binding.when, `execution.bindings.${index}.when`);
      exactKeys(when, /* @__PURE__ */ new Set(["parameter", "equals"]), `execution.bindings.${index}.when`);
      if (request.inputs[when.parameter] !== when.equals) continue;
    }
    const node = graph[String(binding.nodeId)];
    if (!node) throw new Error(`binding \u76EE\u6807\u8282\u70B9\u4E0D\u5B58\u5728: ${binding.nodeId}`);
    node.inputs[binding.input] = binding.value !== void 0 ? structuredClone(binding.value) : bindingValue(binding, request);
  }
}
function applyClearRules(graph, rules) {
  for (const [index, rawRule] of rules.entries()) {
    const rule = object(rawRule, `execution.clearInputPrefixes.${index}`);
    exactKeys(rule, /* @__PURE__ */ new Set(["nodeId", "prefixes"]), `execution.clearInputPrefixes.${index}`);
    const inputs = graph[String(rule.nodeId)]?.inputs;
    if (!inputs || !Array.isArray(rule.prefixes)) throw new Error(`clearInputPrefixes \u76EE\u6807\u65E0\u6548: ${rule.nodeId}`);
    for (const key of Object.keys(inputs)) {
      if (rule.prefixes.some((prefix) => key.startsWith(prefix))) delete inputs[key];
    }
  }
}
function mediaReferences(request, type) {
  return (request.references ?? []).filter((reference) => reference.type === type && reference.filePath);
}
function applyReferenceSlots(graph, slots, request) {
  const uploads = [];
  for (const [slotIndex, rawSlot] of slots.entries()) {
    const slot = object(rawSlot, `execution.referenceSlots.${slotIndex}`);
    exactKeys(slot, /* @__PURE__ */ new Set([
      "type",
      "maximum",
      "nodeIdStart",
      "loaderClass",
      "loaderInput",
      "targetNodeId",
      "targetInputPattern",
      "titlePrefix",
      "fixed"
    ]), `execution.referenceSlots.${slotIndex}`);
    if (!["image", "video", "audio"].includes(slot.type)) throw new Error(`referenceSlot.type \u65E0\u6548: ${slot.type}`);
    const references = mediaReferences(request, slot.type);
    if (references.length > slot.maximum) throw new Error(`${slot.type} \u5F15\u7528\u8D85\u8FC7 execution slot \u4E0A\u9650 ${slot.maximum}`);
    const fixed = Array.isArray(slot.fixed) ? slot.fixed : null;
    for (const [index, reference] of references.entries()) {
      const target = fixed?.[index];
      if (fixed && !target) throw new Error(`${slot.type} \u5F15\u7528\u7F3A\u5C11\u56FA\u5B9A\u69FD\u4F4D ${index + 1}`);
      const nodeId = String(target?.nodeId ?? Number(slot.nodeIdStart) + index);
      graph[nodeId] = {
        class_type: slot.loaderClass,
        inputs: { [slot.loaderInput]: "" },
        ...slot.titlePrefix || target?.title ? { _meta: { title: target?.title ?? `${slot.titlePrefix} ${index + 1}` } } : {}
      };
      const targetNodeId = String(target?.targetNodeId ?? slot.targetNodeId);
      const targetNode = graph[targetNodeId];
      if (!targetNode) throw new Error(`referenceSlot \u76EE\u6807\u8282\u70B9\u4E0D\u5B58\u5728: ${targetNodeId}`);
      const input = target?.targetInput ?? slot.targetInputPattern.replace("{ordinal}", String(index + 1)).replace("{index}", String(index));
      targetNode.inputs[input] = [nodeId, 0];
      uploads.push({ sourcePath: reference.filePath, nodeId, inputName: slot.loaderInput });
    }
  }
  return uploads;
}
function compileComfyTemplateV2(request) {
  const execution = request.model?.execution;
  if (execution?.kind !== "comfy-template") throw new Error("\u8BF7\u6C42\u4E0D\u662F comfy-template \u6267\u884C\u65CF");
  const graph = structuredClone(validateComfyWorkflowPackage(request.model.workflow, execution.outputKind));
  applyClearRules(graph, execution.clearInputPrefixes ?? []);
  applyBindings(graph, execution.bindings ?? [], request);
  const uploads = applyReferenceSlots(graph, execution.referenceSlots ?? [], request);
  validateComfyWorkflowPackage(graph, execution.outputKind);
  return {
    provider: "comfy",
    prompt: graph,
    uploads,
    workflowType: request.workflowType,
    expectedOutputKind: execution.outputKind
  };
}
var comfyWorkflowPackageLimits = Object.freeze({
  maxNodes: MAX_NODES,
  maxJsonDepth: MAX_JSON_DEPTH,
  approvedClassTypes: Object.freeze([...APPROVED_CLASS_TYPES].sort())
});

// ../plugins/graphvideo.studio/backend/shared/generation-submit-spec-v2.mjs
function mediaReferences2(request, type) {
  return (request.references ?? []).filter((reference) => reference.type === type && reference.filePath);
}
function audioSpec(request, project) {
  const execution = request.model.execution;
  const values = request.inputs;
  const base = {
    provider: "audio",
    projectId: project.id,
    projectName: project.name,
    ...project.baseUrl ? { baseUrl: project.baseUrl } : {}
  };
  if (execution.taskType === "SFX") return { ...base, taskType: "SFX", payload: values };
  if (execution.taskType === "SPEECH") {
    const audio = mediaReferences2(request, "audio")[0];
    const voiceReference = values.voice_reference || audio?.metadata?.voice_id || audio?.id;
    return {
      ...base,
      taskType: "SPEECH",
      payload: {
        text: values.prompt,
        voice_id: voiceReference,
        speed: values.speed,
        temperature: values.temperature,
        seed: values.seed ?? 0
      }
    };
  }
  if (execution.taskType === "VOICE_DESIGN") {
    const audio = mediaReferences2(request, "audio")[0];
    const voiceId = values.voice_id || values.name || audio?.id || "custom_voice";
    if (audio) {
      return {
        ...base,
        taskType: "VOICE_CLONE",
        payload: {
          voice_id: voiceId,
          name: values.name || voiceId,
          description: values.description || "\u57FA\u4E8E\u5F55\u97F3\u6837\u672C\u514B\u9686\u7684\u58F0\u7EB9\u6BCD\u5E26",
          reference_audio_path: audio.filePath,
          reference_text: values.transcript || audio.content || values.prompt
        }
      };
    }
    return {
      ...base,
      taskType: "VOICE_DESIGN",
      payload: {
        voice_id: voiceId,
        name: values.name || voiceId,
        description: values.description || values.prompt,
        seed_text: values.prompt || values.seed_text,
        gender: values.gender,
        age: values.age,
        accent: values.accent,
        seed: values.seed
      }
    };
  }
  throw new Error(`audio-task \u4E0D\u652F\u6301 taskType: ${execution.taskType}`);
}
function compileGenerationSubmitSpecV2(request, project) {
  const execution = request.model?.execution;
  if (!execution) throw new Error("v2 \u751F\u6210\u8BF7\u6C42\u7F3A\u5C11 execution \u5FEB\u7167");
  if (execution.kind === "audio-task") return audioSpec(request, project);
  if (execution.kind === "mock") return { provider: "mock", kind: execution.outputKind };
  if (execution.kind === "comfy-template") return compileComfyTemplateV2(request);
  throw new Error(`v2 \u6267\u884C\u65CF\u5C1A\u672A\u5B9E\u73B0: ${execution.kind}`);
}

// ../plugins/graphvideo.studio/backend/nodes/generation-model-resolver.ts
function requestedSnapshot(catalog, prompt) {
  const requestedModelId = parseGenerationPrompt(prompt).modelId;
  const snapshot = catalog.models.find((entry) => entry.model.id === requestedModelId || entry.model.aliases.includes(requestedModelId ?? ""));
  if (!snapshot) throw new Error(`\u6279\u6B21\u5FEB\u7167\u7F3A\u5C11\u6A21\u578B: ${requestedModelId ?? "unknown"}`);
  return snapshot;
}
function checkedMaxGenerationWaitMs(value) {
  if (value === void 0) return 0;
  if (!Number.isFinite(value) || value < 0 || value > 24 * 60 * 60 * 1e3) {
    throw new Error("\u6700\u5927\u751F\u6210\u7B49\u5F85\u65F6\u95F4\u5FC5\u987B\u5728 0 \u5230 1440 \u5206\u949F\u4E4B\u95F4");
  }
  return Math.round(value);
}
var GenerationModelResolverNode = class extends Node {
  constructor(id = "node-generation-model-resolver", name = "\u751F\u6210\u6A21\u578B\u89E3\u6790\u5668", resolutionResultTargetId = "node-generation-task", batchAdmissionTargetId = "node-generation-task") {
    super(id, name, { resolutions: /* @__PURE__ */ new Map() });
    this.resolutionResultTargetId = resolutionResultTargetId;
    this.batchAdmissionTargetId = batchAdmissionTargetId;
    this.icon = "\u{1F9E9}";
    this.description = "\u6A21\u578B\u58F0\u660E\u3001\u53C2\u6570\u3001\u63D0\u793A\u8BCD\u4E0E\u4F9D\u8D56\u89C4\u5219\u7684\u7EAF\u4E1A\u52A1 Owner\uFF1B\u4E0D\u6267\u884C\u8BF7\u6C42\u3001\u8F6E\u8BE2\u3001\u4E0B\u8F7D\u6216\u9879\u76EE I/O";
  }
  async change(info, ctx) {
    if (info.type === "GenerationBatchRequestedInfo") {
      const requested2 = info;
      const maxGenerationWaitMs = checkedMaxGenerationWaitMs(requested2.maxGenerationWaitMs);
      const plan = planGenerationBatch(requested2.project, requested2.items, {
        batchId: requested2.batchId,
        audioUrl: requested2.audioUrl,
        nextId: () => this.runtimeId("task")
      });
      const tasks = plan.tasks.map((task) => {
        const snapshot = requestedSnapshot(requested2.catalog, task.input.prompt);
        const submit = compileGenerationSubmitSpecV2(
          buildModelRequestV2(snapshot, task.input),
          plan.project
        );
        return {
          taskId: task.taskId,
          targetNodeId: task.targetNodeId,
          versionId: task.versionId,
          mediaType: task.mediaType,
          estimatedCredits: compileModelIntentV2(snapshot, task.input).estimatedCredits,
          destinationRelativePath: task.destinationRelativePath,
          autoPoll: true,
          maxGenerationWaitMs,
          submit
        };
      });
      const plannedInfo = {
        type: "GenerationBatchPlannedInfo",
        batchId: requested2.batchId,
        tasks
      };
      ctx.send(plannedInfo, this.batchAdmissionTargetId);
      return;
    }
    if (info.type !== "GenerationModelResolutionRequestedInfo") return;
    const requested = info;
    const next = new Map(ctx.read("resolutions"));
    try {
      const result = buildModelRequestV2(
        requestedSnapshot(requested.catalog, requested.input.prompt),
        requested.input
      );
      next.set(requested.requestId, {
        requestId: requested.requestId,
        status: "resolved",
        result,
        error: ""
      });
      ctx.write("resolutions", next);
      const completedInfo = {
        type: "GenerationModelResolutionCompletedInfo",
        requestId: requested.requestId,
        result
      };
      ctx.send(completedInfo, this.resolutionResultTargetId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      next.set(requested.requestId, {
        requestId: requested.requestId,
        status: "failed",
        result: null,
        error: message
      });
      ctx.write("resolutions", next);
      const failedInfo = {
        type: "GenerationModelResolutionFailedInfo",
        requestId: requested.requestId,
        error: message
      };
      ctx.send(failedInfo, this.resolutionResultTargetId);
    }
  }
};

// ../plugins/graphvideo.studio/backend/nodes/history-manager.ts
var HistoryManagerNode = class extends Node {
  constructor(id = "n-hist", name = "\u4E8B\u5B9E\u5386\u53F2\u4E0E\u56DE\u6EDA\u4E2D\u67A2") {
    super(id, name, {
      past: [],
      future: [],
      currentEntry: null,
      historyScopeId: ""
    });
    this.icon = "\u23F3";
    this.description = "\u3010\u4E8B\u5B9E\u5386\u53F2\u8BB0\u5F55\u3011\u7EF4\u62A4\u4E0D\u53EF\u53D8\u6570\u636E\u5E93\u539F\u5B50\u53D8\u66F4\u65E5\u5FD7 (Action Journal)\n\u3010\u4E8B\u52A1\u7EA7\u56DE\u6EDA\u3011\u5411 SQLite \u53D1\u9001 RevertMetadataTaskInfo \u6267\u884C\u884C\u7EA7\u56DE\u6EDA\n\u3010\u5355\u5411\u56E0\u679C\u3011\u65E0\u8DE8\u57DF\u5012\u704C\uFF0C\u4FDD\u6301 100% \u7EAF\u6B63\u5411\u65E0\u73AF\u56E0\u679C\u6D41\u6C34\u7EBF";
  }
  async recordJournal(entry, ctx) {
    const fullEntry = {
      ...entry,
      id: this.runtimeId("snapshot"),
      timestamp: this.runtimeNow()
    };
    {
      const past = ctx.read("past");
      ctx.write("past", [...past, fullEntry]);
      ctx.write("future", []);
      ctx.write("currentEntry", fullEntry);
    }
  }
  async change(info, ctx) {
    if (info.type === "ProjectHistoryResetInfo") {
      ctx.patchState({ past: [], future: [], currentEntry: null, historyScopeId: String(info.historyScopeId) });
      return;
    }
    if (info.type === "TaskFactObservedInfo") {
      if ((info.historyScopeId ?? "") !== ctx.read("historyScopeId")) return;
      const fact = info.fact;
      if (fact) {
        await this.recordJournal(fact, ctx);
      }
      return;
    }
    if (info.type === "UserSnapshotActionInfo") {
      const action = info.action?.type;
      if (action === "CLEAR_REDO") {
        ctx.write("future", []);
        return;
      }
      if (action === "UNDO") {
        const past = [...ctx.read("past")];
        const future = [...ctx.read("future")];
        if (past.length === 0)
          return;
        const entry = past.pop();
        future.push(entry);
        {
          ctx.write("past", past);
          ctx.write("future", future);
          ctx.write("currentEntry", past.length > 0 ? past[past.length - 1] : null);
          ctx.send({
            type: "RevertMetadataTaskInfo",
            entry,
            direction: "undo",
            historyScopeId: ctx.read("historyScopeId")
          }, "node-sqlite");
        }
      } else if (action === "REDO") {
        const past = [...ctx.read("past")];
        const future = [...ctx.read("future")];
        if (future.length === 0)
          return;
        const entry = future.pop();
        past.push(entry);
        {
          ctx.write("past", past);
          ctx.write("future", future);
          ctx.write("currentEntry", entry);
          ctx.send({
            type: "RevertMetadataTaskInfo",
            entry,
            direction: "redo",
            historyScopeId: ctx.read("historyScopeId")
          }, "node-sqlite");
        }
      }
    }
  }
  getBodySummaryText() {
    const p = this.state.past.length;
    const f = this.state.future.length;
    return `\u65E5\u5FD7: [\u64A4\u9500\u6808: ${p}] [\u91CD\u505A\u6808: ${f}]`;
  }
};

// ../plugins/graphvideo.studio/backend/shared/node-id.mjs
var nodeIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
var reservedWindowsNames = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
function nodeIdError(id) {
  if (typeof id !== "string" || !nodeIdPattern.test(id)) {
    return "\u8282\u70B9 ID \u53EA\u80FD\u5305\u542B ASCII \u5B57\u6BCD\u3001\u6570\u5B57\u3001\u4E0B\u5212\u7EBF\u548C\u8FDE\u5B57\u7B26\uFF0C\u4E14\u5FC5\u987B\u4EE5\u5B57\u6BCD\u6216\u6570\u5B57\u5F00\u5934";
  }
  if (reservedWindowsNames.test(id)) return "\u8282\u70B9 ID \u4E0D\u80FD\u4F7F\u7528 Windows \u4FDD\u7559\u540D\u79F0";
  return null;
}

// ../plugins/graphvideo.studio/backend/shared/project-parser.mjs
var nodeTypeBySymbol = {
  "$": "text",
  "@": "image",
  "%": "video",
  "~": "audio",
  "&": "style"
};
var idMapLine = /^\s*(?:['"]([^'"]+)['"]|([^:]+?))\s*:\s*\{\s*type\s*:\s*(['"]?)([$@%~&])\3\s*,\s*id\s*:\s*(['"]?)([^,'"}\s]+)\5\s*\}\s*$/;
var nodeLine = /^(\s*)([$@%~&])\s*(.+?)\s*$/;
var structureLine = /^(\s*)#+\s*(.+?)\s*$/;
var structureOpenTag = "<project-structure>";
var structureCloseTag = "</project-structure>";
function usesTextPayload(type) {
  return type === "text" || type === "style";
}
function findStructureRange(lines, issues) {
  const openings = lines.flatMap((line, index) => line.trim() === structureOpenTag ? [index] : []);
  if (openings.length === 0) {
    issues.push({
      code: "missing-structure",
      line: 1,
      severity: "error",
      message: `\u7F3A\u5C11 ${structureOpenTag} \u9879\u76EE\u7ED3\u6784\u533A\u57DF`
    });
    return null;
  }
  if (openings.length > 1) {
    issues.push({
      code: "duplicate-structure",
      line: openings[1] + 1,
      severity: "error",
      message: "\u4E00\u4E2A\u9879\u76EE\u53EA\u80FD\u5305\u542B\u4E00\u4E2A\u9879\u76EE\u7ED3\u6784\u533A\u57DF"
    });
  }
  const start = openings[0];
  const end = lines.findIndex((line, index) => index > start && line.trim() === structureCloseTag);
  if (end < 0) {
    issues.push({
      code: "unclosed-structure",
      line: start + 1,
      severity: "error",
      message: `${structureOpenTag} \u7F3A\u5C11\u7ED3\u675F\u6807\u7B7E ${structureCloseTag}`
    });
    return null;
  }
  return { start: start + 1, end };
}
function parseIdMap(lines, issues) {
  const map = /* @__PURE__ */ new Map();
  const ids = /* @__PURE__ */ new Map();
  const frontmatterEnd = lines[0]?.trim() === "---" ? lines.findIndex((line, index) => index > 0 && line.trim() === "---") : -1;
  if (frontmatterEnd < 0) return { map, frontmatterEnd: -1 };
  for (let index = 1; index < frontmatterEnd; index += 1) {
    const match = lines[index].match(idMapLine);
    if (!match) continue;
    const title = (match[1] ?? match[2]).trim();
    const entry = { symbol: match[4], id: match[6], line: index + 1 };
    const invalidId = nodeIdError(entry.id);
    if (invalidId) {
      issues.push({
        code: "invalid-id",
        line: index + 1,
        severity: "error",
        message: `${invalidId}\uFF1A\u201C${entry.id}\u201D`
      });
    }
    const existing = ids.get(entry.id);
    if (existing && existing.title !== title) {
      issues.push({
        code: "duplicate-id",
        line: index + 1,
        severity: "error",
        message: `ID \u201C${entry.id}\u201D \u5DF2\u7531 \u201C${existing.title}\u201D \u4F7F\u7528`
      });
    }
    map.set(title, entry);
    ids.set(entry.id, { title, line: index + 1 });
  }
  return { map, frontmatterEnd };
}
function getRelation(parent) {
  if (!parent) return "root";
  if (parent.kind === "structure") return "structure";
  return parent.nodeType === "text" ? "content" : "dependency";
}
function countIndent(value) {
  return [...value].reduce((count, character) => count + (character === "	" ? 2 : 1), 0);
}
function parseProject(markdown) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const issues = [];
  const { map } = parseIdMap(lines, issues);
  const structureRange = findStructureRange(lines, issues);
  if (!structureRange) return { tree: [], declarations: [], issues };
  const roots = [];
  const stack = [];
  const declarations = /* @__PURE__ */ new Map();
  const occurrenceCount = /* @__PURE__ */ new Map();
  let lastNodeDecl = null;
  const structuredLines = lines.slice(structureRange.start, structureRange.end);
  const baseIndent2 = structuredLines.reduce((minimum, raw) => {
    const match = raw.match(nodeLine) ?? raw.match(structureLine);
    return match ? Math.min(minimum, countIndent(match[1])) : minimum;
  }, Number.POSITIVE_INFINITY);
  const normalizedBaseIndent = Number.isFinite(baseIndent2) ? baseIndent2 : 0;
  for (let index = structureRange.start; index < structureRange.end; index += 1) {
    const raw = lines[index];
    const quoteMatch = raw.match(/^\s*>\s*(.+?)\s*$/);
    if (quoteMatch) {
      if (lastNodeDecl) {
        const text = quoteMatch[1].trim();
        lastNodeDecl.description = lastNodeDecl.description ? `${lastNodeDecl.description}
${text}` : text;
      }
      continue;
    }
    const nodeMatch = raw.match(nodeLine);
    const structureMatch = raw.match(structureLine);
    if (!nodeMatch && !structureMatch) continue;
    const indentation = Math.max(0, countIndent((nodeMatch ?? structureMatch)[1]) - normalizedBaseIndent);
    if (indentation % 2 !== 0) {
      issues.push({
        code: "invalid-indent",
        line: index + 1,
        severity: "error",
        message: "\u9879\u76EE\u7ED3\u6784\u7F29\u8FDB\u5FC5\u987B\u4F7F\u7528\u4E24\u4E2A\u7A7A\u683C\u4E3A\u4E00\u7EA7"
      });
    }
    const depth = Math.floor(indentation / 2);
    if (depth > stack.length) {
      issues.push({
        code: "invalid-indent",
        line: index + 1,
        severity: "error",
        message: "\u9879\u76EE\u7ED3\u6784\u7F29\u8FDB\u4E0D\u80FD\u8DF3\u8FC7\u4E2D\u95F4\u5C42\u7EA7"
      });
    }
    while (stack.length > depth) stack.pop();
    const parent = stack[depth - 1];
    let item;
    if (nodeMatch) {
      const symbol = nodeMatch[2];
      const title = nodeMatch[3].trim();
      const mapped = map.get(title);
      const id = mapped?.id ?? `auto:${symbol}:${title}`;
      if (mapped && mapped.symbol !== symbol) {
        issues.push({
          code: "type-mismatch",
          line: index + 1,
          severity: "error",
          message: `\u201C${title}\u201D \u6B63\u6587\u524D\u7F00 ${symbol} \u4E0E\u6620\u5C04 ${mapped.symbol} \u4E0D\u4E00\u81F4`
        });
      }
      const count = occurrenceCount.get(id) ?? 0;
      occurrenceCount.set(id, count + 1);
      item = {
        key: `${id}:${count}`,
        kind: "node",
        title,
        depth,
        line: index + 1,
        relation: getRelation(parent),
        nodeId: id,
        nodeType: nodeTypeBySymbol[symbol],
        symbol,
        children: []
      };
      if (!declarations.has(id)) {
        const type = nodeTypeBySymbol[symbol];
        const decl = {
          id,
          type,
          title,
          description: "",
          ...usesTextPayload(type) ? { content: "", history: [] } : { prompt: "", history: [] }
        };
        declarations.set(id, decl);
        lastNodeDecl = decl;
      } else {
        lastNodeDecl = declarations.get(id);
      }
    } else {
      lastNodeDecl = null;
      const title = structureMatch[2].trim();
      item = {
        key: `structure:${index}:${title}`,
        kind: "structure",
        title,
        depth,
        line: index + 1,
        relation: getRelation(parent),
        children: []
      };
    }
    if (parent) parent.children.push(item);
    else roots.push(item);
    stack[depth] = item;
  }
  return { tree: roots, declarations: [...declarations.values()], issues };
}

// ../plugins/graphvideo.studio/backend/domain/markdown/markdown-parser.ts
function parseProjectMarkdown(markdown) {
  return parseProject(markdown);
}

// ../plugins/graphvideo.studio/backend/nodes/markdown-parser.ts
var MarkdownParserNode = class extends Node {
  get latestTree() {
    return this.state.tree;
  }
  get latestIssues() {
    return this.state.issues;
  }
  constructor(id = "node-md-parser", name = "\u6587\u6863\u8BED\u6CD5\u89E3\u6790\u5668") {
    super(id, name, {
      tree: [],
      issues: [],
      lastParsedAt: 0
    });
    this.icon = "\u{1F332}";
    this.description = "\u3010AST \u8BED\u6CD5\u6811\u89E3\u6790\u3011\u589E\u91CF\u89E3\u6790 Markdown \u7ED3\u6784\u4E0E\u6807\u9898\u5206\u5757\n\u3010\u5F02\u5E38\u8BCA\u65AD\u3011\u6355\u83B7 Prompt \u6807\u8BB0\u4E0E\u683C\u5F0F\u8BED\u6CD5 Issue\n\u3010\u53CC\u5411\u6D3E\u53D1\u3011\u5411\u4E0B\u6E38\u5927\u7EB2\u6811\u4E0E SQLite \u540C\u6B65 ParsedAstTreeInfo";
  }
  async change(info, ctx) {
    if (info.type !== "DocumentUpdatedInfo")
      return;
    const md = info.markdown;
    if (md !== void 0 && md !== null) {
      const now = this.runtimeNow();
      let result = { tree: [], declarations: [], issues: [] };
      {
        result = await ctx.span("parse_ast_tree", () => parseProjectMarkdown(md));
        ctx.write("tree", result.tree);
        ctx.write("issues", result.issues);
        ctx.write("lastParsedAt", now);
        ctx.send({
          type: "ParsedAstTreeInfo",
          tree: result.tree,
          issues: result.issues,
          markdown: md
        }, "node-outliner");
        ctx.send({
          type: "SyncTreeInfo",
          tree: result.tree,
          nodes: result.declarations,
          markdown: md,
          persistenceMode: info.persistenceMode ?? "full"
        }, "node-sqlite");
      }
    }
  }
  getBodySummaryText() {
    return this.state.issues.length > 0 ? `\u53D1\u73B0 ${this.state.issues.length} \u5904\u8BED\u6CD5\u5F02\u5E38` : this.state.tree.length > 0 ? `\u7ED3\u6784\u89E3\u6790\u5C31\u7EEA (${this.state.tree.length}\u7AE0\u8282)` : "\u7B49\u5F85\u6587\u6863\u8F93\u5165";
  }
};

// ../plugins/graphvideo.studio/backend/nodes/markdown-source.ts
var MarkdownSourceNode = class extends Node {
  constructor(id = "node-md-source", name = "Markdown \u6587\u672C\u6E90", initialMd = "") {
    super(id, name, {
      markdown: initialMd,
      revision: 0,
      lastUpdatedAt: 0
    });
    this.icon = "\u{1F4C4}";
    this.description = "\u3010\u6587\u6863\u6295\u5F71\u89C6\u7A97\u3011\u7EF4\u62A4\u5F53\u524D\u6587\u6863\u5185\u5B58\u89C6\u56FE\u4E0E Markdown \u7F16\u8F91\u6001\n\u3010\u54CD\u5E94\u89E6\u53D1\u3011\u63A5\u6536\u524D\u7AEF\u7F16\u8F91\u8F93\u5165\u6216\u5916\u90E8\u5BFC\u5165\u540C\u6B65\u6D41\n\u3010\u589E\u91CF\u4F20\u64AD\u3011\u5E7F\u64AD DocumentUpdatedInfo \u9A71\u52A8 AST \u89E3\u6790\u4E0E\u6570\u636E\u5E93\u540C\u6B65";
  }
  async change(info, ctx) {
    const currentMarkdown = ctx.read("markdown");
    const storedRevision = ctx.read("revision");
    const currentRevision = Number.isSafeInteger(storedRevision) ? storedRevision : 0;
    if (info.type === "ProjectTreeEditRequestedInfo") {
      const request = {
        type: "ProjectTreeEditTaskInfo",
        operation: info.operation,
        markdown: currentMarkdown,
        baseRevision: currentRevision
      };
      ctx.send(request, "node-outliner");
      return;
    }
    if (info.type === "UserMarkdownEditedInfo") {
      const md = String(info.markdown ?? "");
      const now = this.runtimeNow();
      const nextRevision = currentRevision + 1;
      {
        ctx.write("markdown", md);
        ctx.write("revision", nextRevision);
        ctx.write("lastUpdatedAt", now);
        ctx.send({
          type: "DocumentUpdatedInfo",
          markdown: md,
          revision: nextRevision,
          persistenceMode: "full"
        }, "node-md-parser");
      }
      return;
    }
    if (info.type === "ProjectFileObservedInfo") {
      const md = typeof info.content === "string" ? info.content : "";
      const now = this.runtimeNow();
      const nextRevision = currentRevision + 1;
      {
        ctx.write("markdown", md);
        ctx.write("revision", nextRevision);
        ctx.write("lastUpdatedAt", now);
        ctx.send({
          type: "DocumentUpdatedInfo",
          markdown: md,
          revision: nextRevision,
          persistenceMode: "full"
        }, "node-md-parser");
      }
      return;
    }
    if (info.type === "ProjectDocumentReplacementInfo") {
      if (!Number.isSafeInteger(info.baseRevision)) {
        throw new Error(`\u9879\u76EE\u6587\u6863 baseRevision \u975E\u6CD5: actual=${String(info.baseRevision)}`);
      }
      const md = typeof info.markdown === "string" ? info.markdown : "";
      const now = this.runtimeNow();
      const nextRevision = currentRevision + 1;
      const persistenceMode = info.persistenceMode ?? "structure";
      {
        ctx.write("markdown", md);
        ctx.write("revision", nextRevision);
        ctx.write("lastUpdatedAt", now);
        ctx.send({
          type: "DocumentUpdatedInfo",
          markdown: md,
          revision: nextRevision,
          persistenceMode
        }, "node-md-parser");
      }
      return;
    }
    if (info.type === "ProjectMarkdownRunRequestedInfo") {
      const md = typeof info.markdown === "string" ? info.markdown : "";
      const now = this.runtimeNow();
      const nextRevision = currentRevision + 1;
      {
        ctx.write("markdown", md);
        ctx.write("revision", nextRevision);
        ctx.write("lastUpdatedAt", now);
        ctx.send({
          type: "DocumentUpdatedInfo",
          markdown: md,
          revision: nextRevision,
          persistenceMode: "full"
        }, "node-md-parser");
      }
    }
  }
  getBodySummaryText() {
    return this.state.markdown ? `\u6587\u6863\u6E90: ${this.state.markdown.length} \u5B57\u7B26` : this.description || "\u7B49\u5F85\u521D\u59CB Markdown \u6587\u672C";
  }
};

// ../plugins/graphvideo.studio/backend/domain/outliner/tree-editor.ts
var symbolByNodeType = {
  text: "$",
  image: "@",
  video: "%",
  audio: "~",
  style: "&"
};
var structureOpenTag2 = "<project-structure>";
var structureCloseTag2 = "</project-structure>";
function readDocument(markdown) {
  const eol = markdown.includes("\r\n") ? "\r\n" : "\n";
  return {
    eol,
    lines: markdown.replace(/\r\n/g, "\n").split("\n"),
    trailingNewline: markdown.endsWith("\n")
  };
}
function writeDocument(document) {
  let value = document.lines.join(document.eol);
  if (!document.trailingNewline && value.endsWith(document.eol)) {
    value = value.slice(0, -document.eol.length);
  }
  return value;
}
function flattenProjectTree(tree) {
  return tree.flatMap((item) => [item, ...flattenProjectTree(item.children)]);
}
function findItem(parsed, key) {
  const item = flattenProjectTree(parsed.tree).find((entry) => entry.key === key);
  if (!item) throw new Error("\u9879\u76EE\u76EE\u5F55\u5DF2\u53D8\u5316\uFF0C\u8BF7\u91CD\u8BD5");
  return item;
}
function findLocation(tree, key, parent = null) {
  for (let index = 0; index < tree.length; index += 1) {
    const item = tree[index];
    if (item.key === key) return { item, parent, siblings: tree, index };
    const nested = findLocation(item.children, key, item);
    if (nested) return nested;
  }
  return null;
}
function normalizedTitle(value) {
  const title = value.trim();
  if (!title) throw new Error("\u540D\u79F0\u4E0D\u80FD\u4E3A\u7A7A");
  if (/[\r\n]/.test(title)) throw new Error("\u540D\u79F0\u4E0D\u80FD\u6362\u884C");
  if (/['"]/.test(title)) throw new Error("\u540D\u79F0\u6682\u4E0D\u652F\u6301\u5F15\u53F7");
  return title;
}
function assertValidProject(parsed) {
  const issue = parsed.issues.find((entry) => entry.severity === "error");
  if (issue) throw new Error(issue.message);
}
function structureBounds(lines) {
  const opening = lines.findIndex((line) => line.trim() === structureOpenTag2);
  const closing = lines.findIndex(
    (line, index) => index > opening && line.trim() === structureCloseTag2
  );
  if (opening < 0 || closing < 0) throw new Error("\u9879\u76EE\u7ED3\u6784\u533A\u57DF\u4E0D\u53EF\u7528");
  return { opening, closing };
}
function itemBlock(parsed, item, closing) {
  const start = item.line - 1;
  const next = flattenProjectTree(parsed.tree).find(
    (candidate) => candidate.line > item.line && candidate.depth <= item.depth
  );
  return { start, end: next ? next.line - 1 : closing };
}
function baseIndent(parsed, lines) {
  const first = flattenProjectTree(parsed.tree)[0];
  return first ? lines[first.line - 1].match(/^\s*/)?.[0].length ?? 0 : 0;
}
function renderTitleLine(item, title, lines) {
  const indentation = lines[item.line - 1].match(/^\s*/)?.[0] ?? "";
  return item.kind === "node" ? `${indentation}${item.symbol}${title}` : `${indentation}# ${title}`;
}
function assertUniqueNodeTitle(parsed, title, ignoredNodeId) {
  const conflict = parsed.declarations.find(
    (node) => node.title === title && node.id !== ignoredNodeId
  );
  if (conflict) throw new Error(`\u8282\u70B9\u540D\u79F0\u201C${title}\u201D\u5DF2\u88AB\u4F7F\u7528`);
}
function complete(document, preferredNodeId) {
  const markdown = writeDocument(document);
  const parsed = parseProject(markdown);
  assertValidProject(parsed);
  return { markdown, parsed, preferredNodeId };
}
function createItem(document, parsed, operation) {
  const title = normalizedTitle(operation.title);
  if (operation.kind === "node") {
    assertUniqueNodeTitle(parsed, title);
  }
  const { closing } = structureBounds(document.lines);
  const parent = operation.parentKey ? findItem(parsed, operation.parentKey) : null;
  const parentBlock = parent ? itemBlock(parsed, parent, closing) : null;
  const depth = parent ? parent.depth + 1 : 0;
  const indentation = " ".repeat(baseIndent(parsed, document.lines) + depth * 2);
  const symbol = operation.kind === "node" ? symbolByNodeType[operation.nodeType] : null;
  const line = operation.kind === "node" ? `${indentation}${symbol}${title}` : `${indentation}# ${title}`;
  document.lines.splice(parentBlock?.end ?? closing, 0, line);
  return complete(document, null);
}
function renameItem(document, parsed, operation) {
  const item = findItem(parsed, operation.key);
  const title = normalizedTitle(operation.title);
  if (item.title === title) return complete(document, item.nodeId ?? null);
  if (item.kind === "node") {
    assertUniqueNodeTitle(parsed, title, item.nodeId);
    flattenProjectTree(parsed.tree).filter(
      (entry) => item.nodeId && entry.nodeId === item.nodeId || entry.title === item.title
    ).forEach((entry) => {
      document.lines[entry.line - 1] = renderTitleLine(entry, title, document.lines);
    });
  } else {
    document.lines[item.line - 1] = renderTitleLine(item, title, document.lines);
  }
  return complete(document, item.nodeId ?? null);
}
function deleteItem(document, parsed, operation) {
  const item = findItem(parsed, operation.key);
  const { closing } = structureBounds(document.lines);
  const block = itemBlock(parsed, item, closing);
  document.lines.splice(block.start, block.end - block.start);
  return complete(document, null);
}
function reindentBlock(lines, sourceIndent, targetIndent) {
  const sourcePrefix = " ".repeat(sourceIndent);
  const targetPrefix = " ".repeat(targetIndent);
  return lines.map((line) => {
    if (!line.trim()) return line;
    return `${targetPrefix}${line.startsWith(sourcePrefix) ? line.slice(sourceIndent) : line.trimStart()}`;
  });
}
function moveItem(document, parsed, operation) {
  const source = findItem(parsed, operation.key);
  const target = operation.targetKey ? findItem(parsed, operation.targetKey) : null;
  const { closing } = structureBounds(document.lines);
  const sourceBlock = itemBlock(parsed, source, closing);
  if (target) {
    const targetBlock2 = itemBlock(parsed, target, closing);
    if (targetBlock2.start >= sourceBlock.start && targetBlock2.start < sourceBlock.end) {
      throw new Error("\u4E0D\u80FD\u628A\u9879\u76EE\u9879\u79FB\u52A8\u5230\u81EA\u8EAB\u5185\u90E8");
    }
  }
  const targetBlock = target ? itemBlock(parsed, target, closing) : null;
  const insertion = !targetBlock ? closing : operation.position === "before" ? targetBlock.start : targetBlock.end;
  const sourceLines = document.lines.slice(sourceBlock.start, sourceBlock.end);
  document.lines.splice(sourceBlock.start, sourceLines.length);
  const adjustedInsertion = insertion > sourceBlock.start ? insertion - sourceLines.length : insertion;
  document.lines.splice(adjustedInsertion, 0, ...sourceLines);
  return complete(document, source.nodeId ?? null);
}
function shiftBlockDepth(document, parsed, source, target, position) {
  const { closing } = structureBounds(document.lines);
  const sourceBlock = itemBlock(parsed, source, closing);
  const targetBlock = itemBlock(parsed, target, closing);
  const insertion = targetBlock.end;
  const indentation = baseIndent(parsed, document.lines);
  const sourceLines = document.lines.slice(sourceBlock.start, sourceBlock.end);
  document.lines.splice(sourceBlock.start, sourceLines.length);
  const adjustedInsertion = insertion > sourceBlock.start ? insertion - sourceLines.length : insertion;
  const targetDepth = position === "inside" ? target.depth + 1 : target.depth;
  document.lines.splice(
    adjustedInsertion,
    0,
    ...reindentBlock(
      sourceLines,
      indentation + source.depth * 2,
      indentation + targetDepth * 2
    )
  );
}
function adjustSingleLeft(document, parsed, source, parent) {
  const { closing } = structureBounds(document.lines);
  const sourceBlock = itemBlock(parsed, source, closing);
  const parentBlock = itemBlock(parsed, parent, closing);
  const indentation = baseIndent(parsed, document.lines);
  const sourceIndent = indentation + source.depth * 2;
  const line = reindentBlock(
    [document.lines[sourceBlock.start]],
    sourceIndent,
    sourceIndent - 2
  )[0];
  const descendants = document.lines.slice(sourceBlock.start + 1, sourceBlock.end);
  const promotedDescendants = reindentBlock(descendants, sourceIndent + 2, sourceIndent);
  document.lines.splice(
    sourceBlock.start,
    sourceBlock.end - sourceBlock.start,
    ...promotedDescendants
  );
  const insertion = parentBlock.end - 1;
  document.lines.splice(insertion, 0, line);
}
function adjustDepth(document, parsed, operation) {
  const location = findLocation(parsed.tree, operation.key);
  if (!location) throw new Error("\u9879\u76EE\u76EE\u5F55\u5DF2\u53D8\u5316\uFF0C\u8BF7\u91CD\u8BD5");
  const { item: source, parent, siblings, index } = location;
  if (operation.direction === "right") {
    const previousSibling = siblings[index - 1];
    if (!previousSibling) throw new Error("\u5F53\u524D\u9879\u524D\u9762\u6CA1\u6709\u53EF\u4F5C\u4E3A\u7236\u7EA7\u7684\u540C\u5C42\u9879\u76EE\u9879");
    if (operation.includeChildren) {
      shiftBlockDepth(document, parsed, source, previousSibling, "inside");
    } else {
      const indentation = document.lines[source.line - 1].match(/^\s*/)?.[0] ?? "";
      document.lines[source.line - 1] = `  ${indentation}${document.lines[source.line - 1].slice(indentation.length)}`;
    }
  } else {
    if (!parent) throw new Error("\u5F53\u524D\u9879\u5DF2\u7ECF\u4F4D\u4E8E\u6700\u5DE6\u5C42\u7EA7");
    if (operation.includeChildren) shiftBlockDepth(document, parsed, source, parent, "after");
    else adjustSingleLeft(document, parsed, source, parent);
  }
  return complete(document, source.nodeId ?? null);
}
function pasteItem(document, parsed, operation) {
  const [root, ...remaining] = operation.item.lines;
  if (!root || root.relativeDepth !== 0 || operation.item.lines.some(
    (line) => line.relativeDepth < 0 || !Number.isInteger(line.relativeDepth)
  ))
    throw new Error("\u590D\u5236\u7684\u9879\u76EE\u5185\u5BB9\u65E0\u6548");
  let previousDepth = 0;
  remaining.forEach((line) => {
    if (line.relativeDepth > previousDepth + 1) throw new Error("\u590D\u5236\u7684\u9879\u76EE\u5C42\u7EA7\u65E0\u6548");
    previousDepth = line.relativeDepth;
  });
  const declarations = new Map(parsed.declarations.map((node) => [node.id, node]));
  operation.item.lines.forEach((line) => {
    if (line.kind === "node" && (!line.nodeId || !declarations.has(line.nodeId))) {
      throw new Error("\u590D\u5236\u5185\u5BB9\u5F15\u7528\u7684\u8282\u70B9\u5DF2\u4E0D\u5728\u5F53\u524D\u9879\u76EE\u4E2D");
    }
  });
  const { closing } = structureBounds(document.lines);
  const target = operation.targetKey ? findItem(parsed, operation.targetKey) : null;
  const targetBlock = target ? itemBlock(parsed, target, closing) : null;
  const insertion = targetBlock?.end ?? closing;
  const rootDepth = target?.depth ?? 0;
  const indentation = baseIndent(parsed, document.lines);
  const lines = operation.item.lines.map((line) => {
    const prefix = " ".repeat(indentation + (rootDepth + line.relativeDepth) * 2);
    if (line.kind === "structure") return `${prefix}# ${line.title}`;
    const declaration = declarations.get(line.nodeId);
    return `${prefix}${symbolByNodeType[declaration.type]}${declaration.title}`;
  });
  document.lines.splice(insertion, 0, ...lines);
  return complete(document, root.nodeId ?? null);
}
function editProjectTree(markdown, operation) {
  const parsed = parseProject(markdown);
  assertValidProject(parsed);
  const document = readDocument(markdown);
  if (operation.type === "create") return createItem(document, parsed, operation);
  if (operation.type === "rename") return renameItem(document, parsed, operation);
  if (operation.type === "delete") return deleteItem(document, parsed, operation);
  if (operation.type === "move") return moveItem(document, parsed, operation);
  if (operation.type === "adjust-depth") return adjustDepth(document, parsed, operation);
  return pasteItem(document, parsed, operation);
}

// ../plugins/graphvideo.studio/backend/nodes/outliner-tree.ts
var OutlinerTreeNode = class extends Node {
  constructor(id = "node-outliner", name = "\u5927\u7EB2\u5C42\u7EA7\u7BA1\u7406\u5668") {
    super(id, name, {
      tree: [],
      lastStructureMd: ""
    });
    this.icon = "\u{1F4CB}";
    this.description = "\u3010\u5927\u7EB2\u552F\u4E00 Owner\u3011\u7EF4\u62A4 canonical ProjectTreeItem\n\u3010\u6811\u7F16\u8F91\u8BA1\u7B97\u3011\u57FA\u4E8E MarkdownSource revision \u8BA1\u7B97\u6587\u6863\u66FF\u6362\n\u3010\u63D0\u4EA4\u95ED\u73AF\u3011\u66FF\u6362\u8BF7\u6C42\u8FD4\u56DE MarkdownSource\uFF0C\u7531 Kernel \u91CD\u8DD1\u89E3\u6790\u5E76\u6295\u5F71";
  }
  async change(info, ctx) {
    if (info.type === "ProjectTreeEditTaskInfo") {
      if (typeof info.markdown !== "string" || !Number.isSafeInteger(info.baseRevision)) {
        throw new Error("ProjectTreeEditTaskInfo \u7F3A\u5C11 markdown/baseRevision");
      }
      if (!info.operation || typeof info.operation !== "object") {
        throw new Error("ProjectTreeEditTaskInfo \u7F3A\u5C11 canonical operation");
      }
      const operation = info.operation;
      const markdown = String(info.markdown);
      const edited = await ctx.span("edit_project_tree", () => editProjectTree(markdown, operation));
      if (edited.markdown === markdown)
        return;
      const replacement = {
        type: "ProjectDocumentReplacementInfo",
        markdown: edited.markdown,
        baseRevision: info.baseRevision,
        persistenceMode: operation.type === "move" || operation.type === "adjust-depth" || operation.type === "paste" ? "order" : "structure",
        preferredNodeId: edited.preferredNodeId
      };
      ctx.send(replacement, "node-md-source");
      return;
    }
    if (info.type !== "ParsedAstTreeInfo" || !Array.isArray(info.tree))
      return;
    const nextTree = info.tree;
    const structureMarkdown = typeof info.markdown === "string" ? info.markdown : ctx.read("lastStructureMd");
    const now = this.runtimeNow();
    {
      ctx.write("tree", nextTree);
      ctx.write("lastStructureMd", structureMarkdown);
      ctx.send({
        type: "StructureMarkdownInfo",
        structureMd: structureMarkdown
      }, "node-sec-gate");
      ctx.send({
        type: "StateToCaptureInfo",
        tree: nextTree,
        structureMd: structureMarkdown
      }, "n-hist");
      return;
    }
  }
  getBodySummaryText() {
    const totalNodes = flattenProjectTree(this.state.tree).length;
    return totalNodes > 0 ? `\u5927\u7EB2\u6811: ${totalNodes} \u4E2A\u9879\u76EE\u9879` : this.description || "\u5927\u7EB2\u6811\u5C31\u7EEA";
  }
};

// ../plugins/graphvideo.studio/backend/nodes/sqlite-observer.ts
var SqliteObserverSourceNode = class extends WorldNode {
  constructor(id = "src-sqlite-observer", name = "SQLite\u843D\u76D8\u89C2\u6D4B\u6E90") {
    super(id, name, {
      observedFlushes: 0,
      lastFlushedBytes: 0,
      lastObservedTime: 0
    });
    this.icon = "\u{1F4E1}";
    this.description = "\u3010\u73B0\u5B9E\u89C2\u6D4B\u6E90\u3011\u72EC\u7ACB\u6355\u83B7 SQLite \u7269\u7406\u78C1\u76D8\u843D\u5E93\u5B8C\u6210\u4E8B\u5B9E\n\u3010\u4E8B\u5B9E\u63D0\u5347\u3011\u7269\u7406\u5199\u5165\u4E8B\u4EF6 -> DatabaseSavedObservedInfo\n\u3010\u5BF9\u8D26\u56DE\u6D41\u3011\u5355\u5411\u56DE\u6D41\u81F3\u9886\u57DF\u5C42\u5B8C\u6210\u9884\u671F\u4E0E\u4E8B\u5B9E\u95ED\u73AF\u6838\u9A8C";
  }
  async change(info, ctx) {
    if (info.type === "DatabaseWriteFailedObservedInfo") {
      ctx.write("lastObservedTime", this.runtimeNow());
      ctx.send(info, "node-sqlite");
      return;
    }
    if (info.type === "PhysicalDiskMutationInfo" || info.type === "PhysicalProjectStructureMutationInfo" || info.persistedRecordCount !== void 0) {
      const projectObservation = info.type === "PhysicalProjectStructureMutationInfo" ? info.observation : null;
      const count = projectObservation?.nodes?.length ?? Number(info.persistedRecordCount ?? 0);
      const now = this.runtimeNow();
      const observedInfo = projectObservation ? {
        type: "ProjectStructurePersistedObservedInfo",
        taskId: info.taskId,
        observation: projectObservation
      } : {
        type: "DatabaseSavedObservedInfo",
        taskId: info.taskId,
        dbFilePath: info.dbFilePath || "dist/project.sqlite",
        persistedRecordCount: count,
        observation: info.observation
      };
      {
        const prevFlushes = ctx.read("observedFlushes");
        ctx.write("observedFlushes", prevFlushes + 1);
        ctx.write("lastFlushedBytes", count * 64);
        ctx.write("lastObservedTime", now);
        ctx.send(observedInfo, "node-sqlite");
      }
    }
  }
  getBodySummaryText() {
    return this.state.observedFlushes > 0 ? `\u5DF2\u6355\u83B7\u843D\u76D8\u4E8B\u5B9E: ${this.state.observedFlushes} \u6B21` : this.description;
  }
};

// ../plugins/graphvideo.studio/backend/nodes/sqlite-registry.ts
var SqliteRegistryNode = class extends Node {
  constructor(id = "node-sqlite", name = "SQLite \u5143\u6570\u636E\u6CE8\u518C\u8868") {
    super(id, name, {
      table: /* @__PURE__ */ new Map(),
      retainedTable: /* @__PURE__ */ new Map(),
      lastUpdatedAt: 0,
      inSync: true,
      lastError: null,
      historyScopeId: ""
    });
    this.icon = "\u{1F5C4}\uFE0F";
    this.description = "\u3010SQLite \u6743\u5A01\u771F\u7406\u6E90\u3011\u4F5C\u4E3A\u7CFB\u7EDF\u552F\u4E00\u6743\u5A01\u771F\u7406\u6E90 (SSOT) \u7EF4\u62A4\u8282\u70B9\u5143\u6570\u636E\u4E0E\u6587\u672C\n\u3010\u591A\u8DEF\u6C47\u805A\u3011\u63A5\u6536 AST \u6811\u540C\u6B65\u3001\u5927\u7EB2\u53D8\u5F02\u4E0E\u667A\u80FD\u4F53\u5DE5\u5177\u94FE\u4FEE\u6539\n\u3010\u4E8B\u52A1\u6267\u884C\u3011\u539F\u5B50\u59D4\u6258\u7269\u7406\u5199\u5165\u7AEF\u843D\u76D8\u5E76\u8054\u52A8 Action Journal \u5386\u53F2\u65E5\u5FD7";
  }
  exportState() {
    return {
      table: Array.from(this.state.table.entries()),
      retainedTable: Array.from(this.state.retainedTable.entries())
    };
  }
  getRecord(id) {
    return this.state.table.get(id);
  }
  getAllRecords() {
    return Array.from(this.state.table.values());
  }
  async change(info, ctx) {
    const now = this.runtimeNow();
    if (info.type === "ProjectMetadataHydratedInfo") {
      const hydrated = info;
      const observedAt = Number.isFinite(hydrated.observedAt) ? hydrated.observedAt : now;
      const historyScopeId = this.runtimeId("snapshot");
      const records = (nodes) => new Map(nodes.map((node) => [
        node.id,
        {
          ...node,
          description: node.description ?? "",
          updatedAt: observedAt
        }
      ]));
      ctx.patchState({
        table: records(Array.isArray(hydrated.nodes) ? hydrated.nodes : []),
        retainedTable: records(Array.isArray(hydrated.retainedNodes) ? hydrated.retainedNodes : []),
        lastUpdatedAt: observedAt,
        inSync: true,
        lastError: null,
        historyScopeId
      });
      ctx.send({ type: "ProjectHistoryResetInfo", historyScopeId }, "n-hist");
      return;
    }
    if (info.type === "DatabaseSavedObservedInfo" || info.type === "ProjectStructurePersistedObservedInfo") {
      {
        ctx.write("inSync", true);
        ctx.write("lastError", null);
      }
      if (info.type === "DatabaseSavedObservedInfo") {
        ctx.send({ ...info, type: "DatabaseSavedObservedInfo" }, "node-generation-task");
      }
      return;
    }
    if (info.type === "DatabaseWriteFailedObservedInfo") {
      ctx.write("inSync", false);
      ctx.write("lastError", typeof info.error === "string" ? info.error : "SQLite \u7269\u7406\u5199\u5165\u5931\u8D25");
      ctx.send({ ...info, type: "DatabaseWriteFailedObservedInfo" }, "node-generation-task");
      return;
    }
    let changed = false;
    const table = new Map(ctx.read("table"));
    const retainedTable = new Map(ctx.read("retainedTable"));
    let journalFact = null;
    if (info.type === "SyncTreeInfo" && Array.isArray(info.nodes)) {
      const incoming = info.nodes;
      const previousByTypeTitle = new Map([...table.values(), ...retainedTable.values()].map((record) => [
        `${record.type}:${record.title}`,
        record
      ]));
      const nextTable = /* @__PURE__ */ new Map();
      for (const node of incoming) {
        const retainedConflict = retainedTable.get(node.id);
        if (retainedConflict && (retainedConflict.type !== node.type || retainedConflict.title !== node.title)) {
          const lastError = `ID \u201C${node.id}\u201D \u5DF2\u7531\u4FDD\u7559\u8282\u70B9 \u201C${retainedConflict.title}\u201D \u5360\u7528`;
          {
            ctx.write("inSync", false);
            ctx.write("lastError", lastError);
          }
          return;
        }
        const previous = table.get(node.id) ?? retainedTable.get(node.id) ?? previousByTypeTitle.get(`${node.type}:${node.title}`);
        const isAutomaticId = node.id.startsWith("auto:") || node.id.startsWith("unmapped:");
        let effectiveId = previous?.id ?? node.id;
        if (!previous && isAutomaticId) {
          const allocatedId = this.runtimeId("task").replace(/[^A-Za-z0-9_-]/g, "_").replace(/^_+|_+$/g, "");
          effectiveId = `node_${allocatedId || "generated"}`;
        }
        nextTable.set(effectiveId, {
          ...node,
          ...previous ?? {},
          id: effectiveId,
          type: node.type,
          title: node.title,
          description: node.description || previous?.description || "",
          updatedAt: now
        });
        retainedTable.delete(effectiveId);
      }
      for (const [id, previous] of table) {
        if (nextTable.has(id))
          continue;
        const hasPayload = Boolean(previous.description || previous.content || previous.prompt || previous.mediaUrl || previous.history?.length);
        if (hasPayload)
          retainedTable.set(id, previous);
      }
      table.clear();
      for (const [id, record] of nextTable)
        table.set(id, record);
      changed = true;
    } else if (info.type === "SyncTreeInfo" && Array.isArray(info.tree)) {
      const syncNode = (n) => {
        if (!table.has(n.id)) {
          table.set(n.id, {
            id: n.id,
            type: n.type,
            title: n.title,
            description: "",
            updatedAt: now
          });
        }
        for (const child of n.children)
          syncNode(child);
      };
      for (const root of info.tree)
        syncNode(root);
      changed = true;
    } else if (info.type === "ArtifactSavedObservedInfo" && typeof info.targetNodeId === "string") {
      const observed = info;
      const target = table.get(observed.targetNodeId);
      if (!target) {
        ctx.send({
          type: "DatabaseWriteFailedObservedInfo",
          taskId: observed.taskId,
          error: `\u751F\u6210\u4EA7\u7269\u76EE\u6807\u5DF2\u4E0D\u5B58\u5728: ${observed.targetNodeId}`
        }, "node-generation-task");
        return;
      }
      if (target) {
        const prev = { ...target };
        const history = (target.history ?? []).map((version) => ({
          ...version,
          current: false
        }));
        if (observed.versionId && observed.relativePath) {
          const mimeType = observed.mediaType === "image" ? "image/png" : observed.mediaType === "audio" ? "audio/mpeg" : "video/mp4";
          history.push({
            id: observed.versionId,
            label: observed.filename || "Generated Media",
            relativePath: observed.relativePath,
            mimeType,
            createdAt: new Date(now).toISOString(),
            source: "generated",
            current: true
          });
        }
        table.set(observed.targetNodeId, {
          ...target,
          mediaUrl: observed.relativePath || target.mediaUrl,
          activeVersionId: observed.versionId || target.activeVersionId,
          history,
          updatedAt: now
        });
        changed = true;
        journalFact = {
          op: "UPDATE",
          targetId: observed.targetNodeId,
          label: `\u5173\u8054\u751F\u6210\u4EA7\u7269: ${observed.filename || observed.targetNodeId}`,
          before: prev,
          after: table.get(observed.targetNodeId)
        };
      }
    } else if (info.type === "UserMetadataPatchInfo" && info.patch) {
      const patch = info.patch;
      const targetId = patch.id || patch.nodeId;
      if (!targetId)
        return;
      const target = table.get(targetId);
      if (target) {
        const prev = { ...target };
        const updated = {
          ...target,
          ...patch,
          updatedAt: now
        };
        table.set(targetId, updated);
        changed = true;
        journalFact = {
          op: "UPDATE",
          targetId,
          label: `\u66F4\u65B0\u5143\u6570\u636E: ${target.title}`,
          before: prev,
          after: updated
        };
      }
    } else if (info.type === "RevertMetadataTaskInfo" && info.entry) {
      if (info.historyScopeId !== ctx.read("historyScopeId")) return;
      const entry = info.entry;
      const targetState = info.direction === "undo" ? entry.before : entry.after;
      if (targetState) {
        table.set(entry.targetId, targetState);
      } else {
        table.delete(entry.targetId);
      }
      changed = true;
    }
    if (changed) {
      const projectRequest = info.type === "SyncTreeInfo" && typeof info.markdown === "string" ? {
        taskId: typeof info.taskId === "string" ? info.taskId : `project-sync-${now}`,
        markdown: info.markdown,
        nodes: [...table.values()],
        retainedNodes: [...retainedTable.values()],
        mode: info.persistenceMode ?? "full"
      } : null;
      {
        ctx.write("table", table);
        ctx.write("retainedTable", retainedTable);
        ctx.write("lastUpdatedAt", now);
        ctx.write("inSync", false);
        ctx.write("lastError", null);
        ctx.send(projectRequest ? {
          type: "PersistProjectStructureTaskInfo",
          taskId: projectRequest.taskId,
          request: projectRequest
        } : {
          type: "PersistMetadataTaskInfo",
          taskId: info.type === "ArtifactSavedObservedInfo" ? String(info.taskId) : this.runtimeId("task"),
          records: Array.from(table.values())
        }, "sink-sqlite-writer");
        if (journalFact && info.type !== "RevertMetadataTaskInfo") {
          ctx.send({
            type: "TaskFactObservedInfo",
            fact: journalFact,
            historyScopeId: ctx.read("historyScopeId")
          }, "n-hist");
        }
      }
    }
  }
  getBodySummaryText() {
    const count = this.state.table.size;
    const syncStatus = this.state.inSync ? "\u5DF2\u5BF9\u9F50" : "\u843D\u76D8\u6392\u961F\u4E2D";
    return `\u5143\u6570\u636E\u8BB0\u5F55: ${count}\u9879 [${syncStatus}]`;
  }
};

// ../plugins/graphvideo.studio/backend/effects/sqlite-metadata-adapter.ts
var sqliteMetadataAdapterId = "graphvideo/sqlite-metadata-v1";
var SqliteMetadataAdapter = class {
  constructor(port) {
    this.port = port;
  }
  id = sqliteMetadataAdapterId;
  async execute(request, context) {
    if (!request.dbFilePath.trim()) throw new Error("SQLite Request \u7F3A\u5C11 dbFilePath");
    const ids = /* @__PURE__ */ new Set();
    for (const record of request.records) {
      if (!record || typeof record !== "object" || typeof record.id !== "string" || !record.id.trim()) {
        throw new Error("SQLite metadata record \u7F3A\u5C11 id");
      }
      if (ids.has(record.id)) throw new Error(`SQLite metadata record id \u91CD\u590D: ${record.id}`);
      ids.add(record.id);
    }
    if (context.signal?.aborted) {
      throw context.signal.reason ?? new Error("SQLite \u5199\u5165\u5DF2\u53D6\u6D88");
    }
    context.recordTransport?.({
      portId: this.port.id,
      transaction: "upsert-graph-metadata",
      recordCount: request.records.length
    });
    const observation = await this.port.write(request, context);
    if (!observation.dbFilePath.trim() || !observation.contentRef.trim()) {
      throw new Error("SQLite WritePort \u8FD4\u56DE\u7684 Observation \u4E0D\u5B8C\u6574");
    }
    return observation;
  }
};

// ../plugins/graphvideo.studio/backend/effects/desktop-sqlite-write-port.ts
var DesktopSqliteWritePort = class {
  id = "electron/project-sqlite-ipc";
  async write(request, context) {
    const project = typeof window === "undefined" ? void 0 : window.graphvideoDesktop?.project;
    if (!project) throw new Error("SQLite \u5199\u5165\u9700\u8981 Electron project bridge");
    const result = await project.persistMetadata(request.dbFilePath, request.records);
    context.recordRawSummary?.({
      kind: "electron-project-sqlite",
      text: `records=${request.records.length};db=${request.dbFilePath}`,
      redacted: false
    });
    return {
      dbFilePath: request.dbFilePath,
      persistedRecordCount: result.persistedRecordCount ?? request.records.length,
      byteLength: result.byteLength ?? 0,
      contentRef: `sqlite:${request.dbFilePath}:${result.persistedRecordCount ?? request.records.length}`
    };
  }
};

// ../plugins/graphvideo.studio/backend/effects/project-structure-adapter.ts
var projectStructureAdapterId = "graphvideo/project-structure-v1";
var ProjectStructureAdapter = class {
  constructor(port) {
    this.port = port;
  }
  id = projectStructureAdapterId;
  async execute(request, context) {
    if (typeof request.markdown !== "string") throw new Error("Project Structure Request \u7F3A\u5C11 markdown");
    if (!Array.isArray(request.nodes) || !Array.isArray(request.retainedNodes)) {
      throw new Error("Project Structure Request nodes/retainedNodes \u975E\u6570\u7EC4");
    }
    const ids = /* @__PURE__ */ new Set();
    for (const node of [...request.nodes, ...request.retainedNodes]) {
      if (!node || typeof node.id !== "string" || !node.id.trim()) {
        throw new Error("Project Structure Request Node \u7F3A\u5C11 id");
      }
      if (ids.has(node.id)) throw new Error(`Project Structure Request Node id \u91CD\u590D: ${node.id}`);
      ids.add(node.id);
    }
    context.signal?.throwIfAborted();
    context.recordTransport?.({
      portId: this.port.id,
      transaction: `project-structure/${request.mode}`,
      nodeCount: request.nodes.length,
      retainedNodeCount: request.retainedNodes.length
    });
    const observation = await this.port.write(request, context);
    if (!Number.isFinite(observation.savedAt) || !observation.contentRef.trim()) {
      throw new Error("Project Structure Observation \u4E0D\u5B8C\u6574");
    }
    return observation;
  }
};

// ../plugins/graphvideo.studio/backend/effects/desktop-project-structure-write-port.ts
var DesktopProjectStructureWritePort = class {
  id = "electron/project-structure-ipc";
  async write(request, context) {
    const project = typeof window === "undefined" ? void 0 : window.graphvideoDesktop?.project;
    if (!project) throw new Error("Project Structure \u5199\u5165\u9700\u8981 Electron project bridge");
    const result = await project.persistStructure({
      markdown: request.markdown,
      nodes: request.nodes,
      retainedNodes: request.retainedNodes,
      mode: request.mode
    });
    context.recordRawSummary?.({
      kind: "electron-project-structure",
      text: `mode=${request.mode};nodes=${request.nodes.length};savedAt=${result.savedAt}`,
      redacted: false
    });
    return {
      nodes: result.nodes ?? request.nodes,
      retainedNodes: result.retainedNodes ?? request.retainedNodes,
      savedAt: result.savedAt ?? Date.now(),
      contentRef: `project-structure:${result.savedAt ?? Date.now()}`
    };
  }
};

// ../plugins/graphvideo.studio/backend/nodes/sqlite-writer.ts
var SqliteWriterSinkNode = class extends WorldNode {
  constructor(id = "sink-sqlite-writer", name = "SQLite\u78C1\u76D8\u5199\u5165\u7AEF", adapter = new SqliteMetadataAdapter(new DesktopSqliteWritePort()), projectStructureAdapter = new ProjectStructureAdapter(new DesktopProjectStructureWritePort()), observerTargetId = "src-sqlite-observer") {
    super(id, name, {
      persistedRecordCount: 0,
      dbFilePath: ".graphvideo/nodes.sqlite",
      lastPersistTime: 0
    });
    this.adapter = adapter;
    this.projectStructureAdapter = projectStructureAdapter;
    this.observerTargetId = observerTargetId;
    this.icon = "\u{1F4BE}";
    this.description = "\u3010\u7269\u7406\u5199\u5165\u6267\u884C\u7AEF\u3011\u72EC\u5360\u6267\u884C SQLite \u672C\u5730\u78C1\u76D8\u4E8B\u52A1\u4E0E\u6301\u4E45\u5316\u5199\u5165\n\u3010\u5355\u5411\u53D7\u63A7\u3011\u63A5\u6536 SqliteRegistryNode \u4E0B\u53D1\u7684\u5143\u6570\u636E\u4E0E\u6587\u672C\u843D\u76D8\u4EFB\u52A1\n\u3010\u7269\u7406\u6D41\u51FA\u3011\u843D\u76D8\u5B8C\u6210\u540E\u89E6\u53D1\u7269\u7406\u5C42\u4E8B\u5B9E\u81F3\u843D\u76D8\u89C2\u6D4B\u7AEF";
  }
  async change(info, ctx) {
    if (info.type === "PersistProjectStructureTaskInfo") {
      const request = info.request;
      if (!request)
        throw new Error("PersistProjectStructureTaskInfo \u7F3A\u5C11 request");
      const now = this.runtimeNow();
      let observation;
      try {
        observation = await ctx.effectAdapter(this.projectStructureAdapter, request);
      } catch (error) {
        ctx.send({
          type: "DatabaseWriteFailedObservedInfo",
          taskId: request.taskId,
          adapterId: this.projectStructureAdapter.id,
          error: error instanceof Error ? error.message : String(error)
        }, this.observerTargetId);
        return;
      }
      ctx.write("persistedRecordCount", observation.nodes.length);
      ctx.write("lastPersistTime", now);
      const observed = {
        type: "PhysicalProjectStructureMutationInfo",
        taskId: request.taskId,
        observation
      };
      ctx.send(observed, this.observerTargetId);
      return;
    }
    if (info.type === "PersistMetadataTaskInfo" || info.type === "SyncTreeInfo") {
      const rawRecords = info.type === "PersistMetadataTaskInfo" ? info.records : info.nodes;
      const records = (rawRecords instanceof Map ? [...rawRecords.values()] : Array.isArray(rawRecords) ? rawRecords : [rawRecords]).filter((record) => Boolean(record) && typeof record === "object" && typeof record.id === "string");
      const now = this.runtimeNow();
      const dbPath = ctx.read("dbFilePath");
      const taskId = typeof info.taskId === "string" ? info.taskId : void 0;
      const request = {
        taskId,
        dbFilePath: dbPath,
        records
      };
      let observation;
      try {
        {
          observation = await ctx.effectAdapter(this.adapter, request);
        }
      } catch (error) {
        const failureInfo = {
          type: "DatabaseWriteFailedObservedInfo",
          taskId,
          adapterId: this.adapter.id,
          error: error instanceof Error ? error.message : String(error)
        };
        ctx.send(failureInfo, this.observerTargetId);
        return;
      }
      {
        ctx.write("persistedRecordCount", observation.persistedRecordCount);
        ctx.write("lastPersistTime", now);
        ctx.send({
          type: "PhysicalDiskMutationInfo",
          taskId,
          dbFilePath: observation.dbFilePath,
          persistedRecordCount: observation.persistedRecordCount,
          observation
        }, this.observerTargetId);
      }
    }
  }
  getBodySummaryText() {
    return this.state.persistedRecordCount > 0 ? `\u5DF2\u843D\u76D8: ${this.state.persistedRecordCount} \u6761\u8BB0\u5F55 (${this.state.dbFilePath})` : this.description;
  }
};

// ../plugins/graphvideo.studio/backend/nodes/studio-node-groups.ts
var createFileSystemSourceNode = defineNodeFactory(
  (_dependencies) => new FileSystemSourceNode("src-fs-source", "\u6587\u4EF6\u7CFB\u7EDF\u8F93\u5165\u6E90")
);
var createMarkdownSourceNode = defineNodeFactory(
  (_dependencies) => new MarkdownSourceNode("node-md-source", "Markdown \u6587\u672C\u6E90")
);
var createMarkdownParserNode = defineNodeFactory(
  (_dependencies) => new MarkdownParserNode("node-md-parser", "\u6587\u6863\u8BED\u6CD5\u89E3\u6790\u5668")
);
var createOutlinerTreeNode = defineNodeFactory(
  (_dependencies) => new OutlinerTreeNode("node-outliner", "\u5927\u7EB2\u5C42\u7EA7\u7BA1\u7406\u5668")
);
var createHistoryManagerNode = defineNodeFactory(
  (_dependencies) => new HistoryManagerNode("n-hist", "\u5386\u53F2\u5FEB\u7167\u4E0E\u64A4\u56DE\u4E2D\u67A2")
);
var createSqliteRegistryNode = defineNodeFactory(
  (_dependencies) => new SqliteRegistryNode("node-sqlite", "SQLite \u5143\u6570\u636E\u6CE8\u518C\u8868")
);
var createSqliteWriterSinkNode = defineNodeFactory(
  (dependencies) => new SqliteWriterSinkNode(
    "sink-sqlite-writer",
    "SQLite\u78C1\u76D8\u5199\u5165\u7AEF",
    dependencies.sqlitePersistAdapter,
    dependencies.projectStructurePersistAdapter
  )
);
var createSqliteObserverSourceNode = defineNodeFactory(
  (_dependencies) => new SqliteObserverSourceNode("src-sqlite-observer", "SQLite\u843D\u76D8\u89C2\u6D4B\u6E90")
);
var createSecurityGateNode = defineNodeFactory(
  (_dependencies) => new SecurityGateNode("node-sec-gate", "\u98CE\u63A7\u4E0E\u9884\u7B97\u5173\u53E3")
);
var createGenerationTaskNode = defineNodeFactory(
  (_dependencies) => new GenerationTaskNode(
    "node-generation-task",
    "\u751F\u6210\u4EFB\u52A1\u72B6\u6001\u63A7\u5236\u5668"
  )
);
var createGenerationModelResolverNode = defineNodeFactory(
  (_dependencies) => new GenerationModelResolverNode(
    "node-generation-model-resolver",
    "\u751F\u6210\u6A21\u578B\u89E3\u6790\u5668"
  )
);
var createGenerationSubmitNode = defineNodeFactory(
  (dependencies) => new GenerationSubmitSinkNode(
    "sink-generation-submit",
    "\u751F\u6210\u8BF7\u6C42\u63D0\u4EA4\u7AEF",
    dependencies.generationAdapterOperation
  )
);
var createGenerationPollNode = defineNodeFactory(
  (dependencies) => new GenerationPollSourceNode(
    "src-generation-poll",
    "\u751F\u6210\u72B6\u6001\u5355\u6B21\u89C2\u6D4B\u7AEF",
    dependencies.generationAdapterOperation
  )
);
var createGenerationPollSchedulerNode = defineNodeFactory(
  (_dependencies) => new GenerationPollSchedulerNode(
    "src-generation-poll-scheduler",
    "\u751F\u6210\u8F6E\u8BE2\u8C03\u5EA6\u6E90"
  )
);
var createGenerationDownloadNode = defineNodeFactory(
  (dependencies) => new GenerationDownloadSinkNode(
    "sink-generation-download",
    "\u751F\u6210\u4EA7\u7269\u4E0B\u8F7D\u7AEF",
    dependencies.generationAdapterOperation
  )
);
var createElectronHostNode = defineNodeFactory(
  (_dependencies) => new ElectronHostNode()
);
var createElectronWindowExecutionNode = defineNodeFactory(
  (dependencies) => new ElectronWindowExecutionNode(
    "sink-electron-window",
    "\u684C\u9762\u7A97\u53E3\u6267\u884C\u7AEF",
    dependencies.electronWindowAdapter
  )
);
var createElectronWindowObservationNode = defineNodeFactory(
  (_dependencies) => new ElectronWindowObservationNode()
);
var createAuthoringNodes = defineGraphFactory(
  (dependencies) => [
    createFileSystemSourceNode(dependencies),
    createMarkdownSourceNode(dependencies),
    createMarkdownParserNode(dependencies),
    createOutlinerTreeNode(dependencies),
    createHistoryManagerNode(dependencies)
  ]
);
var createPersistenceNodes = defineGraphFactory(
  (dependencies) => [
    createSqliteRegistryNode(dependencies),
    createSqliteWriterSinkNode(dependencies),
    createSqliteObserverSourceNode(dependencies)
  ]
);
var createGenerationNodes = defineGraphFactory(
  (dependencies) => [
    createSecurityGateNode(dependencies),
    createGenerationModelResolverNode(dependencies),
    createGenerationTaskNode(dependencies),
    createGenerationSubmitNode(dependencies),
    createGenerationPollNode(dependencies),
    createGenerationPollSchedulerNode(dependencies),
    createGenerationDownloadNode(dependencies)
  ]
);
var createPlatformNodes = defineGraphFactory(
  (dependencies) => [
    createElectronHostNode(dependencies),
    createElectronWindowExecutionNode(dependencies),
    createElectronWindowObservationNode(dependencies)
  ]
);

// ../plugins/graphvideo.studio/backend.ts
var backend_default = defineBackendPlugin({
  id: "graphvideo.studio",
  rendererRoots: [
    { targetNodeId: "src-fs-source", infoType: "ProjectOpenedInfo", validate: (info) => Boolean(info.project && typeof info.project === "object") },
    { targetNodeId: "node-md-source", infoType: "UserMarkdownEditedInfo", validate: (info) => typeof info.markdown === "string" },
    { targetNodeId: "node-md-source", infoType: "ProjectTreeEditRequestedInfo", validate: (info) => Boolean(info.operation && typeof info.operation === "object") },
    { targetNodeId: "node-sqlite", infoType: "UserMetadataPatchInfo", validate: (info) => Boolean(info.patch && typeof info.patch === "object" && typeof info.patch.id === "string") },
    { targetNodeId: "node-sec-gate", infoType: "GenerationBudgetConfiguredInfo", validate: (info) => typeof info.maxBudget === "number" && Number.isFinite(info.maxBudget) && info.maxBudget >= 0 },
    { targetNodeId: "node-sec-gate", infoType: "GenerationCreditsResetInfo", validate: () => true },
    { targetNodeId: "node-generation-model-resolver", infoType: "GenerationBatchRequestedInfo", validate: (info) => typeof info.batchId === "string" && Array.isArray(info.items) && Boolean(info.project && info.catalog) },
    { targetNodeId: "node-generation-task", infoType: "GenerationBatchCancelRequestedInfo", validate: (info) => typeof info.batchId === "string" },
    { targetNodeId: "n-hist", infoType: "UserSnapshotActionInfo", validate: (info) => Boolean(info.action && typeof info.action === "object" && ["UNDO", "REDO", "CLEAR_REDO"].includes(String(info.action.type))) }
  ],
  createNodes: ({ dependencies }) => [
    ...createAuthoringNodes(dependencies),
    ...createPersistenceNodes(dependencies),
    ...createGenerationNodes(dependencies),
    ...createPlatformNodes(dependencies)
  ]
});
export {
  backend_default as default
};
