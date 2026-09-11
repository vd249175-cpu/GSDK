import { constants } from 'node:fs'
import { copyFile, mkdir } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { getProjectNode, resolveProjectNodeVersionPath } from './project-store.mjs'

const reservedWindowsNames = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i

export function sanitizeVideoExportTitle(title) {
  const withoutControlCharacters = [...String(title ?? '')]
    .map((character) => character.codePointAt(0) < 32 ? '_' : character)
    .join('')
  const cleaned = withoutControlCharacters
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')
    .slice(0, 120)
  if (!cleaned) return 'video'
  return reservedWindowsNames.test(cleaned) ? `_${cleaned}` : cleaned
}

async function copyWithoutOverwrite(sourcePath, destinationDirectory, baseName, extension) {
  for (let suffix = 1; suffix <= 10_000; suffix += 1) {
    const collisionSuffix = suffix === 1 ? '' : ` (${suffix})`
    const fileName = `${baseName}${collisionSuffix}${extension}`
    const destinationPath = join(destinationDirectory, fileName)
    try {
      await copyFile(sourcePath, destinationPath, constants.COPYFILE_EXCL)
      return { fileName, destinationPath }
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST') continue
      throw error
    }
  }
  throw new Error(`同名导出文件过多：${baseName}${extension}`)
}

export async function exportNumberedVideoFiles(destinationDirectory, videos) {
  await mkdir(destinationDirectory, { recursive: true })
  const width = Math.max(3, String(videos.length).length)
  const exported = []
  const skipped = []
  for (const video of videos) {
    const sequence = String(exported.length + 1).padStart(width, '0')
    const extension = extname(video.sourcePath).toLocaleLowerCase()
    try {
      const copied = await copyWithoutOverwrite(
        video.sourcePath,
        destinationDirectory,
        `${sequence}_${sanitizeVideoExportTitle(video.title)}`,
        extension,
      )
      exported.push({ nodeId: video.nodeId, ...copied })
    } catch (error) {
      skipped.push({
        nodeId: video.nodeId,
        title: video.title,
        reason: error instanceof Error ? error.message : '无法复制视频文件',
      })
    }
  }
  return { directory: destinationDirectory, exported, skipped }
}

export async function exportProjectVideos(projectRoot, nodeIds, destinationDirectory) {
  const uniqueNodeIds = [...new Set(
    (Array.isArray(nodeIds) ? nodeIds : []).filter((nodeId) => (
      typeof nodeId === 'string' && nodeId
    )),
  )]
  const candidates = []
  const skipped = []
  for (const nodeId of uniqueNodeIds) {
    try {
      const node = await getProjectNode(projectRoot, nodeId)
      if (node.type !== 'video') throw new Error('节点不是视频类型')
      const currentVersion = node.history?.find((version) => version.current)
      if (!currentVersion) throw new Error('没有可导出的当前视频版本')
      candidates.push({
        nodeId: node.id,
        title: node.title,
        sourcePath: await resolveProjectNodeVersionPath(projectRoot, node.id, currentVersion.id),
      })
    } catch (error) {
      skipped.push({
        nodeId,
        title: nodeId,
        reason: error instanceof Error ? error.message : '无法读取视频节点',
      })
    }
  }
  const result = await exportNumberedVideoFiles(destinationDirectory, candidates)
  return { ...result, skipped: [...skipped, ...result.skipped] }
}
