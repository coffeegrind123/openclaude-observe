// app/server/src/consumer-tracker.ts
// Tracks registered API consumers (MCP processes) with TTL-based expiry so
// /api/health can report how many are connected. The server NEVER shuts itself
// down — it stays up until explicitly stopped (SIGINT/SIGTERM or `just stop`).

import { config } from './config'

const consumers = new Map<string, number>() // id → last heartbeat timestamp

let sweepTimer: ReturnType<typeof setInterval> | null = null

/** Start the periodic sweep that evicts stale consumers (bookkeeping only). */
export function startConsumerSweep() {
  if (sweepTimer) return
  sweepTimer = setInterval(() => {
    const now = Date.now()
    for (const [id, lastSeen] of consumers) {
      if (now - lastSeen > config.consumerTtlMs) {
        consumers.delete(id)
        console.log(`[consumer] Evicted stale consumer ${id}`)
      }
    }
  }, config.sweepIntervalMs)
}

/** Register or refresh a consumer heartbeat. Returns current consumer count. */
export function heartbeat(id: string): number {
  consumers.set(id, Date.now())
  return consumers.size
}

/** Remove a consumer. Returns { activeConsumers }. */
export function deregister(id: string): { activeConsumers: number } {
  consumers.delete(id)
  return { activeConsumers: consumers.size }
}

/** Current consumer count. */
export function getConsumerCount(): number {
  return consumers.size
}
