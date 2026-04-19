import { useUIStore } from '@/stores/ui-store'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { LogsModal } from './logs-modal'
import { AgentCombobox } from './agent-combobox'
import {
  ArrowDownToLine,
  ArrowUpToLine,
  Pencil,
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
  } = useUIStore()

  if (!selectedProjectId || !selectedSessionId) return null

  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-border min-h-[40px]">
      <AgentCombobox />

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
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Edit session</TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}
