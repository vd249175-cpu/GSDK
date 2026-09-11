import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import {
  useAppState,
  useApplicationClient,
  useShellClient,
  type GenerationDagItem,
  type ProjectNode,
} from '@graphvideo/client-sdk'
import {
  LaunchpadScheduler,
  type LaunchpadItem,
  type ExecutionMode,
} from '@graphvideo/domain'
import {
  assertGenerationExecutionResult,
  compileManualPrompt,
  generationModelReferences,
  mediaDependencyVersionClipboardItems,
} from './generationBundle'
import { launchpadBatchCredits } from './launchpadBatch'
import { isExecutableGenerationReadiness } from './launchpadReadiness'

export function useLaunchpadPipeline() {
  const application = useApplicationClient()
  const shell = useShellClient()
  const project = useAppState((state) => state.project)
  const generationRuntime = useAppState((state) => state.runtime.generation)
  const taskGraphs = useAppState((state) => state.runtime.taskGraphs)
  const nodes = project.nodes || {}

  const [isRunning, setIsRunning] = useState(false)
  const [localRequestCount, setLocalRequestCount] = useState(0)
  const [isPaused, setIsPaused] = useState(false)

  // 整次生成的业务等待上限；0 表示不限制，和底层单次网络传输超时相互独立。
  const [maxGenerationWaitMinutes, setMaxGenerationWaitMinutesState] = useState<number>(() => {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem('gv_launchpad_max_generation_wait_minutes')
      const stored = raw === null ? Number.NaN : Number(raw)
      if (Number.isFinite(stored) && stored >= 0 && stored <= 1440) return Math.round(stored)
    }
    return 30
  })

  const [dagEvaluation, setDagEvaluation] = useState<{
    key: string
    items: Record<string, GenerationDagItem>
    error?: string
  } | null>(null)
  const [notice, setNotice] = useState('')
  const audioUrl = typeof process !== 'undefined' && process.env?.AUDIO_STUDIO_URL
    ? process.env.AUDIO_STUDIO_URL
    : 'http://192.168.10.7:5000/api/v1'

  const isCancelledRef = useRef(false)
  const isPausedRef = useRef(false)
  const activeGenerationControllers = useRef(new Set<AbortController>())
  // Covers the click-to-projection gap only; Graph remains the task state Owner.
  const submittingTargets = useRef(new Set<string>())

  const latestTaskByTarget = useMemo(() => {
    const tasks = Object.values(taskGraphs).flatMap((graph) => Object.values(graph.tasks))
      .sort((left, right) => (left.startedAt ?? 0) - (right.startedAt ?? 0))
    return new Map(tasks.map((task) => [task.targetNodeId, task]))
  }, [taskGraphs])
  const currentRunningIds = useMemo(() => [...latestTaskByTarget.values()]
    .filter((task) => task.status === 'running' || task.status === 'retrying')
    .map((task) => task.targetNodeId), [latestTaskByTarget])

  const dagEvaluationKey = useMemo(() => JSON.stringify([
    project.localPath,
    project.tree,
    Object.values(nodes).map((node) => [
      node.id,
      node.type,
      node.title,
      node.description,
      node.prompt,
      node.content,
      node.history?.map((version) => [version.id, version.current, version.relativePath]),
    ]),
  ]), [nodes, project.localPath, project.tree])

  useEffect(() => {
    const projectRoot = project.localPath
    if (!projectRoot) {
      setDagEvaluation(null)
      return undefined
    }
    let active = true
    const key = dagEvaluationKey
    setDagEvaluation({ key, items: {} })
    const timer = window.setTimeout(() => {
      void application.generationModels.evaluateDag(projectRoot).then((evaluated) => {
        if (!active) return
        setDagEvaluation({
          key,
          items: Object.fromEntries(evaluated.map((item) => [item.id, item])),
        })
      }).catch((error) => {
        if (!active) return
        setDagEvaluation({
          key,
          items: {},
          error: error instanceof Error ? error.message : '模型发射参数校验失败',
        })
      })
    }, 120)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [application, dagEvaluationKey, project.localPath])

  // 1. 构建 Launchpad 项，并叠加 Node-owned model catalog 的权威准入结果。
  const rawItems = useMemo(() => LaunchpadScheduler.buildLaunchpadItems(nodes, project.tree), [nodes, project.tree])
  const items = useMemo(() => rawItems.map((item: LaunchpadItem) => {
    const currentEvaluation = dagEvaluation?.key === dagEvaluationKey ? dagEvaluation : null
    const authoritative = currentEvaluation
      ? currentEvaluation.items[item.id]
      : undefined
    const readiness = authoritative?.readiness
    const validationPending = Boolean(project.localPath) && !readiness && !currentEvaluation?.error
    const isManualWeb = item.dispatchMode === 'manual-web'
    const runtimeTask = latestTaskByTarget.get(item.id)
    const active = runtimeTask?.status === 'running' || runtimeTask?.status === 'retrying'
    const isReady = active || isManualWeb
      ? false
      : project.localPath
      ? isExecutableGenerationReadiness(readiness)
      : item.isReady
    const missingDependencies = readiness?.missingDependencies ?? item.missingDependencies
    const statusMessage = runtimeTask?.error
      ?? (runtimeTask && (runtimeTask.status === 'running' || runtimeTask.status === 'retrying')
        ? runtimeTask.message
        : isManualWeb
        ? item.statusMessage
        : currentEvaluation?.error
          ?? (validationPending ? '正在校验提示词、参数与前置依赖…' : readiness?.reason)
          ?? item.statusMessage)
    const status: LaunchpadItem['status'] = active ? 'running'
      : runtimeTask?.status === 'failed' ? 'error'
        : item.status === 'completed' ? 'completed'
          : isManualWeb ? 'manual_waiting' : isReady ? 'ready' : 'pending'
    return {
      ...item,
      modelId: authoritative?.modelId ?? item.modelId,
      layer: authoritative?.level ?? item.layer,
      dependencies: authoritative?.dependencies ?? item.dependencies,
      missingDependencies,
      areDependenciesReady: isManualWeb
        ? item.areDependenciesReady
        : readiness
        ? readiness.status !== 'MISSING_DEPENDENCIES'
        : item.areDependenciesReady,
      estimatedCredits: authoritative?.estimatedCredits ?? item.estimatedCredits,
      isReady,
      status,
      statusMessage,
    }
  }), [dagEvaluation, dagEvaluationKey, latestTaskByTarget, project.localPath, rawItems])

  // 2. 积分与预算只读取 SecurityGate 的权威 Projection。
  const spentCredits = generationRuntime.spentCredits
  const maxBudget = generationRuntime.maxBudget
  const remainingCredits = Math.round(Math.max(0, maxBudget - spentCredits) * 100) / 100

  const setMaxBudget = useCallback((newBudget: number) => {
    const val = Math.max(0, newBudget)
    void application.generation.configureBudget(val).catch((error: unknown) => {
      setNotice(error instanceof Error ? error.message : '无法更新生成预算')
    })
  }, [application])

  const setMaxGenerationWaitMinutes = useCallback((minutes: number) => {
    const value = Math.min(1440, Math.max(0, Math.round(minutes)))
    setMaxGenerationWaitMinutesState(value)
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('gv_launchpad_max_generation_wait_minutes', String(value))
    }
  }, [])

  const resetSpentCredits = useCallback(() => {
    void application.generation.resetCredits().catch((error: unknown) => {
      setNotice(error instanceof Error ? error.message : '无法清零生成积分')
    })
  }, [application])

  // 3. 统计指标衍生
  useEffect(() => {
    if (typeof window !== 'undefined' && (window as any).graphvideoLaunchpad) {
      (window as any).graphvideoLaunchpad.items = items
    }
  }, [rawItems])

  const itemsMap = useMemo(() => new Map(items.map((it: LaunchpadItem) => [it.id, it])), [items])

  const groupedLayers = useMemo(() => {
    const map = new Map<number, LaunchpadItem[]>()
    for (const item of items) {
      const list = map.get(item.layer) || []
      list.push(item)
      map.set(item.layer, list)
    }
    return Array.from(map.entries()).sort(([a], [b]) => a - b)
  }, [items])

  const totalPlannedCredits = useMemo(() => {
    const sum = items
      .filter((it: LaunchpadItem) => it.status !== 'completed' && it.dispatchMode === 'model')
      .reduce((acc: number, it: LaunchpadItem) => acc + (it.estimatedCredits || 0), 0)
    return Math.round(sum * 100) / 100
  }, [items])

  const completedCount = useMemo(() => items.filter((it: LaunchpadItem) => it.status === 'completed').length, [items])
  const runningCount = useMemo(() => items.filter((it: LaunchpadItem) => it.status === 'running').length, [items])
  const errorCount = useMemo(() => items.filter((it: LaunchpadItem) => it.status === 'error').length, [items])
  const hasActiveErrors = useMemo(() => {
    return items.some((it: LaunchpadItem) => it.status === 'error')
  }, [items])

  function buildNodeReferences(item: LaunchpadItem): import('@graphvideo/contracts').GenerationModelReference[] {
    return generationModelReferences(item.dependencies, nodes)
  }

  async function resolveItemPrompt(item: LaunchpadItem): Promise<{ prompt: string; aliases: Record<string, string> }> {
    const rawPrompt = nodes[item.id]?.prompt || item.prompt
    const references = buildNodeReferences(item)
    if (item.modelId) {
      try {
        const resolved = await application.generationModels.resolve({
          nodeType: item.type,
          prompt: rawPrompt,
          references,
        })
        return { prompt: resolved.prompt, aliases: resolved.aliases }
      } catch {
        // Fall back to the generic compiler when model-specific resolution is unavailable.
      }
    }
    const header = LaunchpadScheduler.extractModelHeader(rawPrompt)
    return { prompt: compileManualPrompt(header.body, references), aliases: {} }
  }

  async function copyPromptText(item: LaunchpadItem) {
    try {
      const { prompt } = await resolveItemPrompt(item)
      await shell.clipboard.writeText(prompt)
      setNotice(`已复制 [${item.title}] 提示词`)
      setTimeout(() => setNotice(''), 3000)
    } catch {
      setNotice('无法写入剪贴板')
    }
  }

  async function copyDependencies(item: LaunchpadItem) {
    try {
      const mediaItems = mediaDependencyVersionClipboardItems(item.dependencies, nodes)
      if (mediaItems.length === 0) {
        setNotice(`⚠️ [${item.title}] 没有已就绪的媒体依赖可复制`)
        return
      }
      const result = await application.assets.copyVersions(mediaItems)
      setNotice(result.mode === 'files'
        ? `已复制 [${item.title}] 的 ${result.count} 个媒体依赖文件`
        : `已复制 [${item.title}] 的 ${result.count} 个媒体依赖路径`)
      setTimeout(() => setNotice(''), 3000)
    } catch {
      setNotice('无法复制媒体依赖文件')
    }
  }

  async function executeSingleItem(item: LaunchpadItem) {
    if (submittingTargets.current.has(item.id) || currentRunningIds.includes(item.id)) {
      setNotice(`⏳ [${item.title}] 已有任务在运行`)
      return false
    }
    if (!item.modelId) {
      setNotice(`🌐 [${item.title}] 是手动网页生成任务，请复制提示词与依赖后在外部平台生成`)
      return false
    }

    if (!item.isReady) {
      setNotice(`⚠️ [${item.title}] 暂不可发射：${item.statusMessage || '模型预检未通过'}`)
      return false
    }

    if (spentCredits + item.estimatedCredits > maxBudget) {
      setNotice(`🚨 积分熔断报警：超出当前预算上限 ${maxBudget}！`)
      return false
    }

    setNotice(`⏳ 正在生成 [${item.title}]...`)
    const controller = new AbortController()
    activeGenerationControllers.current.add(controller)
    submittingTargets.current.add(item.id)
    setLocalRequestCount(activeGenerationControllers.current.size)

    try {
      const rawPrompt = nodes[item.id]?.prompt || item.prompt
      const res = await application.generationModels.generate(item.id, {
        prompt: rawPrompt,
        audioUrl,
        maxGenerationWaitMs: maxGenerationWaitMinutes * 60_000,
      }, { signal: controller.signal })
      controller.signal.throwIfAborted()
      assertGenerationExecutionResult(res, [item.id])
      setNotice(`✅ [${item.title}] 生成成功！`)
      return true
    } catch (err: any) {
      const errMsg = err?.message || '生成失败'
      setNotice(`❌ [${item.title}] 失败: ${errMsg}`)
      return false
    } finally {
      activeGenerationControllers.current.delete(controller)
      submittingTargets.current.delete(item.id)
      setLocalRequestCount(activeGenerationControllers.current.size)
    }
  }

  async function executeAdmittedBatch(batchItems: LaunchpadItem[]) {
    if (batchItems.some((item) => submittingTargets.current.has(item.id) || currentRunningIds.includes(item.id))) {
      setNotice('本批目标已有任务在运行，未重复发射')
      return { successCount: 0, failedCount: batchItems.length }
    }
    const ids = batchItems.map((item) => item.id)
    const controller = new AbortController()
    activeGenerationControllers.current.add(controller)
    ids.forEach((id) => submittingTargets.current.add(id))
    setLocalRequestCount(activeGenerationControllers.current.size)
    try {
      const result = await application.generationModels.generateBatch(
        batchItems.map((item) => ({
          nodeId: item.id,
          prompt: nodes[item.id]?.prompt || item.prompt,
        })),
        { audioUrl, maxGenerationWaitMs: maxGenerationWaitMinutes * 60_000 },
        { signal: controller.signal },
      )
      controller.signal.throwIfAborted()
      assertGenerationExecutionResult(result, ids)
      return { successCount: batchItems.length, failedCount: 0 }
    } catch (error) {
      const message = error instanceof Error ? error.message : '生成批次失败'
      if (!isCancelledRef.current) setNotice(`❌ 生成批次失败: ${message}`)
      return { successCount: 0, failedCount: batchItems.length }
    } finally {
      activeGenerationControllers.current.delete(controller)
      ids.forEach((id) => submittingTargets.current.delete(id))
      setLocalRequestCount(activeGenerationControllers.current.size)
    }
  }

  const layersSummary = useMemo(() => {
    return groupedLayers.map(([layer, layerItems]) => {
      // 仅统计具备模型声明的自动化待发射任务；手动资产不计入自动化待办
      const pendingItems = layerItems.filter((it) => it.status !== 'completed' && it.hasHeader && Boolean(it.modelId))
      const readyItems = pendingItems.filter((it) => it.isReady)
      const completedItems = layerItems.filter((it) => it.status === 'completed')
      const totalCredits = pendingItems.reduce((sum, it) => sum + (it.estimatedCredits ?? (it.type === 'video' ? 20 : (it.type === 'audio' ? 0 : 10))), 0)
      return {
        layer,
        total: layerItems.length,
        pending: pendingItems.length,
        ready: readyItems.length,
        completed: completedItems.length,
        credits: totalCredits,
      }
    })
  }, [groupedLayers])

  async function startLayerPipeline(targetLayer: number) {
    if (activeGenerationControllers.current.size > 0 || isRunning || currentRunningIds.length > 0) return
    isCancelledRef.current = false
    isPausedRef.current = false
    setIsPaused(false)
    setIsRunning(true)
    setNotice(`🚀 已启动 [Layer ${targetLayer} 单层流水线]...`)

    // 仅发射具有模型声明且依赖就绪的未完成任务
    const targetItems = items.filter(
      (it) => it.layer === targetLayer && it.status !== 'completed' && it.isReady
    )
    if (targetItems.length === 0) {
      setNotice(`✅ Layer ${targetLayer} 所有自动化模型任务已全部完成！`)
      setIsRunning(false)
      return
    }

    if (spentCredits + launchpadBatchCredits(targetItems) > maxBudget) {
      setNotice(`🚨 本批积分总额超出当前预算上限 ${maxBudget}，未发射任何任务`)
      setIsRunning(false)
      return
    }

    const { successCount, failedCount } = await executeAdmittedBatch(targetItems)

    if (isCancelledRef.current) {
      setNotice('⏹ 流水线已手动终止')
    } else {
      setIsRunning(false)
      setIsPaused(false)
      setNotice(`🎉 Layer ${targetLayer} 并行发射完毕 (成功 ${successCount} 项${failedCount > 0 ? `，失败 ${failedCount} 项` : ''})`)
    }
  }

  async function startPipeline(runMode: ExecutionMode = 'auto') {
    if (activeGenerationControllers.current.size > 0 || isRunning || currentRunningIds.length > 0) return
    isCancelledRef.current = false
    isPausedRef.current = false
    setIsPaused(false)
    setIsRunning(true)
    setNotice('🚀 正在扫描全工程就绪任务...')

    // 1. 全局扫描：检查全工程所有“前置依赖已全部准备好（areDependenciesReady === true）且具备模型头”的未完成节点
    // (按照 layer 从小到大排序，浅层先发射)
    const readyAutomatedItems = items
      .filter((it) => it.status !== 'completed' && it.isReady)
      .sort((a, b) => a.layer - b.layer)

    // 2. 如果全工程当前没有任何一个节点处于“准备就绪”状态：
    if (readyAutomatedItems.length === 0) {
      const remainingAutomated = items.filter(
        (it) => it.status !== 'completed' && it.hasHeader && Boolean(it.modelId)
      )
      if (remainingAutomated.length === 0) {
        setNotice('🎉 全量自动化模型任务已全部生成完毕！')
      } else {
        const waitingTitles = remainingAutomated.map((it) => it.title).join(', ')
        setNotice(`⚠️ 当前暂无满足前置依赖的可发射任务（等待前置依赖或手动素材: ${waitingTitles}）`)
      }
      setIsRunning(false)
      return
    }

    if (spentCredits + launchpadBatchCredits(readyAutomatedItems) > maxBudget) {
      setNotice(`🚨 本批积分总额超出当前预算上限 ${maxBudget}，未发射任何任务`)
      setIsRunning(false)
      return
    }

    setNotice(`🚀 正在执行本批检测到的 ${readyAutomatedItems.length} 个就绪任务...`)

    // 3. 本次准入快照中的所有就绪节点同时发射，彼此不等待完成。
    const { successCount, failedCount } = await executeAdmittedBatch(readyAutomatedItems)

    // 4. 收敛机制：无论结果如何，本批检测到的任务执行完毕后立即结束本次发射（一次只执行一批）
    setIsRunning(false)
    setIsPaused(false)
    setNotice(isCancelledRef.current ? '⏹ 流水线已手动终止'
      : `🎉 本批就绪任务发射完毕 (成功 ${successCount} 项${failedCount > 0 ? `，失败 ${failedCount} 项` : ''})`)
  }

  function pausePipeline() {
    isPausedRef.current = true
    setIsPaused(true)
    setNotice('⏸ 已暂停后续派发；当前已提交批次会继续完成')
  }

  function resumePipeline() {
    isPausedRef.current = false
    setIsPaused(false)
    setNotice('▶ 流水线已恢复执行')
  }

  function cancelPipeline() {
    isCancelledRef.current = true
    isPausedRef.current = false
    activeGenerationControllers.current.forEach((controller) => controller.abort(new DOMException('用户取消生成', 'AbortError')))
    setIsRunning(false)
    setIsPaused(false)
    setNotice('⏹ 已向 Graph 提交取消请求')
  }

  function resetItemStatus(_id: string) {
    setNotice('任务事实由 Graph 保留；重新发射会创建新的任务记录')
  }

  function resetAll() {
    activeGenerationControllers.current.forEach((controller) => controller.abort(new DOMException('重置生成面板', 'AbortError')))
    setIsRunning(false)
    setIsPaused(false)
    setNotice('已重置面板交互状态；生成历史仍以 Graph 为准')
  }

  const readyCount = items.filter((item) => item.status !== 'completed' && item.isReady).length

  return {
    items,
    itemsMap,
    groupedLayers,
    layersSummary,
    isRunning: isRunning || localRequestCount > 0 || currentRunningIds.length > 0,
    canCancel: localRequestCount > 0,
    isPaused,
    currentRunningId: currentRunningIds[0] ?? null,
    currentRunningIds,
    spentCredits,
    remainingCredits,
    totalPlannedCredits,
    completedCount,
    runningCount,
    errorCount,
    hasActiveErrors,
    readyCount,
    maxBudget,
    setMaxBudget,
    maxGenerationWaitMinutes,
    setMaxGenerationWaitMinutes,
    resetSpentCredits,
    audioUrl,
    notice,
    setNotice,
    startPipeline,
    startLayerPipeline,
    pausePipeline,
    resumePipeline,
    cancelPipeline,
    executeSingleItem,
    copyPromptText,
    copyDependencies,
    resetItemStatus,
    resetAll,
    resetAllStatuses: resetAll,
  }
}
