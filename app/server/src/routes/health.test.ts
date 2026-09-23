import { describe, test, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { EventStore } from '../storage/types'

type Env = { Variables: { store: EventStore } }

describe('GET /health', () => {
  let app: Hono<Env>
  const mockStore = {
    healthCheck: vi.fn(),
  }

  beforeEach(async () => {
    vi.resetModules()
    mockStore.healthCheck.mockReset()

    vi.doMock('../config', () => ({
      config: {
        apiId: 'instantcoffee-observe',
        version: '1.0.0-test',
        gitHash: 'abc1234',
        logLevel: 'debug',
        runtime: 'docker',
        dbPath: '/data/observe.db',
        hostDbPath: '/home/me/instantcoffee-observe/data/observe.db',
        transcriptStats: { enabled: true },
      },
    }))
    vi.doMock('../consumer-tracker', () => ({
      getConsumerCount: vi.fn(() => 3),
    }))
    vi.doMock('../websocket', () => ({
      getClientCount: vi.fn(() => 5),
    }))

    const { default: healthRouter } = await import('./health')
    app = new Hono<Env>()
    app.use('*', async (c, next) => {
      c.set('store', mockStore as unknown as EventStore)
      await next()
    })
    app.route('/api', healthRouter)
  })

  test('returns 200 with ok: true when health check passes', async () => {
    mockStore.healthCheck.mockResolvedValue({ ok: true })

    const res = await app.request('/api/health')
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body).not.toHaveProperty('error')
  })

  test('returns 503 with ok: false and error message when health check fails', async () => {
    mockStore.healthCheck.mockResolvedValue({ ok: false, error: 'db down' })

    const res = await app.request('/api/health')
    expect(res.status).toBe(503)

    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error).toBe('db down')
  })

  test('response includes all expected config fields', async () => {
    mockStore.healthCheck.mockResolvedValue({ ok: true })

    const res = await app.request('/api/health')
    const body = await res.json()

    expect(body).toMatchObject({
      ok: true,
      id: 'instantcoffee-observe',
      version: '1.0.0-test',
      gitHash: 'abc1234',
      logLevel: 'debug',
      runtime: 'docker',
    })
  })

  test('dbPath is the host-side path; the in-container path rides alongside', async () => {
    mockStore.healthCheck.mockResolvedValue({ ok: true })

    const body = await (await app.request('/api/health')).json()

    // The user can't navigate to /data/observe.db on their machine.
    expect(body.dbPath).toBe('/home/me/instantcoffee-observe/data/observe.db')
    expect(body.containerDbPath).toBe('/data/observe.db')
  })

  test('includes activeConsumers from consumer-tracker', async () => {
    mockStore.healthCheck.mockResolvedValue({ ok: true })

    const res = await app.request('/api/health')
    const body = await res.json()

    expect(body.activeConsumers).toBe(3)
  })

  test('includes activeClients from websocket', async () => {
    mockStore.healthCheck.mockResolvedValue({ ok: true })

    const res = await app.request('/api/health')
    const body = await res.json()

    expect(body.activeClients).toBe(5)
  })
})
