import { watch } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { openLocalProject } from './project-store.mjs'

const updateFileName = 'external-update.json'

export class ProjectExternalSync {
  constructor(onUpdate, onMarkdownUpdate = () => undefined) {
    this.onUpdate = onUpdate
    this.onMarkdownUpdate = onMarkdownUpdate
    this.watchers = []
    this.projectRoot = null
    this.updateTimer = null
    this.markdownTimer = null
    this.generation = 0
  }

  async start(projectRoot) {
    this.stop()
    const root = resolve(projectRoot)
    const directory = join(root, '.graphvideo')
    await mkdir(directory, { recursive: true })
    this.projectRoot = root
    const generation = ++this.generation
    this.watchers.push(watch(directory, (_eventType, fileName) => {
      if (String(fileName) !== updateFileName || generation !== this.generation) return
      clearTimeout(this.updateTimer)
      this.updateTimer = setTimeout(() => void this.refresh(generation), 40)
    }))
  }

  async refresh(generation = this.generation) {
    const root = this.projectRoot
    if (!root || generation !== this.generation) return
    try {
      const project = await openLocalProject(root)
      if (generation === this.generation) this.onUpdate(project)
    } catch {
      // A later event can retry after an external writer finishes its transaction.
    }
  }

  stop() {
    this.generation += 1
    clearTimeout(this.updateTimer)
    clearTimeout(this.markdownTimer)
    this.updateTimer = null
    this.markdownTimer = null
    this.watchers.splice(0).forEach((watcher) => watcher.close())
    this.projectRoot = null
  }
}
