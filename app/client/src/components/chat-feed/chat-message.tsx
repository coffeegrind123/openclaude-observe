import { memo, useState } from 'react'
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
  Brain,
  ChevronDown,
  ChevronRight,
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

/**
 * Collapsible thinking preface for assistant/subagent-stop bubbles. Hidden by
 * default — click the pill to reveal the chain-of-thought inline, styled as
 * a muted indented block above the assistant text.
 */
function ThinkingPeek({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const tokens = Math.max(1, Math.ceil(text.length / 4))
  const tokLabel = tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : String(tokens)
  const passes = text.split(/\n\n---\n\n/).filter((s) => s.trim().length > 0)
  return (
    <div className="mb-1">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
        className="inline-flex items-center gap-1 rounded bg-purple-500/10 hover:bg-purple-500/15 border border-purple-500/30 px-1.5 py-[1px] text-[10px] font-medium text-purple-700 dark:text-purple-300 transition-colors cursor-pointer"
        title="Show thinking"
      >
        {open ? <ChevronDown className="h-2.5 w-2.5" /> : <ChevronRight className="h-2.5 w-2.5" />}
        <Brain className="h-2.5 w-2.5" />
        thinking · {tokLabel}t
        {passes.length > 1 && <span className="opacity-70">· {passes.length}×</span>}
      </button>
      {open && (
        <div className="mt-1 pl-2 border-l-2 border-purple-500/30 text-[10px] text-muted-foreground italic space-y-2 max-h-[300px] overflow-auto">
          {passes.map((pass, i) => (
            <div
              key={i}
              className="whitespace-pre-wrap break-words"
              onClick={(e) => e.stopPropagation()}
            >
              {passes.length > 1 && (
                <div className="not-italic text-[9px] uppercase tracking-wider text-purple-600/70 dark:text-purple-400/70 mb-0.5">
                  pass {i + 1}
                </div>
              )}
              {pass}
            </div>
          ))}
        </div>
      )}
    </div>
  )
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
  const setScrollToEventId = useUIStore((s) => s.setScrollToEventId)
  const isFlashing = useUIStore((s) => s.flashingEventId === event.id)
  const isSelected = selectedEventId === event.id
  // Toggle selection AND scroll the event panel to the matching row so the
  // chat→event link is useful even when the event is off-screen. The event
  // stream's scrollToEventId effect resolves the row, scrolls the
  // virtualizer, and pulses flashingEventId on the matched row. Skip the
  // scroll on a deselect click — leaving the user where they are.
  const onSelect = () => {
    if (isSelected) {
      setSelectedEventId(null)
    } else {
      setSelectedEventId(event.id)
      setScrollToEventId(event.id)
    }
  }

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
          {message.thinking && <ThinkingPeek text={message.thinking} />}
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
            {message.thinking && <ThinkingPeek text={message.thinking} />}
            <ChatMarkdown text={message.text} />
          </div>
        ) : message.thinking ? (
          <div
            className={cn(
              'mt-1 max-w-[90%] rounded-lg border bg-card px-2.5 py-1.5 text-xs break-words overflow-hidden',
              agentColors.border,
            )}
          >
            <ThinkingPeek text={message.thinking} />
            <div className="text-[11px] text-muted-foreground italic">
              Subagent finished with no final message.
            </div>
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
