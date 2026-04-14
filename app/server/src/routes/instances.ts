// app/server/src/routes/instances.ts
import { Hono } from 'hono'
import type { EventStore } from '../storage/types'

type Env = {
  Variables: {
    store: EventStore
  }
}

const router = new Hono<Env>()

// GET /sessions/:id/instances
router.get('/sessions/:id/instances', async (c) => {
  const store = c.get('store')
  const sessionId = c.req.param('id')
  const instances = store.getInstancesForSession(sessionId)
  return c.json(instances)
})

export default router
