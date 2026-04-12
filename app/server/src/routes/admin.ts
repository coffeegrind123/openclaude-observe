// app/server/src/routes/admin.ts
import { Hono } from 'hono'
import { copyFileSync } from 'fs'
import type { EventStore } from '../storage/types'
import { apiError } from '../errors'
import { config } from '../config'
import { removeSessionRootAgent, clearSessionRootAgents } from './events'

type Env = { Variables: { store: EventStore } }

const router = new Hono<Env>()

// DELETE /sessions/:id — delete session and all its data
router.delete('/sessions/:id', async (c) => {
  const store = c.get('store')
  const sessionId = c.req.param('id')
  const deleted = await store.deleteSession(sessionId)
  removeSessionRootAgent(sessionId)
  return c.json({ ok: true, deleted })
})

// DELETE /sessions/:id/events — clear events and agents for a specific session
router.delete('/sessions/:id/events', async (c) => {
  const store = c.get('store')
  const sessionId = c.req.param('id')
  const deleted = await store.clearSessionEvents(sessionId)
  removeSessionRootAgent(sessionId)
  return c.json({ ok: true, deleted })
})

// DELETE /projects/:id — delete a project and all its sessions, agents, events
router.delete('/projects/:id', async (c) => {
  const store = c.get('store')
  const projectId = Number(c.req.param('id'))
  if (isNaN(projectId)) return apiError(c, 400, 'Invalid project ID')
  const { sessionIds, ...deleted } = await store.deleteProject(projectId)
  for (const sessionId of sessionIds) {
    removeSessionRootAgent(sessionId)
  }
  return c.json({ ok: true, deleted })
})

// DELETE /data — delete all data (projects, sessions, agents, events)
// Controlled by AGENTS_OBSERVE_ALLOW_DB_RESET: allow | deny | backup (default)
router.delete('/data', async (c) => {
  const store = c.get('store')
  const policy = config.allowDbReset

  if (policy !== 'allow' && policy !== 'backup') {
    return apiError(c, 403, 'Database reset is disabled', {
      code: 'DB_RESET_DENIED',
      details: 'Set AGENTS_OBSERVE_ALLOW_DB_RESET=allow or backup to enable',
    })
  }

  if (policy === 'backup') {
    const dbPath = config.dbPath
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backupPath = dbPath.replace(/\.db$/, `-${timestamp}.bak.db`)
    try {
      copyFileSync(dbPath, backupPath)
      console.log(`[admin] Database backed up to ${backupPath}`)
    } catch (err) {
      console.error('[admin] Failed to create database backup:', err)
      return apiError(c, 500, 'Failed to create database backup before reset', {
        code: 'BACKUP_FAILED',
      })
    }
  }

  const deleted = await store.clearAllData()
  clearSessionRootAgents()
  return c.json({ ok: true, deleted })
})

export default router
