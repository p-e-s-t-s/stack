// @magpiejs/indexer-prowlarr: takes Magpie's indexers from Prowlarr, which already does
// indexer site definitions and FlareSolverr (docs/PLAN.md Phase 6). Two ways in, which can
// be used together:
//   pull  Prowlarr's own API (v1): list its indexers and register one Torznab/Newznab indexer
//         for each, kept in sync on a timer.
//   push  the Radarr/Sonarr API (v3): Prowlarr adds Magpie as an application and pushes
//         its indexers; see ./push.ts.
// Every indexer is registered by @magpiejs/indexer-torznab in a child scope of this
// plugin, so removing one in Prowlarr, or disabling this plugin, removes it from Magpie.

import type { Fiber } from 'cordis'
import type {} from '@cordisjs/plugin-http'
import type {} from '@cordisjs/plugin-timer'
import type {} from '@magpiejs/database'
import type {} from '@magpiejs/indexers'
import * as torznab from '@magpiejs/indexer-torznab'
import type { Context } from 'cordis'
import z from 'schemastery'
import { pushRoutes } from './push'
import { connectionOf, type Connection } from './resource'
import * as schema from './schema'
import { PushStore } from './store'

export const name = 'indexer-prowlarr'
export const inject = ['http', 'indexers', 'database', 'timer']

export interface Config {
  url: string
  apiKey: string
  syncInterval: number
  acceptPush: boolean
  version: string
}

export const Config: z<Partial<Config>, Config> = z.object({
  url: z
    .string()
    .default('')
    .description(
      "Prowlarr's address, e.g. `http://prowlarr:9696`. Empty: do not pull from Prowlarr.",
    ),
  apiKey: z.string().role('secret').default('').description("Prowlarr's API key."),
  syncInterval: z.natural().default(15).description('Minutes between looking at Prowlarr again.'),
  acceptPush: z
    .boolean()
    .default(true)
    .description(
      "Let Prowlarr push indexers: add Magpie in Prowlarr's Settings → Apps as a Radarr or Sonarr, with Magpie's address and an API key made in Magpie.",
    ),
  version: z
    .string()
    .default('5.0.0.0')
    .hidden()
    .description('The Radarr/Sonarr version reported to Prowlarr.'),
})

/** One entry of Prowlarr's `GET /api/v1/indexer`. */
interface ProwlarrIndexer {
  id: number
  name: string
  enable?: boolean
  protocol?: string
  priority?: number
  supportsRss?: boolean
  supportsSearch?: boolean
}

interface Live {
  signature: string
  fiber: Fiber
}

export function apply(ctx: Context, config: Config) {
  const store = new PushStore(
    ctx.database.register({
      namespace: 'prowlarr',
      schema,
      migrations: new URL('../migrations', import.meta.url),
    }),
  )
  const base = config.url.replace(/\/+$/, '')

  /** What the last successful look at Prowlarr found; kept when Prowlarr is unreachable. */
  let pulled: { id: string; connection: Connection }[] = []
  const live = new Map<string, Live>()
  // changes are applied one after another, so a slow dispose never overlaps the next
  let queue = Promise.resolve()

  async function pull() {
    if (!base) return
    const list = await ctx.http.get<ProwlarrIndexer[]>(`${base}/api/v1/indexer`, {
      headers: { 'X-Api-Key': config.apiKey },
      timeout: 30_000,
    })
    if (!Array.isArray(list)) throw new Error('that is not a Prowlarr indexer list')
    pulled = list
      .filter((i) => i.enable !== false)
      .map((i) => ({
        id: `prowlarr:${i.id}`,
        connection: {
          name: i.name,
          protocol: i.protocol === 'usenet' ? 'usenet' : 'torrent',
          // Prowlarr's own Torznab/Newznab proxy for the indexer
          url: `${base}/${i.id}/api`,
          apiKey: config.apiKey,
          priority: Math.min(Math.max(i.priority ?? 25, 0), 50),
          enableRss: i.supportsRss !== false,
          enableAutomatic: i.supportsSearch !== false,
          enableInteractive: i.supportsSearch !== false,
        },
      }))
  }

  /** Pulled indexers first, then pushed ones, one registered indexer per feed address. */
  function desired() {
    const wanted = new Map<string, { id: string; connection: Connection }>()
    const add = (id: string, connection: Connection) => {
      // Radarr and Sonarr both push the same Prowlarr indexer; it is one feed
      const key = `${connection.url}\n${connection.apiKey}`
      if (!wanted.has(key)) wanted.set(key, { id, connection })
    }
    for (const p of pulled) add(p.id, p.connection)
    for (const body of store.list()) {
      try {
        add(`prowlarr:push:${body.id}`, connectionOf(body))
      } catch (error) {
        ctx.logger.warn('ignoring pushed indexer %s: %s', body.name, error)
      }
    }
    return new Map([...wanted.values()].map((w) => [w.id, w.connection]))
  }

  async function apply_() {
    const wanted = desired()
    for (const [id, entry] of live) {
      if (wanted.has(id) && JSON.stringify(wanted.get(id)) === entry.signature) continue
      live.delete(id)
      await entry.fiber.dispose()
    }
    for (const [id, c] of wanted) {
      if (live.has(id)) continue
      const fiber = ctx.plugin(
        torznab,
        torznab.Config({
          id,
          name: c.name,
          url: c.url,
          apiKey: c.apiKey,
          protocol: c.protocol,
          categories: {},
          priority: c.priority,
          enableRss: c.enableRss,
          enableAutomatic: c.enableAutomatic,
          enableInteractive: c.enableInteractive,
        }) as never,
      ) as unknown as Fiber
      live.set(id, { signature: JSON.stringify(c), fiber })
    }
  }

  const reconcile = () =>
    (queue = queue.then(apply_).catch((e) => ctx.logger.warn('cannot update indexers: %s', e)))

  const sync = async () => {
    try {
      await pull()
    } catch (error) {
      ctx.logger.warn('cannot read indexers from Prowlarr: %s', error)
    }
    await reconcile()
  }

  void sync()
  if (base) ctx.setInterval(() => void sync(), config.syncInterval * 60_000)
  else void reconcile()

  if (config.acceptPush)
    ctx.inject(['server', 'auth'], (c) => {
      pushRoutes(c, store, { version: config.version, changed: () => void reconcile() })
    })
}
