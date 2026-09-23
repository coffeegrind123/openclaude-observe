import { useState, useEffect, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Copy, Check, ChevronDown, ChevronRight, Loader, X } from 'lucide-react'
import { api } from '@/lib/api-client'
import { getEventIcon, eventIconId } from '@/config/event-icons'
import { agentClassFor } from '@/agents/registry'
import { cn } from '@/lib/utils'
import { formatRuntime } from '@/lib/runtime'
import { DetailRow } from './detail-parts'
import { useUIStore } from '@/stores/ui-store'
import { useFilterStore } from '@/stores/filter-store'
import { passesAllFilter } from '@/lib/filters/all-filter'
import type { ParsedEvent, Agent } from '@/types'
import type { SpawnInfo } from '@/agents/types'
import type { PairedPayloads } from '@/hooks/use-deduped-events'

interface EventDetailProps {
  event: ParsedEvent
  agentMap: Map<string, Agent>
  /** For an event of a subagent: how that subagent was spawned. */
  spawnInfo?: SpawnInfo
  /** For a spawning tool row: the agent it spawned, and how. */
  spawnedAgentId?: string | null
  spawnedInfo?: SpawnInfo
  pairedPayloads?: PairedPayloads
  runtimeMs?: number | null
}

// Turn-boundary events get the surrounding conversation thread (server-side
// /events/:id/thread: the prompt→Stop window, or the whole subagent).
const THREAD_SUBTYPES = new Set(['UserPromptSubmit', 'Stop', 'SubagentStart', 'SubagentStop'])

/**
 * Event detail shell: the agent class renders the body; the shell adds the
 * runtime, the conversation thread and the raw payload(s).
 */
