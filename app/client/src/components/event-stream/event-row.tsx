import { memo } from 'react'
import { cn } from '@/lib/utils'
import { getEventIcon, getEventColor } from '@/config/event-icons'
import { getEventSummary } from '@/lib/event-summary'
import { getAgentColorById } from '@/lib/agent-utils'
import { AgentLabel } from '@/components/shared/agent-label'
import { useUIStore } from '@/stores/ui-store'
import { EventDetail } from './event-detail'
import { ContextBadge } from './context-badge'
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
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', {
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
  return parts.join(' | ')
}

export const EventRow = memo(function EventRow({
  event,
  agentMap,
  agentColorMap,
  showAgentLabel,
  spawnInfo,
  pairedPayloads,
}: EventRowProps) {
  // Individual selectors so only rows with changing slices re-render.
  // Destructuring from useUIStore() subscribes to the full store state and
  // causes every row to re-render on any store update — a huge perf hit
  // with thousands of rows.
  const isExpanded = useUIStore((s) => s.expandedEventIds.has(event.id))
  const isSelected = useUIStore((s) => s.selectedEventId === event.id)
  // Boolean selector (not the raw id) so only the target row re-renders when
  // flashingEventId changes. Subscribing to the raw id causes all 1000+ rows
  // to re-render on every flash. The flash state lives in the store (not in
  // local React state) so it survives row unmount/remount during virtualizer
  // scrolling — important in rewind mode where target rows can be far away.
  const isFlashing = useUIStore((s) => s.flashingEventId === event.id)
  const toggleExpandedEvent = useUIStore((s) => s.toggleExpandedEvent)
  const setSelectedEventId = useUIStore((s) => s.setSelectedEventId)

  const agent = agentMap.get(event.agentId)
  const isSubagent = agent?.parentAgentId != null
  const parentAgent = agent?.parentAgentId ? agentMap.get(agent.parentAgentId) : null
  const agentColors = getAgentColorById(event.agentId, agentColorMap)
  const Icon = getEventIcon(event.subtype, event.toolName)
  const { iconColor, customHex } = getEventColor(event.subtype, event.toolName)

  const isTool =
    event.subtype === 'PreToolUse' ||
    event.subtype === 'PostToolUse' ||
    event.subtype === 'PostToolUseFailure'
  const isFailure = event.subtype === 'PostToolUseFailure' || event.status === 'failed'
  const isCompleted = event.status === 'completed'
  const isPending = event.status === 'pending' || event.status === 'running'
  // Status icon surfaces on any event that carries a status, not just tools.
  const showStatus = isFailure || isCompleted || isPending

  const rawLabel = isTool ? 'Tool' : event.subtype || event.type
  const displayLabel = LABEL_MAP[rawLabel] || rawLabel
  const displaySummary = getEventSummary(event)
  const isLLM = event.subtype === 'LLMGeneration'

  const handleRowClick = (e: React.MouseEvent) => {
    // Middle-click or ctrl/meta+click: select/deselect the row
    if (e.button === 1 || e.ctrlKey || e.metaKey) {
      e.preventDefault()
      setSelectedEventId(isSelected ? null : event.id)
      return
    }
    // Normal click: toggle expand
    toggleExpandedEvent(event.id)
  }

  return (
    <div
      className={cn(
        'transition-shadow',
        isSelected && 'ring-1 ring-primary/40',
        isFlashing && 'animate-[flash-ring_0.4s_ease-in-out_3]',
      )}
    >
      <button
        className={cn(
          'flex flex-col w-full text-left px-3 py-1.5 border-l-2 transition-colors hover:bg-accent/50 overflow-hidden cursor-pointer',
          isSubagent ? 'bg-muted/20' : '',
          isSelected
            ? 'border-l-primary bg-primary/[0.07] dark:bg-primary/[0.12]'
            : agentColors.border,
        )}
        onClick={handleRowClick}
        onAuxClick={(e) => {
          // Some browsers don't fire onClick for middle-click; onAuxClick covers it.
          if (e.button === 1) handleRowClick(e)
        }}
        onMouseDown={(e) => {
          if (e.button === 1) e.preventDefault()
        }}
        title="Click to expand · Ctrl/⌘-click or middle-click to select"
      >
        {showAgentLabel && (
          <div
            className={cn(
              'text-[10px] opacity-90 dark:opacity-60 leading-tight',
              agentColors.textOnly,
            )}
          >
            {isSubagent ? '↳ ' : ''}
            {agent ? (
              <AgentLabel agent={agent} parentAgent={parentAgent} />
            ) : (
              event.agentId.slice(0, 8)
            )}
          </div>
        )}

        <div className="flex items-center gap-2 w-full min-w-0">
          <span
            className={cn('shrink-0', !customHex && iconColor)}
            style={customHex ? { color: customHex } : undefined}
            title={event.subtype || event.type}
          >
            <Icon className="h-4 w-4" />
          </span>
          <span
            className="text-xs font-medium w-16 shrink-0 truncate text-muted-foreground"
            title={event.subtype || event.type}
          >
            {displayLabel}
          </span>
          {showStatus && (
            <span
              className={cn(
                'shrink-0',
                isFailure
                  ? 'text-red-600 dark:text-red-500'
                  : isCompleted
                    ? 'text-green-600 dark:text-green-500'
                    : 'text-yellow-600 dark:text-yellow-500/70',
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
                'text-xs font-medium shrink-0',
                event.toolName.startsWith('mcp__')
                  ? 'text-cyan-700 dark:text-cyan-400'
                  : 'text-blue-700 dark:text-blue-400',
              )}
            >
              {event.toolName.startsWith('mcp__') ? 'MCP' : event.toolName}
            </span>
          )}
          {isTool && event.toolName?.startsWith('mcp__') && (
            <span className="text-[10px] text-muted-foreground/60 shrink-0">{event.toolName}</span>
          )}
          {isLLM ? (
            <>
              <span className="text-xs text-muted-foreground truncate flex-1 min-w-0 font-mono tabular-nums">
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
          ) : displaySummary.includes('\n') ? (
            <div className="text-xs text-muted-foreground flex-1 min-w-0">
              {displaySummary.split('\n').map((line, i) => (
                <div key={i} className="truncate">
                  {line}
                </div>
              ))}
            </div>
          ) : (
            <span className="text-xs text-muted-foreground truncate flex-1 min-w-0">
              {displaySummary}
            </span>
          )}
          <span className="text-[10px] text-muted-foreground/80 dark:text-muted-foreground/60 tabular-nums shrink-0">
            {formatTime(event.timestamp)}
          </span>
        </div>
      </button>

      {isExpanded && (
        <EventDetail
          event={event}
          agentMap={agentMap}
          spawnInfo={spawnInfo}
          pairedPayloads={pairedPayloads}
        />
      )}
    </div>
  )
})
