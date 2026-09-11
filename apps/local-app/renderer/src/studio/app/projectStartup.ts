import type { LocalProjectSource } from '../core/system/desktopAdapter'

export async function restoreLastProjectAtStartup(
  restore: () => Promise<LocalProjectSource | null>,
  open: (project: LocalProjectSource) => Promise<void>,
) {
  const project = await restore()
  if (project) await open(project)
}
