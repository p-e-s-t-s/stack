import { connect, createClient, global } from '@cordisjs/client'
import shell from './shell'

const root = createClient()
root.plugin(shell)

if (!global.static) {
  const endpoint = new URL(global.endpoint, location.origin).toString()
  connect(root, () => new WebSocket(endpoint.replace(/^http/, 'ws')))
}

root.client.mount('#app')
