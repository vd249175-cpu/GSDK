/**
 * 消费项目 UI 边界表：唯一人工关系（方法 → 根 Info → Owner State → UI 消费者）。
 * 只声明图外边界，不声明图内 send；形状见 `@graphvideo/sdk/analysis` 的
 * FrontendLinkDefinition。暂无条目时保持空数组，不得虚构。
 */
export const frontendLinks = [
  {
    id: 'counter.increment',
    applicationMethod: 'counter.increment',
    injection: { targetNodeId: 'example.counter', infoType: 'IncrementInfo' },
    projections: [
      {
        ownerNodeId: 'example.counter',
        ownerField: 'count',
        applicationStatePath: 'counter.count',
        consumers: ['App'],
      },
    ],
  },
]

export const frontendServiceLinks = []
