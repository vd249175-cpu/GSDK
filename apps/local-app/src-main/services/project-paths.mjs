import { lstatSync, realpathSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

/** Physical project boundary. The user-selected root may itself be an alias;
 * links and multiply-linked files BELOW it are never project-owned storage.
 * Check again at each I/O boundary; this is not an OS sandbox against concurrent
 * replacement by another process with the same filesystem privileges.
 */
export function resolveProjectPath(projectRoot, candidate) {
  const root = resolve(projectRoot)
  const target = resolve(root, candidate)
  const nested = relative(root, target)
  if (nested === '..' || nested.startsWith(`..${sep}`) || isAbsolute(nested)) {
    throw new Error('路径越出当前项目目录')
  }
  const segments = nested ? nested.split(sep) : []
  if (segments.some((part) => /[:\x00]/.test(part) || /[. ]$/.test(part))) {
    throw new Error('项目路径包含不安全的文件名')
  }
  let current = realpathSync(root)
  for (const segment of segments) {
    current = join(current, segment)
    try {
      const entry = lstatSync(current)
      if (entry.isSymbolicLink() || (entry.isFile() && entry.nlink > 1)) {
        throw new Error('项目路径不能包含符号链接、junction 或硬链接')
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
      // Non-existing descendants are valid write destinations. Continue checking
      // every component so existing prefixes can never escape through a link.
    }
  }
  return target
}

export function resolveProjectDatabasePath(projectRoot, candidate = '.graphvideo/nodes.sqlite') {
  const database = resolveProjectPath(projectRoot, candidate)
  for (const suffix of ['-wal', '-shm', '-journal']) {
    resolveProjectPath(projectRoot, `${candidate}${suffix}`)
  }
  return database
}
