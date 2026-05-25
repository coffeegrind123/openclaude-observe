import { useUIStore } from '@/stores/ui-store'
import { SessionBreadcrumb } from './session-breadcrumb'
import { ScopeBar } from './scope-bar'
import { EventFilterBar } from './event-filter-bar'
import { ActivityTimeline } from '@/components/timeline/activity-timeline'
import { EventStream } from '@/components/event-stream/event-stream'
import { ChatPanel } from '@/components/chat-feed/chat-panel'
import { HomePage } from './home-page'
import { ProjectPage } from './project-page'
import { useRegionShortcuts } from '@/hooks/use-region-shortcuts'

export function MainPanel() {
  const { selectedProjectId, selectedProjectSlug, selectedSessionId } = useUIStore()

  useRegionShortcuts()

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
      <SessionBreadcrumb />
      <ScopeBar />
      <EventFilterBar />
      <ActivityTimeline />
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* key= remounts EventStream on session change so virtualizer state resets cleanly */}
        <EventStream key={selectedSessionId} />
        <ChatPanel />
      </div>
    </div>
  )
}
