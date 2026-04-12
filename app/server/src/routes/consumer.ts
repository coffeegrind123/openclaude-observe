// app/server/src/routes/consumer.ts

import { Hono } from 'hono'
import { heartbeat, deregister } from '../consumer-tracker'
import { apiError } from '../errors'

const router = new Hono()

/** Register or refresh a consumer. Body: { id: string } */
router.post('/consumer/heartbeat', async (c) => {
  const body = await c.req.json<{ id?: string }>()
  if (!body.id) {
    return apiError(c, 400, 'id is required')
  }
  const activeConsumers = heartbeat(body.id)
  return c.json({ ok: true, activeConsumers })
})

/** Deregister a consumer. Body: { id: string } */
router.post('/consumer/deregister', async (c) => {
  const body = await c.req.json<{ id?: string }>()
  if (!body.id) {
    return apiError(c, 400, 'id is required')
  }
  const counts = deregister(body.id)
  return c.json({ ok: true, ...counts })
})

export default router
