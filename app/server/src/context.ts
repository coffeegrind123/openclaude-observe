// Per-turn context attribution — classifies the events that preceded each
// LLMGeneration into categories so users can see what's consuming their
// context window.
//
// Categories (discriminated by `category` field on each attribution):
//   claude-md          — InstructionsLoaded events (CLAUDE.md / rules files)
//   mentioned-file     — @file mentions in the user's prompt
//   tool-output        — PostToolUse tool_response content
//   thinking-text      — Assistant text + extended-thinking from prior turns
//   team-coordination  — SendMessage / TaskCreate / TaskUpdate / TaskList /
//                        TaskGet / TeamCreate / TeamDelete tool calls
//   user-message       — UserPromptSubmit prompt text (excluding @-mentions)
//   skills             — Skill* tool calls (bundled skill invocations)
//
// This module does NOT mutate state — it's a pure read-side computation over
// the events already stored. Token counts are estimates (chars/4 heuristic),
// which is the same baseline tokenizer Claude uses as a cheap approximation.
// The authoritative input_tokens number for the LLM call is returned alongside
// so the UI can show both the estimate and the true total.

import type { StoredEvent } from './storage/types'

export type ContextCategory =
  | 'claude-md'
  | 'mentioned-file'
  | 'tool-output'
  | 'thinking-text'
  | 'team-coordination'
  | 'user-message'
  | 'skills'

export const CONTEXT_CATEGORIES: ContextCategory[] = [
  'claude-md',
  'mentioned-file',
  'tool-output',
  'thinking-text',
  'team-coordination',
  'user-message',
  'skills',
]

export interface ContextSource {
  eventId: number
  description: string
  tokens: number
  scope?: string // e.g. 'User' | 'Project' | 'Local' for claude-md
}

export interface ContextBucket {
  category: ContextCategory
  tokens: number
  sources: ContextSource[]
}

export interface TurnAttribution {
  llmEventId: number
  timestamp: number
  inputTokens: number // authoritative from LLM call
  cacheReadTokens: number
  cacheCreationTokens: number
  estimatedTokens: number // sum across categories
  buckets: ContextBucket[]
}

export interface SessionContextBreakdown {
  sessionId: string
  turns: TurnAttribution[]
  // Aggregated view (summed across all turns) for the stats tab:
  aggregates: Record<ContextCategory, { tokens: number; count: number }>
  peakInputTokens: number
}

// --- helpers -----------------------------------------------------------------

const TEAM_COORD_TOOLS = new Set([
  'SendMessage',
  'TaskCreate',
  'TaskUpdate',
  'TaskList',
  'TaskGet',
  'TeamCreate',
  'TeamDelete',
])

function estimateTokens(text: string | null | undefined): number {
  if (!text) return 0
  // Claude's cheap approximation; within ~15% for English text.
  return Math.max(1, Math.ceil(text.length / 4))
}

function parsePayload(raw: StoredEvent): Record<string, any> {
  try {
    return JSON.parse(raw.payload) as Record<string, any>
  } catch {
    return {}
  }
}

// Match @file mentions in the user's prompt. Matches:
//  @relative/path.ts  @/abs/path  @file.md
// Stops at whitespace or common punctuation. Ignored inside code fences.
const MENTION_RE = /(?:^|\s)@([\w./~\-]+)(?=[\s,.;:!?)\]]|$)/g

function extractMentions(prompt: string): string[] {
  const out: string[] = []
  let inFence = false
  for (const line of prompt.split('\n')) {
    if (line.trimStart().startsWith('```')) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    MENTION_RE.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = MENTION_RE.exec(line))) {
      out.push(m[1])
    }
  }
  return out
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…'
}

function toolResponseText(toolResponse: unknown): string {
  if (!toolResponse) return ''
  if (typeof toolResponse === 'string') return toolResponse
  const r = toolResponse as Record<string, any>
  if (typeof r.content === 'string') return r.content
  if (Array.isArray(r.content)) {
    return r.content
      .map((c: unknown) => (typeof c === 'string' ? c : ((c as any)?.text ?? '')))
      .join('\n')
  }
  if (r.file && typeof r.file.content === 'string') return r.file.content
  if (typeof r.stdout === 'string' || typeof r.stderr === 'string') {
    return [r.stdout, r.stderr].filter(Boolean).join('\n')
  }
  if (typeof r.output === 'string') return r.output
  try {
    return JSON.stringify(toolResponse)
  } catch {
    return ''
  }
}

// --- main computation --------------------------------------------------------

