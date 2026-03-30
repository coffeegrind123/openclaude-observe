import { WebSocketServer, WebSocket } from 'ws'
import type { Server } from 'http'

const clients = new Set<WebSocket>()

export function attachWebSocket(server: Server) {
  const wss = new WebSocketServer({ server, path: '/api/events/stream' })

  wss.on('connection', (ws) => {
    clients.add(ws)
    console.log('[WS] Client connected')

    ws.on('close', () => {
      clients.delete(ws)
      console.log('[WS] Client disconnected')
    })

    ws.on('error', () => {
      clients.delete(ws)
    })
  })

  console.log('[WS] WebSocket enabled on /api/events/stream')
}

export function broadcast(message: object): void {
  const json = JSON.stringify(message)
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(json)
      } catch {
        clients.delete(client)
      }
    }
  }
}

export function getClientCount(): number {
  return clients.size
}
