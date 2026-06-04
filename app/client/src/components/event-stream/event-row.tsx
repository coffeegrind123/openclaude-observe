import { memo } from 'react'
import { cn } from '@/lib/utils'
import { getEventIcon, getEventColor } from '@/config/event-icons'
import { getEventSummary } from '@/lib/event-summary'
import { classifyChatEvent } from '@/lib/chat-events'
import { getAgentColorById, getAgentStreamColorById, getAgentDisplayName } from '@/lib/agent-utils'
import { AgentLabel } from '@/components/shared/agent-label'
import { useUIStore } from '@/stores/ui-store'
import { EventDetail } from './event-detail'
import { ContextBadge } from './context-badge'
import { useTimestampTooltip } from './timestamp-tooltip'
import { formatRuntime } from '@/lib/runtime'
import { Check, X, Loader } from 'lucide-react'
import type { ParsedEvent, Agent } from '@/types'
import type { PairedPayloads } from '@/hooks/use-deduped-events'

export interface SpawnInfo {
  description?: string
  prompt?: string
}

interface EventRowProps {
  event: ParsedEvent
  agentMap: Map<string, Agent>
  agentColorMap: Map<string, number>
  showAgentLabel: boolean
  spawnInfo?: SpawnInfo
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

// Friendly display labels for subtypes
const LABEL_MAP: Record<string, string> = {
  UserPromptSubmit: 'Prompt',
  stop_hook_summary: 'Stop',
  StopFailure: 'Error',
  SubagentStart: 'SubStart',
  SubagentStop: 'SubStop',
  SessionStart: 'Session',
  SessionEnd: 'Session',
  PostToolUseFailure: 'ToolErr',
  PermissionRequest: 'Permit',
  TaskCreated: 'Task',
  TaskCompleted: 'Task',
  TeammateIdle: 'Team',
  InstructionsLoaded: 'Config',
  ConfigChange: 'Config',
  CwdChanged: 'CwdChg',
  FileChanged: 'FileChg',
  PreCompact: 'Compact',
  PostCompact: 'Compact',
  Elicitation: 'MCP',
  ElicitationResult: 'MCP',
  WorktreeCreate: 'Worktree',
  WorktreeRemove: 'Worktree',
  LLMGeneration: 'LLM',
  DaemonStart: 'Start',
  DaemonStop: 'Stop',
  DaemonHeartbeat: 'Beat',
  PipeRoleAssigned: 'PipeRole',
  PipeAttach: 'Attach',
  PipeDetach: 'Detach',
  PipePromptRouted: 'Route',
  PipePermissionForward: 'PipePerm',
  PipeLanPeerDiscovered: 'LANPeer',
  CoordinatorDispatch: 'Dispatch',
  CoordinatorResult: 'Result',
  BridgeConnected: 'Connect',
  BridgeDisconnected: 'Disconn',
  BridgeWorkReceived: 'BrgWork',
  SuperModeToggle: 'Super',
  CompactionRun: 'Compact',
  CostUpdate: 'Cost',
  ToolBatch: 'Batch',
  PermissionDenied: 'Denied',
}

function formatTokens(n: unknown): string {
  if (typeof n !== 'number' || n === 0) return '0'
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
  return String(n)
}

function llmSummary(payload: Record<string, unknown>): string | null {
  // Prefer the upstream-reported model (e.g. glm-4.6 when z.ai re-routes
  // claude-sonnet-4-6) over the request model so the row label matches
  // what actually ran.
  const model =
    (payload.actual_model as string | undefined) ?? (payload.model as string | undefined)
  const inputTokens = payload.input_tokens as number | undefined
  const outputTokens = payload.output_tokens as number | undefined
  const cacheRead = payload.cache_read_tokens as number | undefined
  const durationMs = payload.duration_ms as number | undefined
  if (!model && inputTokens == null) return null
  const parts: string[] = []
  if (model) parts.push(model)
  const tokenParts: string[] = []
  if (inputTokens != null) tokenParts.push(`in:${formatTokens(inputTokens)}`)
  if (outputTokens != null) tokenParts.push(`out:${formatTokens(outputTokens)}`)
  if (cacheRead != null && inputTokens != null && cacheRead + inputTokens > 0) {
    const pct = Math.round((cacheRead / (cacheRead + inputTokens)) * 100)
    tokenParts.push(`cache:${pct}%`)
  }
  if (tokenParts.length) parts.push(tokenParts.join(' '))
  if (durationMs != null) parts.push(`${(durationMs / 1000).toFixed(1)}s`)
  return parts.join(' · ')
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
  pairedPayloads,
  runtimeMs,
}: EventRowProps) {
  // Individual selectors so only rows with changing slices re-render.
  const isExpanded = useUIStore((s) => s.expandedEventIds.has(event.id))
  const isSelected = useUIStore((s) => s.selectedEventId === event.id)
  const isFlashing = useUIStore((s) => s.flashingEventId === event.id)
  const toggleExpandedEvent = useUIStore((s) => s.toggleExpandedEvent)
  const setSelectedEventId = useUIStore((s) => s.setSelectedEventId)
  const { show: showTimestampTooltip, hide: hideTimestampTooltip } = useTimestampTooltip()

  const agent = agentMap.get(event.agentId)
  const isSubagent = agent?.parentAgentId != null
  const parentAgent = agent?.parentAgentId ? agentMap.get(agent.parentAgentId) : null
  const Icon = getEventIcon(event.subtype, event.toolName)
  const { iconColor, customHex } = getEventColor(event.subtype, event.toolName)

  const isTool =
    event.subtype === 'PreToolUse' ||
    event.subtype === 'PostToolUse' ||
    event.subtype === 'PostToolUseFailure'
  const isFailure = event.subtype === 'PostToolUseFailure' || event.status === 'failed'
  const isCompleted = event.status === 'completed'
  const isPending = event.status === 'pending' || event.status === 'running'
  const showStatus = isFailure || isCompleted || isPending

  const isLLM = event.subtype === 'LLMGeneration'
  const isPrompt = event.subtype === 'UserPromptSubmit'

  const rawLabel = isTool ? 'Tool' : event.subtype || event.type
  const displayLabel = LABEL_MAP[rawLabel] || rawLabel
  const displaySummary = getEventSummary(event)

  // Human-voice prose pulled into the river so the "talk" lens reads as a
  // conversation. Skip the Stop family's last_assistant_message — it would
  // duplicate the LLM row's response_preview shown just above it.
  const chatMsg = classifyChatEvent(event)
  let proseText: string | null = null
  if (chatMsg) {
    if (chatMsg.kind === 'user') proseText = chatMsg.text
    else if (chatMsg.kind === 'assistant' && isLLM) proseText = chatMsg.text || null
    else if (chatMsg.kind === 'subagent-start') proseText = chatMsg.prompt || chatMsg.description || null
    else if (chatMsg.kind === 'subagent-stop') proseText = chatMsg.text || null
    else if (chatMsg.kind === 'task') proseText = chatMsg.description || null
    else if (chatMsg.kind === 'status') proseText = chatMsg.reason || null
  }

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
            className={cn(
              'block shadow-bead',
              isLLM ? 'rotate-45 rounded-[2px]' : 'rounded-full',
            )}
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
              <span className="shrink-0 font-semibold text-ink-2">you</span>
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

            {isTool && event.toolName && (
              <span
                className={cn(
                  'shrink-0 font-semibold',
                  event.toolName.startsWith('mcp__') ? 'text-a-slate' : 'text-primary',
                )}
              >
                {event.toolName.startsWith('mcp__') ? 'MCP' : event.toolName}
              </span>
            )}

            {!isPrompt &&
              (isLLM ? (
                <>
                  <span className="min-w-0 flex-1 truncate text-ink-2">
                    {llmSummary(event.payload) || displaySummary}
                  </span>
                  <span
                    className="shrink-0"
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    <ContextBadge sessionId={event.sessionId} llmEventId={event.id} />
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
                isPrompt ? 'text-foreground' : 'text-foreground/90',
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
            pairedPayloads={pairedPayloads}
            runtimeMs={runtimeMs}
          />
        </div>
      )}
    </div>
  )
})