export function computeSessionContext(events: StoredEvent[]): SessionContextBreakdown {
  // Sort defensively; the query layer already returns ASC but we don't want to
  // assume.
  const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp)
  const turns: TurnAttribution[] = []

  // Pointer to the first event after the previous LLMGeneration. On the very
  // first turn, starts at 0.
  let windowStart = 0

  for (let i = 0; i < sorted.length; i++) {
    const ev = sorted[i]
    if (ev.subtype !== 'LLMGeneration') continue

    const buckets: Record<ContextCategory, ContextBucket> = {
      'claude-md': { category: 'claude-md', tokens: 0, sources: [] },
      'mentioned-file': { category: 'mentioned-file', tokens: 0, sources: [] },
      'tool-output': { category: 'tool-output', tokens: 0, sources: [] },
      'thinking-text': { category: 'thinking-text', tokens: 0, sources: [] },
      'team-coordination': { category: 'team-coordination', tokens: 0, sources: [] },
      'user-message': { category: 'user-message', tokens: 0, sources: [] },
      skills: { category: 'skills', tokens: 0, sources: [] },
    }

    // Walk the window: events between windowStart and this LLMGeneration.
    for (let j = windowStart; j < i; j++) {
      const win = sorted[j]
      const p = parsePayload(win)

      if (win.subtype === 'UserPromptSubmit') {
        const prompt = (p.prompt as string) || ''
        const mentions = extractMentions(prompt)
        const mentionTokens = mentions.reduce((t, m) => t + estimateTokens(m), 0)
        // Estimate the mention text itself (path only; we don't have the file
        // content). We'll separately bucket the file content when it arrives
        // via a subsequent Read PostToolUse event.
        if (mentionTokens > 0) {
          buckets['mentioned-file'].tokens += mentionTokens
          buckets['mentioned-file'].sources.push({
            eventId: win.id,
            description: `${mentions.length} @-mention${mentions.length === 1 ? '' : 's'}: ${mentions.slice(0, 3).join(', ')}${mentions.length > 3 ? '…' : ''}`,
            tokens: mentionTokens,
          })
        }
        const promptTokens = estimateTokens(prompt) - mentionTokens
        if (promptTokens > 0) {
          buckets['user-message'].tokens += promptTokens
          buckets['user-message'].sources.push({
            eventId: win.id,
            description: truncate(prompt.replace(/\s+/g, ' ').trim(), 120),
            tokens: promptTokens,
          })
        }
      } else if (win.subtype === 'InstructionsLoaded') {
        const filePath = (p.file_path as string) || ''
        const memoryType = (p.memory_type as string) || ''
        // We don't know the file size server-side, but the dashboard can look
        // up later. For now, estimate from the path length as a placeholder —
        // the UI will show "size unknown" and let the user click to load.
        // Better: walk subsequent events for a Read on the same path and use
        // that as the true content size. For now, use a small constant baseline.
        const baselineTokens = 200 // heuristic — real CLAUDE.md is usually 200-2000 tokens
        buckets['claude-md'].tokens += baselineTokens
        buckets['claude-md'].sources.push({
          eventId: win.id,
          description: filePath,
          tokens: baselineTokens,
          scope: memoryType,
        })
      } else if (win.subtype === 'PostToolUse' && win.tool_name) {
        const toolName = win.tool_name
        const toolInput = (p.tool_input as Record<string, any>) || {}
        const resultText = toolResponseText(p.tool_response)
        const toolTokens = estimateTokens(resultText)
        if (TEAM_COORD_TOOLS.has(toolName)) {
          const inputTokens = estimateTokens(JSON.stringify(toolInput))
          const total = toolTokens + inputTokens
          buckets['team-coordination'].tokens += total
          buckets['team-coordination'].sources.push({
            eventId: win.id,
            description: `${toolName}: ${truncate(JSON.stringify(toolInput), 80)}`,
            tokens: total,
          })
        } else if (toolName.startsWith('Skill')) {
          buckets.skills.tokens += toolTokens
          buckets.skills.sources.push({
            eventId: win.id,
            description: `${toolName}${toolInput.skill ? `: ${toolInput.skill}` : ''}`,
            tokens: toolTokens,
          })
        } else if (toolTokens > 0) {
          const fp = (toolInput.file_path as string) || (toolInput.path as string) || ''
          const cmd = (toolInput.command as string) || ''
          const desc = fp
            ? `${toolName}: ${fp.split('/').pop() || fp}`
            : cmd
              ? `${toolName}: ${truncate(cmd, 60)}`
              : toolName
          buckets['tool-output'].tokens += toolTokens
          buckets['tool-output'].sources.push({
            eventId: win.id,
            description: desc,
            tokens: toolTokens,
          })
        }
      }
    }

    // Thinking/text output from any prior LLMGeneration falls into context
    // for this turn. Prior response_preview tokens are the closest visible
    // proxy for what the LLM generated and fed back as assistant turns.
    for (let k = 0; k < windowStart; k++) {
      const prior = sorted[k]
      if (prior.subtype !== 'LLMGeneration') continue
      const pp = parsePayload(prior)
      const out = (pp.output_tokens as number) || 0
      if (out > 0) {
        buckets['thinking-text'].tokens += out
        if (buckets['thinking-text'].sources.length < 8) {
          buckets['thinking-text'].sources.push({
            eventId: prior.id,
            description: `assistant turn ${new Date(prior.timestamp).toISOString().slice(11, 19)}`,
            tokens: out,
          })
        }
      }
    }

    const payload = parsePayload(ev)
    const inputTokens = (payload.input_tokens as number) || 0
    const cacheReadTokens = (payload.cache_read_tokens as number) || 0
    const cacheCreationTokens = (payload.cache_creation_tokens as number) || 0
    const estimatedTokens = CONTEXT_CATEGORIES.reduce((s, c) => s + buckets[c].tokens, 0)

    turns.push({
      llmEventId: ev.id,
      timestamp: ev.timestamp,
      inputTokens,
      cacheReadTokens,
      cacheCreationTokens,
      estimatedTokens,
      buckets: CONTEXT_CATEGORIES.map((c) => buckets[c]),
    })

    windowStart = i + 1
  }

  // Aggregates across all turns
  const aggregates = Object.fromEntries(
    CONTEXT_CATEGORIES.map((c) => [c, { tokens: 0, count: 0 }]),
  ) as Record<ContextCategory, { tokens: number; count: number }>
  let peak = 0
  for (const t of turns) {
    peak = Math.max(peak, t.inputTokens)
    for (const b of t.buckets) {
      aggregates[b.category].tokens += b.tokens
      aggregates[b.category].count += b.sources.length
    }
  }

  return {
    sessionId: events[0]?.session_id ?? '',
    turns,
    aggregates,
    peakInputTokens: peak,
  }
}
