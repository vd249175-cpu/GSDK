/**
 * app/plugins/backend/browser-recorder/cdp-recorder.mjs
 * 
 * 基于 Chrome DevTools Protocol (CDP) WebSocket 的原生 Playwright 实时流式录制器。
 * 架构位置：可选外层宿主 Adapter（零业务逻辑微内核，录制动作和 CDP 协议不进 Node）。
 * 
 * 连接 9343 端口专用 Chrome，通过 Target.setAutoAttach 监听所有页面，
 * 通过 Runtime.addBinding('__recordAction') 捕获用户在浏览器中的点击、输入、导航等原生动作，
 * 实时生成 Playwright 语句并推入队列，供 BrowserObserverNode 长轮询流式消费。
 */

export const CONTROL_ADAPTER_ID = 'browser/capture-control'
export const EVENTS_ADAPTER_ID = 'browser/capture-events'

export const INJECTED_RECORDING_SCRIPT = `(() => {
  if (window.__recordingInitialized) return;
  window.__recordingInitialized = true;

  function getLocator(el) {
    if (!el || el === document.body || el === document.documentElement) return 'page.locator("body")';

    // 1. data-testid / data-test-id / data-test
    const testId = el.getAttribute('data-testid') || el.getAttribute('data-test-id') || el.getAttribute('data-test');
    if (testId) return 'page.getByTestId(' + JSON.stringify(testId) + ')';

    // 2. role & name for buttons and links
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute('role') || (tag === 'button' ? 'button' : tag === 'a' ? 'link' : null);
    const name = el.getAttribute('aria-label') || el.innerText?.trim()?.slice(0, 40) || el.getAttribute('title') || '';
    if (role && name && name.length > 0 && name.length < 50 && !name.includes('\\n')) {
      return 'page.getByRole(' + JSON.stringify(role) + ', { name: ' + JSON.stringify(name) + ' })';
    }

    // 3. placeholder
    const placeholder = el.getAttribute('placeholder');
    if (placeholder) {
      return 'page.getByPlaceholder(' + JSON.stringify(placeholder) + ')';
    }

    // 4. label
    if (el.labels && el.labels[0]) {
      const labelText = el.labels[0].innerText?.trim();
      if (labelText && labelText.length < 40) {
        return 'page.getByLabel(' + JSON.stringify(labelText) + ')';
      }
    }

    // 5. id
    if (el.id && !el.id.match(/\\d{4,}/)) {
      return 'page.locator(' + JSON.stringify('#' + el.id) + ')';
    }

    // 6. name attribute
    if (el.name) {
      return 'page.locator(' + JSON.stringify('[name="' + el.name + '"]') + ')';
    }

    // 7. text for buttons/links/headings
    if (['button', 'a', 'span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tag) && name && name.length > 0 && name.length < 40 && !name.includes('\\n')) {
      return 'page.getByText(' + JSON.stringify(name) + ')';
    }

    // 8. class-based fallback
    const classes = Array.from(el.classList || []).filter(c => !c.match(/\\d{4,}/) && c.length < 30).slice(0, 2);
    if (classes.length > 0) {
      return 'page.locator(' + JSON.stringify(tag + '.' + classes.join('.')) + ')';
    }

    return 'page.locator(' + JSON.stringify(tag) + ')';
  }

  function emitAction(code) {
    if (typeof window.__recordAction === 'function') {
      try {
        window.__recordAction(JSON.stringify({ kind: 'action', code: code, timestamp: Date.now() }));
      } catch (e) {}
    }
  }

  document.addEventListener('click', (e) => {
    const target = e.target;
    if (!target) return;
    const clickable = target.closest('button, a, input[type="submit"], input[type="button"], [role="button"], [role="link"]') || target;
    const loc = getLocator(clickable);
    emitAction('await ' + loc + '.click();');
  }, true);

  document.addEventListener('change', (e) => {
    const target = e.target;
    if (!target) return;
    const tag = target.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea') {
      const type = (target.type || '').toLowerCase();
      if (type === 'checkbox' || type === 'radio') {
        const loc = getLocator(target);
        if (target.checked) {
          emitAction('await ' + loc + '.check();');
        } else {
          emitAction('await ' + loc + '.uncheck();');
        }
      } else if (type !== 'password') {
        const loc = getLocator(target);
        emitAction('await ' + loc + '.fill(' + JSON.stringify(target.value) + ');');
      }
    } else if (tag === 'select') {
      const loc = getLocator(target);
      emitAction('await ' + loc + '.selectOption(' + JSON.stringify(target.value) + ');');
    }
  }, true);
})();`

