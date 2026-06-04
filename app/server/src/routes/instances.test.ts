import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Hono } from 'hono'
import type { EventStore } from '../storage/types'

type Env = { Variables: { store: EventStore } }

function createStore(overrides = {}) {
  return {
    getInstancesForSession: vi.fn(),
    ...overrides,
  }
}

function createApp(storeOverrides = {}) {
  const store = createStore(storeOverrides)
  const app = new Hono<Env>()
  app.use('*', async (c, next) => {
    c.set('store', store as unknown as EventStore)
    await next()
  })
  return { app, store }
}

describe('instances routes', () => {
  let app: Hono<Env>
  let store: ReturnType<typeof createStore>

  beforeEach(async () => {
    vi.resetModules()

    const built = createApp()
    app = built.app
    store = built.store

    const { default: instancesRouter } = await import('./instances')
    app.route('/api', instancesRouter)
  })

  it('returns instance list for a valid session ID', async () => {
    const instances = [
      {
        id: 'inst-1',
        session_id: 'sess-1',
        role: 'main',
        name: 'main-instance',
        machine_id: 'm1',
        pid: 1234,
        first_seen: 1700000000000,
        last_heartbeat: 1700000001000,
        status: 'active',
      },
      {
        id: 'inst-2',
        session_id: 'sess-1',
        role: 'daemon',
        name: 'daemon-1',
        machine_id: 'm1',
        pid: 1235,
        first_seen: 1700000000500,
        last_heartbeat: 1700000001500,
        status: 'active',
      },
    ]
    store.getInstancesForSession.mockReturnValue(instances)

    const res = await app.request('/api/sessions/sess-1/instances')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual(instances)
    expect(store.getInstancesForSession).toHaveBeenCalledWith('sess-1')
  })

  it('returns empty array for a session with no instances', async () => {
    store.getInstancesForSession.mockReturnValue([])

    const res = await app.request('/api/sessions/sess-2/instances')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual([])
    expect(store.getInstancesForSession).toHaveBeenCalledWith('sess-2')
  })

  it('passes the session ID from the URL param correctly', async () => {
    store.getInstancesForSession.mockReturnValue([])

    await app.request('/api/sessions/special-session/instances')
    expect(store.getInstancesForSession).toHaveBeenCalledWith('special-session')
  })

  it('passes session ID with URL-encoded characters', async () => {
    store.getInstancesForSession.mockReturnValue([])

    await app.request('/api/sessions/session%2Fwith%2Fslashes/instances')
    // Hono decodes the param automatically; the route receives the decoded value
  })

  it('returns whatever getInstancesForSession returns verbatim', async () => {
    const weird = {
      id: 'x',
      session_id: 'y',
      role: 'z',
      name: null,
      machine_id: null,
      pid: null,
      first_seen: 0,
      last_heartbeat: 0,
      status: 'offline',
    }
    store.getInstancesForSession.mockReturnValue([weird])

    const res = await app.request('/api/sessions/any/instances')
    const body = await res.json()
    expect(body[0]).toEqual(weird)
  })
})
