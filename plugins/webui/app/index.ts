import { connect, createClient, global } from '@cordisjs/client'
import shell from './shell'

const root = createClient()
root.plugin(shell)

/** A refused WebSocket usually means the login ran out: go to the login page. */
async function checkLogin() {
  try {
    const res = await fetch('/auth/status', { credentials: 'same-origin' })
    if (res.status === 401) {
      location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`
    }
  } catch {
    // offline: the client keeps retrying
  }
}

if (!global.static) {
  const endpoint = new URL(global.endpoint, location.origin).toString()
  connect(root, () => {
    const socket = new WebSocket(endpoint.replace(/^http/, 'ws'))
    socket.addEventListener('close', (event) => {
      if (!event.wasClean) void checkLogin()
    })
    return socket
  })
}

root.client.mount('#app')
