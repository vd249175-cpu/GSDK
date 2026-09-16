import { pathToFileURL } from 'node:url'
import { loadApplication } from '../application.mjs'
await import(pathToFileURL(loadApplication().hostEntry).href)
