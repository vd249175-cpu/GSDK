#!/usr/bin/env node

import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(scriptDirectory, '../../../..')

const usage = `Usage:
  ufo-computer.mjs windows [--no-screenshot]
  ufo-computer.mjs observe [window selector] [--ui-tree] [--no-screenshot]
  ufo-computer.mjs focus [window selector]
  ufo-computer.mjs click --control <id> --name <exact> [--button left] [--double]
  ufo-computer.mjs coordinate-click --x <0..1> --y <0..1> [--button left] [--double]
  ufo-computer.mjs drag --start-x <0..1> --start-y <0..1> --end-x <0..1> --end-y <0..1>
  ufo-computer.mjs set-text --control <id> --name <exact> --text <value> [--clear]
  ufo-computer.mjs keys --keys <pywinauto sequence> [--control <id> --name <exact>]
  ufo-computer.mjs scroll --control <id> --name <exact> --distance <integer>
  ufo-computer.mjs maximize|minimize|restore [window selector]
  ufo-computer.mjs close [window selector] --yes
  ufo-computer.mjs raw-action --command <UFO command> [--args-json <json>]

Window selector: --window <id> --name <exact> | --handle <number> | --title-contains <text>
Common option: --run <runs/.../run.config.json>`

function parseArgs(values) {
  const positional = []
  const options = {}
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]
    if (!value.startsWith('--')) {
      positional.push(value)
      continue
    }
    const key = value.slice(2)
    if (key.startsWith('no-')) {
      options[key.slice(3)] = false
      continue
    }
    const next = values[index + 1]
    if (next === undefined || next.startsWith('--')) options[key] = true
    else {
      options[key] = next
      index += 1
    }
  }
  return { positional, options }
}

const required = (options, key) => {
  const value = options[key]
  if (value === undefined || value === true || String(value).length === 0) throw new Error(`--${key} is required`)
  return value
}

const number = (options, key, { min = -Infinity, max = Infinity } = {}) => {
  const parsed = Number(required(options, key))
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) throw new Error(`--${key} must be between ${min} and ${max}`)
  return parsed
}

const boolean = (value, fallback = false) => value === undefined ? fallback : value === true || value === 'true' || value === '1'

function windowSelector(options) {
  const selector = {}
  if (options.window !== undefined) selector.id = String(options.window)
  if (options.name !== undefined) selector.name = String(options.name)
  if (options.handle !== undefined) selector.handle = Number(options.handle)
  if (options['title-contains'] !== undefined) selector.titleContains = String(options['title-contains'])
  return Object.keys(selector).length > 0 ? selector : undefined
}

const postActionObservation = () => ({
  mode: 'after-action',
  includeControls: true,
  includeScreenshot: true,
  settleMs: 500,
})

function buildInfo(command, options, requestId) {
  const selector = windowSelector(options)
  if (command === 'windows') {
    return {
      type: 'InspectComputerInfo',
      requestId,
      observation: { mode: 'desktop', includeScreenshot: options.screenshot !== false },
    }
  }
  if (command === 'observe') {
    return {
      type: 'InspectComputerInfo',
      requestId,
      observation: {
        mode: selector ? 'window' : 'selected-window',
        ...(selector ? { window: selector } : {}),
        includeControls: true,
        includeScreenshot: options.screenshot !== false,
        includeUiTree: boolean(options['ui-tree']),
        ...(options['max-controls'] ? { maxControls: Number(options['max-controls']) } : {}),
      },
    }
  }

  let action
  if (command === 'focus') action = { command: 'focus_window', ...(selector ? { window: selector } : {}) }
  else if (['maximize', 'minimize', 'restore', 'close'].includes(command)) {
    if (command === 'close' && !boolean(options.yes)) {
      const error = new Error('close requires explicit --yes after authorization for closing the selected window')
      error.exitCode = 10
      throw error
    }
    action = { command: `${command}_window`, ...(selector ? { window: selector } : {}) }
  } else if (command === 'click') {
    action = {
      command: 'click_input',
      controlId: String(required(options, 'control')),
      controlName: String(required(options, 'name')),
      args: { button: options.button ?? 'left', double: boolean(options.double) },
    }
  } else if (command === 'coordinate-click') {
    action = {
      command: 'click_on_coordinates',
      args: {
        x: number(options, 'x', { min: 0, max: 1 }),
        y: number(options, 'y', { min: 0, max: 1 }),
        button: options.button ?? 'left',
        double: boolean(options.double),
      },
    }
  } else if (command === 'drag') {
    action = {
      command: 'drag_on_coordinates',
      args: {
        start_x: number(options, 'start-x', { min: 0, max: 1 }),
        start_y: number(options, 'start-y', { min: 0, max: 1 }),
        end_x: number(options, 'end-x', { min: 0, max: 1 }),
        end_y: number(options, 'end-y', { min: 0, max: 1 }),
        duration: options.duration === undefined ? 1 : Number(options.duration),
        button: options.button ?? 'left',
        key_hold: options['key-hold'] ?? null,
      },
    }
  } else if (command === 'set-text') {
    action = {
      command: 'set_edit_text',
      controlId: String(required(options, 'control')),
      controlName: String(required(options, 'name')),
      args: { text: String(required(options, 'text')), clear_current_text: boolean(options.clear) },
    }
  } else if (command === 'keys') {
    action = {
      command: 'keyboard_input',
      ...(options.control !== undefined ? { controlId: String(options.control) } : {}),
      ...(options.name !== undefined ? { controlName: String(options.name) } : {}),
      args: { keys: String(required(options, 'keys')), control_focus: options.control !== undefined },
    }
  } else if (command === 'scroll') {
    action = {
      command: 'wheel_mouse_input',
      controlId: String(required(options, 'control')),
      controlName: String(required(options, 'name')),
      args: { wheel_dist: number(options, 'distance') },
    }
  } else if (command === 'raw-action') {
    const rawCommand = String(required(options, 'command'))
    if (rawCommand === 'close_window' && !boolean(options.yes)) {
      const error = new Error('close_window requires explicit --yes after authorization')
      error.exitCode = 10
      throw error
    }
    action = {
      command: rawCommand,
      ...(selector ? { window: selector } : {}),
      ...(options.control !== undefined ? { controlId: String(options.control) } : {}),
      ...(options.name !== undefined ? { controlName: String(options.name) } : {}),
      args: options['args-json'] ? JSON.parse(options['args-json']) : {},
    }
  } else throw new Error(`Unknown command: ${command}`)

  return { type: 'ControlComputerInfo', requestId, action, observation: postActionObservation() }
}

