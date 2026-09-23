import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api-client'

/**
 * Sessions active within the last `windowMs`, newest first — the activity
 * window the Constellation dashboard renders. `since` is computed at fetch
 * time (not baked into the key) so the query key stays stable as the clock
 * moves; WS invalidation of ['recent-sessions'] (session_update /
 * project_update) refreshes it, which also re-applies the moving window.
 *
 * `limit` is a generous safety cap for pathological bursts — the server still
 * bounds by the time window first.
 */
export function useWindowedSessions(windowMs: number, limit = 250) {
  return useQuery({
    queryKey: ['recent-sessions', 'window', windowMs, limit],
    queryFn: () => api.getRecentSessions(limit, Date.now() - windowMs),
  })
}
