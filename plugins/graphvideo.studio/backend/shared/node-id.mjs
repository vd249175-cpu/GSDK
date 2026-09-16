const nodeIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]*$/
const reservedWindowsNames = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i

export function nodeIdError(id) {
  if (typeof id !== 'string' || !nodeIdPattern.test(id)) {
    return '节点 ID 只能包含 ASCII 字母、数字、下划线和连字符，且必须以字母或数字开头'
  }
  if (reservedWindowsNames.test(id)) return '节点 ID 不能使用 Windows 保留名称'
  return null
}

export function assertNodeId(id) {
  const error = nodeIdError(id)
  if (error) throw new Error(`${error}：${id}`)
  return id
}
