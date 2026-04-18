import { memo } from 'react'
import { cn } from '@/lib/utils'
import { getAgentColorById, getAgentDisplayName } from '@/lib/agent-utils'
import { useUIStore } from '@/stores/ui-store'
import { AgentLabel } from '@/components/shared/agent-label'
import {
  CheckCircle2,
  Circle,
  CircleDot,
  UserRound,
  Sparkles,
  SquareArrowOutUpRight,
  SquareArrowDownLeft,
  PauseCircle,
} from 'lucide-react'
import type { Agent, ParsedEvent } from '@/types'
import type { ChatEntry } from '@/lib/chat-events'
import { ChatMarkdown } from './chat-markdown'

interface ChatMessageProps {
  entry: ChatEntry
  agentMap: Map<string, Agent>
  agentColorMap: Map<string, number>
  showAgentLabel: boolean
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function MessageHeader({
  event,
  agent,
  parentAgent,
  agentColorText,
  label,
  icon,
}: {
  event: ParsedEvent
  agent: Agent | undefined
  parentAgent: Agent | null
  agentColorText: string
  label: string
  icon: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
      <span className={cn('flex items-center gap-1', agentColorText)}>
        {icon}
        <span className="font-medium">
          {agent ? (
            <AgentLabel agent={agent} parentAgent={parentAgent}>
              {label}
            </AgentLabel>
          ) : (
            label
          )}
        </span>
      </span>
      <span className="tabular-nums opacity-70">{formatTime(event.timestamp)}</span>
    </div>
  )
}

/**
 * A single chat bubble. Picks its layout and colors from the classified
 * message kind. All bubbles share the same container so they scroll/flow
 * uniformly regardless of sender.
 */
export const ChatMessage = memo(function ChatMessage({
  entry,
  agentMap,
  agentColorMap,
  showAgentLabel,
}: ChatMessageProps) {
  const { event, message } = entry
  const agent = agentMap.get(event.agentId)
  const parentAgent = agent?.parentAgentId ? (agentMap.get(agent.parentAgentId) ?? null) : null
  const agentColors = getAgentColorById(event.agentId, agentColorMap)

  const selectedEventId = useUIStore((s) => s.selectedEventId)
  const setSelectedEventId = useUIStore((s) => s.setSelectedEventId)
  const isFlashing = useUIStore((s) => s.flashingEventId === event.id)
  const isSelected = selectedEventId === event.id
  const onSelect = () => setSelectedEventId(isSelected ? null : event.id)

  const displayName = agent ? getAgentDisplayName(agent) : event.agentId.slice(0, 8)

  // User messages: right-aligned on sessions with multiple agents so the eye
  // can distinguish "what the user asked" from "what agents said".
  if (message.kind === 'user') {
    return (
      <div
        className={cn(
          'px-3 py-1.5 flex flex-col items-end gap-1 transition-shadow',
          isSelected && 'ring-1 ring-primary/40',
          isFlashing && 'animate-[flash-ring_0.4s_ease-in-out_3]',
        )}
        onClick={onSelect}
      >
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <span className="tabular-nums opacity-70">{formatTime(event.timestamp)}</span>
          <span className="flex items-center gap-1 text-foreground/80">
            <span className="font-medium">You</span>
            <UserRound className="h-3 w-3" />
          </span>
        </div>
        <div className="max-w-[85%] rounded-lg bg-primary/10 dark:bg-primary/15 px-2.5 py-1.5 text-xs break-words text-foreground overflow-hidden">
          <ChatMarkdown text={message.text} />
        </div>
      </div>
    )
  }

  if (message.kind === 'assistant') {
    return (
      <div
        className={cn(
          'px-3 py-1.5 flex flex-col items-start gap-1 transition-shadow cursor-pointer',
          isSelected && 'ring-1 ring-primary/40',
          isFlashing && 'animate-[flash-ring_0.4s_ease-in-out_3]',
        )}
        onClick={onSelect}
      >
        <MessageHeader
          event={event}
          agent={agent}
          parentAgent={parentAgent}
          agentColorText={agentColors.textOnly}
          label={showAgentLabel ? displayName : 'Assistant'}
          icon={<Sparkles className="h-3 w-3" />}
        />
        <div
          className={cn(
            'max-w-[90%] rounded-lg border px-2.5 py-1.5 text-xs break-words text-foreground bg-card overflow-hidden',
            message.failed
              ? 'border-red-500/40 bg-red-500/5'
              : cn(agentColors.border, 'bg-muted/30'),
          )}
        >
          <ChatMarkdown text={message.text} />
        </div>
      </div>
    )
  }

  if (message.kind === 'subagent-start') {
    const title = message.agentName || message.description || 'subagent'
    return (
      <div
        className={cn(
          'px-3 py-1 cursor-pointer transition-shadow',
          isSelected && 'ring-1 ring-primary/40',
          isFlashing && 'animate-[flash-ring_0.4s_ease-in-out_3]',
        )}
        onClick={onSelect}
      >
        <MessageHeader
          event={event}
          agent={agent}
          parentAgent={parentAgent}
          agentColorText={agentColors.textOnly}
          label={showAgentLabel ? displayName : 'spawned'}
          icon={<SquareArrowOutUpRight className="h-3 w-3" />}
        />
        <div
          className={cn(
            'mt-1 rounded-md border-l-2 pl-2.5 pr-2 py-1 bg-muted/20',
            agentColors.border,
          )}
        >
          <div className="text-xs font-medium text-foreground/90">→ {title}</div>
          {message.prompt && (
            <div className="mt-0.5 text-[11px] text-muted-foreground whitespace-pre-wrap break-words line-clamp-4">
              {message.prompt}
            </div>
          )}
        </div>
      </div>
    )
  }

  if (message.kind === 'subagent-stop') {
    const title = message.agentName || displayName
    return (
      <div
        className={cn(
          'px-3 py-1 cursor-pointer transition-shadow',
          isSelected && 'ring-1 ring-primary/40',
          isFlashing && 'animate-[flash-ring_0.4s_ease-in-out_3]',
        )}
        onClick={onSelect}
      >
        <MessageHeader
          event={event}
          agent={agent}
          parentAgent={parentAgent}
          agentColorText={agentColors.textOnly}
          label={title}
          icon={<SquareArrowDownLeft className="h-3 w-3" />}
        />
        {message.text ? (
          <div
            className={cn(
              'mt-1 max-w-[90%] rounded-lg border bg-card px-2.5 py-1.5 text-xs break-words overflow-hidden',
              agentColors.border,
            )}
          >
            <ChatMarkdown text={message.text} />
          </div>
        ) : (
          <div className="mt-1 text-[11px] text-muted-foreground italic">
            Subagent finished with no message.
          </div>
        )}
      </div>
    )
  }

  if (message.kind === 'task') {
    const done = message.status === 'completed'
    return (
      <div
        className={cn(
          'px-3 py-1 cursor-pointer transition-shadow',
          isSelected && 'ring-1 ring-primary/40',
          isFlashing && 'animate-[flash-ring_0.4s_ease-in-out_3]',
        )}
        onClick={onSelect}
      >
        <MessageHeader
          event={event}
          agent={agent}
          parentAgent={parentAgent}
          agentColorText={agentColors.textOnly}
          label={showAgentLabel ? displayName : done ? 'task done' : 'task'}
          icon={
            done ? (
              <CheckCircle2 className="h-3 w-3 text-green-600 dark:text-green-500" />
            ) : (
              <CircleDot className="h-3 w-3 text-amber-600 dark:text-amber-500" />
            )
          }
        />
        <div
          className={cn(
            'mt-1 flex items-start gap-1.5 rounded-md border px-2 py-1 text-xs',
            done
              ? 'border-green-500/30 bg-green-500/[0.04]'
              : 'border-amber-500/30 bg-amber-500/[0.04]',
          )}
        >
          {done ? (
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 mt-0.5 text-green-600 dark:text-green-500" />
          ) : (
            <Circle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-600 dark:text-amber-500" />
          )}
          <div className="min-w-0 flex-1 whitespace-pre-wrap break-words">
            {message.description || (done ? 'Task completed' : 'Task created')}
          </div>
        </div>
      </div>
    )
  }

  if (message.kind === 'status') {
    const who = message.teammateName || displayName
    return (
      <div
        className={cn(
          'px-3 py-1 cursor-pointer transition-shadow',
          isSelected && 'ring-1 ring-primary/40',
          isFlashing && 'animate-[flash-ring_0.4s_ease-in-out_3]',
        )}
        onClick={onSelect}
      >
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <PauseCircle className="h-3 w-3 text-yellow-600 dark:text-yellow-500" />
          <span className="font-medium text-foreground/80">{who}</span>
          <span>idle</span>
          {message.reason && <span className="truncate opacity-80">— {message.reason}</span>}
          <span className="ml-auto tabular-nums opacity-60">{formatTime(event.timestamp)}</span>
        </div>
      </div>
    )
  }

  return null
})
