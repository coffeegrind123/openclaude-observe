import { useUIStore } from '@/stores/ui-store'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { LogsModal } from './logs-modal'
import { AgentCombobox } from './agent-combobox'
import {
  ArrowDownToLine,
  ArrowUpToLine,
  SquarePen,
  BarChart3,
  ChevronsDownUp,
  ChevronsUpDown,
} from 'lucide-react'

export function ScopeBar() {
  const {
    selectedSessionId,
    autoFollow,
    setAutoFollow,
    expandedEventIds,
    collapseAllEvents,
    requestExpandAll,
    setEditingSessionId,
    reverseFeed,
    talkMode,
    setTalkMode,
    mergeToolEvents,
    setMergeToolEvents,
  } = useUIStore()

  // The session's controls don't depend on its project, which may still be
  // resolving (or absent) when the route came from a `#/_/<id>` link.
  if (!selectedSessionId) return null

  return (
    <div className="flex items-center gap-2 px-4 py-1.5 min-h-[36px]">
      <AgentCombobox />

      {/* View lens — stream (everything) vs talk (conversation only) */}
      <div className="flex items-center gap-3 font-mono text-[11.5px] ml-1">
        {(['stream', 'talk'] as const).map((mode) => {
          const active = (mode === 'talk') === talkMode
          return (
            <button
              key={mode}
              onClick={() => setTalkMode(mode === 'talk')}
              className={cn(
                'cursor-pointer transition-colors',
                active ? 'text-foreground' : 'text-ink-3 hover:text-foreground',
              )}
            >
              {mode}
              <span
                className={cn(
                  'mt-0.5 block h-px transition-colors',
                  active ? 'bg-primary' : 'bg-transparent',
                )}
              />
            </button>
          )
        })}
      </div>

      {/* Unmerged mode is a debugging lens that changes what every tool row
          means, so it stays visible while on. Click re-merges; the setting
          lives in Settings → Display. */}
      {!mergeToolEvents && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => setMergeToolEvents(true)}
              className="shrink-0 cursor-pointer rounded border border-warn/60 px-1.5 font-mono text-[10.5px] text-warn hover:bg-warn/10"
            >
              unmerged
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            Tool calls show PreToolUse and PostToolUse as separate rows. Click to merge them.
          </TooltipContent>
        </Tooltip>
      )}

      <div className="flex items-center gap-1 shrink-0">
        {/* Follow — icon mirrors feed direction (top vs bottom) */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={autoFollow ? 'default' : 'ghost'}
              size="icon"
              className="h-7 w-7"
              onClick={() => setAutoFollow(!autoFollow)}
              aria-label={autoFollow ? 'Disable auto-follow' : 'Enable auto-follow'}
            >
              {reverseFeed ? (
                <ArrowUpToLine className="h-3.5 w-3.5" />
              ) : (
                <ArrowDownToLine className="h-3.5 w-3.5" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {autoFollow ? 'Auto-follow on' : 'Auto-follow off'}
          </TooltipContent>
        </Tooltip>
        {/* Expand/Collapse */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => {
                if (expandedEventIds.size > 0) {
                  collapseAllEvents()
                } else {
                  requestExpandAll()
                }
              }}
              aria-label={expandedEventIds.size > 0 ? 'Collapse all events' : 'Expand all events'}
            >
              {expandedEventIds.size > 0 ? (
                <ChevronsDownUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronsUpDown className="h-3.5 w-3.5" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {expandedEventIds.size > 0 ? 'Collapse all' : 'Expand all'}
          </TooltipContent>
        </Tooltip>
        {/* Logs */}
        <LogsModal />
        {/* Stats */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={() => setEditingSessionId(selectedSessionId, 'stats')}
              aria-label="Session stats"
            >
              <BarChart3 className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Session stats</TooltipContent>
        </Tooltip>
        {/* Edit */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={() => setEditingSessionId(selectedSessionId)}
              aria-label="Edit session"
            >
              <SquarePen className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Edit session</TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}
