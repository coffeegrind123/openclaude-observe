import { createContext, useContext, useDeferredValue } from 'react'
import { useUIStore } from '@/stores/ui-store'
import { useEffectiveEvents } from './use-effective-events'
import { useDedupedEvents, type DedupedEventsResult } from './use-deduped-events'

const DedupedEventsContext = createContext<DedupedEventsResult | null>(null)

/**
 * Runs the dedupe/filter-tag pipeline once for the selected session and
 * shares the result with every consumer (event stream, inspector, filter
 * bar, rewind timeline). Each of those used to call useDedupedEvents on
 * its own, redoing the same work per WS flush.
 *
 * Input is the effective event list (frozen snapshot in rewind mode),
 * deferred so React can yield during large initial loads.
 */
export function DedupedEventsProvider({ children }: { children: React.ReactNode }) {
  const selectedSessionId = useUIStore((s) => s.selectedSessionId)
  const events = useDeferredValue(useEffectiveEvents(selectedSessionId).data)
  const value = useDedupedEvents(events)
  return <DedupedEventsContext.Provider value={value}>{children}</DedupedEventsContext.Provider>
}

/** The selected session's deduped events, from the nearest DedupedEventsProvider. */
export function useSessionDedupedEvents(): DedupedEventsResult {
  const value = useContext(DedupedEventsContext)
  if (!value) {
    throw new Error('useSessionDedupedEvents must be used inside <DedupedEventsProvider>')
  }
  return value
}
