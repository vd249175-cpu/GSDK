import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { catalogAgentDocuments, parseDocumentMetadata } from './document-catalog.mjs'

const roots = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('Agent document catalog', () => {
  it('parses metadata without loading document bodies', () => {
    expect(parseDocumentMetadata('---\ntitle: "模型规则"\ndescription: "按需阅读"\n---\n正文')).toEqual({
      title: '模型规则',
      description: '按需阅读',
    })
  })

  it('indexes only auxiliary documents by relative path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'graphvideo-agent-docs-'))
    roots.push(root)
    await mkdir(join(root, 'details'), { recursive: true })
    await writeFile(join(root, 'AGENTS.md'), '# Agent')
    await writeFile(join(root, 'details', 'project.md'), '---\ntitle: "项目"\ndescription: "项目说明"\n---\n私有正文')
    expect(await catalogAgentDocuments(root)).toEqual([{
      path: 'details/project.md',
      title: '项目',
      description: '项目说明',
    }])
  })

  it('indexes shared documents in parent agents directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'graphvideo-agent-docs-'))
    roots.push(root)
    const agentDir = join(root, 'director')
    await mkdir(join(agentDir, 'details'), { recursive: true })
    await writeFile(join(agentDir, 'AGENTS.md'), '# Director')
    await writeFile(join(agentDir, 'details', 'screenplay.md'), '---\ntitle: "剧本"\ndescription: "分幕写法"\n---\n正文')
    await writeFile(join(root, 'project_knowledge.md'), '---\ntitle: "通用项目知识"\ndescription: "节点与目录规范"\n---\n通用正文')

    expect(await catalogAgentDocuments(agentDir)).toEqual([
      {
        path: '../project_knowledge.md',
        title: '通用项目知识',
        description: '节点与目录规范',
      },
      {
        path: 'details/screenplay.md',
        title: '剧本',
        description: '分幕写法',
      },
    ])
  })

  it('indexes shared project subdirectories in parent agents directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'graphvideo-agent-docs-'))
    roots.push(root)
    const agentDir = join(root, 'director')
    const projectDir = join(root, '治愈系萌宠短剧')
    await mkdir(join(agentDir, 'details'), { recursive: true })
    await mkdir(projectDir, { recursive: true })
    await writeFile(join(agentDir, 'AGENTS.md'), '# Director')
    await writeFile(join(projectDir, '项目核心思路.md'), '---\ntitle: "项目核心思路"\ndescription: "核心受众与设定"\n---\n正文')

    expect(await catalogAgentDocuments(agentDir)).toEqual([
      {
        path: '../治愈系萌宠短剧/项目核心思路.md',
        title: '项目核心思路',
        description: '核心受众与设定',
      },
    ])
  })
})
