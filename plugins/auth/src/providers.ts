// What an identity provider plugin gives auth. A provider proves who someone is (a
// password, an OpenID Connect login, a header from a trusted proxy); auth owns the users,
// their roles, sessions and API keys. Providers register with `ctx.auth.providers`.

import type { Request } from '@cordisjs/plugin-server'
import type { Role } from './permissions'

/** What the login page shows a provider. */
export interface LoginView {
  /** Where to go after logging in. Already checked to be on this site. */
  next: string
  /** The last attempt's failure, to show. */
  error?: string
  /** No user exists yet. */
  setup: boolean
}

/** Someone a provider has authenticated, for auth to match to a user. */
export interface ExternalLogin {
  /** The provider's `id`. */
  provider: string
  /** Who they are at the provider; stable, unlike a name. */
  subject: string
  /** A name for a new user. Made unique if taken. */
  username: string
  /** Make the user, with this role, if there is none for `subject` yet. Omit to refuse them. */
  create?: { role: Role }
  /** Set the user's role to this on every login, so the provider decides it. */
  role?: Role
  /**
   * With no user linked to `subject` yet, sign in as the existing user with this `username`.
   * Only for providers whose names can be trusted: it hands them that user's access.
   */
  matchUsername?: boolean
}

/** Passwords kept by a provider, which the account and Users pages offer to change. */
export interface PasswordSupport {
  has(userId: number): boolean
  change(userId: number, current: string, next: string): Promise<void>
  /** Sets a password without knowing the old one: for an administrator, or a new user. */
  reset(userId: number, next: string): Promise<void>
}

export interface IdentityProvider {
  /** Lowercase letters, digits and dashes. Its routes live under `/auth/<id>/`. */
  id: string
  /** Shown on the login page and in Users. */
  label: string
  /** HTML for the login page: a form, or a link that starts the login. */
  login?(view: LoginView): string
  /** HTML shown instead of the login page while no user exists, to create the first one. */
  setup?(view: LoginView): string | undefined
  /** Signs in a request that carries proof without a form (a trusted proxy's header). */
  authenticate?(req: Request): ExternalLogin | undefined
  password?: PasswordSupport
  /** Whether this provider can sign `userId` in, for users it keeps itself. */
  knows?(userId: number): boolean
}

/** The providers that are loaded. */
export class ProviderRegistry {
  private providers = new Map<string, IdentityProvider>()
  private listeners = new Set<() => void>()

  /** Adds a provider. Returns what removes it. */
  register(provider: IdentityProvider) {
    if (!/^[a-z0-9-]+$/.test(provider.id)) throw new Error(`invalid provider id ${provider.id}`)
    if (this.providers.has(provider.id))
      throw new Error(`the ${provider.id} identity provider is already loaded`)
    this.providers.set(provider.id, provider)
    this.changed()
    return () => {
      if (this.providers.get(provider.id) !== provider) return
      this.providers.delete(provider.id)
      this.changed()
    }
  }

  list() {
    return [...this.providers.values()]
  }

  get(id: string) {
    return this.providers.get(id)
  }

  /** The provider that keeps passwords, if one is loaded. */
  password() {
    return this.list().find((p) => p.password)?.password
  }

  /** Calls `listener` when a provider is added or removed. Returns what stops it. */
  onChange(listener: () => void) {
    this.listeners.add(listener)
    return () => void this.listeners.delete(listener)
  }

  private changed() {
    for (const listener of this.listeners) listener()
  }
}
