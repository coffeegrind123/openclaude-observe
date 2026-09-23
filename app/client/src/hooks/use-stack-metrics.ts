import { useEffect } from 'react'
import { api } from '@/lib/api-client'
import { useStackStore } from '@/stores/stack-store'

/**
 * Backfills the stack history once per page load; live samples arrive over the
 * WebSocket (`stack_metrics` / `stack_status`, see use-websocket.ts) and go
 * straight into the store. Safe to call from several components.
 */
export function useStackMetrics(): void {
  const hydrated = useStackStore((s) => s.hydrated)
  const hydrate = useStackStore((s) => s.hydrate)

  useEffect(() => {
    if (hydrated) {
      return
    }
    let cancelled = false
    api
      .getStack()
      .then((view) => {
        if (!cancelled) {
          hydrate(view)
        }
      })
      .catch(() => {
        // The status line shows "Connecting…" until a WS status arrives; a
        // failed backfill only costs the history before this page load.
      })
    return () => {
      cancelled = true
    }
  }, [hydrated, hydrate])
}
