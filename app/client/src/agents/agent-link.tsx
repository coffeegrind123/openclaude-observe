import { Bot, Filter, CornerDownRight } from 'lucide-react'
import { useUIStore } from '@/stores/ui-store'
import { getAgentDisplayName } from '@/lib/agent-utils'
import type { Agent } from '@/types'

/**
 * A subagent reference in a detail view: its name, plus buttons to narrow
 * the stream to it and to jump to a related row (its SubagentStart, or the
 * call that spawned it).
 */
export function AgentLink({
  label,
  agentId,
  agent,
  fallbackName,
  jumpEventId,
  jumpLabel,
}: {
  label: string
  agentId: string
  agent?: Agent
  fallbackName?: string
  jumpEventId?: number
  jumpLabel?: string
}) {
  const setSelectedAgentIds = useUIStore((s) => s.setSelectedAgentIds)
  const setScrollToEventId = useUIStore((s) => s.setScrollToEventId)
  const setSelectedEventId = useUIStore((s) => s.setSelectedEventId)
  const name = agent ? getAgentDisplayName(agent) : (fallbackName ?? agentId.slice(0, 8))

  return (
    <div className="flex gap-2">
      <span className="w-24 shrink-0 text-right text-muted-foreground">{label}:</span>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5" data-testid="agent-link">
        <Bot className="h-3 w-3 shrink-0 text-purple-600 dark:text-purple-400" />
        <span className="truncate font-medium" title={agentId}>
          {name}
        </span>
        <span className="font-mono text-[10px] text-muted-foreground">{agentId.slice(0, 8)}</span>
        <button
          type="button"
          className="inline-flex cursor-pointer items-center gap-0.5 rounded border border-border px-1 text-[10px] text-muted-foreground hover:text-foreground"
          onClick={() => setSelectedAgentIds([agentId])}
          title="Show only this agent's events"
        >
          <Filter className="h-2.5 w-2.5" /> only
        </button>
        {jumpEventId != null && (
          <button
            type="button"
            className="inline-flex cursor-pointer items-center gap-0.5 rounded border border-border px-1 text-[10px] text-muted-foreground hover:text-foreground"
            onClick={() => {
              setScrollToEventId(jumpEventId)
              setSelectedEventId(jumpEventId)
            }}
          >
            <CornerDownRight className="h-2.5 w-2.5" /> {jumpLabel ?? 'jump'}
          </button>
        )}
      </div>
    </div>
  )
}
