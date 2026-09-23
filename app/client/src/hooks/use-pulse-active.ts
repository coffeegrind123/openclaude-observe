import { useEffect, useRef, useState } from 'react'
import { useUIStore } from '@/stores/ui-store'

/**
 * Returns true for the user-configured duration (Settings → Display →
 * Sidebar) after the given session last received an activity ping from the
 * server, then flips back to false. Never true while the indicator is off.
 *
 * The pulse counter lives in ui-store and is incremented by the WS handler
 * on every `{ type: 'activity' }` message. We read it here, track changes
 * with a ref, and schedule a timeout to reset `active` back to false.
 */
export function useSessionPulseActive(sessionId: string): boolean {
  const pulseCount = useUIStore((s) => s.sessionPulses[sessionId] ?? 0)
  return usePulseTimer(pulseCount)
}

/**
 * Project-scoped variant. Pulses whenever any session in the project
 * pulses, read from the `projectPulses` counter the WS handler bumps
 * alongside `sessionPulses` — no need for the project's session list.
 */
export function useProjectPulseActive(projectId: number | null | undefined): boolean {
  const pulseCount = useUIStore((s) => (projectId != null ? (s.projectPulses[projectId] ?? 0) : 0))
  return usePulseTimer(pulseCount)
}

/**
 * Variant that aggregates a set of session pulse counters into a single
 * value, so any child pulse re-triggers the timer. For callers that
 * already hold the session-id list; prefer `useProjectPulseActive` for
 * project rollups.
 */
export function useAggregatePulseActive(sessionIds: string[]): boolean {
  const sum = useUIStore((s) => {
    let total = 0
    for (const id of sessionIds) total += s.sessionPulses[id] ?? 0
    return total
  })
  return usePulseTimer(sum)
}

function usePulseTimer(counter: number): boolean {
  const enabled = useUIStore((s) => s.activeIndicatorEnabled)
  const durationMs = useUIStore((s) => s.activeIndicatorSeconds) * 1000
  const prevRef = useRef(counter)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [active, setActive] = useState(false)

  useEffect(() => {
    // Skip the first render when counter is already > 0 — that means
    // the session already pulsed before this component mounted, and we
    // don't want a spurious pulse on mount. The counter is monotonic,
    // so on subsequent renders any change means a real new ping.
    if (counter === prevRef.current) return
    prevRef.current = counter
    if (!enabled) {
      return
    }
    setActive(true)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      setActive(false)
      timerRef.current = null
    }, durationMs)
  }, [counter, enabled, durationMs])

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  // Disabling mid-pulse drops the indicator immediately.
  return enabled ? active : false
}
