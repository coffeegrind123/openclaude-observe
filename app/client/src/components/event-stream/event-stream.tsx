import { useMemo, useRef, useEffect, useDeferredValue, useCallback } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useQuery } from '@tanstack/react-query'
import { useEffectiveEvents } from '@/hooks/use-effective-events'
import { useAgents } from '@/hooks/use-agents'
import { useDedupedEvents } from '@/hooks/use-deduped-events'
import { useCompactions } from '@/hooks/use-compactions'
import { usePermissionModeBackfill } from '@/hooks/use-permission-mode-backfill'
import { getTimelineScrollTo, registerEventStreamScroll, withSyncLock } from '@/lib/scroll-sync'
import { api } from '@/lib/api-client'
import { useUIStore } from '@/stores/ui-store'
import { EventRow } from './event-row'
import { CompactionBoundary } from './compaction-boundary'
import { eventMatchesFilters } from '@/config/filters'
import { format } from 'timeago.js'
import { buildAgentColorMap } from '@/lib/agent-utils'
import { QueryBoundary } from '@/components/shared/query-boundary'
import { EmptyState, Spinner } from '@/components/shared/loading-states'
import type { Agent } from '@/types'

export function EventStream() {
  const {
    selectedSessionId,
    selectedAgentIds,
    activeStaticFilters,
    activeToolFilters,
    searchQuery,
    autoFollow,
    expandAllCounter,
    expandAllEvents,
    selectedEventId,
    rewindMode,
    reverseFeed,
  } = useUIStore()

  // Defer filter values so the UI stays responsive during filter changes
  const deferredStaticFilters = useDeferredValue(activeStaticFilters)
  const deferredToolFilters = useDeferredValue(activeToolFilters)
  const deferredSearchQuery = useDeferredValue(searchQuery)

  const eventsQuery = useEffectiveEvents(selectedSessionId)
  // Defer the event list so React can yield to the browser during the heavy
  // dedupe/filter/render pipeline. On the initial transition from undefined
  // to a large array, React keeps the spinner visible while processing.
  // During streaming, React can skip intermediate values to batch updates.
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

  // Backfill permission_mode into session metadata if missing.
  // Long staleTime — this only needs to run once per session, not on every WS update.
  const { data: sessionForBackfill } = useQuery({
    queryKey: ['session-backfill', selectedSessionId],
    queryFn: () => api.getSession(selectedSessionId!),
    enabled: !!selectedSessionId,
    staleTime: Infinity,
  })
  usePermissionModeBackfill(sessionForBackfill, events, agents)

  const agentMap = useMemo(() => {
    const map = new Map<string, Agent>()
    agents.forEach((a) => map.set(a.id, a))
    return map
  }, [agents])

  const agentColorMap = useMemo(() => buildAgentColorMap(agents), [agents])

  // Dedupe tool events + build spawn map (shared with timeline-rewind)
  const { deduped, spawnToolUseIds, spawnInfo, mergedIdMap, pairedPayloads } =
    useDedupedEvents(events)

  // Pair PreCompact/PostCompact events with flanking LLM tokens so the row can
  // render a rich boundary. Keyed by PreCompact event id.
  const compactionMap = useCompactions(events)
  const postToPreCompactionMap = useMemo(() => {
    const m = new Map<number, number>() // postId -> preId
    for (const info of compactionMap.values()) {
      if (info.postEventId != null) m.set(info.postEventId, info.preEventId)
    }
    return m
  }, [compactionMap])

  // Apply all client-side filters: agent selection + static/tool filters
  const filteredEvents = useMemo(() => {
    let filtered = deduped

    // Agent chip filtering (client-side, includes spawning Tool:Agent calls)
    if (selectedAgentIds.length > 0) {
      const spawnIds = new Set<string>()
      for (const agentId of selectedAgentIds) {
        const toolUseId = spawnToolUseIds.get(agentId)
        if (toolUseId) spawnIds.add(toolUseId)
      }
      filtered = filtered.filter(
        (e) =>
          selectedAgentIds.includes(e.agentId) ||
          (e.toolUseId != null && spawnIds.has(e.toolUseId)),
      )
    }

    // Static + dynamic tool filters
    if (deferredStaticFilters.length > 0 || deferredToolFilters.length > 0) {
      filtered = filtered.filter((e) =>
        eventMatchesFilters(e, deferredStaticFilters, deferredToolFilters),
      )
    }

    // Text search — case-insensitive substring match across key fields and payload
    // Skip search if query is only whitespace (don't trim — users may want leading/trailing spaces)
    if (deferredSearchQuery && deferredSearchQuery.trim().length > 0) {
      const q = deferredSearchQuery.toLowerCase()
      filtered = filtered.filter((e) => {
        if (e.toolName?.toLowerCase().includes(q)) return true
        if (e.subtype?.toLowerCase().includes(q)) return true
        if (e.type?.toLowerCase().includes(q)) return true
        // Search stringified payload
        if (JSON.stringify(e.payload).toLowerCase().includes(q)) return true
        return false
      })
    }

    return filtered
  }, [
    deduped,
    selectedAgentIds,
    spawnToolUseIds,
    deferredStaticFilters,
    deferredToolFilters,
    deferredSearchQuery,
  ])

  // The list actually fed to the virtualizer. When reverseFeed is on, we show
  // newest at top by reversing the chronological array. All virtualizer-index
  // operations (scrollToIndex, findIndex, getItemKey, render) must use this.
  const displayedEvents = useMemo(
    () => (reverseFeed ? [...filteredEvents].reverse() : filteredEvents),
    [filteredEvents, reverseFeed],
  )

  const expandedEventIds = useUIStore((s) => s.expandedEventIds)
  const scrollToEventId = useUIStore((s) => s.scrollToEventId)
  const setScrollToEventId = useUIStore((s) => s.setScrollToEventId)

  const showAgentLabel = agents.length > 1
  const scrollRef = useRef<HTMLDivElement>(null)
  const hasInitiallyScrolled = useRef(false)

  // Virtualizer: only renders rows in (and near) the viewport, so sessions
  // with thousands of events don't destroy performance.
  const virtualizer = useVirtualizer({
    count: displayedEvents.length,
    getScrollElement: () => scrollRef.current,
    // Better height estimate for expanded rows reduces layout shift when
    // scrolling through many expanded items (the gap between 36px estimate
    // and 200px+ actual caused visible jumps as items were measured).
    estimateSize: (index) => {
      const event = displayedEvents[index]
      return event && expandedEventIds.has(event.id) ? 200 : 36
    },
    overscan: 10,
    // Keep a stable key per event so height measurements survive list changes
    getItemKey: (index) => displayedEvents[index]?.id ?? index,
  })

  const virtualItems = virtualizer.getVirtualItems()
  const totalSize = virtualizer.getTotalSize()

  // Re-anchor the initial scroll on session change OR feed-direction change.
  useEffect(() => {
    hasInitiallyScrolled.current = false
  }, [selectedSessionId, reverseFeed])

  // Initial scroll to whichever end holds the newest event.
  useEffect(() => {
    if (!hasInitiallyScrolled.current && displayedEvents.length > 0) {
      if (reverseFeed) {
        virtualizer.scrollToIndex(0, { align: 'start' })
      } else {
        virtualizer.scrollToIndex(displayedEvents.length - 1, { align: 'end' })
      }
      hasInitiallyScrolled.current = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayedEvents.length, reverseFeed])

  // Auto-follow the newest event. With reverseFeed on, "newest" lives at index 0
  // (top of viewport); otherwise it's the last index (bottom).
  useEffect(() => {
    if (autoFollow && displayedEvents.length > 0) {
      if (reverseFeed) {
        virtualizer.scrollToIndex(0, { align: 'start' })
      } else {
        virtualizer.scrollToIndex(displayedEvents.length - 1, { align: 'end' })
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFollow, displayedEvents.length, reverseFeed])

  // When the browser tab is re-activated, rAF throttling while hidden can
  // leave the virtualizer scrolled short of the end. Re-issue scrollToBottom
  // on visibility change so autoFollow catches up with events that arrived
  // while the tab was backgrounded.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      if (!autoFollow) return
      if (filteredEvents.length === 0) return
      requestAnimationFrame(() => {
        virtualizer.scrollToIndex(filteredEvents.length - 1, { align: 'end' })
      })
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFollow, filteredEvents.length])

  // Expand all events when requested from the scope bar
  useEffect(() => {
    if (expandAllCounter > 0 && filteredEvents.length > 0) {
      expandAllEvents(filteredEvents.map((e) => e.id))
    }
  }, [expandAllCounter])

  // ── Rewind mode scroll sync ──────────────────────────────────────────
  // Scrolling the event stream drives the timeline's horizontal scroll.
  // Uses the virtualizer's own knowledge of item positions instead of the
  // DOM, since most rows aren't mounted with virtualization enabled.
  const syncTimelineFromScroll = useCallback(() => {
    const container = scrollRef.current
    if (!container) return
    const top = container.scrollTop
    // Find the first virtual item whose bottom edge is below the viewport top
    const items = virtualizer.getVirtualItems()
    for (const item of items) {
      if (item.start + item.size > top) {
        const event = displayedEvents[item.index]
        if (event) {
          getTimelineScrollTo()?.(event.timestamp)
        }
        return
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayedEvents])

  // Attach scroll listener only while in rewind mode
  useEffect(() => {
    if (!rewindMode) return
    const container = scrollRef.current
    if (!container) return
    const onScroll = () => {
      withSyncLock('event-stream', syncTimelineFromScroll)
    }
    container.addEventListener('scroll', onScroll, { passive: true })
    return () => container.removeEventListener('scroll', onScroll)
  }, [rewindMode, syncTimelineFromScroll])

  // Sticky-to-newest-edge: auto-follow turns on when the user scrolls to the
  // edge where newest events land (top in reverseFeed mode, bottom in
  // chronological), and off as soon as they scroll away. Skipped in rewind
  // mode — autoFollow is frozen there and the timeline-sync listener owns
  // scroll events.
  const setAutoFollow = useUIStore((s) => s.setAutoFollow)
  useEffect(() => {
    if (rewindMode) return
    const container = scrollRef.current
    if (!container) return
    const THRESHOLD = 4
    const onScroll = () => {
      const atNewest = reverseFeed
        ? container.scrollTop <= THRESHOLD
        : container.scrollHeight - container.scrollTop - container.clientHeight <= THRESHOLD
      if (useUIStore.getState().autoFollow !== atNewest) {
        setAutoFollow(atNewest)
      }
    }
    container.addEventListener('scroll', onScroll, { passive: true })
    return () => container.removeEventListener('scroll', onScroll)
  }, [reverseFeed, rewindMode, setAutoFollow])

  // Register the event-stream scroll-to callback for reverse sync.
  // Uses virtualizer.scrollToIndex so the target row gets mounted and measured.
  // Must re-register when filteredEvents changes so the callback sees the
  // current filtered array (otherwise findIndex works on a stale list after
  // a filter change in rewind mode).
  useEffect(() => {
    if (!rewindMode) {
      registerEventStreamScroll(null)
      return
    }
    registerEventStreamScroll((eventId) => {
      const idx = displayedEvents.findIndex((e) => e.id === eventId)
      if (idx >= 0) {
        virtualizer.scrollToIndex(idx, { align: 'start' })
      }
    })
    return () => registerEventStreamScroll(null)
    // virtualizer is stable across renders; intentionally omitted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rewindMode, displayedEvents])

  // Initial sync when entering rewind mode: wait for timeline to mount, then
  // sync timeline to match current event stream scroll position.
  useEffect(() => {
    if (!rewindMode) return
    // Two rAF waits: one for timeline to mount, one for its scroll registration
    let id2: number | null = null
    const id1 = requestAnimationFrame(() => {
      id2 = requestAnimationFrame(() => {
        withSyncLock('event-stream', syncTimelineFromScroll)
      })
    })
    return () => {
      cancelAnimationFrame(id1)
      if (id2 != null) cancelAnimationFrame(id2)
    }
  }, [rewindMode, syncTimelineFromScroll])

  // Auto-scroll to the selected event when the displayed list changes (filters
  // toggled, or feed direction flipped).
  const prevDisplayedRef = useRef(displayedEvents)
  useEffect(() => {
    if (selectedEventId != null && displayedEvents !== prevDisplayedRef.current) {
      const idx = displayedEvents.findIndex((e) => e.id === selectedEventId)
      if (idx >= 0) {
        virtualizer.scrollToIndex(idx, { align: 'center' })
      }
    }
    prevDisplayedRef.current = displayedEvents
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayedEvents, selectedEventId])

  // Scroll to a requested event (set via setScrollToEventId — e.g. timeline dot click).
  // Resolves merged events (PostToolUse → displayed PreToolUse row), scrolls the
  // virtualizer to the target row, then sets flashingEventId so the row pulses.
  // Flash state lives in the store so it survives row unmount/remount during
  // virtualized scrolling — important in rewind mode where target rows can be far.
  const setFlashingEventId = useUIStore((s) => s.setFlashingEventId)
  useEffect(() => {
    if (scrollToEventId == null) return
    // Always clear so the next click of the same dot retriggers
    setScrollToEventId(null)
    // Resolve merged event IDs (PostToolUse id → PreToolUse row id) inline,
    // so a single render handles both the remap and the scroll.
    const resolvedId = mergedIdMap.get(scrollToEventId) ?? scrollToEventId
    const idx = displayedEvents.findIndex((e) => e.id === resolvedId)
    if (idx < 0) return
    virtualizer.scrollToIndex(idx, { align: 'center' })
    setFlashingEventId(resolvedId)
    const timeout = setTimeout(() => {
      // Only clear if we're still flashing this same event (avoid clobbering
      // a newer flash triggered during the timeout window).
      if (useUIStore.getState().flashingEventId === resolvedId) {
        setFlashingEventId(null)
      }
    }, 1200) // matches 3 × 0.4s flash-ring keyframe
    return () => clearTimeout(timeout)
    // virtualizer is stable; intentionally omitted from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollToEventId, displayedEvents, mergedIdMap, setScrollToEventId, setFlashingEventId])

  if (!selectedSessionId) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
        Select a project to view events
      </div>
    )
  }

  const firstTs = filteredEvents[0]?.timestamp
  const lastTs = filteredEvents[filteredEvents.length - 1]?.timestamp
  const rawCount = events?.length ?? 0
  const showRawCount = rawCount !== filteredEvents.length

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <QueryBoundary
        query={displayQuery}
        loading={
          <div className="flex-1 flex items-center justify-center">
            <Spinner label="Loading events..." />
          </div>
        }
        empty={
          <div className="flex-1 flex items-center justify-center">
            <EmptyState text="No events in this session" />
          </div>
        }
        isEmpty={(events) => events.length === 0}
      >
        {() => (
          <>
            <div className="flex items-center gap-2 px-3 py-1 border-b border-border/50 shrink-0">
              <span className="text-xs text-muted-foreground">
                Events: <span className="text-foreground">{filteredEvents.length}</span>
                {showRawCount && (
                  <span className="text-muted-foreground/70 dark:text-muted-foreground/50">
                    {' '}
                    / {rawCount} raw
                  </span>
                )}
              </span>
              {firstTs && lastTs && (
                <span className="text-[10px] text-muted-foreground/70 dark:text-muted-foreground/50">
                  {format(firstTs)} — {format(lastTs)}
                </span>
              )}
            </div>
            <div ref={scrollRef} className="flex-1 overflow-y-auto">
              {displayedEvents.length === 0 ? (
                <EmptyState text="No events match the current filters" />
              ) : (
                <div className="relative" style={{ height: `${totalSize}px`, width: '100%' }}>
                  {virtualItems.map((virtualItem) => {
                    const event = displayedEvents[virtualItem.index]
                    if (!event) return null
                    // Render PreCompact/PostCompact as a distinct boundary card
                    // instead of a normal event row so the compaction reads as
                    // a visual break in the stream.
                    const isPreCompact = event.subtype === 'PreCompact'
                    const isPostCompact = event.subtype === 'PostCompact'
                    const compactionInfo = isPreCompact
                      ? (compactionMap.get(event.id) ?? null)
                      : isPostCompact
                        ? (() => {
                            const preId = postToPreCompactionMap.get(event.id)
                            return preId != null ? (compactionMap.get(preId) ?? null) : null
                          })()
                        : null
                    return (
                      <div
                        key={virtualItem.key}
                        ref={virtualizer.measureElement}
                        data-index={virtualItem.index}
                        className="absolute top-0 left-0 w-full border-b border-border/50"
                        style={{ transform: `translateY(${virtualItem.start}px)` }}
                      >
                        {isPreCompact || isPostCompact ? (
                          <CompactionBoundary
                            event={event}
                            info={compactionInfo}
                            variant={isPreCompact ? 'pre' : 'post'}
                          />
                        ) : (
                          <EventRow
                            event={event}
                            agentMap={agentMap}
                            agentColorMap={agentColorMap}
                            showAgentLabel={showAgentLabel}
                            spawnInfo={spawnInfo.get(event.agentId)}
                            pairedPayloads={pairedPayloads.get(event.id)}
                          />
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </QueryBoundary>
    </div>
  )
}
