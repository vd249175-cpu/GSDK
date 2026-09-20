/**
 * runs/os-recorder/host.mjs — run 宿主：向 OS 录制图注入 UFO 侧车 Adapter。
 *
 * 架构位置：可选外层宿主（红线：UFO 本体不进 Rust 内核、不进 Node）。
 * UFO（Python、Windows-only、重型 ML 依赖）永远运行在进程外侧车中；
 * 本宿主只在 change 结算时经 HTTP 与侧车对话（start/stop/poll），
 * 不持有长连接，无 stopSources/dispose。
 *
 * 侧车地址：`backend.dependencies.sidecarUrl`，缺省 `UFO_SIDECAR_URL` 环境变量；
 * 均缺失时注入的 Adapter 在执行期抛明确错误（config validate 仍通过）。
 */

import {
  createOsCaptureControlAdapter,
  createOsCaptureEventsAdapter,
} from '../../app/plugins/backend/os-recorder/index.mjs'

const requestFor = (sidecarUrl) => async (path, { method = 'GET', body } = {}) => {
  if (!sidecarUrl) {
    throw new Error('UFO 侧车地址缺失：设置 run backend.dependencies.sidecarUrl 或 UFO_SIDECAR_URL 后重试')
  }
  let response
  try {
    response = await fetch(new URL(path, sidecarUrl).href, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch (error) {
    throw new Error(`UFO 侧车不可达 ${sidecarUrl}：${error.message ?? error}`, { cause: error })
  }
  if (!response.ok) throw new Error(`UFO 侧车 ${method} ${path} -> ${response.status}`)
  return response.json()
}

export async function createRunHost({ parsed } = {}) {
  const sidecarUrl = parsed?.backend?.dependencies?.sidecarUrl ?? process.env.UFO_SIDECAR_URL ?? null
  const request = requestFor(sidecarUrl)
  return {
    dependenciesFor: {
      captureControl: createOsCaptureControlAdapter({ request }),
      captureEvents: createOsCaptureEventsAdapter({ request }),
    },
  }
}
