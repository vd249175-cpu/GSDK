import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname } from 'node:path'
import { Readable } from 'node:stream'

const assetMimeTypes = Object.freeze({
  '.md': 'text/markdown; charset=utf-8',
  '.markdown': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
  '.aac': 'audio/aac',
})

function parseByteRange(value, size) {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(value.trim())
  if (!match || size === 0) return null
  const [, startValue, endValue] = match
  if (!startValue && !endValue) return null

  if (!startValue) {
    const suffixLength = Number(endValue)
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null
    return { start: Math.max(size - suffixLength, 0), end: size - 1 }
  }

  const start = Number(startValue)
  const requestedEnd = endValue ? Number(endValue) : size - 1
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd)
    || start < 0 || requestedEnd < start || start >= size) return null
  return { start, end: Math.min(requestedEnd, size - 1) }
}

export async function createProjectAssetResponse(request, filePath) {
  const file = await stat(filePath)
  const size = file.size
  const mimeType = assetMimeTypes[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
  const rangeHeader = request.headers.get('range')
  const range = rangeHeader ? parseByteRange(rangeHeader, size) : null
  const headers = new Headers({
    'Accept-Ranges': 'bytes',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
    'Content-Type': mimeType,
    'Cross-Origin-Resource-Policy': 'cross-origin',
  })

  if (rangeHeader && !range) {
    headers.set('Content-Range', `bytes */${size}`)
    return new Response(null, { status: 416, headers })
  }

  const start = range?.start ?? 0
  const end = range?.end ?? Math.max(size - 1, 0)
  const contentLength = size === 0 ? 0 : end - start + 1
  headers.set('Content-Length', String(contentLength))
  if (range) headers.set('Content-Range', `bytes ${start}-${end}/${size}`)
  const status = range ? 206 : 200
  if (request.method === 'HEAD' || size === 0) return new Response(null, { status, headers })

  const stream = createReadStream(filePath, { start, end })
  return new Response(Readable.toWeb(stream), { status, headers })
}
