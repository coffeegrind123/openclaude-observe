// app/server/src/routes/stack.ts
// Inference-stack metrics (llama-server + forge). Live samples also go out
// over the WebSocket as `stack_metrics`; this endpoint backfills history on
// page load.

import { Hono } from 'hono'
import { getStackPoller } from '../services/stack-poller'

const router = new Hono()

router.get('/stack', (c) => {
  const poller = getStackPoller()
  if (!poller) {
    return c.json({ status: { state: 'disabled' }, latest: null, totals: null, samples: [] })
  }
  return c.json(poller.view())
})

export default router
