import { useMemo, useRef, useEffect, useDeferredValue, useCallback, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { MessageSquare, PanelRightClose, Filter, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/stores/ui-store'
import { useEffectiveEvents } from '@/hooks/use-effective-events'
import { useAgents } from '@/hooks/use-agents'
import { buildAgentColorMap, getAgentDisplayName } from '@/lib/agent-utils'
import { buildChatEntries } from '@/lib/chat-events'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu'
import { EmptyState, Spinner } from '@/components/shared/loading-states'
import { QueryBoundary } from '@/components/shared/query-boundary'
import { ChatMessage } from './chat-message'
import type { Agent } from '@/types'

/**
 * Right-side chat view over the same event stream as EventStream. Filters
 * the OTel events down to the subtypes that read as conversation turns
 * (prompts, assistant replies, subagent spawns/returns, tasks, idle status)
 * and renders them as bubbles grouped by agent color.
 *
 * Auto-follows the newest message unless the user has scrolled up, in which
 * case a "new messages" pill appears.
 */
export function ChatFeed() {
  const selectedSessionId = useUIStore((s) => s.selectedSessionId)
  const reverseFeed = useUIStore((s) => s.reverseFeed)
  const setChatPanelCollapsed = useUIStore((s) => s.setChatPanelCollapsed)
  const autoFollow = useUIStore((s) => s.autoFollow)

  const eventsQuery = useEffectiveEvents(selectedSessionId)
  const events = useDeferredValue(eventsQuery.data)
  const displayQuery = useMemo(
    () => ({
      data: events,
      isLoading: eventsQuery.isLoading || (eventsQuery.data !== undefined && events === undefined),
      isError: eventsQuery.isError,
      error: eventsQuery.error,
    }),
    [events, eventsQuery.data, eventsQuery.isLoading, eventsQuery.isError, eventsQuery.error],
  )

  const agents = useAgents(selectedSessionId, events)
  const agentMap = useMemo(() => {
    const map = new Map<string, Agent>()
    agents.forEach((a) => map.set(a.id, a))
    return map
  }, [agents])
  const agentColorMap = useMemo(() => buildAgentColorMap(agents), [agents])
  const showAgentLabel = agents.length > 1

  // Local filter: which agents to include in the chat view. Empty set = all.
  const [agentFilter, setAgentFilter] = useState<Set<string>>(new Set())
  const toggleAgentFilter = (id: string) =>
    setAgentFilter((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const chatEntries = useMemo(() => {
    const all = buildChatEntries(events)
    if (agentFilter.size === 0) return all
    return all.filter((e) => agentFilter.has(e.event.agentId))
  }, [events, agentFilter])

  const displayedEntries = useMemo(
    () => (reverseFeed ? [...chatEntries].reverse() : chatEntries),
    [chatEntries, reverseFeed],
  )

  // ── Virtualized scrolling ─────────────────────────────────────────────
  const scrollRef = useRef<HTMLDivElement>(null)
  const hasInitiallyScrolled = useRef(false)

  const virtualizer = useVirtualizer({
    count: displayedEntries.length,
    getScrollElement: () => scrollRef.current,
    // Chat bubbles are taller than event rows. 72 is a decent average across
    // short status pills and multi-line assistant messages; virtualizer
    // re-measures once mounted.
    estimateSize: () => 72,
    overscan: 8,
    getItemKey: (index) => displayedEntries[index]?.event.id ?? index,
  })

  const virtualItems = virtualizer.getVirtualItems()
  const totalSize = virtualizer.getTotalSize()

  useEffect(() => {
    hasInitiallyScrolled.current = false
  }, [selectedSessionId, reverseFeed])

  useEffect(() => {
    if (!hasInitiallyScrolled.current && displayedEntries.length > 0) {
      if (reverseFeed) virtualizer.scrollToIndex(0, { align: 'start' })
      else virtualizer.scrollToIndex(displayedEntries.length - 1, { align: 'end' })
      hasInitiallyScrolled.current = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayedEntries.length, reverseFeed])

  // Follow newest message when autoFollow is on. Shared store flag so the
  // chat panel tracks the same "live" vs "paused" state as the event feed.
  useEffect(() => {
    if (autoFollow && displayedEntries.length > 0) {
      if (reverseFeed) virtualizer.scrollToIndex(0, { align: 'start' })
      else virtualizer.scrollToIndex(displayedEntries.length - 1, { align: 'end' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFollow, displayedEntries.length, reverseFeed])

  // ── Header controls ───────────────────────────────────────────────────
  const hasAgentFilter = agentFilter.size > 0

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-1.5 px-3 py-1 border-b border-border/50 shrink-0">
        <MessageSquare className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-xs text-muted-foreground">
          Chat: <span className="text-foreground">{chatEntries.length}</span>
        </span>

        <div className="ml-auto flex items-center gap-0.5">
          {agents.length > 1 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn('h-6 w-6', hasAgentFilter && 'text-primary')}
                  title="Filter agents"
                >
                  <Filter className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="text-xs">Show agents</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {agents.map((agent) => (
                  <DropdownMenuCheckboxItem
                    key={agent.id}
                    checked={agentFilter.size === 0 || agentFilter.has(agent.id)}
                    onCheckedChange={() => toggleAgentFilter(agent.id)}
                    onSelect={(e) => e.preventDefault()}
                  >
                    <span className="truncate">{getAgentDisplayName(agent)}</span>
                  </DropdownMenuCheckboxItem>
                ))}
                {hasAgentFilter && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuCheckboxItem
                      checked={false}
                      onCheckedChange={() => setAgentFilter(new Set())}
                      onSelect={(e) => e.preventDefault()}
                    >
                      <X className="h-3 w-3 mr-1" />
                      Clear filter
                    </DropdownMenuCheckboxItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => setChatPanelCollapsed(true)}
            title="Collapse chat panel"
          >
            <PanelRightClose className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <QueryBoundary
        query={displayQuery}
        loading={
          <div className="flex-1 flex items-center justify-center">
            <Spinner label="Loading chat..." />
          </div>
        }
        empty={
          <div className="flex-1 flex items-center justify-center">
            <EmptyState text="No chat messages in this session" />
          </div>
        }
        isEmpty={() => chatEntries.length === 0}
      >
        {() => (
          <div ref={scrollRef} className="flex-1 overflow-y-auto">
            {displayedEntries.length === 0 ? (
              <EmptyState text="No chat messages match the current filter" />
            ) : (
              <div className="relative" style={{ height: `${totalSize}px`, width: '100%' }}>
                {virtualItems.map((virtualItem) => {
                  const entry = displayedEntries[virtualItem.index]
                  if (!entry) return null
                  return (
                    <div
                      key={virtualItem.key}
                      ref={virtualizer.measureElement}
                      data-index={virtualItem.index}
                      className="absolute top-0 left-0 w-full"
                      style={{ transform: `translateY(${virtualItem.start}px)` }}
                    >
                      <ChatMessage
                        entry={entry}
                        agentMap={agentMap}
                        agentColorMap={agentColorMap}
                        showAgentLabel={showAgentLabel}
                      />
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </QueryBoundary>
    </div>
  )
}
