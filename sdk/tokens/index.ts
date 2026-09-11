import { defineWorkbenchContext, type WorkbenchContextToken } from '@graphvideo/workbench'

/**
 * 通用跨面板上下文 Tokens：选择、协作等工作台机制共享的临时交互态。
 * 主题与字体偏好不在此——它们由工作台偏好管理经根元素属性同步。
 * 业务领域的选择（如提示词条目、播放进度）归各自插件所有，不得进入本入口。
 */

/** 跨工作区共享当前选中的节点 ID */
export const activeSelectedNodeIdToken: WorkbenchContextToken<string | null | undefined> = defineWorkbenchContext<string | null | undefined>(
  'workbench/selection/active-node-id',
  { scope: 'project', initialValue: undefined },
)
