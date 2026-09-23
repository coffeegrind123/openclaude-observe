// app/server/src/services/stack-poller.ts
// Process-wide StackPoller, started once from index.ts and read by the
// /api/stack route. Kept separate from stack-metrics.ts so that module stays
// free of config and WebSocket imports (and trivially testable).

import { config } from '../config'
import { broadcastToAll } from '../websocket'
import { StackPoller } from './stack-metrics'

let poller: StackPoller | null = null

export function startStackPoller(): StackPoller {
  if (poller) {
    return poller
  }
  poller = new StackPoller({
    ...config.stack,
    onSample: (sample, totals) =>
      broadcastToAll({ type: 'stack_metrics', data: { sample, totals } }),
    onStatus: (status) => {
      broadcastToAll({ type: 'stack_status', data: status })
      if ((status.state === 'unreachable' || status.state === 'stalled') && config.verbose) {
        console.warn(`[stack] ${status.llamaUrl} ${status.state}: ${status.lastError}`)
      }
    },
  })
  poller.start()
  return poller
}

export function getStackPoller(): StackPoller | null {
  return poller
}
