import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api-client'

export function useRecentSessions(limit?: number) {
  return useQuery({
    queryKey: ['recent-sessions', limit],
    queryFn: () => api.getRecentSessions(limit),
    refetchInterval: 10000, // refresh every 10s
  })
}
