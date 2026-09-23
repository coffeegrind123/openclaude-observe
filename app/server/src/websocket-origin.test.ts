import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { WebSocket } from 'ws'

// Integration coverage for the WebSocket handshake origin check: the event
// stream is unauthenticated, so a page the user visits must not be able to
// open ws://localhost and read it.

async function makeServer(corsAllowedOrigins: string[]): Promise<Server> {
  vi.doMock('./config', () => ({
    config: { logLevel: 'warn', corsAllowedOrigins },
  }))
  const { attachWebSocket } = await import('./websocket')
  const server = createServer()
  attachWebSocket(server)
  await new Promise<void>((res) => server.listen(0, '127.0.0.1', res))
  return server
}

function connect(server: Server, origin: string | undefined): Promise<'accepted' | 'rejected'> {
  const { port } = server.address() as AddressInfo
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/events/stream`, {
      headers: origin === undefined ? {} : { Origin: origin },
    })
    const finish = (r: 'accepted' | 'rejected') => {
      try {
        ws.close()
      } catch {
        /* already closing */
      }
      resolve(r)
    }
    ws.on('open', () => finish('accepted'))
    ws.on('unexpected-response', () => finish('rejected'))
    ws.on('error', () => finish('rejected'))
  })
}

describe('WebSocket origin check', () => {
  let server: Server

  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    server?.close()
    vi.restoreAllMocks()
  })

  test('rejects a cross-origin browser connection by default', async () => {
    server = await makeServer([])
    expect(await connect(server, 'https://evil.com')).toBe('rejected')
  })

  test('accepts a loopback origin by default', async () => {
    server = await makeServer([])
    expect(await connect(server, 'http://localhost:5174')).toBe('accepted')
  })

  test('accepts a connection with no Origin header (non-browser client)', async () => {
    server = await makeServer([])
    expect(await connect(server, undefined)).toBe('accepted')
  })

  test('honors an explicit allowlist', async () => {
    server = await makeServer(['https://dash.example'])
    expect(await connect(server, 'https://dash.example')).toBe('accepted')
    expect(await connect(server, 'https://evil.com')).toBe('rejected')
  })
})
