import type { ParsedEvent } from '@/types'

// Event subtypes the chat feed renders. All other events stay in the event
// feed only. LLMGeneration is in here so intermediate model turns show as
// their own assistant bubbles — Stop only fires once per turn, so without
// this the chat goes silent during long agent loops.
export const CHAT_SUBTYPES = new Set([
  'UserPromptSubmit',
  'LLMGeneration',
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
  | { kind: 'assistant'; text: string; failed?: boolean; thinking?: string }
  | { kind: 'subagent-start'; agentName?: string; description?: string; prompt?: string }
  | { kind: 'subagent-stop'; agentName?: string; text?: string; thinking?: string }
  | { kind: 'task'; status: 'created' | 'completed'; description?: string }
  | { kind: 'status'; teammateName?: string; reason?: string }

export interface ChatEntry {
  event: ParsedEvent
  message: ChatMessageKind
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

// Prefixes the OpenClaude REPL wraps around synthetic / internal prompts that
// the user never types or sees. Mirrors the detection in OpenClaude's
// forwardHookToObserve (utils/hooks.ts) and the existing filter in
// event-detail.tsx's dedupeThread. Kept here as a fallback so the chat feed
// filters these even when the sender is an older version that didn't tag
// payload.kind = 'background'.
const BACKGROUND_PROMPT_PREFIXES = [
  '<tick>',
  '<system-reminder>',
  '<local-command-stdout>',
  '<task-notification>',
  'A background agent completed a task:',
]

function isBackgroundPrompt(prompt: string): boolean {
  const trimmed = prompt.trimStart()
  for (const prefix of BACKGROUND_PROMPT_PREFIXES) {
    if (trimmed.startsWith(prefix)) return true
  }
  return false
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

  // Drop background-tagged events globally. OpenClaude's sender marks
  // UserPromptSubmit hooks with kind='background' when the prompt is a
  // synthetic wrapper (tick, system-reminder, local-command-stdout, etc.)
  // so telemetry still receives them but the chat view mirrors what the
  // user actually saw in the REPL.
  if (p.kind === 'background') return null

  switch (subtype) {
    case 'UserPromptSubmit': {
      const text = str(p.prompt) ?? str((p.message as Record<string, unknown>)?.content)
      if (!text) return null
      // Defense in depth: if the sender didn't tag payload.kind (older
      // openclaude versions), detect the synthetic prefixes directly.
      if (isBackgroundPrompt(text)) return null
      return { kind: 'user', text }
    }

    case 'LLMGeneration': {
      // Each LLM call is its own assistant bubble so mid-turn model text
      // ("Let me check X first…") is visible before Stop fires. response_preview
      // is the concatenated text blocks of this call's assistant message
      // (capped 1000 chars by openclaude); thinking_preview is the extended-
      // thinking content for the same call. Drop when both are empty — those
      // are tool-only LLM calls with nothing to render.
      const text = str(p.response_preview)
      const thinking = str(p.thinking_preview)
      if (!text && !thinking) return null
      const msg: ChatMessageKind = { kind: 'assistant', text: text ?? '' }
      if (thinking) msg.thinking = thinking
      return msg
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
 *
 * Each LLMGeneration becomes its own assistant bubble so intermediate turns
 * of a long agent loop are visible. When a Stop / stop_hook_summary /
 * StopFailure fires on an agent that just emitted an LLMGeneration, we merge
 * the two: the Stop's `last_assistant_message` (full text, untruncated)
 * replaces the LLMGeneration bubble's `response_preview` text (capped at 1000
 * chars) and StopFailure sets `failed=true` on that bubble. This avoids a
 * trailing duplicate bubble at the end of every turn.
 *
 * If no LLMGeneration preceded the Stop on this agent (e.g. a session from
 * before the LLM-span attribution fix, or a Stop with no LLM calls in the
 * turn), the Stop bubble is emitted on its own as a fallback.
 *
 * SubagentStop is intentionally NOT merged — subagent LLM calls are
 * currently attributed to the parent agent_id upstream, so the subagent
 * rarely has a preceding LLMGeneration on its own agentId. Leaving it as an
 * independent bubble preserves the subagent-stop styling (bordered result
 * card with agent name) regardless of attribution.
 */
export function buildChatEntries(events: ParsedEvent[] | undefined): ChatEntry[] {
  if (!events) return []
  const entries: ChatEntry[] = []
  // agentId → index into `entries` of the most recent LLMGeneration bubble
  // on that agent that hasn't been sealed by a Stop yet. A Stop/
  // stop_hook_summary/StopFailure on the same agent will upgrade this entry's
  // text instead of pushing a new bubble.
  const openLLMBubble = new Map<string, number>()

  for (let i = 0; i < events.length; i++) {
    const event = events[i]
    const message = classifyChatEvent(event)
    if (!message) continue

    const subtype = event.subtype
    if (subtype === 'LLMGeneration') {
      openLLMBubble.set(event.agentId, entries.length)
      entries.push({ event, message })
      continue
    }

    if (subtype === 'Stop' || subtype === 'stop_hook_summary' || subtype === 'StopFailure') {
      // classifier already asserted message.kind === 'assistant' here
      if (message.kind !== 'assistant') {
        entries.push({ event, message })
        continue
      }
      const openIdx = openLLMBubble.get(event.agentId)
      if (openIdx !== undefined) {
        const prev = entries[openIdx]
        if (prev.message.kind === 'assistant') {
          // Prefer the untruncated last_assistant_message over the LLM call's
          // response_preview (capped at 1000 chars). Keep the preceding
          // bubble's thinking since it belongs to the same LLM call.
          if (message.text) prev.message.text = message.text
          if (message.failed) prev.message.failed = true
          openLLMBubble.delete(event.agentId)
          continue
        }
      }
      // No LLMGeneration to merge into — emit the Stop bubble standalone.
      entries.push({ event, message })
      continue
    }

    // User prompts mark a new turn boundary; any dangling LLMGeneration
    // bubble from a prior turn is no longer a merge target.
    if (subtype === 'UserPromptSubmit') {
      openLLMBubble.delete(event.agentId)
    }

    entries.push({ event, message })
  }
  return entries
}
