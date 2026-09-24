// @magpiejs/api: a small helper for JSON endpoints under /api/v1. Feature plugins add
// their own endpoints with `ctx.api.get(...)` etc.; @magpiejs/auth checks the caller.

import type {} from '@cordisjs/plugin-server'
import type {} from '@magpiejs/auth'
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
}

export type ApiHandler<P = Record<string, string>> = (req: ApiRequest<P>) => unknown

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

  get(path: string, handler: ApiHandler) {
    return this.route('get', path, handler)
  }

  post(path: string, handler: ApiHandler) {
    return this.route('post', path, handler)
  }

  put(path: string, handler: ApiHandler) {
    return this.route('put', path, handler)
  }

  patch(path: string, handler: ApiHandler) {
    return this.route('patch', path, handler)
  }

  delete(path: string, handler: ApiHandler) {
    return this.route('delete', path, handler)
  }

  private route(method: Method, path: string, handler: ApiHandler) {
    // routes belong to the calling plugin's context, so they go away with it
    this.ctx.server[method](ApiService.prefix + path, async (req, res) => {
      try {
        let body: unknown
        if (method !== 'get' && method !== 'delete') {
          const text = await req.text()
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
        })
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
