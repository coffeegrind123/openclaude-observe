import { describe, test, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { EventStore } from '../storage/types'

type Env = {
  Variables: {
    store: EventStore
  }
}

describe('agent routes', () => {
  let app: Hono<Env>
  const mockStore = {
    getAgentById: vi.fn(),
    getEventsForAgent: vi.fn(),
  }

  beforeEach(async () => {
    vi.resetModules()
    Object.values(mockStore).forEach((fn) => fn.mockReset())

    vi.doMock('../config', () => ({
      config: { logLevel: 'error' },
    }))

    const { default: agentsRouter } = await import('./agents')
    app = new Hono<Env>()
    app.use('*', async (c, next) => {
      c.set('store', mockStore as unknown as EventStore)
      await next()
    })
    app.route('/api', agentsRouter)
  })

  describe('GET /api/agents/:id', () => {
    test('returns the agent in the client-facing shape', async () => {
      mockStore.getAgentById.mockResolvedValue({
        id: 'agent-1',
        session_id: 'sess-1',
        parent_agent_id: 'root',
        name: 'explorer#abcdef12',
        description: 'dig',
        agent_type: 'explorer',
        agent_class: 'pi',
      })
      const res = await app.request('/api/agents/agent-1')
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({
        id: 'agent-1',
        sessionId: 'sess-1',
        parentAgentId: 'root',
        name: 'explorer#abcdef12',
        description: 'dig',
        agentType: 'explorer',
        agentClass: 'pi',
      })
    })

    test('returns 404 for an unknown agent', async () => {
      mockStore.getAgentById.mockResolvedValue(null)
      const res = await app.request('/api/agents/unknown')
      expect(res.status).toBe(404)
    })
  })

  // Agents are named by the pi extension's events; nothing in the dashboard
  // renames them or reads a per-agent event list, so these unauthenticated
  // endpoints are not served.
  describe('retired endpoints', () => {
    test('PATCH /api/agents/:id is not routed', async () => {
      mockStore.getAgentById.mockResolvedValue({ id: 'agent-1', name: 'old' })
      const res = await app.request('/api/agents/agent-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'new-name' }),
      })
      expect(res.status).toBe(404)
    })

    test('GET /api/agents/:id/events is not routed', async () => {
      mockStore.getEventsForAgent.mockResolvedValue([])
      const res = await app.request('/api/agents/agent-1/events')
      expect(res.status).toBe(404)
      expect(mockStore.getEventsForAgent).not.toHaveBeenCalled()
    })
  })
})
