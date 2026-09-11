import { describe, expect, it } from 'vitest'
import { defineWorkbenchContext } from './types'
import { WorkbenchContextStore } from './workbenchContextStore'

describe('WorkbenchContextStore', () => {
  it('destroys only plugin-owned cells and detaches old subscriptions for reinstallation', () => {
    const store = new WorkbenchContextStore()
    const old = store.get(defineWorkbenchContext('review.plugin/value', {
      scope: 'application', initialValue: 'old-default',
    }))
    const shared = store.get(defineWorkbenchContext('workbench/selection', {
      scope: 'application', initialValue: 'shared-default',
    }))
    old.write('old-value')
    shared.write('shared-value')
    let notified = 0
    old.subscribe(() => { notified += 1 })
    store.disposePluginContexts({ id: 'review.plugin' })
    expect(notified).toBe(1)
    expect(old.read()).toBe('old-default')
    const replacement = store.get(defineWorkbenchContext('review.plugin/value', {
      scope: 'application', initialValue: 'new-default',
    }))
    old.write('late-stale-write')
    expect(notified).toBe(1)
    expect(replacement.read()).toBe('new-default')
    expect(shared.read()).toBe('shared-value')
  })

  it('shares project context across workspaces without sharing other projects', () => {
    const store = new WorkbenchContextStore()
    const token = defineWorkbenchContext('example.timeline/playhead', {
      scope: 'project', initialValue: 0,
    })
    store.get(token, { projectId: 'project-a', workspaceId: 'editing' }).write(42)

    expect(store.get(token, { projectId: 'project-a', workspaceId: 'color' }).read()).toBe(42)
    expect(store.get(token, { projectId: 'project-b', workspaceId: 'editing' }).read()).toBe(0)
  })

  it('requires the binding selected by the token scope', () => {
    const store = new WorkbenchContextStore()
    const token = defineWorkbenchContext('example.timeline/zoom', {
      scope: 'workspace', initialValue: 1,
    })
    expect(() => store.get(token)).toThrow('缺少 workspaceId')
  })

  it('guarantees snapshot reference stability across repeated read() calls', () => {
    const store = new WorkbenchContextStore()
    const token = defineWorkbenchContext<{ count: number }>('example.test/obj', {
      scope: 'project',
      initialValue: { count: 0 },
    })
    const handle = store.get(token, { projectId: 'project-a' })
    const snapshot1 = handle.read()
    const snapshot2 = handle.read()
    expect(Object.is(snapshot1, snapshot2)).toBe(true)
  })

  it('retains listeners across purgeNamespace and notifies on reset and subsequent writes', () => {
    const store = new WorkbenchContextStore()
    const token = defineWorkbenchContext<string>('example.chat/msg', {
      scope: 'project',
      initialValue: 'default',
    })
    const handle = store.get(token, { projectId: 'p1' })
    const notifications: string[] = []
    handle.subscribe(() => {
      notifications.push(handle.read())
    })

    // 1. 写入新值
    handle.write('hello')
    expect(notifications).toEqual(['hello'])

    // 2. 清理命名空间 -> 监听器收到重置为 default 的通知
    store.purgeNamespace('example.chat')
    expect(handle.read()).toBe('default')
    expect(notifications).toEqual(['hello', 'default'])

    // 3. 再次写入 -> 监听器依然保留并收到新通知
    handle.write('world')
    expect(handle.read()).toBe('world')
    expect(notifications).toEqual(['hello', 'default', 'world'])
  })

  it('strictly isolates ownership and never purges unrelated plugins via prefix guessing', () => {
    const store = new WorkbenchContextStore()
    const alphaWorkbenchToken = defineWorkbenchContext<string>('review.alpha-workbench/token', {
      scope: 'project',
      initialValue: 'wb-initial',
    })
    const alphaToken = defineWorkbenchContext<string>('review.alpha/token', {
      scope: 'project',
      initialValue: 'alpha-initial',
    })

    const wbHandle = store.get(alphaWorkbenchToken, { projectId: 'p1' })
    const alphaHandle = store.get(alphaToken, { projectId: 'p1' })

    wbHandle.write('wb-active')
    alphaHandle.write('alpha-active')

    // 清理 review.alpha-workbench 插件
    store.clearPluginContexts({
      id: 'review.alpha-workbench',
      contributes: { elements: ['review.alpha-workbench.panel'] },
    })

    // wb 被重置，但 review.alpha 绝不受任何影响！
    expect(wbHandle.read()).toBe('wb-initial')
    expect(alphaHandle.read()).toBe('alpha-active')
  })
})
