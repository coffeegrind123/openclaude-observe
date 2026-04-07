// app/server/src/consumer-tracker.ts
// Tracks registered API consumers (MCP processes) with TTL-based expiry.
// The server shuts itself down when no consumers and no WS clients remain.

import { getClientCount } from './websocket'
import { config } from './config'

const CONSUMER_TTL_MS = 30_000
const SWEEP_INTERVAL_MS = 10_000
const STARTUP_GRACE_MS = 60_000
const SHUTDOWN_DELAY_MS = 30_000 // Wait 30s after last client/consumer disconnects

const consumers = new Map<string, number>() // id → last heartbeat timestamp
const startedAt = Date.now()
const devMode = config.runtime === 'local'

let sweepTimer: ReturnType<typeof setInterval> | null = null
let shutdownTimer: ReturnType<typeof setTimeout> | null = null

if (devMode) {
  console.log('[consumer] Running in dev mode — auto-shutdown is disabled')
}

/** Start the periodic sweep that evicts stale consumers. */
export function startConsumerSweep() {
  if (sweepTimer) return
  sweepTimer = setInterval(() => {
    const now = Date.now()
    for (const [id, lastSeen] of consumers) {
      if (now - lastSeen > CONSUMER_TTL_MS) {
        consumers.delete(id)
        console.log(`[consumer] Evicted stale consumer ${id}`)
      }
    }
    checkShutdown()
  }, SWEEP_INTERVAL_MS)
}

/** Register or refresh a consumer heartbeat. Returns current consumer count. */
export function heartbeat(id: string): number {
  consumers.set(id, Date.now())
  cancelPendingShutdown()
  return consumers.size
}

/** Remove a consumer. Returns { activeConsumers, activeClients }. */
export function deregister(id: string): { activeConsumers: number; activeClients: number } {
  consumers.delete(id)
  const counts = { activeConsumers: consumers.size, activeClients: getClientCount() }
  checkShutdown()
  return counts
}

/** Current consumer count. */
export function getConsumerCount(): number {
  return consumers.size
}

/** Called when a new WS client connects — cancel any pending shutdown. */
export function cancelPendingShutdown() {
  if (shutdownTimer) {
    clearTimeout(shutdownTimer)
    shutdownTimer = null
    console.log('[consumer] Shutdown cancelled — consumer or client reconnected')
  }
}

/** Check if the server should shut down (no consumers, no WS clients). */
export function checkShutdown() {
  // If anyone is still connected, cancel any pending shutdown
  if (consumers.size > 0 || getClientCount() > 0) {
    cancelPendingShutdown()
    return
  }

  // Within startup grace — don't even start the timer
  if (Date.now() - startedAt < STARTUP_GRACE_MS) {
    console.log('[consumer] No active consumers or clients, but within startup grace period — skipping shutdown')
    return
  }

  if (devMode) {
    return
  }

  // Already have a pending shutdown timer — let it run
  if (shutdownTimer) return

  // Start the shutdown countdown
  console.log(`[consumer] No active consumers or clients — shutting down in ${SHUTDOWN_DELAY_MS / 1000}s unless someone reconnects`)
  shutdownTimer = setTimeout(() => {
    // Final check — someone may have reconnected during the delay
    if (consumers.size > 0 || getClientCount() > 0) {
      console.log('[consumer] Shutdown aborted — consumer or client reconnected during delay')
      shutdownTimer = null
      return
    }
    console.log('[consumer] Shutdown delay expired, no reconnections — shutting down')
    if (sweepTimer) clearInterval(sweepTimer)
    process.exit(0)
  }, SHUTDOWN_DELAY_MS)
}
