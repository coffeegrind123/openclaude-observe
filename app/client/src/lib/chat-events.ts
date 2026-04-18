import type { ParsedEvent } from '@/types'

// Event subtypes the chat feed renders. All other events stay in the event
// feed only. Order here does not imply priority — classification happens in
// classifyChatEvent below.
export const CHAT_SUBTYPES = new Set([
  'UserPromptSubmit',
  'Stop',
  'stop_hook_summary',
  'StopFailure',
  'SubagentStart',
  'SubagentStop',
  'TaskCreated',
  'TaskCompleted',
  'TeammateIdle',
])

export type ChatMessageKind =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string; failed?: boolean }
  | { kind: 'subagent-start'; agentName?: string; description?: string; prompt?: string }
  | { kind: 'subagent-stop'; agentName?: string; text?: string }
  | { kind: 'task'; status: 'created' | 'completed'; description?: string }
  | { kind: 'status'; teammateName?: string; reason?: string }

export interface ChatEntry {
  event: ParsedEvent
  message: ChatMessageKind
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

/**
 * Map a ParsedEvent to a chat-message view. Returns null when the event
 * should not appear in the chat feed (either not a chat subtype, or the
 * payload lacks content we can render as a bubble).
 */
export function classifyChatEvent(event: ParsedEvent): ChatMessageKind | null {
  const subtype = event.subtype
  if (!subtype || !CHAT_SUBTYPES.has(subtype)) return null
  const p = event.payload as Record<string, unknown>

  switch (subtype) {
    case 'UserPromptSubmit': {
      const text = str(p.prompt) ?? str((p.message as Record<string, unknown>)?.content)
      if (!text) return null
      return { kind: 'user', text }
    }

    case 'Stop':
    case 'stop_hook_summary': {
      const text = str(p.last_assistant_message)
      if (!text) return null
      return { kind: 'assistant', text }
    }

    case 'StopFailure': {
      const text = str(p.last_assistant_message) ?? 'Turn failed'
      return { kind: 'assistant', text, failed: true }
    }

    case 'SubagentStart': {
      return {
        kind: 'subagent-start',
        agentName: str(p.agent_name),
        description: str(p.description),
        prompt: str(p.prompt),
      }
    }

    case 'SubagentStop': {
      return {
        kind: 'subagent-stop',
        agentName: str(p.agent_name),
        text: str(p.last_assistant_message),
      }
    }

    case 'TaskCreated':
      return {
        kind: 'task',
        status: 'created',
        description: str(p.description) ?? str(p.task_description),
      }

    case 'TaskCompleted':
      return {
        kind: 'task',
        status: 'completed',
        description: str(p.description) ?? str(p.task_description),
      }

    case 'TeammateIdle':
      return {
        kind: 'status',
        teammateName: str(p.teammate_name),
        reason: str(p.reason) ?? str(p.idle_reason),
      }

    default:
      return null
  }
}

/**
 * Build the chronological list of chat entries from the raw event stream.
 * Events that don't classify (no content, wrong subtype) are dropped.
 */
export function buildChatEntries(events: ParsedEvent[] | undefined): ChatEntry[] {
  if (!events) return []
  const entries: ChatEntry[] = []
  for (const event of events) {
    const message = classifyChatEvent(event)
    if (message) entries.push({ event, message })
  }
  return entries
}
