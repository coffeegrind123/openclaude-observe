// Per-turn context attribution for pi sessions: an estimate of what fills the
// model's window at each LLM call, by category, so the standing costs of a
// small local window are visible (instantcoffee runs a 96K window where the
// system prompt alone can be a tenth of it).
//
// What a pi window holds at a given call:
//   - the system prompt (incl. AGENTS.md context files) — every call
//   - since the last compaction: the compaction summary, then every user
//     message, tool result, injected message and prior assistant output
//
// So each turn's bucket `tokens` is CUMULATIVE — what is in the window at that
// call — while its `sources` list only what was ADDED since the previous call
// (keeping the response linear in session length). Aggregates count each
// source once: the tokens each category contributed over the session.
//
// One agent at a time: a subagent has its own window, so its events never
// count against its parent's. Token counts are chars/4 estimates; the call's
// real input_tokens is returned alongside so the gap is visible. Tool schemas
// are sent with every request but never appear in events, which is most of
// the gap.

import type { StoredEvent } from './storage/types'

export type ContextCategory =
  | 'system-prompt'
  | 'compaction-summary'
  | 'user-message'
  | 'mentioned-file'
  | 'tool-output'
  | 'delegation'
  | 'injected'
  | 'assistant-output'

export const CONTEXT_CATEGORIES: ContextCategory[] = [
  'system-prompt',
  'compaction-summary',
  'user-message',
  'mentioned-file',
  'tool-output',
  'delegation',
  'injected',
  'assistant-output',
]

export interface ContextSource {
  eventId: number
  description: string
  tokens: number
}

export interface ContextBucket {
  category: ContextCategory
  tokens: number
  sources: ContextSource[]
}

export interface TurnAttribution {
  llmEventId: number
  timestamp: number
  inputTokens: number // authoritative from the LLM call
  cacheReadTokens: number
  cacheCreationTokens: number
  estimatedTokens: number // sum across categories
  buckets: ContextBucket[]
}

export interface SessionContextBreakdown {
  sessionId: string
  agentId: string
  turns: TurnAttribution[]
  aggregates: Record<ContextCategory, { tokens: number; count: number }>
  peakInputTokens: number
}

const SPAWN_TOOLS = new Set(['Agent', 'SubAgent'])
const SUBAGENT_RESULT = 'subagent-result'
const DESCRIPTION_MAX = 120

export function estimateTokens(text: string | null | undefined): number {
  if (!text) {
    return 0
  }
  return Math.max(1, Math.ceil(text.length / 4))
}

function parsePayload(raw: StoredEvent): Record<string, any> {
  try {
    return JSON.parse(raw.payload) as Record<string, any>
  } catch {
    return {}
  }
}

// @file mentions in a prompt (pi inlines the file). Ignored inside fences.
const MENTION_RE = /(?:^|\s)@([\w./~\-]+)(?=[\s,.;:!?)\]]|$)/g

function extractMentions(prompt: string): string[] {
  const out: string[] = []
  let inFence = false
  for (const line of prompt.split('\n')) {
    if (line.trimStart().startsWith('```')) {
      inFence = !inFence
      continue
    }
    if (inFence) {
      continue
    }
    MENTION_RE.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = MENTION_RE.exec(line))) {
      out.push(m[1])
    }
  }
  return out
}

function truncate(s: string, n: number): string {
  const flat = s.replace(/\s+/g, ' ').trim()
  return flat.length <= n ? flat : flat.slice(0, n - 1) + '…'
}

function toolResponseText(toolResponse: unknown): string {
  if (!toolResponse) {
    return ''
  }
  if (typeof toolResponse === 'string') {
    return toolResponse
  }
  const r = toolResponse as Record<string, any>
  if (typeof r.content === 'string') {
    return r.content
  }
  try {
    return JSON.stringify(toolResponse)
  } catch {
    return ''
  }
}

function toolDescription(toolName: string, input: Record<string, any>): string {
  const target =
    input.path ?? input.file_path ?? input.command ?? input.pattern ?? input.description
  return typeof target === 'string' ? `${toolName}: ${truncate(target, 60)}` : toolName
}

type Running = Record<ContextCategory, { tokens: number; added: ContextSource[] }>

function emptyRunning(): Running {
  return Object.fromEntries(
    CONTEXT_CATEGORIES.map((c) => [c, { tokens: 0, added: [] }]),
  ) as unknown as Running
}

/**
 * Attribution for one agent's window. `agentId` defaults to the session's
 * top-level agent, whose id is the session id.
 */
