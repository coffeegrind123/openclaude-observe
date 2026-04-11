// app/server/src/routes/admin.ts
import { Hono } from 'hono'
import type { EventStore } from '../storage/types'
import { removeSessionRootAgent, clearSessionRootAgents } from './events'

type Env = { Variables: { store: EventStore } }

const router = new Hono<Env>()

// DELETE /sessions/:id — delete session and all its data
router.delete('/sessions/:id', async (c) => {
  const store = c.get('store')
  const sessionId = c.req.param('id')
  await store.deleteSession(sessionId)
  removeSessionRootAgent(sessionId)
  return c.json({ ok: true })
})

// DELETE /sessions/:id/events — clear events and agents for a specific session
router.delete('/sessions/:id/events', async (c) => {
  const store = c.get('store')
  const sessionId = c.req.param('id')
  await store.clearSessionEvents(sessionId)
  removeSessionRootAgent(sessionId)
  return c.json({ ok: true })
})

// DELETE /projects/:id — delete a project and all its sessions, agents, events
router.delete('/projects/:id', async (c) => {
  const store = c.get('store')
  const projectId = Number(c.req.param('id'))
  if (isNaN(projectId)) return c.json({ error: 'Invalid project ID' }, 400)
  // Cascade-delete returns the affected session IDs so we can clear their
  // in-memory caches. Without this, ensureRootAgent would still return the
  // cached (now-orphaned) root agent id and insertEvent would fail with a
  // FOREIGN KEY constraint error on the next event for an active session.
  const deletedSessionIds = await store.deleteProject(projectId)
  for (const sessionId of deletedSessionIds) {
    removeSessionRootAgent(sessionId)
  }
  return c.json({ ok: true })
})

// DELETE /data — delete all data (projects, sessions, agents, events)
router.delete('/data', async (c) => {
  const store = c.get('store')
  await store.clearAllData()
  clearSessionRootAgents()
  return c.json({ ok: true })
})

export default router
