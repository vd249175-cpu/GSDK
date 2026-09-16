import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createPromptDirectory, createPromptFile, deletePromptEntry, discoverAgentTemplates,
  listPromptEntries, readPromptFile, renamePromptEntry, resolveAgentDirectory,
  resolvePromptEntry, resolvePromptFile, savePromptFile,
} from './agent-catalog.mjs'

const temporaryDirectories = []
const execFileAsync = promisify(execFile)

async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), 'graphvideo-agent-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )))
})

describe('Agent template catalog', () => {
  it('discovers only Agent directories containing AGENTS.md', async () => {
    const root = await temporaryDirectory()
    await mkdir(join(root, 'default', 'agents', 'general'), { recursive: true })
    await mkdir(join(root, 'default', 'agents', 'incomplete'), { recursive: true })
    await writeFile(join(root, 'default', 'agents', 'general', 'AGENTS.md'), '# General')

    expect(await discoverAgentTemplates(root)).toEqual([{
      id: 'default',
      name: 'default',
      agents: [{ id: 'general', name: 'general' }],
    }])
    const agentDirectory = join(root, 'default', 'agents', 'general')
    expect(await resolveAgentDirectory(root, 'default', 'general')).toBe(agentDirectory)
    const { stdout } = await execFileAsync('git', ['-C', agentDirectory, 'rev-parse', '--show-toplevel'])
    const canonicalAgentDirectory = await realpath(agentDirectory)
    expect(stdout.trim().replaceAll('\\', '/').toLowerCase()).toBe(
      canonicalAgentDirectory.replaceAll('\\', '/').toLowerCase(),
    )
  })
})

describe('global Prompt Library', () => {
  it('lists, reads and saves nested XML files', async () => {
    const root = await temporaryDirectory()
    await mkdir(join(root, 'group'), { recursive: true })
    await writeFile(join(root, 'group', 'one.xml'), '<prompts><prompt>first</prompt></prompts>')
    await writeFile(join(root, 'ignored.txt'), 'ignored')

    expect(await listPromptEntries(root)).toEqual([
      { kind: 'directory', path: 'group' },
      { kind: 'file', path: 'group/one.xml' },
    ])
    expect(await readPromptFile(root, 'group/one.xml')).toBe('<prompts><prompt>first</prompt></prompts>')
    await savePromptFile(root, 'group/one.xml', '<prompts><prompt>second</prompt></prompts>')
    expect(await readPromptFile(root, 'group/one.xml')).toBe('<prompts><prompt>second</prompt></prompts>')
    await createPromptFile(root, 'new/two.xml', '<prompts></prompts>')
    expect(await listPromptEntries(root)).toEqual([
      { kind: 'directory', path: 'group' },
      { kind: 'file', path: 'group/one.xml' },
      { kind: 'directory', path: 'new' },
      { kind: 'file', path: 'new/two.xml' },
    ])
    await deletePromptEntry(root, 'new/two.xml')
    expect(await listPromptEntries(root)).toEqual([
      { kind: 'directory', path: 'group' },
      { kind: 'file', path: 'group/one.xml' },
      { kind: 'directory', path: 'new' },
    ])
  })

  it('creates, renames and recursively deletes directories', async () => {
    const root = await temporaryDirectory()
    await createPromptDirectory(root, 'video')
    await createPromptDirectory(root, 'video/style')
    await createPromptFile(root, 'video/style/crt.xml', '<prompts></prompts>')
    await renamePromptEntry(root, 'video/style', 'video/look')

    expect(await listPromptEntries(root)).toEqual([
      { kind: 'directory', path: 'video' },
      { kind: 'directory', path: 'video/look' },
      { kind: 'file', path: 'video/look/crt.xml' },
    ])
    await deletePromptEntry(root, 'video')
    expect(await listPromptEntries(root)).toEqual([])
  })

  it('rejects paths outside the library and non-XML files', async () => {
    const root = await temporaryDirectory()
    expect(() => resolvePromptEntry(root, '../outside')).toThrow('路径无效')
    expect(() => resolvePromptFile(root, '../outside.xml')).toThrow('路径无效')
    expect(() => resolvePromptFile(root, 'prompt.md')).toThrow('必须是 XML')
  })
})
