// Magpie entry point: a Cordis context with the loader, driven by <config dir>/magpie.yml.

import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import Loader from '@cordisjs/plugin-loader'
import { applyStagedConfig } from '@magpiejs/database'
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
    { name: '@magpiejs/auth' },
    // logging in with a password, and making the first account; turn off only if another
    // identity provider below is enabled
    { name: '@magpiejs/auth-local' },
    // log in with an OpenID Connect provider (Authelia, Authentik, Keycloak…); fill in the
    // provider's address, client id and the groups that map to roles, then enable
    {
      name: '@magpiejs/auth-oidc',
      disabled: true,
      config: { issuer: '', clientId: '', clientSecret: '', adminGroups: [], managerGroups: [] },
    },
    // trust a reverse proxy's user header; list the proxy's address first, then enable
    { name: '@magpiejs/auth-proxy', disabled: true, config: { trustedProxies: [] } },
    { name: '@magpiejs/api' },
    { name: '@magpiejs/jobs' },
    { name: '@magpiejs/decision' },
    { name: '@cordisjs/plugin-http' },
    { name: '@magpiejs/metadata' },
    // enabled from Settings → Metadata once it has an API key
    { name: '@magpiejs/metadata-tmdb', disabled: true, config: { apiKey: '' } },
    // podcast search; needs no key
    { name: '@magpiejs/metadata-itunes' },
    // authors and books; needs no key
    { name: '@magpiejs/metadata-openlibrary' },
    // artists and albums; needs no key
    { name: '@magpiejs/metadata-musicbrainz' },
    { name: '@magpiejs/library' },
    { name: '@magpiejs/indexers' },
    { name: '@magpiejs/movies' },
    { name: '@magpiejs/series' },
    { name: '@magpiejs/podcasts' },
    { name: '@magpiejs/books' },
    { name: '@magpiejs/music' },
    { name: '@magpiejs/downloads' },
    // direct downloads (podcast episodes); needs no settings
    { name: '@magpiejs/downloader-http' },
    { name: '@magpiejs/import' },
    { name: '@magpiejs/history' },
    // messages to webhooks, Discord, …; destinations are added in Settings → Notifications
    { name: '@magpiejs/notifications' },
    // adds titles from TMDB, Trakt, IMDb and Plex lists; lists are added in Settings → Import lists
    { name: '@magpiejs/import-lists' },
    // tells Plex/Jellyfin/Emby about new files; servers are added in Settings → Media servers
    { name: '@magpiejs/media-servers' },
    // ffprobe/ffmpeg location, and what is inside each library file
    { name: '@magpiejs/media-tools' },
    { name: '@magpiejs/mediainfo' },
    // rejects fake, corrupt and malicious downloads before they are imported
    { name: '@magpiejs/verify' },
    { name: '@magpiejs/subtitles' },
    { name: '@magpiejs/calendar' },
    // library statistics page, and the Ctrl+K search in the top bar
    { name: '@magpiejs/stats' },
    { name: '@magpiejs/search' },
    { name: '@magpiejs/browse' },
    { name: '@magpiejs/webui', config: { devMode: !!options.dev } },
    { name: '@magpiejs/system' },
    // checks that everything Magpie depends on works, and scheduled backups of the database
    { name: '@magpiejs/health' },
    { name: '@magpiejs/backup' },
    { name: '@magpiejs/settings' },
    // swappable console themes; installed themes appear in Settings → Appearance
    { name: '@magpiejs/themes' },
    // two sample themes: Slate (colours and type) and Dock (top bar, table list; builds on Slate)
    { name: '@magpiejs/theme-slate' },
    { name: '@magpiejs/theme-dock' },
  ]
}

export async function start(options: StartOptions) {
  const configDir = resolve(options.configDir)
  mkdirSync(configDir, { recursive: true })
  // a restore staged from the console replaces magpie.yml before it is read
  if (applyStagedConfig(configDir)) console.log('restored magpie.yml from a backup')

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
    config: {
      path: pathToFileURL(resolve(configDir, 'magpie.yml')).href,
      initial: defaultConfig(options),
    },
  })
  await ctx.loader.await()
  // wait for the plugins listed in magpie.yml, not just the include entry
  await ctx.loader.resolve(id).subtree?.await()
  return ctx
}
