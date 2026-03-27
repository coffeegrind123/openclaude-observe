import { useState } from 'react'
import { useEvents } from '@/hooks/use-events'
import { useUIStore } from '@/stores/ui-store'
import { Button } from '@/components/ui/button'
import { Dialog, DialogTrigger, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { ScrollText, Copy, Check } from 'lucide-react'
import { cn } from '@/lib/utils'

export function LogsModal() {
  const { selectedSessionId } = useUIStore()
  const { data: events } = useEvents(selectedSessionId)
  const [copiedId, setCopiedId] = useState<number | null>(null)

  if (!selectedSessionId) return null

  const handleCopy = (id: number, payload: Record<string, unknown>) => {
    navigator.clipboard.writeText(JSON.stringify(payload, null, 2))
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          title="View raw event logs"
        >
          <ScrollText className="h-3.5 w-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="w-[90vw] max-w-5xl h-[85vh] flex flex-col p-0">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <DialogTitle>Raw Event Logs</DialogTitle>
          <span className="text-xs text-muted-foreground">
            {events?.length ?? 0} events
          </span>
        </div>
        <div className="flex-1 overflow-y-auto">
          {events && events.length > 0 ? (
            <div className="divide-y divide-border/30">
              {events.map((event) => {
                const hookName = event.subtype || event.type
                const toolName = event.toolName
                return (
                  <div key={event.id} className="px-4 py-2 hover:bg-muted/30">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-mono font-medium text-primary">
                        {hookName}
                      </span>
                      {toolName && (
                        <span className="text-xs font-mono text-blue-400">
                          {toolName}
                        </span>
                      )}
                      <span className="text-[10px] text-muted-foreground/50 tabular-nums ml-auto">
                        {new Date(event.timestamp).toLocaleTimeString('en-US', {
                          hour12: false,
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })}
                      </span>
                      <button
                        className="text-muted-foreground/50 hover:text-foreground transition-colors"
                        onClick={() => handleCopy(event.id, event.payload)}
                        title="Copy payload"
                      >
                        {copiedId === event.id ? (
                          <Check className="h-3 w-3 text-green-500" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                      </button>
                    </div>
                    <pre className={cn(
                      'text-[10px] font-mono leading-relaxed text-muted-foreground',
                      'overflow-x-auto max-h-60 overflow-y-auto',
                      'rounded bg-muted/40 p-2',
                    )}>
                      {JSON.stringify(event.payload, null, 2)}
                    </pre>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              No events
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
