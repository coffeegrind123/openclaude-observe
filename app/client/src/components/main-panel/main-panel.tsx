import { useUIStore } from '@/stores/ui-store'
import { SessionBreadcrumb } from './session-breadcrumb'
import { ScopeBar } from './scope-bar'
import { EventFilterBar } from './event-filter-bar'
import { ActivityTimeline } from '@/components/timeline/activity-timeline'
import { EventStream } from '@/components/event-stream/event-stream'
import { ChatPanel } from '@/components/chat-feed/chat-panel'
import { HomePage } from './home-page'
import { ProjectPage } from './project-page'

export function MainPanel() {
  const { selectedProjectId, selectedSessionId } = useUIStore()

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
        <EventStream />
        <ChatPanel />
      </div>
    </div>
  )
}
