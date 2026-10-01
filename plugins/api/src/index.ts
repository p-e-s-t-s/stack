// @magpiejs/api: a small helper for JSON endpoints under /api/v1. Feature plugins add
// their own endpoints with `ctx.api.get(...)` etc.; @magpiejs/auth checks the caller.

import type {} from '@cordisjs/plugin-server'
import type { Identity } from '@magpiejs/auth'
import type { Permission } from '@magpiejs/types'
import { type Context, Service } from 'cordis'

declare module 'cordis' {
  interface Context {
    api: ApiService
  }
}

/** An error with an HTTP status, returned to the caller as `{ error }`. */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

export interface ApiRequest<P = Record<string, string>> {
  params: P
  query: URLSearchParams
  /** Parsed JSON body, for methods that have one. */
  body: any
  /** Who is calling: a logged-in session or an API key. */
  identity: Identity
}

/** Returns JSON-able data, nothing (204), or a `Response` for other content types. */
export type ApiHandler<P = Record<string, string>> = (req: ApiRequest<P>) => unknown

export interface RouteOptions {
  /**
   * What the caller needs. By default reading (`GET`) needs `library.read` and anything
   * else `library.write`; routes for settings, downloads or the system name their own.
   */
  permission?: Permission
}

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete'

export class ApiService extends Service {
  static inject = ['server', 'auth']
  static prefix = '/api/v1'

  constructor(ctx: Context) {
    super(ctx, 'api')
  }

  [Service.init]() {
    this.get('/system/status', () => ({ version: '0.0.0', startedAt: this.startedAt }))
  }

  startedAt = new Date().toISOString()

  get(path: string, handler: ApiHandler, options?: RouteOptions) {
    return this.route('get', path, handler, options)
  }

  post(path: string, handler: ApiHandler, options?: RouteOptions) {
    return this.route('post', path, handler, options)
  }

  put(path: string, handler: ApiHandler, options?: RouteOptions) {
    return this.route('put', path, handler, options)
  }

  patch(path: string, handler: ApiHandler, options?: RouteOptions) {
    return this.route('patch', path, handler, options)
  }

  delete(path: string, handler: ApiHandler, options?: RouteOptions) {
    return this.route('delete', path, handler, options)
  }

  /** The same routes, needing `permission` unless one names another. */
  as(permission: Permission) {
    const options = { permission }
    return {
      get: (path: string, handler: ApiHandler) => this.get(path, handler, options),
      post: (path: string, handler: ApiHandler) => this.post(path, handler, options),
      put: (path: string, handler: ApiHandler) => this.put(path, handler, options),
      patch: (path: string, handler: ApiHandler) => this.patch(path, handler, options),
      delete: (path: string, handler: ApiHandler) => this.delete(path, handler, options),
    }
  }

  private route(method: Method, path: string, handler: ApiHandler, options?: RouteOptions) {
    // routes belong to the calling plugin's context, so they go away with it
    const needed = options?.permission ?? (method === 'get' ? 'library.read' : 'library.write')
    this.ctx.server[method](ApiService.prefix + path, async (req, res) => {
      try {
        const who = this.ctx.auth.identity(req)
        if (!this.ctx.auth.can(who, needed))
          throw new ApiError(who ? 403 : 401, 'you are not allowed to do that')
        let body: unknown
        if (method !== 'get' && method !== 'delete') {
          const text = await req.text()
          // a logged-in browser is sent JSON only, as another guard against forms from
          // other sites (the session cookie is already SameSite=Lax)
          if (
            text &&
            who?.type === 'session' &&
            !req.headers.get('content-type')?.includes('application/json')
          )
            throw new ApiError(415, 'send the body as application/json')
          try {
            body = text ? JSON.parse(text) : undefined
          } catch {
            throw new ApiError(400, 'the body is not valid JSON')
          }
        }
        const result = await handler({
          params: req.params as Record<string, string>,
          query: req.query,
          body,
          identity: who!,
        })
        // a Response (e.g. a calendar file) is sent as it is
        if (result instanceof Response) return result
        if (result === undefined) res.status = 204
        else res.json(result)
      } catch (error) {
        const status = error instanceof ApiError ? error.status : 500
        if (status === 500) this.ctx.logger.warn(error)
        res.status = status
        res.json({ error: error instanceof Error ? error.message : String(error) })
      }
    })
  }
}

export default ApiService
