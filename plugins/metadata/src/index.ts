// @magpiejs/metadata: registry of metadata providers (TMDB, TVDB, …). Provider plugins
// register themselves for their lifetime; features ask for a provider by kind or id.

import type { MediaKind, MetadataProvider } from '@magpiejs/types'
import { type Context, Service } from 'cordis'

declare module 'cordis' {
  interface Context {
    metadata: MetadataService
  }
}

export class MetadataService extends Service {
  private providers = new Map<string, MetadataProvider>()

  constructor(ctx: Context) {
    super(ctx, 'metadata')
  }

  register(provider: MetadataProvider) {
    return this.ctx.effect(() => {
      if (this.providers.has(provider.id))
        throw new Error(`metadata provider ${provider.id} is already registered`)
      this.providers.set(provider.id, provider)
      return () => this.providers.delete(provider.id)
    }, `metadata.register(${provider.id})`)
  }

  get(id: string) {
    return this.providers.get(id)
  }

  /** The provider for a kind of media: the preferred id if registered, else the first one. */
  for(kind: MediaKind, preferred?: string) {
    const candidates = [...this.providers.values()].filter((p) => p.kinds.includes(kind))
    return candidates.find((p) => p.id === preferred) ?? candidates[0]
  }

  list() {
    return [...this.providers.values()].map((p) => ({ id: p.id, kinds: p.kinds }))
  }
}

export default MetadataService
