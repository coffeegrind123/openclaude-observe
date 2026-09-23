import { useEffect, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api-client'
import type { Agent, ServerAgent, ParsedEvent } from '@/types'
import { agentClassFor } from '@/agents/registry'
import type { AgentIdentity } from '@/agents/types'

// Module-level dedup — shared across all useAgents instances so multiple
// components (event-stream, combobox, timeline) don't each fire a fetch
// for the same unknown agent.
const pendingFetches = new Set<string>()

/**
 * Derives full Agent objects from server metadata + events.
 * Status, eventCount, and timing are computed from events.
 * Detects unknown agents and fetches their metadata on demand — that
 * fetch is a side effect and lives in a useEffect, not the render-time
 * useMemo that builds the Agent[] (React's rules: pure renders, side
 * effects in useEffect).
 */
export function useAgents(sessionId: string | null, events: ParsedEvent[] | undefined): Agent[] {
  const queryClient = useQueryClient()

  const { data: serverAgents } = useQuery({
    queryKey: ['agents', sessionId],
    queryFn: () => api.getAgents(sessionId!),
    enabled: !!sessionId,
  })

  // Pure render: compute per-agent stats from events. No side effects.
  const agentStats = useMemo(() => {
    const stats = new Map<
      string,
      {
        eventCount: number
        firstEventAt: number
        lastEventAt: number
        lastStoppedAt: number // timestamp of last stop signal, 0 if never
        cwd: string | null
        agentClass: string | null
        identity: AgentIdentity | null
      }
    >()
    if (!events) return stats
    // A subagent's own SubagentStop ends it; Stop / SessionEnd end the root turn.
    const stopSubtypes = new Set(['Stop', 'SessionEnd', 'SubagentStop'])
    for (const e of events) {
      let s = stats.get(e.agentId)
      if (!s) {
        s = {
          eventCount: 0,
          firstEventAt: e.timestamp,
          lastEventAt: e.timestamp,
          lastStoppedAt: 0,
          cwd: null,
          agentClass: null,
          identity: null,
        }
        stats.set(e.agentId, s)
      }
      if (!s.agentClass && typeof (e.payload as any)?.agent_class === 'string') {
        s.agentClass = (e.payload as any).agent_class
      }
      // Payload-declared identity (pi: agent_id, agent_name, parent_agent_id…)
      // stands in until the server's agent row arrives.
      if (!s.identity) {
        const identity = agentClassFor(e).identity(e)
        if (identity && identity.agentId === e.agentId) {
          s.identity = identity
        }
      }
      if (!s.cwd && typeof (e.payload as any)?.cwd === 'string') {
        s.cwd = (e.payload as any).cwd
      }
      s.eventCount++
      if (e.timestamp < s.firstEventAt) s.firstEventAt = e.timestamp
      if (e.timestamp > s.lastEventAt) s.lastEventAt = e.timestamp
      if (stopSubtypes.has(e.subtype ?? '')) {
        s.lastStoppedAt = Math.max(s.lastStoppedAt, e.timestamp)
      }
    }
    return stats
  }, [events])

  // Side effect: for every agentId seen in events but not present in
  // serverAgents, fetch the metadata and patch it into the ['agents',
  // sessionId] cache.
  //
  // Gate on `serverAgents !== undefined` so we don't fire one
  // /api/agents/:id call per event-derived agent before the bulk
  // /api/sessions/:id/agents response has even returned. Without this,
  // a session with N agents that received events before the bulk fetch
  // completed could trigger N individual lazy-fetches that the bulk
  // response would have covered.
  useEffect(() => {
    if (!sessionId || agentStats.size === 0) return
    if (serverAgents === undefined) return // wait for the bulk fetch
    const serverIds = new Set<string>()
    for (const a of serverAgents) serverIds.add(a.id)
    for (const agentId of agentStats.keys()) {
      if (serverIds.has(agentId)) continue
      if (pendingFetches.has(agentId)) continue
      pendingFetches.add(agentId)
      api
        .getAgent(agentId)
        .then((agent) => {
          queryClient.setQueryData<ServerAgent[]>(['agents', sessionId], (old) => {
            if (!old) return [agent]
            if (old.some((a) => a.id === agent.id)) {
              return old.map((a) => (a.id === agent.id ? agent : a))
            }
            return [...old, agent]
          })
        })
        .catch(() => {})
    }
  }, [agentStats, serverAgents, sessionId, queryClient])

  // Pure render: merge event-derived stats with server metadata.
  return useMemo(() => {
    const serverMap = new Map<string, ServerAgent>()
    if (serverAgents) for (const a of serverAgents) serverMap.set(a.id, a)
    const result: Agent[] = []
    for (const [agentId, s] of agentStats) {
      const server = serverMap.get(agentId)
      const identity = s.identity
      result.push({
        id: agentId,
        sessionId: sessionId || '',
        parentAgentId: server ? server.parentAgentId : (identity?.parentAgentId ?? null),
        description: server?.description ?? identity?.description ?? null,
        name: server?.name ?? identity?.name ?? null,
        agentType: server?.agentType ?? identity?.agentType ?? null,
        agentClass: server?.agentClass ?? s.agentClass,
        // Agent is stopped if the last stop signal came after or at the last activity
        status: s.lastStoppedAt >= s.lastEventAt ? 'stopped' : 'active',
        eventCount: s.eventCount,
        firstEventAt: s.firstEventAt,
        lastEventAt: s.lastEventAt,
        cwd: s.cwd,
      })
    }
    return result
  }, [agentStats, serverAgents, sessionId])
}
