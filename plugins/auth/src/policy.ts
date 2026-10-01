// Connects auth to the web console: who is on each WebSocket, what they may do there, and
// closing sockets whose session or role has changed.

import type { Request } from '@cordisjs/plugin-server'
import type { WebSocket } from '@cordisjs/plugin-webui'
import type { AccessPolicy } from '@magpiejs/webui'
import type { Context } from 'cordis'
import type AuthService from './index'
import type { Identity } from './index'
import { PERMISSIONS } from './permissions'

type SessionIdentity = Extract<Identity, { type: 'session' }>

interface Live {
  userId: number
  sessionId: string
  socket: WebSocket
}

/** The console sockets that are open, by the user and session behind each. */
export class SocketRegistry {
  private live = new Set<Live>()

  add(entry: Live) {
    this.live.add(entry)
    entry.socket.addEventListener('close', () => this.live.delete(entry))
  }

  close(match: (live: Live) => boolean) {
    for (const entry of [...this.live]) {
      if (!match(entry)) continue
      this.live.delete(entry)
      entry.socket.close(4401, 'logged out')
    }
  }
}

/** Upgrade requests that passed the check, by their TCP socket, until the console takes them. */
const upgrades = new WeakMap<object, SessionIdentity>()

export function allowUpgrade(req: Request, who: SessionIdentity) {
  upgrades.set(req._req.socket, who)
}

export function installPolicy(ctx: Context, auth: AuthService) {
  const policy: AccessPolicy<Identity> = {
    identify(socket) {
      // `ws` keeps the TCP socket of the upgrade it accepted
      const who = upgrades.get((socket as unknown as { _socket?: object })._socket ?? {})
      if (!who) return
      auth.sockets.add({ userId: who.user.id, sessionId: who.sessionId, socket })
      return who
    },
    can: (who, permission) => auth.can(who, permission),
    describe(who) {
      const role = auth.roleOf(who)
      return {
        username: who.type === 'session' ? who.user.username : '',
        role,
        permissions: role ? [...PERMISSIONS[role]] : [],
      }
    },
  }
  ctx.effect(() => {
    ctx.webui.policy = policy as AccessPolicy
    return () => {
      if (ctx.webui.policy === policy) ctx.webui.policy = undefined
    }
  }, 'auth: console access policy')
}
