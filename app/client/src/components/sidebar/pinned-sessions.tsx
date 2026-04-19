import { useCallback } from 'react'
import { useQueries, useQueryClient } from '@tanstack/react-query'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/stores/ui-store'
import { api } from '@/lib/api-client'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { SessionItem } from './session-item'
import type { Session } from '@/types'

function pinnedInitials(session: Session): string {
  const source = session.slug || session.id
  // Strip leading non-alphanum so a UUID like 0a-... still shows letters when possible
  const cleaned = source.replace(/^[^a-z0-9]+/i, '')
  return cleaned.slice(0, 2).toUpperCase() || source.slice(0, 2).toUpperCase()
}

export function PinnedSessions({ collapsed }: { collapsed: boolean }) {
  const pinnedIds = useUIStore((s) => s.pinnedSessionIds)
  const selectedSessionId = useUIStore((s) => s.selectedSessionId)
  const togglePinnedSession = useUIStore((s) => s.togglePinnedSession)
  const queryClient = useQueryClient()

  const queries = useQueries({
    queries: [...pinnedIds].map((id) => ({
      queryKey: ['session', id],
      queryFn: () => api.getSession(id),
      staleTime: 30_000,
    })),
  })

  const sessions = queries.map((q) => q.data).filter(Boolean) as Session[]

  function selectSession(session: Session) {
    useUIStore.getState().setSelectedProject(session.projectId, session.projectSlug || null)
    useUIStore.getState().setSelectedSessionId(session.id)
  }

  const handleRename = useCallback(
    async (id: string, name: string) => {
      await api.updateSessionSlug(id, name)
      await queryClient.invalidateQueries({ queryKey: ['session', id] })
      await queryClient.invalidateQueries({ queryKey: ['sessions'] })
    },
    [queryClient],
  )

  if (pinnedIds.size === 0) return null

  if (collapsed) {
    return (
      <div className="px-1 py-1 space-y-1">
        {sessions.map((session) => {
          const isActive = session.status === 'active'
          const isSelected = selectedSessionId === session.id
          return (
            <Tooltip key={session.id}>
              <TooltipTrigger asChild>
                <button
                  className={cn(
                    'flex h-8 w-8 mx-auto items-center justify-center rounded-md text-[10px] font-semibold tracking-tight cursor-pointer border',
                    isSelected
                      ? 'bg-primary/10 text-primary border-primary/40'
                      : isActive
                        ? 'border-green-500/40 text-green-600 dark:text-green-400 hover:bg-accent'
                        : 'border-transparent text-muted-foreground hover:bg-accent',
                  )}
                  onClick={() => selectSession(session)}
                >
                  {pinnedInitials(session)}
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">{session.slug || session.id.slice(0, 8)}</TooltipContent>
            </Tooltip>
          )
        })}
      </div>
    )
  }

  return (
    <div className="px-2 py-1">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground/80 dark:text-muted-foreground/60 px-2 pb-0.5 select-none">
        Pinned
      </div>
      {sessions.map((session) => (
        <SessionItem
          key={session.id}
          session={session}
          isSelected={selectedSessionId === session.id}
          isPinned={true}
          onSelect={() => selectSession(session)}
          onTogglePin={() => togglePinnedSession(session.id)}
          onRename={handleRename}
          onEdit={() => useUIStore.getState().setEditingSessionId(session.id)}
          cwd={typeof session.metadata?.cwd === 'string' ? session.metadata.cwd : null}
          showCwd={false}
        />
      ))}
    </div>
  )
}
