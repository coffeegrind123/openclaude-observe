import { useUIStore } from '@/stores/ui-store'
import { ScopeBar } from './scope-bar'
import { EventFilterBar } from './event-filter-bar'
import { ActivityTimeline } from '@/components/timeline/activity-timeline'
import { EventStream } from '@/components/event-stream/event-stream'
import { HomePage } from './home-page'

export function MainPanel() {
  const { selectedProjectId, selectedSessionId } = useUIStore()

  if (!selectedProjectId) {
    return <HomePage />
  }

  if (!selectedSessionId) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        Select a session from the sidebar
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <ScopeBar />
      <EventFilterBar />
      <ActivityTimeline />
      <EventStream />
    </div>
  )
}
