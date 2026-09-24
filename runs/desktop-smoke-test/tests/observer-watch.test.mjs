import { describe, expect, it } from 'vitest'
import { selectWatchedFields, selectWatchedInfos } from '../plugins/frontend/workflow-observer/desktop/watch.mjs'

describe('generic observer watches', () => {
  it('reads configured nested fields without inventing missing state', () => {
    const nodes = [{ nodeId: 'smoke/session', state: { status: 'awaiting-confirmation', pendingConfirmation: { step: 'edit-doc' } } }]
    expect(selectWatchedFields(nodes, [
      { label: '状态', nodeId: 'smoke/session', path: 'status' },
      { label: '步骤', nodeId: 'smoke/session', path: 'pendingConfirmation.step' },
      { label: '缺失', nodeId: 'smoke/other', path: 'value' },
    ])).toEqual([
      { label: '状态', nodeId: 'smoke/session', path: 'status', value: 'awaiting-confirmation' },
      { label: '步骤', nodeId: 'smoke/session', path: 'pendingConfirmation.step', value: 'edit-doc' },
      { label: '缺失', nodeId: 'smoke/other', path: 'value', value: null },
    ])
  })

  it('filters causal events by configured Info type in newest-first order', () => {
    const events = [
      { cursor: 1, kind: 'change_started', infoType: 'OtherInfo' },
      { cursor: 2, kind: 'change_started', infoType: 'ConfirmStepInfo' },
      { cursor: 3, kind: 'root_injected', infoType: 'ConfirmStepInfo' },
    ]
    expect(selectWatchedInfos(events, [{ type: 'ConfirmStepInfo' }]).map((event) => event.cursor)).toEqual([3, 2])
  })
})
