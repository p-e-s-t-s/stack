// The Radarr/Sonarr v3 API that Prowlarr uses to push indexers: add Magpie in Prowlarr
// (Settings → Apps) as a Radarr and/or Sonarr whose address is Magpie's, with a Magpie API key.
// Only the indexer, tag and status endpoints Prowlarr's application sync calls are served.

import type {} from '@cordisjs/plugin-http'
import type {} from '@cordisjs/plugin-server'
import type {} from '@magpiejs/auth'
import type { Context } from 'cordis'
import { connectionOf, type IndexerResource, ResourceError, schema } from './resource'
import type { PushStore } from './store'

const PREFIX = '/api/v3'

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message)
  }
}

export interface PushOptions {
  /** The version reported to Prowlarr, which checks it against its minimum. */
  version: string
  /** Called after the pushed indexers changed. */
  changed(): void
}

export function pushRoutes(ctx: Context, store: PushStore, options: PushOptions) {
  const route = (
    method: 'get' | 'post' | 'put' | 'delete',
    path: string,
    handler: (req: { params: Record<string, string>; body: any }) => unknown | Promise<unknown>,
  ) => {
    ctx.server[method](PREFIX + path, async (req, res) => {
      try {
        // the guard has already let the key in. An API key is at most a manager and never
        // has `settings.manage`, so pushing indexers (what is searched and downloaded)
        // asks for `downloads.manage`.
        const who = ctx.auth.identity(req)
        if (!ctx.auth.can(who, 'downloads.manage'))
          throw new HttpError(who ? 403 : 401, 'you are not allowed to do that')
        let body: unknown
        if (method === 'post' || method === 'put') {
          const text = await req.text()
          try {
            body = text ? JSON.parse(text) : undefined
          } catch {
            throw new HttpError(400, 'the body is not valid JSON')
          }
        }
        res.json((await handler({ params: req.params as Record<string, string>, body })) ?? {})
      } catch (error) {
        if (error instanceof ResourceError) {
          // the shape of Radarr's validation failures, which Prowlarr shows to the user
          res.status = 400
          res.json([
            { propertyName: error.property, errorMessage: error.message, severity: 'error' },
          ])
        } else if (error instanceof HttpError) {
          res.status = error.status
          res.json(error.body ?? { message: error.message })
        } else {
          ctx.logger.warn(error)
          res.status = 500
          res.json({ message: error instanceof Error ? error.message : String(error) })
        }
      }
    })
  }

  const id = (params: Record<string, string>) => {
    const n = Number(params.id)
    if (!Number.isInteger(n)) throw new HttpError(404, 'not found')
    return n
  }
  const resourceOf = (body: unknown) => {
    if (!body || typeof body !== 'object' || Array.isArray(body))
      throw new HttpError(400, 'send an indexer as a JSON object')
    const resource = body as IndexerResource
    connectionOf(resource) // checks it
    return resource
  }

  route('get', '/system/status', () => ({
    appName: 'Magpie',
    instanceName: 'Magpie',
    version: options.version,
    buildTime: new Date(0).toISOString(),
    isDebug: false,
    isProduction: true,
    isAdmin: false,
    isUserInteractive: false,
    osName: process.platform,
    isLinux: process.platform === 'linux',
    isWindows: process.platform === 'win32',
    isOsx: process.platform === 'darwin',
    runtimeName: 'node',
    runtimeVersion: process.versions.node,
    authentication: 'apiKey',
    urlBase: '',
  }))

  // `schema` and `test` come before `:id`
  route('get', '/indexer', () => store.list())
  route('get', '/indexer/schema', () => schema())
  route('post', '/indexer/test', async ({ body }) => {
    const connection = connectionOf(resourceOf(body))
    try {
      const caps = await ctx.http.get<string>(connection.url, {
        params: { t: 'caps', ...(connection.apiKey && { apikey: connection.apiKey }) },
        responseType: 'text',
        timeout: 15_000,
      })
      if (!String(caps).includes('<caps'))
        throw new ResourceError(
          'BaseUrl',
          'that address does not answer like a Torznab/Newznab feed',
        )
    } catch (error) {
      if (error instanceof ResourceError) throw error
      throw new ResourceError(
        'BaseUrl',
        `cannot reach the indexer: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    return {}
  })
  route('post', '/indexer', ({ body }) => {
    const added = store.add(resourceOf(body))
    options.changed()
    return added
  })
  route('get', '/indexer/:id', ({ params }) => {
    const found = store.get(id(params))
    if (!found) throw new HttpError(404, 'not found')
    return found
  })
  route('put', '/indexer/:id', ({ params, body }) => {
    const updated = store.update(id(params), resourceOf(body))
    if (!updated) throw new HttpError(404, 'not found')
    options.changed()
    return updated
  })
  route('delete', '/indexer/:id', ({ params }) => {
    if (!store.remove(id(params))) throw new HttpError(404, 'not found')
    options.changed()
    return {}
  })

  route('get', '/tag', () => store.tags())
  route('post', '/tag', ({ body }) => {
    const label = typeof body?.label === 'string' ? body.label.trim() : ''
    if (!label) throw new HttpError(400, 'a tag needs a label')
    return store.tag(label)
  })
}
