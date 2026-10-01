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

/** Upgrade requests that passed the check, until the console takes their socket. */
const upgrades = new WeakMap<object, SessionIdentity>()

export function allowUpgrade(req: Request, who: SessionIdentity) {
  upgrades.set(req._req, who)
}

export function installPolicy(ctx: Context, auth: AuthService) {
  // the `ws` server announces each accepted socket with the request it came from, just
  // before the console is handed the socket
  const owners = new WeakMap<object, SessionIdentity>()
  const onConnection = (socket: object, incoming: object) => {
    const who = upgrades.get(incoming)
    if (who) owners.set(socket, who)
  }
  const policy: AccessPolicy<Identity> = {
    identify(socket) {
      const who = owners.get(socket)
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
    ctx.server._ws.on('connection', onConnection)
    ctx.webui.policy = policy as AccessPolicy
    return () => {
      ctx.server._ws.off('connection', onConnection)
      if (ctx.webui.policy === policy) ctx.webui.policy = undefined
    }
  }, 'auth: console access policy')
}
