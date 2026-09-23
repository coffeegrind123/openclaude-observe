import { memo } from 'react'
import { cn } from '@/lib/utils'
import { getEventIcon, getEventColor } from '@/config/event-icons'
import { agentClassFor } from '@/agents/registry'
import { getAgentColorById, getAgentStreamColorById, getAgentDisplayName } from '@/lib/agent-utils'
import { AgentLabel } from '@/components/shared/agent-label'
import { useUIStore } from '@/stores/ui-store'
import { EventDetail } from './event-detail'
import { ContextBadge } from './context-badge'
import { useTimestampTooltip } from './timestamp-tooltip'
import { formatRuntime } from '@/lib/runtime'
import { Check, X, Loader, CornerDownRight } from 'lucide-react'
import type { ParsedEvent, Agent } from '@/types'
import type { RowBadge, SpawnInfo } from '@/agents/types'
import type { PairedPayloads } from '@/hooks/use-deduped-events'

interface EventRowProps {
  event: ParsedEvent
  agentMap: Map<string, Agent>
  agentColorMap: Map<string, number>
  showAgentLabel: boolean
  /** For an event of a subagent: how that subagent was spawned. */
  spawnInfo?: SpawnInfo
  /** For a spawning tool row: the subagent it spawned. */
  spawnedAgentId?: string | null
  spawnedInfo?: SpawnInfo
  pairedPayloads?: PairedPayloads
  runtimeMs?: number | null
}

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

const BADGE_CLASSES: Record<RowBadge['tone'], string> = {
  accent: 'bg-primary/15 text-primary',
  warn: 'bg-amber-500/20 text-amber-700 dark:text-amber-400',
  fail: 'bg-red-500/15 text-red-700 dark:text-red-400',
  muted: 'bg-muted text-muted-foreground',
}

// Spine geometry — must match the spine line + container padding in
// event-stream.tsx. The bead rides the spine; the timestamp lives in the
// gutter fully left of it; content begins right of the spine.
const SPINE_X = 92
const BEAD = 11

