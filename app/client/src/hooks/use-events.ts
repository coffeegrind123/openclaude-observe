import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api-client'

export function useEvents(sessionId: string | null) {
  return useQuery({
    queryKey: ['events', sessionId],
    queryFn: () => api.getEvents(sessionId!),
    enabled: !!sessionId,
    refetchInterval: false,
    // Drop the events array immediately when no component is observing this
    // session — these payloads can be large (10s of MB for big sessions) and
    // letting the default 30s gcTime hold them in memory after navigation is
    // a significant memory cost.
    gcTime: 0,
  })
}
