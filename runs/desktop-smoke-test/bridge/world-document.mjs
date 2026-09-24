import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

export function createWorldDocumentAdapter(directory) {
  return { id: 'smoke/world-document', async execute(request) {
    if (typeof request?.requestId !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(request.requestId)
      || request.requestId === '.' || request.requestId === '..') throw new Error('invalid world document request id')
    const target = join(directory, `${createHash('sha256').update(request.requestId).digest('hex')}.md`)
    const body = [
      '---', 'type: world', `title: 自动化测试 ${request.requestId}`, '---', '',
      '# 自动化测试记录', '',
      `请求：${request.requestId}`, '',
      `用户说明：${request.text ?? ''}`, '',
      '## 浏览器结果', '', '```json', JSON.stringify(request.browserResult ?? null, null, 2), '```', '',
      '## 电脑操作结果', '', '```json', JSON.stringify(request.docResult ?? null, null, 2), '```', '',
      '## 最终观察', '', '```json', JSON.stringify(request.observation ?? null, null, 2), '```', '',
    ].join('\n')
    await mkdir(directory, { recursive: true })
    try {
      await writeFile(target, body, { encoding: 'utf8', flag: 'wx' })
    } catch (error) {
      if (error?.code !== 'EEXIST' || await readFile(target, 'utf8') !== body) throw error
    }
    return { saved: true, documentId: request.requestId }
  } }
}
