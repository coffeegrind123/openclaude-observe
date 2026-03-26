// app/server/src/index.ts
import { serve } from '@hono/node-server'
import { createApp } from './app'
import { createStore } from './storage'
import { attachWebSocket, broadcast } from './websocket'

const store = createStore()
const PORT = parseInt(process.env.SERVER_PORT || process.env.PORT || '4001', 10)
const WS_ENABLED = process.env.ENABLE_WEBSOCKET !== 'false'

const app = createApp(store, broadcast)

const server = serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`Server running on http://localhost:${PORT}`)
  console.log(`POST events: http://localhost:${PORT}/api/events`)
})

attachWebSocket(server, WS_ENABLED)
