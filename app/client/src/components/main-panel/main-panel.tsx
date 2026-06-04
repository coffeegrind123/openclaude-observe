import { useUIStore } from '@/stores/ui-store'
import { useRegionShortcuts } from '@/hooks/use-region-shortcuts'
import { SessionBreadcrumb } from './session-breadcrumb'
import { ScopeBar } from './scope-bar'
import { EventFilterBar } from './event-filter-bar'
import { ActivityTimeline } from '@/components/timeline/activity-timeline'
import { EventStream } from '@/components/event-stream/event-stream'
import { Inspector } from '@/components/event-stream/inspector'
import { HomePage } from './home-page'
import { ProjectPage } from './project-page'

export function MainPanel() {
  const { selectedProjectId, selectedProjectSlug, selectedSessionId, selectedEventId } =
    useUIStore()

  useRegionShortcuts({
    regions: [
      { target: 'events', key: 'e', label: 'Event stream' },
      { target: 'search', key: '/', label: 'Search events' },
      { target: 'agents', key: 'a', label: 'Agent filter' },
    ],
  })

  // The URL hash populates `selectedProjectSlug` / `selectedSessionId`
  // synchronously on store init, but `selectedProjectId` is resolved
  // asynchronously by `useRouteSync` once /api/projects (and possibly
  // /api/sessions/:id) has returned. Don't flash HomePage in that
  // window — it triggers /api/sessions/recent and other home-page
  // queries that get torn down a tick later.
  const isResolvingRoute = !selectedProjectId && (!!selectedProjectSlug || !!selectedSessionId)
  if (isResolvingRoute) {
    return <div className="flex-1" />
  }

  if (!selectedProjectId) {
    return <HomePage />
  }

  if (!selectedSessionId) {
    return <ProjectPage />
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header cluster — grouped under one soft shadow instead of stacked
          divider lines, so the chrome reads as a single floating surface
          above the river (matches the Stream design language). */}
      <div className="shadow-float relative z-10">
        <SessionBreadcrumb />
        <ScopeBar />
        <EventFilterBar />
      </div>
      <ActivityTimeline />
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* key= remounts EventStream on session change so virtualizer state resets cleanly */}
        <EventStream key={selectedSessionId} />
        {/* Detail inspector pops in when an event is selected (⌘/Ctrl/middle-click
            a row, or click its select affordance); close returns the river to
            full width. Replaces the old standalone chat panel — the conversation
            now lives in the river via the stream↔talk lens. */}
        {selectedEventId != null && <Inspector />}
      </div>
    </div>
  )
}