export const EventRow = memo(function EventRow({
  event,
  agentMap,
  agentColorMap,
  showAgentLabel,
  spawnInfo,
  spawnedAgentId,
  spawnedInfo,
  pairedPayloads,
  runtimeMs,
}: EventRowProps) {
  // Individual selectors so only rows with changing slices re-render.
  const isExpanded = useUIStore((s) => s.expandedEventIds.has(event.id))
  const isSelected = useUIStore((s) => s.selectedEventId === event.id)
  const isFlashing = useUIStore((s) => s.flashingEventId === event.id)
  const mergeToolEvents = useUIStore((s) => s.mergeToolEvents)
  const toggleExpandedEvent = useUIStore((s) => s.toggleExpandedEvent)
  const setSelectedEventId = useUIStore((s) => s.setSelectedEventId)
  const { show: showTimestampTooltip, hide: hideTimestampTooltip } = useTimestampTooltip()

  const agent = agentMap.get(event.agentId)
  const isSubagent = agent?.parentAgentId != null
  const parentAgent = agent?.parentAgentId ? agentMap.get(agent.parentAgentId) : null
  const cls = agentClassFor(event, agent)
  const iconId = cls.iconId(event)
  const Icon = getEventIcon(iconId)
  const { iconColor, customHex } = getEventColor(iconId)

  const toolLabel = cls.toolLabel(event)
  const isTool = toolLabel != null
  const isFailure = cls.isFailure(event)
  const isCompleted = event.status === 'completed'
  // Only tool rows have a lifecycle; other events are instantaneous.
  const isPending = isTool && (event.status === 'pending' || event.status === 'running')
  const showStatus = isFailure || (isTool && (isCompleted || isPending))

  const isLLM = event.subtype === 'LLMGeneration'
  const isPrompt = event.subtype === 'UserPromptSubmit'

  // Unmerged, a call's Pre and Post are separate rows: label each with its
  // hook name so the pair reads as two events, not a duplicated call.
  const displayLabel =
    !mergeToolEvents && isTool && event.subtype ? event.subtype : cls.label(event)
  const displaySummary = cls.summary(event)
  const proseText = cls.prose(event)
  const badges = cls.badges(event)

  const spawnedAgent = spawnedAgentId ? agentMap.get(spawnedAgentId) : undefined
  const spawnedName = spawnedAgent
    ? getAgentDisplayName(spawnedAgent)
    : (spawnedInfo?.agentName ?? spawnedAgentId?.slice(0, 8))

  // Agent identity color (main = brand blue; subagents = muted hues). The
  // bead, the agent name, and the subagent rail all key off this.
  const agentCss = getAgentStreamColorById(event.agentId, agentColorMap)
  // text-only Tailwind classes for the agent label (kept consistent with chat)
  const agentTextClass = getAgentColorById(event.agentId, agentColorMap).textOnly

  // Bead color: failures go red, the user prompt rides the brand, everything
  // else takes its agent's identity color.
  const beadColor = isFailure ? 'var(--fail)' : isPrompt ? 'var(--primary)' : agentCss
  const hollow = isTool && !isFailure // tool beads read as hollow rings on the spine

  const handleRowClick = (e: React.MouseEvent) => {
    // Modifier / middle click → expand inline (kept for power users, the
    // expand-all control and keyboard nav). Plain click → select, which pops
    // the detail inspector in on the right.
    if (e.button === 1 || e.ctrlKey || e.metaKey) {
      e.preventDefault()
      toggleExpandedEvent(event.id)
      return
    }
    setSelectedEventId(isSelected ? null : event.id)
  }

  return (
    <div className={cn('relative', isFlashing && 'animate-[flash-ring_0.4s_ease-in-out_3]')}>
      <button
        className={cn(
          'group relative block w-full cursor-pointer py-1 pr-4 text-left transition-colors',
          'hover:bg-foreground/[0.03]',
          isSelected && 'bg-primary/[0.06] dark:bg-primary/[0.10]',
        )}
        style={
          { '--c': agentCss, paddingLeft: SPINE_X + 20 } as React.CSSProperties & {
            '--c': string
          }
        }
        onClick={handleRowClick}
        onAuxClick={(e) => {
          if (e.button === 1) handleRowClick(e)
        }}
        onMouseDown={(e) => {
          if (e.button === 1) e.preventDefault()
        }}
        title="Click to inspect · Ctrl/⌘-click or middle-click to expand inline"
      >
        {/* selection accent bar at the far left edge */}
        {isSelected && (
          <span className="absolute top-0 bottom-0 left-0 w-0.5 bg-primary" aria-hidden />
        )}

        {/* timestamp — gutter, fully left of the spine */}
        <span
          className="absolute top-1.5 left-2 w-[68px] text-right font-mono text-[10px] tabular-nums text-ink-3"
          onMouseEnter={(e) =>
            showTimestampTooltip(event.timestamp, e.currentTarget.getBoundingClientRect())
          }
          onMouseLeave={hideTimestampTooltip}
        >
          {formatTime(event.timestamp)}
        </span>

        {/* bead on the spine */}
        <span
          className="absolute top-[7px]"
          style={{ left: SPINE_X - BEAD / 2 }}
          title={event.subtype || event.type}
        >
          {isPending && (
            <span
              aria-hidden
              className="absolute -inset-1 animate-ping rounded-full"
              style={{ background: beadColor, opacity: 0.25 }}
            />
          )}
          <span
            className={cn('block shadow-bead', isLLM ? 'rotate-45 rounded-[2px]' : 'rounded-full')}
            style={
              hollow
                ? {
                    width: BEAD,
                    height: BEAD,
                    background: 'var(--background)',
                    boxShadow: `inset 0 0 0 2px ${beadColor}`,
                  }
                : { width: BEAD, height: BEAD, background: beadColor }
            }
          />
        </span>

        {/* content — subagents indent behind a faint agent-colored rail */}
        <div
          className={cn('min-w-0', isSubagent && 'border-l-2 pl-2.5')}
          style={isSubagent ? { borderColor: agentCss, opacity: 0.98 } : undefined}
        >
          {/* telemetry header — the machine voice (mono) */}
          <div className="flex items-baseline gap-2 font-mono text-[11.5px] leading-snug">
            {showAgentLabel && (
              <span className={cn('shrink-0 font-semibold', agentTextClass)}>
                {isSubagent ? '↳ ' : ''}
                {agent ? (
                  <AgentLabel agent={agent} parentAgent={parentAgent} />
                ) : (
                  event.agentId.slice(0, 8)
                )}
              </span>
            )}

            {isPrompt ? (
              <span className="shrink-0 font-semibold text-ink-2">{displayLabel}</span>
            ) : (
              <>
                <Icon
                  className={cn('h-3 w-3 shrink-0 translate-y-[1px]', !customHex && iconColor)}
                  style={customHex ? { color: customHex } : undefined}
                />
                <span className="shrink-0 text-ink-3">{displayLabel}</span>
              </>
            )}

            {showStatus && (
              <span
                className={cn(
                  'shrink-0',
                  isFailure ? 'text-fail' : isCompleted ? 'text-run' : 'text-warn',
                )}
              >
                {isFailure ? (
                  <X className="h-3 w-3" />
                ) : isCompleted ? (
                  <Check className="h-3 w-3" />
                ) : (
                  <Loader className="h-3 w-3" />
                )}
              </span>
            )}

            {isTool && (
              <span
                className={cn('shrink-0 font-semibold', isFailure ? 'text-fail' : 'text-primary')}
              >
                {toolLabel}
              </span>
            )}

            {badges.map((b) => (
              <span
                key={b.text}
                className={cn('shrink-0 rounded px-1 text-[10px]', BADGE_CLASSES[b.tone])}
                title={b.title}
              >
                {b.text}
              </span>
            ))}

            {spawnedAgentId && (
              <span
                className="flex shrink-0 items-center gap-0.5 text-[10.5px] text-a-plum"
                title={`Spawned ${spawnedAgentId}`}
                data-testid="spawned-agent"
              >
                <CornerDownRight className="h-3 w-3" />
                {spawnedName}
              </span>
            )}

            {!isPrompt &&
              (isLLM ? (
                <>
                  <span className="min-w-0 flex-1 truncate text-ink-2">{displaySummary}</span>
                  <span
                    className="shrink-0"
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    <ContextBadge
                      sessionId={event.sessionId}
                      agentId={event.agentId}
                      llmEventId={event.id}
                    />
                  </span>
                </>
              ) : (
                <span className="min-w-0 flex-1 truncate text-ink-2">{displaySummary}</span>
              ))}

            {runtimeMs != null && (
              <span className="shrink-0 text-[10px] text-ink-3">{formatRuntime(runtimeMs)}</span>
            )}
          </div>

          {/* prose — the human voice (sans), for conversational events */}
          {proseText && (
            <div
              className={cn(
                'mt-1 line-clamp-4 max-w-[64ch] text-[13px] leading-snug break-words whitespace-pre-wrap',
                isPrompt ? 'text-foreground' : isFailure ? 'text-fail' : 'text-foreground/90',
              )}
            >
              {proseText}
            </div>
          )}
        </div>
      </button>

      {isExpanded && (
        <div style={{ paddingLeft: SPINE_X + 20 }}>
          <EventDetail
            event={event}
            agentMap={agentMap}
            spawnInfo={spawnInfo}
            spawnedAgentId={spawnedAgentId}
            spawnedInfo={spawnedInfo}
            pairedPayloads={pairedPayloads}
            runtimeMs={runtimeMs}
          />
        </div>
      )}
    </div>
  )
})
