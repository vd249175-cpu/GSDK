import { execFile } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'

const execFileAsync = promisify(execFile)
const script = fileURLToPath(new URL('../../../.agents/skills/interaction-popup/scripts/prompt.ps1', import.meta.url))

export function createWorldSaveDialog(directory, { runCommand = execFileAsync } = {}) {
  return async (pending) => {
    if (process.platform !== 'win32') throw new Error('world save dialog requires Windows')
    await mkdir(directory, { recursive: true })
    const id = randomUUID()
    const requestPath = join(directory, `${id}.request.json`)
    const responsePath = join(directory, `${id}.response.json`)
    await writeFile(requestPath, JSON.stringify({ nodeId: pending.nodeId,
      requestId: pending.requestId, step: pending.step, prompt: pending.prompt, text: '' }), 'utf8')
    await runCommand('powershell.exe', [
      '-NoProfile', '-STA', '-File', script,
      '-RequestPath', requestPath, '-ResponsePath', responsePath,
    ], { windowsHide: true, timeout: 600_000 })
    return JSON.parse((await readFile(responsePath, 'utf8')).replace(/^\uFEFF/, ''))
  }
}
