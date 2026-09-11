#!/usr/bin/env node
import { existsSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import {
  archiveProjectHistory, editProjectNodes, getProjectOverview, getProjectStructure,
  listProjectHistory, patchProjectNodes, queryProjectNodes, replaceProjectNodeField,
  replaceProjectStructure, renameProjectEntity, resolveProjectHistory, runMarkdownLogic, setProjectStructure, writeProjectMarkdown, runGenerationModelCommand,
} from './service.mjs'
import {
  formatProjectEdit, formatProjectHistory, formatProjectOverview, formatProjectQuery,
  formatProjectRename, formatProjectRun, formatProjectStructure, parseQueryLanguage,
} from './symbol-language.mjs'
import { parseTextPatch } from './text-patch.mjs'

async function batchEditInput(inputPath) {
  if (!inputPath) throw new Error('edit-file 需要 JSON 文件路径')
  const parsed = JSON.parse(await readFile(inputPath, 'utf8'))
  const updates = Array.isArray(parsed) ? parsed : parsed.updates
  if (!Array.isArray(updates) || updates.length === 0) throw new Error('编辑输入必须包含 updates 数组')
  return updates
}

async function standardInput() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

async function patchInput(inputPath) {
  if (!inputPath) throw new Error('patch 需要补丁文件路径或 -')
  return inputPath === '-' ? standardInput() : readFile(inputPath, 'utf8')
}

const fieldAliases = {
  d: 'description',
  desc: 'description',
  description: 'description',
  c: 'content',
  content: 'content',
  p: 'prompt',
  prompt: 'prompt',
}

function parseEditFields(rawArgs) {
  if (!rawArgs || rawArgs.length === 0) return {}
  const fields = {}

  let i = 0
  while (i < rawArgs.length) {
    const token = rawArgs[i]
    if (!token) {
      i += 1
      continue
    }
    const eq = token.indexOf('=')
    if (eq > 0) {
      const k = token.slice(0, eq).toLowerCase()
      const canonical = fieldAliases[k]
      if (canonical) {
        fields[canonical] = token.slice(eq + 1)
        i += 1
        continue
      }
    }
    const canonical = fieldAliases[token.toLowerCase()]
    if (canonical) {
      let nextFieldIndex = -1
      for (let j = i + 1; j < rawArgs.length; j++) {
        const nextToken = rawArgs[j]
        const nextEq = nextToken.indexOf('=')
        if (nextEq > 0 && fieldAliases[nextToken.slice(0, nextEq).toLowerCase()]) {
          nextFieldIndex = j
          break
        }
        if (fieldAliases[nextToken.toLowerCase()]) {
          nextFieldIndex = j
          break
        }
      }
      if (nextFieldIndex >= 0) {
        fields[canonical] = rawArgs.slice(i + 1, nextFieldIndex).join(' ')
        i = nextFieldIndex
      } else {
        fields[canonical] = rawArgs.slice(i + 1).join(' ')
        break
      }
    } else {
      const fallbackKey = Object.keys(fields).length === 0 ? 'description' : 'content'
      fields[fallbackKey] = rawArgs.slice(i).join(' ')
      break
    }
  }
  return fields
}

export async function runProjectCommand(args, environment = process.env) {
  const isJson = args.includes('--json')
  const cleanArgs = args.filter((arg) => arg !== '--json')
  const [command, first, second, third, ...rest] = cleanArgs
  if (!command || command === 'help' || command === '--help' || command === '-h') return [
    'graphvideo structure [scope] [depth] [--status] [--json] (默认 depth: 1, 全量展开用 all)',
    'graphvideo structure set <file|->',
    'graphvideo structure replace <target> <replacement>',
    'graphvideo structure resolve <actions> (一键核销历史冲突: [[P, 原名, 新名], [原名, inherit], [H, 旧名, 归档名]])',
    'graphvideo write <text|file|-> (走 Info 协议全量写入大纲文本并热同步，支持裸大纲与 > 描述语法)',
    "graphvideo query '[@名称],第1幕/@名称 :: dcph' [--json]",
    'graphvideo replace <selector> <description|content|prompt> <target> <replacement>',
    'graphvideo patch <change.patch|->',
    'graphvideo edit <selector> [d|description "val"] [p|prompt "val"] [c|content "val"] [--json]',
    'graphvideo edit-file <updates.json> [--json]',
    'graphvideo model list|get <id>|put <directory>|delete <id>|validate [id] [--json]',
    'graphvideo run [file|-] [--json]',
  ].join('\n')
  const projectRoot = environment.GRAPHVIDEO_PROJECT_ROOT
  if (!projectRoot) throw new Error('缺少 GRAPHVIDEO_PROJECT_ROOT')
  if (command === 'model') {
    return runGenerationModelCommand(environment.GRAPHVIDEO_GENERATION_MODELS_ROOT, [first, second, third, ...rest], isJson)
  }
  if (command === 'history') {
    if (!first || first === 'list') {
      const history = await listProjectHistory(projectRoot)
      return isJson ? JSON.stringify(history, null, 2) : formatProjectHistory(history)
    }
    if (first === 'archive') {
      if (!second || !third) throw new Error('history archive 需要旧名称和新归档名称')
      const result = await archiveProjectHistory(projectRoot, second, third)
      return `= history archived [${result.oldTitle}] -> [${result.newTitle}]`
    }
    throw new Error('history 支持 list | archive <old> <new>')
  }
  if (command === 'structure' || command === 'overview') {
    const rawArgs = [first, second, third, ...rest].filter((arg) => arg !== undefined && arg !== null)
    if (rawArgs.length > 0 && ['set', 'replace', 'resolve'].includes(rawArgs[0])) {
      const sub = rawArgs[0]
      if (sub === 'set') {
        const contentArg = rawArgs[1]
        if (!contentArg) throw new Error('structure set 需要大纲文件路径或 -')
        const content = contentArg === '-' ? await standardInput() : await readFile(contentArg, 'utf8')
        const result = await setProjectStructure(projectRoot, content)
        return isJson ? JSON.stringify(result, null, 2) : formatProjectRun(result)
      }
      if (sub === 'replace') {
        const target = rawArgs[1]
        if (!target) throw new Error('structure replace 需要目标文本和替换文本')
        const replacement = rawArgs.slice(2).join(' ')
        const result = await replaceProjectStructure(projectRoot, target, replacement)
        return isJson ? JSON.stringify(result, null, 2) : formatProjectRun(result)
      }
      if (sub === 'resolve') {
        const actionsInput = rawArgs.slice(1).join(' ')
        if (!actionsInput) throw new Error('structure resolve 需要操作数组，如 \'[["P", "旧名", "新名"], ["老节点", "inherit"]]\'')
        const result = await resolveProjectHistory(projectRoot, actionsInput)
        return isJson ? JSON.stringify(result, null, 2) : formatProjectRun(result)
      }
    }

    let includeStatus = command === 'overview'
    const filteredArgs = []
    for (const arg of rawArgs) {
      if (arg === '--status' || arg === '-s' || arg === 'status') {
        includeStatus = true
      } else if (arg !== 'get') {
        filteredArgs.push(arg)
      }
    }

    let scope = null
    let depth = 1
    if (command === 'overview') {
      scope = filteredArgs[0] || null
      depth = 'all'
    } else {
      if (filteredArgs.length === 1) {
        if (filteredArgs[0] === 'all') {
          scope = null
          depth = 'all'
        } else if (/^\d+$/.test(filteredArgs[0])) {
          depth = parseInt(filteredArgs[0], 10)
        } else {
          scope = filteredArgs[0]
          depth = 1
        }
      } else if (filteredArgs.length >= 2) {
        scope = filteredArgs[0]
        depth = filteredArgs[1] === 'all' ? 'all' : (parseInt(filteredArgs[1], 10) || 1)
      }
    }

    const structure = await getProjectStructure(projectRoot, scope, depth, includeStatus)
    return isJson ? JSON.stringify(structure, null, 2) : formatProjectStructure(structure)
  }
  if (command === 'write' || command === 'input' || command === 'submit') {
    const rawContent = [first, second, third, ...rest].filter((arg) => arg !== undefined && arg !== null).join(' ')
    let content = rawContent
    if (!content || content === '-') {
      content = await standardInput()
    } else if (first && !first.includes('\n') && !first.includes('<project-structure>')) {
      try {
        const s = await stat(first)
        if (s.isFile()) {
          content = await readFile(first, 'utf8')
        }
      } catch {}
    }
    if (!content || !content.trim()) throw new Error('write 命令需要提供 Markdown 文本、大纲文件路径或通过 stdin 管道输入')
    const result = await writeProjectMarkdown(projectRoot, content)
    return isJson ? JSON.stringify(result, null, 2) : `= write characters=${result.characters} lines=${result.lines}`
  }
  if (command === 'replace') {
    if (!first || !second || third === undefined) {
      throw new Error('replace 需要 ID、字段、目标文本和替换文本')
    }
    const target = third
    const replacement = rest.join(' ')
    const result = await replaceProjectNodeField(projectRoot, first, second, target, replacement)
    return isJson ? JSON.stringify(result, null, 2) : formatProjectEdit(result, 'replace')
  }
  if (command === 'rename') {
    if (!first || !second) throw new Error('rename 需要原节点选择器和新名称，如：graphvideo rename "[@旧名]" "[@新名]"')
    const result = await renameProjectEntity(projectRoot, first, second)
    return isJson ? JSON.stringify(result, null, 2) : formatProjectRename(result)
  }
  if (command === 'run') {
    if (first) {
      const content = first === '-' ? await standardInput() : await readFile(first, 'utf8')
      await writeProjectMarkdown(projectRoot, content)
    }
    const result = await runMarkdownLogic(projectRoot)
    return isJson ? JSON.stringify(result, null, 2) : formatProjectRun(result)
  }
  if (command === 'overview') {
    const overview = await getProjectOverview(projectRoot)
    return isJson ? JSON.stringify(overview, null, 2) : formatProjectOverview(overview)
  }
  if (command === 'query') {
    const requests = parseQueryLanguage(cleanArgs.slice(1).join('\n'))
    const result = await queryProjectNodes(projectRoot, requests)
    return isJson ? JSON.stringify(result, null, 2) : formatProjectQuery(result)
  }
  if (command === 'patch') {
    const patches = parseTextPatch(await patchInput(first))
    const result = await patchProjectNodes(projectRoot, patches)
    return isJson ? JSON.stringify(result, null, 2) : formatProjectEdit(result, 'patch')
  }
  if (command === 'edit') {
    if (!first || second === undefined) throw new Error('edit 需要 ID、字段和值')
    const editArgs = [second, third, ...rest].filter((arg) => arg !== undefined && arg !== null)
    const fields = parseEditFields(editArgs)
    for (const [k, v] of Object.entries(fields)) {
      if (v === '-') {
        fields[k] = await standardInput()
      } else if (typeof v === 'string' && v.length < 500 && (v.endsWith('.txt') || v.endsWith('.yaml') || v.endsWith('.yml') || v.endsWith('.md')) && existsSync(v)) {
        fields[k] = await readFile(v, 'utf8')
      }
    }
    const result = await editProjectNodes(projectRoot, [{ id: first, fields }])
    return isJson ? JSON.stringify(result, null, 2) : formatProjectEdit(result)
  }
  if (command === 'edit-file') {
    const result = await editProjectNodes(projectRoot, await batchEditInput(first))
    return isJson ? JSON.stringify(result, null, 2) : formatProjectEdit(result)
  }
  throw new Error('使用 graphvideo help 查看命令')
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runProjectCommand(process.argv.slice(2))
    .then((result) => process.stdout.write(`${result}\n`))
    .catch((error) => {
      process.stderr.write(`GraphVideo Project: ${error.message}\n`)
      process.exitCode = 1
    })
}
