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
    selectedProjectId,
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
  } = useUIStore()

  if (!selectedProjectId || !selectedSessionId) return null

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
