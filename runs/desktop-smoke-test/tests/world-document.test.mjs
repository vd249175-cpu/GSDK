import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWorldDocumentAdapter } from '../bridge/world-document.mjs'

describe('world document adapter', () => {
  it('writes the observed test facts once after consent', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'gf-world-'))
    try {
      const adapter = createWorldDocumentAdapter(directory)
      const request = { requestId: 'review-1', text: '用户同意',
        browserResult: { opened: true }, desktopActionResult: { command: 'focus_window' },
        observation: { windows: ['GraphFramework'] } }
      expect(await adapter.execute(request)).toEqual({ saved: true, documentId: 'review-1' })
      expect(await adapter.execute(request)).toEqual({ saved: true, documentId: 'review-1' })
      const files = await readdir(directory)
      expect(files).toHaveLength(1)
      const body = await readFile(join(directory, files[0]), 'utf8')
      expect(body).toContain('type: world')
      expect(body).toContain('GraphFramework')
      expect(body).toContain('focus_window')
      expect(body).toContain('用户同意')
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
})