export function createCdpRecorder({ cdpUrl = 'http://127.0.0.1:9343' } = {}) {
  let ws = null
  let isRecording = false
  let actionQueue = []
  let allActions = []
  const pendingWaiters = []
  const attachedSessions = new Map()

  const pushAction = (code) => {
    if (!isRecording) return
    actionQueue.push({ kind: 'action', code, timestamp: Date.now() })
    allActions.push(code)
    while (pendingWaiters.length > 0) {
      const waiter = pendingWaiters.shift()
      waiter?.()
    }
  }

  const start = async (sessionId) => {
    let versionRes
    try {
      versionRes = await fetch(`${cdpUrl}/json/version`)
    } catch (err) {
      throw new Error(`无法连接到专用浏览器 (${cdpUrl})。请先点击“打开专用浏览器”启动 Chrome (端口 9343)。`, { cause: err })
    }
    if (!versionRes.ok) {
      throw new Error(`专用浏览器 HTTP 状态异常: ${versionRes.status}`)
    }
    const versionData = await versionRes.json()
    const wsUrl = versionData.webSocketDebuggerUrl
    if (!wsUrl) {
      throw new Error('专用浏览器未提供 webSocketDebuggerUrl')
    }

    ws = new WebSocket(wsUrl)
    await new Promise((resolve, reject) => {
      const onOpen = () => { cleanup(); resolve() }
      const onError = (e) => { cleanup(); reject(new Error('CDP WebSocket 连接失败: ' + (e.message || 'error'))) }
      const cleanup = () => {
        ws.removeEventListener('open', onOpen)
        ws.removeEventListener('error', onError)
      }
      ws.addEventListener('open', onOpen)
      ws.addEventListener('error', onError)
    })

    isRecording = true
    actionQueue = []
    allActions = []
    attachedSessions.clear()

    let nextCmdId = 1
    const sendCommand = (method, params = {}, targetSessionId = null) => {
      if (ws?.readyState === 1) {
        const payload = { id: nextCmdId++, method, params }
        if (targetSessionId) payload.sessionId = targetSessionId
        ws.send(JSON.stringify(payload))
      }
    }

    const attachToPage = (targetSessionId) => {
      sendCommand('Page.enable', {}, targetSessionId)
      sendCommand('Runtime.enable', {}, targetSessionId)
      sendCommand('Runtime.addBinding', { name: '__recordAction' }, targetSessionId)
      sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: INJECTED_RECORDING_SCRIPT }, targetSessionId)
      sendCommand('Runtime.evaluate', { expression: INJECTED_RECORDING_SCRIPT }, targetSessionId)
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        if (msg.method === 'Target.attachedToTarget') {
          const { sessionId: attachedId, targetInfo } = msg.params
          if (targetInfo?.type === 'page') {
            attachedSessions.set(attachedId, targetInfo)
            attachToPage(attachedId)
          }
        } else if (msg.method === 'Target.detachedFromTarget') {
          attachedSessions.delete(msg.params.sessionId)
        } else if (msg.method === 'Runtime.bindingCalled' && msg.params?.name === '__recordAction') {
          const actionData = JSON.parse(msg.params.payload)
          if (actionData.code) {
            pushAction(actionData.code)
          }
        } else if (msg.method === 'Page.frameNavigated') {
          const frame = msg.params?.frame
          if (frame && !frame.parentId) {
            const url = frame.url
            if (url && !url.startsWith('chrome://') && !url.startsWith('about:blank')) {
              pushAction(`await page.goto(${JSON.stringify(url)});`)
            }
          }
        }
      } catch {
        // ignore parse error
      }
    }

    sendCommand('Target.setDiscoverTargets', { discover: true })
    sendCommand('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true })

    return { handle: `cdp:9343:${sessionId}` }
  }

  const poll = async (sessionId, cursor) => {
    const events = actionQueue.splice(0)
    return { events, shouldContinue: isRecording, cursor: String(Date.now()) }
  }

  const stop = async () => {
    isRecording = false
    while (pendingWaiters.length > 0) {
      const waiter = pendingWaiters.shift()
      waiter?.()
    }
    if (ws) {
      try {
        ws.close()
      } catch {}
      ws = null
    }
    return { stopped: true, actions: allActions.join('\n') }
  }

  return {
    captureControl: {
      id: CONTROL_ADAPTER_ID,
      execute: async (request) => {
        if (request?.op === 'start') {
          return await start(request.sessionId)
        }
        if (request?.op === 'stop') {
          return await stop(request.sessionId)
        }
        throw new Error(`未知 capture-control 请求：${JSON.stringify(request?.op)}`)
      },
    },
    captureEvents: {
      id: EVENTS_ADAPTER_ID,
      execute: async (request) => {
        if (request?.op === 'poll') {
          return await poll(request.sessionId, request.cursor)
        }
        throw new Error(`未知 capture-events 请求：${JSON.stringify(request?.op)}`)
      },
    },
  }
}