export function EventDetail({
  event,
  agentMap,
  spawnInfo,
  spawnedAgentId,
  spawnedInfo,
  pairedPayloads,
  runtimeMs,
}: EventDetailProps) {
  const [thread, setThread] = useState<ParsedEvent[] | null>(null)
  const [loadingThread, setLoadingThread] = useState(false)
  const showThread = THREAD_SUBTYPES.has(event.subtype || '')

  useEffect(() => {
    if (!showThread) {
      return
    }
    let cancelled = false
    setLoadingThread(true)
    api
      .getThread(event.id)
      .then((t) => {
        if (!cancelled) {
          setThread(t)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setThread(null)
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingThread(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [event.id, showThread])

  // The thread mirrors the stream: rows the All filter hides there are
  // hidden here, and with Pre/Post merging on a call is one row carrying its
  // final status. Read reactively — both are user settings.
  const compiled = useFilterStore((s) => s.compiled)
  const mergeToolEvents = useUIStore((s) => s.mergeToolEvents)
  const threadRows = useMemo(() => {
    if (!thread) {
      return []
    }
    const visible = thread.filter((e) =>
      passesAllFilter({ hookName: e.subtype, payload: e.payload }, e.toolName, compiled),
    )
    return mergeToolEvents ? dedupeThread(visible) : visible
  }, [thread, compiled, mergeToolEvents])

  // Collapse state is LOCAL to this detail, seeded once from the store's
  // default. Toggling writes the default back so the next detail opens the
  // same way, but never collapses other open details (which would jump the
  // virtualized stream).
  const [threadCollapsed, setThreadCollapsedLocal] = useState(
    () => useUIStore.getState().threadCollapsed,
  )
  const toggleThreadCollapsed = () => {
    const next = !threadCollapsed
    setThreadCollapsedLocal(next)
    const store = useUIStore.getState()
    store.setThreadCollapsed(next)
    // No-op outside the virtualized stream (e.g. in the inspector).
    store.setThreadRemeasureEventId(event.id)
  }

  const agent = agentMap.get(event.agentId)
  const cls = agentClassFor(event, agent)
  const Body = cls.EventDetail

  return (
    <div className="space-y-2 border-t border-border bg-muted/30 px-4 py-2 text-xs">
      <Body
        event={event}
        agentMap={agentMap}
        spawnInfo={spawnInfo}
        spawnedAgentId={spawnedAgentId}
        spawnedInfo={spawnedInfo}
        pairedPayloads={pairedPayloads}
      />

      {runtimeMs != null && <DetailRow label="Runtime" value={formatRuntime(runtimeMs)} />}

      {pairedPayloads ? (
        <>
          <RawPayloadSection
            label={pairedPayloads.pre.subtype}
            timestamp={pairedPayloads.pre.timestamp}
            payload={pairedPayloads.pre.payload}
          />
          {pairedPayloads.post ? (
            <RawPayloadSection
              label={pairedPayloads.post.subtype}
              timestamp={pairedPayloads.post.timestamp}
              payload={pairedPayloads.post.payload}
            />
          ) : (
            <div className="flex items-center gap-1 text-muted-foreground/60">
              <ChevronRight className="h-3 w-3" />
              <span>PostToolUse</span>
              <span className="ml-2 text-[10px] italic">pending</span>
            </div>
          )}
        </>
      ) : (
        <RawPayloadSection
          label="Raw payload"
          timestamp={event.timestamp}
          payload={event.payload}
        />
      )}

      {/* Below the raw payload(s) so they stay reachable without scrolling
          past a long turn. */}
      {showThread && (
        <div>
          <div
            className="mb-1.5 flex cursor-pointer items-center gap-1 font-medium text-muted-foreground transition-colors hover:text-foreground"
            onClick={toggleThreadCollapsed}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                toggleThreadCollapsed()
              }
            }}
            role="button"
            tabIndex={0}
            aria-expanded={!threadCollapsed}
          >
            {threadCollapsed ? (
              <ChevronRight className="h-3 w-3" />
            ) : (
              <ChevronDown className="h-3 w-3" />
            )}
            <span>Conversation thread</span>
            {threadCollapsed && threadRows.length > 0 && (
              <span className="ml-1 text-[10px] tabular-nums text-muted-foreground/70">
                ({threadRows.length})
              </span>
            )}
          </div>
          {!threadCollapsed && (
            <>
              {loadingThread && (
                <div className="py-2 text-muted-foreground/80 dark:text-muted-foreground/60">
                  Loading thread...
                </div>
              )}
              {thread && threadRows.length > 0 && (
                <div
                  className="space-y-0.5 rounded border border-border/50 bg-muted/20 p-1.5"
                  data-testid="thread-rows"
                >
                  {threadRows.map((e) => (
                    <ThreadEvent
                      key={e.id}
                      event={e}
                      agent={agentMap.get(e.agentId)}
                      isCurrentEvent={e.id === event.id}
                      showHookName={!mergeToolEvents}
                    />
                  ))}
                </div>
              )}
              {thread && threadRows.length === 0 && (
                <div className="py-1 text-muted-foreground/80 dark:text-muted-foreground/60">
                  No thread events found
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function formatTimeOfDay(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function RawPayloadSection({
  label,
  timestamp,
  payload,
}: {
  label: string
  timestamp: number
  payload: Record<string, unknown>
}) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    void navigator.clipboard?.writeText(JSON.stringify(payload, null, 2))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div>
      <div
        className="flex cursor-pointer items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
        onClick={() => setOpen(!open)}
        role="button"
        tabIndex={0}
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <span>{label}</span>
        <span className="ml-2 text-[10px] tabular-nums text-muted-foreground/70 dark:text-muted-foreground/60">
          {formatTimeOfDay(timestamp)}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="ml-1 h-5 w-5"
          onClick={(e) => {
            e.stopPropagation()
            handleCopy()
          }}
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
        </Button>
      </div>
      {open && (
        <pre className="mt-1 overflow-x-auto rounded bg-muted/50 p-2 font-mono text-[10px] leading-relaxed">
          {JSON.stringify(payload, null, 2)}
        </pre>
      )}
    </div>
  )
}

// Merge PostToolUse into PreToolUse by toolUseId, same as the main stream.
function dedupeThread(events: ParsedEvent[]): ParsedEvent[] {
  const result: ParsedEvent[] = []
  const toolUseMap = new Map<string, number>()

  for (const e of events) {
    if (e.subtype === 'PreToolUse' && e.toolUseId) {
      toolUseMap.set(e.toolUseId, result.length)
      result.push({ ...e })
      continue
    }
    const isPost = e.subtype === 'PostToolUse' || e.subtype === 'PostToolUseFailure'
    if (isPost && e.toolUseId && toolUseMap.has(e.toolUseId)) {
      const idx = toolUseMap.get(e.toolUseId)!
      result[idx] = {
        ...result[idx],
        status: e.subtype === 'PostToolUseFailure' ? 'failed' : 'completed',
        payload: e.payload,
      }
      continue
    }
    result.push(e)
  }
  return result
}

function ThreadEvent({
  event,
  agent,
  isCurrentEvent,
  showHookName,
}: {
  event: ParsedEvent
  agent?: Agent
  isCurrentEvent: boolean
  /** Unmerged mode: label tool rows with their hook name, like the stream. */
  showHookName: boolean
}) {
  const cls = agentClassFor(event, agent)
  const Icon = getEventIcon(eventIconId(event, agent))
  const toolLabel = cls.toolLabel(event)
  const isTool = toolLabel != null
  const failed = cls.isFailure(event)
  const isCompleted = event.status === 'completed'
  const label = showHookName && isTool && event.subtype ? event.subtype : cls.label(event)

  // Reuses the stream's scroll-to pipeline, which maps a merged Post id to
  // its row and flashes the target. Read from the store at click time — no
  // per-row subscription.
  const scrollToEvent = () => useUIStore.getState().setScrollToEventId(event.id)

  return (
    <div
      role="button"
      tabIndex={0}
      data-event-id={event.id}
      title="Scroll to this event in the stream"
      onClick={scrollToEvent}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          scrollToEvent()
        }
      }}
      className={cn(
        'flex cursor-pointer items-center gap-2 rounded px-2 py-0.5 text-[11px] hover:bg-accent/60',
        isCurrentEvent ? 'bg-primary/10 font-medium' : 'text-muted-foreground',
      )}
    >
      <span className="shrink-0 text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
      </span>
      <span className={cn('shrink-0 truncate', showHookName ? 'w-28' : 'w-14')}>{label}</span>
      {isTool && (
        <span
          className={cn(
            'shrink-0',
            failed
              ? 'text-red-600 dark:text-red-500'
              : isCompleted
                ? 'text-green-600 dark:text-green-500'
                : 'text-yellow-600 dark:text-yellow-500/70',
          )}
        >
          {failed ? (
            <X className="h-3 w-3" />
          ) : isCompleted ? (
            <Check className="h-3 w-3" />
          ) : (
            <Loader className="h-3 w-3" />
          )}
        </span>
      )}
      {isTool && (
        <span className="shrink-0 text-xs font-medium text-blue-700 dark:text-blue-400">
          {toolLabel}
        </span>
      )}
      <span className="flex-1 truncate text-[10px]">{cls.summary(event)}</span>
      <span className="shrink-0 text-[9px] tabular-nums text-muted-foreground/70 dark:text-muted-foreground/50">
        {formatTimeOfDay(event.timestamp)}
      </span>
    </div>
  )
}
