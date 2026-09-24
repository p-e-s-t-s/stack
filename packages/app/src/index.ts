// Magpie entry point: a Cordis context with the loader, driven by <config dir>/magpie.yml.

import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import Loader from '@cordisjs/plugin-loader'
import { Context, Logger } from 'cordis'

export interface StartOptions {
  /** Directory holding magpie.yml, the database and backups. */
  configDir: string
  /** Vite dev server for the web console (restart on code changes comes from `tsx watch`). */
  dev?: boolean
  port?: number
}

/** Plugins written to magpie.yml on first start. Users add providers from the UI later. */
export function defaultConfig(options: StartOptions) {
  return [
    { name: '@cordisjs/plugin-timer' },
    {
      name: '@cordisjs/plugin-server',
      config: { host: '0.0.0.0', port: options.port ?? 6767 },
    },
    { name: '@magpiejs/database' },
    { name: '@magpiejs/jobs' },
    { name: '@magpiejs/decision' },
    { name: '@cordisjs/plugin-http' },
    { name: '@magpiejs/metadata' },
    // enable after adding your TMDB API key (Settings will manage this later)
    { name: '@magpiejs/metadata-tmdb', disabled: true, config: { apiKey: '' } },
    { name: '@magpiejs/library' },
    { name: '@magpiejs/indexers' },
    { name: '@magpiejs/movies' },
    { name: '@magpiejs/downloads' },
    { name: '@magpiejs/import' },
    { name: '@magpiejs/history' },
    { name: '@magpiejs/webui', config: { devMode: !!options.dev } },
    { name: '@magpiejs/system' },
  ]
}

export async function start(options: StartOptions) {
  const configDir = resolve(options.configDir)
  mkdirSync(configDir, { recursive: true })

  const ctx = new Context()
  // data paths (database, backups) resolve against the config directory
  ctx.baseUrl = pathToFileURL(configDir + '/').href

  // cordis 4 has a built-in logger; print its messages to the console
  const colors = process.stdout.isTTY ? 3 : false
  ctx.logger.exporter({
    colors,
    export(message) {
      const line = Logger.format(this, message)
      if (message.type === 'error' || message.type === 'warn') console.error(line)
      else console.log(line)
    },
  })
  // plugin packages resolve from Magpie's own install, not from the config directory
  await ctx.plugin(Loader, { baseUrl: import.meta.url })
  const id = await ctx.loader.create({
    name: '@cordisjs/plugin-include',
    config: { path: resolve(configDir, 'magpie.yml'), initial: defaultConfig(options) },
  })
  await ctx.loader.await()
  // wait for the plugins listed in magpie.yml, not just the include entry
  await ctx.loader.resolve(id).subtree?.await()
  return ctx
}
