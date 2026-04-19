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
 * Collect thinking_preview text from every LLMGeneration event in [start, end)
 * on the same agent. Joins multiple LLM calls' thinking with a `---` divider,
 * matching the sender-side format so passes read as sequential blocks.
 */
function collectThinkingForAgent(
  events: ParsedEvent[],
  agentId: string,
  startIdx: number,
  endIdx: number,
): string | undefined {
  const pieces: string[] = []
  for (let i = startIdx; i < endIdx; i++) {
    const e = events[i]
    if (e.subtype !== 'LLMGeneration') continue
    if (e.agentId !== agentId) continue
    const t = (e.payload as Record<string, unknown>).thinking_preview
    if (typeof t === 'string' && t.length > 0) pieces.push(t)
  }
  if (pieces.length === 0) return undefined
  return pieces.join('\n\n---\n\n')
}

/**
 * Build the chronological list of chat entries from the raw event stream.
 * Events that don't classify (no content, wrong subtype) are dropped.
 *
 * For assistant replies (Stop / stop_hook_summary / StopFailure / SubagentStop)
 * we stitch in the `thinking_preview` from any LLMGeneration events that fired
 * on the same agent since the previous assistant boundary. Thinking isn't on
 * the Stop event itself — it arrives on separate LLM spans — so this walks
 * back to the agent's prior Stop/SubagentStop (or the start of the event
 * window) to scope which LLM calls belong to this turn.
 */
export function buildChatEntries(events: ParsedEvent[] | undefined): ChatEntry[] {
  if (!events) return []
  // Per-agent index of the last assistant-boundary event, so we can scope the
  // "LLM calls in this turn" window without walking the whole history on each
  // Stop. Single forward pass, O(n) overall.
  const lastBoundary = new Map<string, number>() // agentId → index
  const entries: ChatEntry[] = []
  for (let i = 0; i < events.length; i++) {
    const event = events[i]
    const message = classifyChatEvent(event)
    if (!message) continue

    if (message.kind === 'assistant' || message.kind === 'subagent-stop') {
      const start = (lastBoundary.get(event.agentId) ?? -1) + 1
      const thinking = collectThinkingForAgent(events, event.agentId, start, i)
      if (thinking) {
        message.thinking = thinking
      }
      lastBoundary.set(event.agentId, i)
    }

    entries.push({ event, message })
  }
  return entries
}
