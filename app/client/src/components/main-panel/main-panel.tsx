import { useUIStore } from '@/stores/ui-store'
import { useRegionShortcuts } from '@/hooks/use-region-shortcuts'
import { SessionBreadcrumb } from './session-breadcrumb'
import { ScopeBar } from './scope-bar'
import { EventFilterBar } from './event-filter-bar'
import { ActivityTimeline } from '@/components/timeline/activity-timeline'
import { EventStream } from '@/components/event-stream/event-stream'
import { Inspector } from '@/components/event-stream/inspector'
import { DedupedEventsProvider } from '@/hooks/deduped-events-context'
import { HomePage } from './home-page'
import { ProjectPage } from './project-page'
import { InstructionsBrowser } from '@/components/instructions/instructions-browser'
import { StackPage } from '@/components/stack/stack-page'

export function MainPanel() {
  const { selectedProjectId, selectedProjectSlug, selectedSessionId, selectedEventId, routeError } =
    useUIStore()
  const view = useUIStore((s) => s.view)

  useRegionShortcuts({
    regions: [
      { target: 'events', key: 'e', label: 'Event stream' },
      { target: 'search', key: '/', label: 'Search events' },
      { target: 'agents', key: 'a', label: 'Agent filter' },
    ],
  })

  // Instructions view is a distinct top-level surface, independent of the
  // project/session selection state used by the observe dashboard.
  if (view === 'instructions') {
    return <InstructionsBrowser />
  }
  if (view === 'stack') {
    return <StackPage />
  }

  // A session route renders as soon as the session id is known: the session
  // id is the source of truth and its project is resolved (and the URL's
  // project segment rewritten) by useRouteSync in the background. A
  // `#/_/<id>` or legacy `#/<id>` link therefore never shows a blank panel.
  if (!selectedSessionId) {
    // A bare project slug still needs its id resolved from /api/projects.
    // Render nothing in that window rather than flashing HomePage, whose
    // queries would be torn down a tick later.
    if (!selectedProjectId && selectedProjectSlug) {
      if (routeError === selectedProjectSlug) {
        return <RouteNotFound target={selectedProjectSlug} />
      }
      return <div className="flex-1" />
    }
    if (!selectedProjectId) {
      return <HomePage />
    }
    return <ProjectPage />
  }

  // useRouteSync flags an id that resolved to no session, so a dead link
  // says so instead of showing an empty stream.
  if (routeError === selectedSessionId) {
    return <RouteNotFound target={selectedSessionId} />
  }

  return (
    <DedupedEventsProvider>
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
    </DedupedEventsProvider>
  )
}

// A URL naming a session id / project slug that doesn't exist (stale bookmark,
// deleted session, typo).
function RouteNotFound({ target }: { target: string }) {
  const setSelectedProject = useUIStore((s) => s.setSelectedProject)
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center text-muted-foreground">
      <p className="text-sm">
        Nothing found for <span className="font-mono text-foreground">{target}</span>.
      </p>
      <button
        className="text-sm text-foreground underline underline-offset-4 hover:opacity-80 cursor-pointer"
        onClick={() => setSelectedProject(null)}
      >
        Back to dashboard
      </button>
    </div>
  )
}