export function computeSessionContext(
  events: StoredEvent[],
  agentId?: string,
): SessionContextBreakdown {
  const sessionId = events[0]?.session_id ?? ''
  const owner = agentId ?? sessionId
  const sorted = events
    .filter((e) => e.agent_id === owner)
    .sort((a, b) => a.timestamp - b.timestamp || a.id - b.id)

  const aggregates = Object.fromEntries(
    CONTEXT_CATEGORIES.map((c) => [c, { tokens: 0, count: 0 }]),
  ) as Record<ContextCategory, { tokens: number; count: number }>
  const turns: TurnAttribution[] = []
  let running = emptyRunning()
  let peak = 0

  const add = (category: ContextCategory, source: ContextSource) => {
    if (source.tokens <= 0) {
      return
    }
    running[category].tokens += source.tokens
    running[category].added.push(source)
    aggregates[category].tokens += source.tokens
    aggregates[category].count += 1
  }

  for (const ev of sorted) {
    const p = parsePayload(ev)

    switch (ev.subtype) {
      case 'SystemPrompt': {
        // Replaces, never accumulates: the window holds one system prompt.
        const chars =
          typeof p.system_prompt_chars === 'number'
            ? p.system_prompt_chars
            : String(p.system_prompt ?? '').length
        const tokens = Math.ceil(chars / 4)
        running['system-prompt'].tokens = 0
        add('system-prompt', {
          eventId: ev.id,
          description: `system prompt (${chars.toLocaleString()} chars)`,
          tokens,
        })
        break
      }
      case 'PostCompact': {
        // Compaction replaces the conversation with a summary; only the system
        // prompt survives from before it.
        const systemPrompt = running['system-prompt'].tokens
        running = emptyRunning()
        running['system-prompt'].tokens = systemPrompt
        const summary = String(p.summary ?? '')
        add('compaction-summary', {
          eventId: ev.id,
          description: `compaction (${p.trigger ?? 'auto'}): ${truncate(summary, 80)}`,
          tokens: estimateTokens(summary),
        })
        break
      }
      case 'UserPromptSubmit': {
        const prompt = String(p.prompt ?? '')
        const mentions = extractMentions(prompt)
        const mentionTokens = mentions.reduce((t, m) => t + estimateTokens(m), 0)
        if (mentions.length > 0) {
          add('mentioned-file', {
            eventId: ev.id,
            description: `${mentions.length} @-mention${mentions.length === 1 ? '' : 's'}: ${mentions.slice(0, 3).join(', ')}${mentions.length > 3 ? '…' : ''}`,
            tokens: mentionTokens,
          })
        }
        add('user-message', {
          eventId: ev.id,
          description: truncate(prompt, DESCRIPTION_MAX),
          tokens: estimateTokens(prompt) - mentionTokens,
        })
        break
      }
      case 'UserBash': {
        if (p.exclude_from_context !== true) {
          add('user-message', {
            eventId: ev.id,
            description: `!${truncate(String(p.command ?? ''), 60)}`,
            tokens: estimateTokens(String(p.command ?? '')),
          })
        }
        break
      }
      case 'PostToolUse':
      case 'PostToolUseFailure': {
        const toolName = ev.tool_name ?? String(p.tool_name ?? 'tool')
        const input = (p.tool_input as Record<string, any>) ?? {}
        const tokens = estimateTokens(toolResponseText(p.tool_response))
        add(SPAWN_TOOLS.has(toolName) ? 'delegation' : 'tool-output', {
          eventId: ev.id,
          description: toolDescription(toolName, input),
          tokens,
        })
        break
      }
      case 'CustomMessage': {
        const kind = String(p.custom_type ?? 'message')
        add(kind === SUBAGENT_RESULT ? 'delegation' : 'injected', {
          eventId: ev.id,
          description: `${kind}: ${truncate(String(p.text ?? ''), 60)}`,
          tokens: estimateTokens(String(p.text ?? '')),
        })
        break
      }
      case 'LLMGeneration': {
        const inputTokens = Number(p.input_tokens) || 0
        const cacheReadTokens = Number(p.cache_read_tokens) || 0
        const cacheCreationTokens = Number(p.cache_creation_tokens) || 0
        const buckets = CONTEXT_CATEGORIES.map((c) => ({
          category: c,
          tokens: running[c].tokens,
          sources: running[c].added,
        }))
        turns.push({
          llmEventId: ev.id,
          timestamp: ev.timestamp,
          inputTokens,
          cacheReadTokens,
          cacheCreationTokens,
          estimatedTokens: buckets.reduce((s, b) => s + b.tokens, 0),
          buckets,
        })
        // pi reports input excluding cache hits; the window is both.
        peak = Math.max(peak, inputTokens + cacheReadTokens + cacheCreationTokens)
        for (const c of CONTEXT_CATEGORIES) {
          running[c].added = []
        }
        // This call's output is in the window from the next call on.
        add('assistant-output', {
          eventId: ev.id,
          description: `assistant turn ${new Date(ev.timestamp).toISOString().slice(11, 19)}`,
          tokens: Number(p.output_tokens) || 0,
        })
        break
      }
    }
  }

  return { sessionId, agentId: owner, turns, aggregates, peakInputTokens: peak }
}
