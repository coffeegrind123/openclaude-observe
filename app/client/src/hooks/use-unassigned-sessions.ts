import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api-client'

/**
 * Cached fetch of `/api/sessions/unassigned`. Returns sessions that have
 * a NULL `project_id` — they haven't been filed under any project yet.
 * The query stays fresh via WS-driven invalidation in `use-websocket.ts`
 * (session_update + project_update handlers also bust
 * ['unassigned-sessions']).
 */
export function useUnassignedSessions(limit?: number) {
  return useQuery({
    queryKey: ['unassigned-sessions', limit],
    queryFn: () => api.getUnassignedSessions(limit),
  })
}