async function connect(runConfigPath) {
  const runDirectory = dirname(runConfigPath)
  const runtimeDirectory = join(runDirectory, '.generated', 'runtime')
  let readyText
  let token
  try {
    readyText = await readFile(join(runtimeDirectory, 'kernel.stdout'), 'utf8')
    token = (await readFile(join(runtimeDirectory, 'daemon-token'), 'utf8')).trim()
  } catch {
    throw new Error(`The UFO computer run is not active. Start it with: bash ./run.sh start ${runConfigPath}`)
  }
  const ready = readyText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    try { return JSON.parse(line) } catch { return null }
  }).find((entry) => entry?.address)
  if (!ready) throw new Error('The active run has no valid kernel ready record')
  const agentModule = await import(pathToFileURL(join(repositoryRoot, 'packages', 'sdk', 'javascript', 'dist', 'agent.js')).href)
  return agentModule.connectKernelDaemon({ address: ready.address, token })
}

async function waitForObservation(client, requestId, afterCursor, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs
  let cursor = afterCursor
  let observedMessage = false
  for (;;) {
    const snapshot = await client.agentInspect(cursor, 200)
    const events = snapshot.events?.events ?? []
    observedMessage ||= events.some((event) => event.kind === 'info_sent'
      && event.nodeId === 'computer/observation'
      && event.targetNodeId === 'computer/session'
      && event.infoType === 'ComputerObservedInfo')
    cursor = snapshot.events?.nextCursor ?? cursor
    const state = snapshot.projection?.nodes?.['computer/session']?.state
    if (state?.requestId === requestId && state.status === 'error') throw new Error(state.lastError ?? 'UFO computer control failed')
    if (state?.requestId === requestId && state.status === 'idle' && observedMessage) {
      return {
        requestId,
        observationMessage: {
          senderNodeId: 'computer/observation',
          targetNodeId: 'computer/session',
          infoType: 'ComputerObservedInfo',
        },
        actionResult: state.actionResult ?? null,
        observation: state.observation ?? null,
      }
    }
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ComputerObservedInfo for ${requestId}`)
    await new Promise((resolveWait) => setTimeout(resolveWait, 150))
  }
}

async function main() {
  const { positional, options } = parseArgs(process.argv.slice(2))
  const command = positional[0]
  if (!command || command === 'help' || options.help) {
    process.stdout.write(`${usage}\n`)
    return
  }
  let configuredRun = options.run
  if (!configuredRun) {
    try {
      const mainToken = join(repositoryRoot, 'runs', 'main', '.generated', 'runtime', 'daemon-token')
      await readFile(mainToken, 'utf8')
      configuredRun = 'runs/main/run.config.json'
    } catch {
      configuredRun = 'runs/os-recorder/run.config.json'
    }
  }
  const runConfigPath = isAbsolute(configuredRun) ? configuredRun : resolve(repositoryRoot, configuredRun)
  const requestId = `ufo-skill-${Date.now()}-${randomUUID()}`
  const info = buildInfo(command, options, requestId)
  const client = await connect(runConfigPath)
  try {
    const before = await client.agentInspect(undefined, 1000)
    const afterCursor = before.events?.nextCursor ?? 0
    await client.agentInject(
      'agent/codex/ufo-computer-control',
      `UFO skill command: ${command}`,
      `ufo-skill/${requestId}`,
      'computer/session',
      info,
    )
    const result = await waitForObservation(client, requestId, afterCursor)
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } finally {
    client.close()
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = error?.exitCode ?? 1
})
