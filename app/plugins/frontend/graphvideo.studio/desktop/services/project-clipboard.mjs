import { spawnSync } from 'node:child_process'
import { resolveProjectNodeVersionPathSync } from './project-store.mjs'

function resolveVersionPaths(projectRoot, items) {
  if (!projectRoot) throw new Error('尚未打开本地项目')
  if (!Array.isArray(items) || items.length === 0 || items.length > 100) {
    throw new Error('复制版本列表无效')
  }
  const paths = items.map((item) => {
    if (!item || typeof item.nodeId !== 'string' || typeof item.versionId !== 'string') {
      throw new Error('复制版本参数无效')
    }
    return resolveProjectNodeVersionPathSync(projectRoot, item.nodeId, item.versionId)
  })
  return [...new Set(paths)]
}

function windowsFileClipboardCommand(paths) {
  const payload = Buffer.from(JSON.stringify(paths), 'utf8').toString('base64')
  const script = `
Add-Type -AssemblyName System.Windows.Forms
$json = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}'))
$paths = ConvertFrom-Json -InputObject $json
$files = New-Object System.Collections.Specialized.StringCollection
foreach ($item in @($paths)) { [void]$files.Add([string]$item) }
[System.Windows.Forms.Clipboard]::SetFileDropList($files)
`
  return Buffer.from(script, 'utf16le').toString('base64')
}

function darwinFileClipboardScript(paths) {
  const fileList = paths.map((path) => {
    const escaped = path.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
    return `POSIX file "${escaped}"`
  }).join(', ')
  return `set the clipboard to {${fileList}}`
}

export function writeSystemFileClipboard(
  paths,
  { platform = process.platform, run = spawnSync, writeText },
) {
  if (platform === 'win32') {
    const result = run('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-STA',
      '-EncodedCommand', windowsFileClipboardCommand(paths),
    ], { encoding: 'utf8', windowsHide: true })
    if (result.error) throw new Error(`无法写入系统文件剪贴板：${result.error.message}`)
    if (result.status !== 0) throw new Error('无法写入系统文件剪贴板')
    return 'files'
  }
  if (platform === 'darwin') {
    const result = run('osascript', ['-e', darwinFileClipboardScript(paths)], { encoding: 'utf8' })
    if (!result.error && result.status === 0) {
      return 'files'
    }
  }
  writeText(paths.join('\n'))
  return 'paths'
}

export function copyProjectVersions(projectRoot, items, clipboardWriter) {
  const paths = resolveVersionPaths(projectRoot, items)
  const mode = clipboardWriter(paths)
  return { count: paths.length, mode }
}
