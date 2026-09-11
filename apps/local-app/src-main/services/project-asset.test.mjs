import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createProjectAssetResponse } from './project-asset.mjs'

let directory
let audioPath

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'graphvideo-asset-'))
  audioPath = join(directory, 'sample.wav')
  await writeFile(audioPath, Buffer.from('0123456789'))
})

afterEach(async () => {
  const resolvedDirectory = resolve(directory)
  const safeParent = resolve(tmpdir())
  if (resolvedDirectory.startsWith(safeParent)
    && basename(resolvedDirectory).startsWith('graphvideo-asset-')) {
    await rm(resolvedDirectory, { recursive: true, force: true })
  }
})

describe('project asset response', () => {
  it('serves audio with its MIME type and byte range support', async () => {
    const request = new Request('graphvideo-asset://node/id/version', {
      headers: { Range: 'bytes=2-5' },
    })
    const response = await createProjectAssetResponse(request, audioPath)

    expect(response.status).toBe(206)
    expect(response.headers.get('content-type')).toBe('audio/wav')
    expect(response.headers.get('accept-ranges')).toBe('bytes')
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expect(response.headers.get('content-range')).toBe('bytes 2-5/10')
    expect(response.headers.get('content-length')).toBe('4')
    expect(await response.text()).toBe('2345')
  })

  it('rejects byte ranges outside the asset', async () => {
    const request = new Request('graphvideo-asset://node/id/version', {
      headers: { Range: 'bytes=20-30' },
    })
    const response = await createProjectAssetResponse(request, audioPath)
    expect(response.status).toBe(416)
    expect(response.headers.get('content-range')).toBe('bytes */10')
  })
})
