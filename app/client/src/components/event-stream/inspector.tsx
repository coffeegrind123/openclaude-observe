import { useMemo } from 'react'
import { X } from 'lucide-react'
import { useUIStore } from '@/stores/ui-store'
import { useEffectiveEvents } from '@/hooks/use-effective-events'
import { useAgents } from '@/hooks/use-agents'
import { useSessionDedupedEvents } from '@/hooks/deduped-events-context'
import { computeRuntimeMs } from '@/lib/runtime'
import { buildAgentColorMap, getAgentStreamColorById, getAgentDisplayName } from '@/lib/agent-utils'
import { EventDetail } from './event-detail'
import { agentClassFor } from '@/agents/registry'
import type { Agent } from '@/types'

function formatTime(ts: number): string {
  const d = new Date(ts)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

/**
 * Right-hand detail inspector. Pops in when an event is selected (the river
 * sets selectedEventId on ⌘/Ctrl/middle-click or row select); the close
 * button deselects, which unmounts the pane and returns the river to full
 * width. Reuses the rich EventDetail renderer (tool viewers, diffs, thread)
 * so every event type keeps its full detail view — now in a focused side
 * panel instead of inline.
 */
export function Inspector() {
  const selectedEventId = useUIStore((s) => s.selectedEventId)
  const setSelectedEventId = useUIStore((s) => s.setSelectedEventId)
  const selectedSessionId = useUIStore((s) => s.selectedSessionId)

  const events = useEffectiveEvents(selectedSessionId).data
  const agents = useAgents(selectedSessionId, events)
  const { spawnInfo, spawnedAgentIds, mergedIdMap, pairedPayloads, deduped } =
    useSessionDedupedEvents()

  const agentMap = useMemo(() => {
    const map = new Map<string, Agent>()
    agents.forEach((a) => map.set(a.id, a))
    return map
  }, [agents])
  const agentColorMap = useMemo(() => buildAgentColorMap(agents), [agents])

  // Prefer the deduped row (a tool call's merged Pre+Post); a raw event id
  // that was merged into another row resolves to that row.
  const event = useMemo(() => {
    if (selectedEventId == null) {
      return null
    }
    const rowId = mergedIdMap.get(selectedEventId) ?? selectedEventId
    return (
      deduped.find((e) => e.id === rowId) ?? events?.find((e) => e.id === selectedEventId) ?? null
    )
  }, [deduped, events, mergedIdMap, selectedEventId])

  if (!event) return null

  const agent = agentMap.get(event.agentId)
  const agentName = agent ? getAgentDisplayName(agent) : event.agentId.slice(0, 8)
  const agentCss = getAgentStreamColorById(event.agentId, agentColorMap)
  const runtimeMs = events ? computeRuntimeMs(event, events) : null
  const cls = agentClassFor(event, agent)
  const label = cls.label(event)
  const toolLabel = cls.toolLabel(event)
  const spawnedAgentId = event.toolUseId ? spawnedAgentIds.get(event.toolUseId) : undefined

  return (
    <aside className="shadow-insp relative z-[1] flex w-[400px] shrink-0 flex-col overflow-hidden bg-card/40">
      <header className="flex items-center gap-2 px-4 py-3">
        <span
          className="h-2.5 w-2.5 shrink-0 rotate-45 rounded-[2px] shadow-bead"
          style={{ background: agentCss }}
          aria-hidden
        />
        <div className="min-w-0">
          <div className="truncate font-mono text-[13px] font-bold" style={{ color: agentCss }}>
            {agentName} · {label}
          </div>
          <div className="font-mono text-[10.5px] text-ink-3">
            {toolLabel ? `${toolLabel} · ` : ''}
            {formatTime(event.timestamp)} · evt #{event.id}
          </div>
        </div>
        <button
          className="ml-auto grid h-6 w-6 shrink-0 place-items-center rounded-sm text-ink-3 transition-colors hover:bg-foreground/5 hover:text-foreground"
          onClick={() => setSelectedEventId(null)}
          title="Close inspector"
          aria-label="Close inspector"
        >
          <X className="h-4 w-4" />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <EventDetail
          event={event}
          agentMap={agentMap}
          spawnInfo={spawnInfo.get(event.agentId)}
          spawnedAgentId={spawnedAgentId}
          spawnedInfo={spawnedAgentId ? spawnInfo.get(spawnedAgentId) : undefined}
          pairedPayloads={pairedPayloads.get(event.id)}
          runtimeMs={runtimeMs}
        />
      </div>
    </aside>
  )
}
