import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { NodeGenerationAdapter } from './node-generation-adapter'

describe('NodeGenerationAdapter (Pure TypeScript / Node Transport)', () => {
  it('executes full mock generation cycle: submit -> poll -> download without locks', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'gsdk-download-test-'))
    try {
      const adapter = new NodeGenerationAdapter({
        getProjectRoot: () => tempDir,
      })

      const dummyContext = {
        signal: new AbortController().signal,
      } as any

      // 1. Submit
      const submitObs = await adapter.execute(
        {
          operation: 'submit',
          spec: { provider: 'mock', kind: 'video' },
        },
        dummyContext,
      )
      expect(submitObs.operation).toBe('submit')
      expect(submitObs.status).toBe('submitted')
      expect(submitObs.handle.provider).toBe('mock')
      expect(submitObs.handle.taskId).toMatch(/^mock-/)

      // 2. Poll
      const pollObs = await adapter.execute(
        {
          operation: 'poll',
          handle: submitObs.handle,
        },
        dummyContext,
      )
      expect(pollObs.operation).toBe('poll')
      expect(pollObs.status).toBe('ready')
      if (pollObs.status === 'ready') {
        expect(pollObs.artifact.kind).toBe('video')
        expect(pollObs.artifact.filename).toContain('.mp4')

        // 3. Download
        const destRel = 'assets/generations/test-output.mp4'
        const downloadObs = await adapter.execute(
          {
            operation: 'download',
            artifact: pollObs.artifact,
            destinationRelativePath: destRel,
          },
          dummyContext,
        )
        expect(downloadObs.operation).toBe('download')
        expect(downloadObs.status).toBe('downloaded')
        expect(downloadObs.bytesWritten).toBeGreaterThan(0)
        expect(downloadObs.contentType).toBe('video/mp4')

        const writtenContent = readFileSync(join(tempDir, destRel), 'utf8')
        expect(writtenContent).toBe('FAKE_VIDEO_BINARY_STREAM_OUTPUT')
      }
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('rejects path traversal attempts outside project boundary', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'gsdk-security-test-'))
    try {
      const adapter = new NodeGenerationAdapter({
        getProjectRoot: () => tempDir,
      })
      const dummyContext = { signal: new AbortController().signal } as any

      await expect(
        adapter.execute(
          {
            operation: 'download',
            artifact: {
              provider: 'mock',
              taskId: 'mock-1',
              kind: 'image',
              filename: 'out.png',
            },
            destinationRelativePath: '../../etc/shadow',
          },
          dummyContext,
        ),
      ).rejects.toThrow(/安全边界/)
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })
})
