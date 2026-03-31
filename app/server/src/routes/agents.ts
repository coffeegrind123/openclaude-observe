// app/server/src/routes/agents.ts
import { Hono } from 'hono'
import type { EventStore } from '../storage/types'
import type { ParsedEvent } from '../types'
import { config } from '../config'

type Env = { Variables: { store: EventStore } }

const LOG_LEVEL = config.logLevel

const router = new Hono<Env>()

// GET /agents/:id/events
router.get('/agents/:id/events', async (c) => {
  const store = c.get('store')
  const agentId = decodeURIComponent(c.req.param('id'))
  const rows = await store.getEventsForAgent(agentId)
  const events: ParsedEvent[] = rows.map((r) => ({
    id: r.id,
    agentId: r.agent_id,
    sessionId: r.session_id,
    type: r.type,
    subtype: r.subtype,
    toolName: r.tool_name,
    toolUseId: r.tool_use_id || null,
    status: r.status || 'pending',
    timestamp: r.timestamp,
    payload: JSON.parse(r.payload),
  }))
  return c.json(events)
})

// GET /agents/:id
router.get('/agents/:id', async (c) => {
  const store = c.get('store')
  const agentId = decodeURIComponent(c.req.param('id'))
  const row = await store.getAgentById(agentId)
  if (!row) return c.json({ error: 'Agent not found' }, 404)
  return c.json({
    id: row.id,
    sessionId: row.session_id,
    parentAgentId: row.parent_agent_id,
    name: row.name,
    description: row.description,
    agentType: row.agent_type || null,
  })
})

// POST /agents/:id/metadata
router.post('/agents/:id/metadata', async (c) => {
  const store = c.get('store')

  try {
    const agentIdParam = decodeURIComponent(c.req.param('id'))
    const data = (await c.req.json()) as Record<string, unknown>

    if (data.name && typeof data.name === 'string') {
      await store.updateAgentName(agentIdParam, data.name)

      if (LOG_LEVEL === 'debug') {
        console.log(`[METADATA] Agent ${agentIdParam.slice(0, 8)} name: ${data.name}`)
      }
    }

    if (data.agentType && typeof data.agentType === 'string') {
      await store.updateAgentType(agentIdParam, data.agentType)
    }

    return c.json({ ok: true })
  } catch {
    return c.json({ error: 'Invalid request' }, 400)
  }
})

export default router
