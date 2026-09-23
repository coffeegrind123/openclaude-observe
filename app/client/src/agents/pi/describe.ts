// Text-level description of pi events: labels, summaries, prose, icons,
// failure state, chat classification and agent linkage. Field names follow
// docs/pi-protocol.md; every one was checked against the captured envelopes
// in app/server/src/routes/__fixtures__/pi-envelopes.jsonl.

import type { ParsedEvent } from '@/types'
import type { AgentIdentity, ChatMessage, RowBadge, SpawnLink } from '../types'
import {
  formatMs,
  formatTokens,
  isToolSubtype,
  num,
  obj,
  oneLine,
  plural,
  str,
  estimateTokens,
  type Payload,
} from '../payload'
import {
  parseBashOutput,
  piToolIconId,
  piToolKind,
  toolCallSummary,
  toolCallTag,
  toolResult,
} from './tools'

function payloadOf(event: ParsedEvent): Payload {
  return event.payload as Payload
}

/** True for events emitted from a subagent's session (they carry `agent_id`). */
export function isSubagentEvent(p: Payload): boolean {
  return str(p.agent_id) != null
}

/** The subagent's `<type>#<id8>` name, else its type, else a short id. */
function agentNameOf(p: Payload): string {
  return str(p.agent_name) ?? str(p.agent_type) ?? str(p.agent_id)?.slice(0, 8) ?? 'subagent'
}

function toolInputOf(p: Payload): Payload | undefined {
  return obj(p.tool_input)
}

// ── Labels ──────────────────────────────────────────────────────────

const LABELS: Record<string, string> = {
  SessionStart: 'Session',
  SessionEnd: 'Session',
  SessionRename: 'Rename',
  SessionTree: 'Tree',
  SystemPrompt: 'System',
  UserBash: '!bash',
  LLMGeneration: 'LLM',
  Stop: 'Stop',
  SubagentStart: 'SubStart',
  SubagentStop: 'SubStop',
  PreCompact: 'Compact',
  PostCompact: 'Compact',
  CompactionFailed: 'Compact',
  ModelChange: 'Model',
  ThinkingLevelChange: 'Thinking',
  Notification: 'Notify',
  CustomMessage: 'Message',
}

export function piLabel(event: ParsedEvent): string {
  const p = payloadOf(event)
  if (isToolSubtype(event.subtype)) {
    return 'Tool'
  }
  if (event.subtype === 'UserPromptSubmit') {
    if (isSubagentEvent(p)) {
      return 'task'
    }
    return p.source === 'extension' ? 'injected' : 'you'
  }
  return LABELS[event.subtype ?? ''] ?? event.subtype ?? event.type
}

export function piToolLabel(event: ParsedEvent): string | null {
  if (!isToolSubtype(event.subtype)) {
    return null
  }
  return event.toolName ?? str(payloadOf(event).tool_name) ?? null
}

// ── Failure ─────────────────────────────────────────────────────────

export function llmFailed(p: Payload): boolean {
  return p.stop_reason === 'error' || str(p.error_message) != null
}

export function piIsFailure(event: ParsedEvent): boolean {
  const p = payloadOf(event)
  if (event.subtype === 'PostToolUseFailure' || event.status === 'failed') {
    return true
  }
  if (isToolSubtype(event.subtype) && p.is_error === true) {
    return true
  }
  if (event.subtype === 'CompactionFailed') {
    return true
  }
  if (event.subtype === 'LLMGeneration') {
    return llmFailed(p)
  }
  return false
}

// ── Icons ───────────────────────────────────────────────────────────

export function piIconId(event: ParsedEvent): string {
  const p = payloadOf(event)
  if (isToolSubtype(event.subtype)) {
    return piToolIconId(event.toolName ?? str(p.tool_name))
  }
  switch (event.subtype) {
    case 'LLMGeneration':
      return llmFailed(p) ? 'LLMGenerationError' : 'LLMGeneration'
    case 'CustomMessage':
      return p.custom_type === 'subagent-result' ? 'CustomMessage:subagent-result' : 'CustomMessage'
    case 'UserPromptSubmit':
      return p.source === 'extension' ? 'UserPromptSubmit:extension' : 'UserPromptSubmit'
    default:
      return event.subtype ?? 'Default'
  }
}

// ── Summaries ───────────────────────────────────────────────────────

/** Share of the prompt served from cache: cache_read / (input + cache_read). */
export function cacheHitPct(p: Payload): number | null {
  const input = num(p.input_tokens) ?? 0
  const cacheRead = num(p.cache_read_tokens) ?? 0
  if (input + cacheRead <= 0) {
    return null
  }
  return Math.round((cacheRead / (input + cacheRead)) * 100)
}

// Below this streaming window the division is noise: on the captured forge
// session the first streamed update landed 2–8 ms before message_end
// (ttft 9269 ms of 9277 ms), i.e. the response arrived in one burst and
// "tokens/s" would read as tens of thousands.
const MIN_STREAM_MS = 100
const MIN_STREAM_SHARE = 0.1

/**
 * Client-derived decode speed: output_tokens over the streaming window
 * (duration_ms − ttft_ms). pi does not see the server's own timings, so this
 * includes network and client overhead. Null when ttft_ms is absent or the
 * window is too short to measure (see isBurstResponse).
 */
export function tokensPerSecond(p: Payload): number | null {
  const out = num(p.output_tokens)
  const dur = num(p.duration_ms)
  const ttft = num(p.ttft_ms)
  if (out == null || dur == null || ttft == null || out <= 0) {
    return null
  }
  if (isBurstResponse(p)) {
    return null
  }
  return out / ((dur - ttft) / 1000)
}

/** True when the whole response arrived at once, so no decode speed can be derived. */
export function isBurstResponse(p: Payload): boolean {
  const dur = num(p.duration_ms)
  const ttft = num(p.ttft_ms)
  if (dur == null || ttft == null) {
    return false
  }
  const streamMs = dur - ttft
  return streamMs < MIN_STREAM_MS || streamMs < dur * MIN_STREAM_SHARE
}

/** "read, bash×2" from `tool_calls: [{id, name}]`. */
export function toolCallList(p: Payload): string {
  if (!Array.isArray(p.tool_calls)) {
    return ''
  }
  const counts = new Map<string, number>()
  for (const c of p.tool_calls) {
    const name = str(obj(c)?.name)
    if (name) {
      counts.set(name, (counts.get(name) ?? 0) + 1)
    }
  }
  return [...counts].map(([n, c]) => (c > 1 ? `${n}×${c}` : n)).join(', ')
}

function llmSummary(p: Payload): string {
  const parts: string[] = []
  const model = str(p.actual_model) ?? str(p.model)
  if (model) {
    parts.push(model)
  }
  const tokens = [
    `in ${formatTokens(num(p.input_tokens))}`,
    `out ${formatTokens(num(p.output_tokens))}`,
  ]
  const hit = cacheHitPct(p)
  if (hit != null && (num(p.cache_read_tokens) ?? 0) > 0) {
    tokens.push(`cache ${hit}%`)
  }
  parts.push(tokens.join(' '))
  const dur = num(p.duration_ms)
  if (dur != null) {
    parts.push(formatMs(dur))
  }
  const tps = tokensPerSecond(p)
  if (tps != null) {
    parts.push(`${tps.toFixed(1)} tok/s`)
  }
  const stop = str(p.stop_reason)
  if (stop && stop !== 'toolUse' && stop !== 'stop') {
    parts.push(stop)
  }
  const calls = toolCallList(p)
  if (calls) {
    parts.push(`→ ${calls}`)
  }
  const err = str(p.error_message)
  if (err) {
    parts.push(oneLine(err))
  }
  return parts.join(' · ')
}

function contextSummary(ctx: Payload | undefined): string {
  if (!ctx) {
    return ''
  }
  const tokens = num(ctx.tokens)
  const window = num(ctx.contextWindow)
  const pct = num(ctx.percent)
  if (tokens == null) {
    return ''
  }
  const pctText = pct != null ? ` (${Math.round(pct)}%)` : ''
  return `context ${formatTokens(tokens)}${window != null ? `/${formatTokens(window)}` : ''}${pctText}`
}

function toolSummary(event: ParsedEvent, p: Payload): string {
  const toolName = event.toolName ?? str(p.tool_name) ?? null
  const call = toolCallSummary(toolName, toolInputOf(p), str(p.cwd))
  if (call) {
    return call
  }
  // A PostToolUse whose Pre never arrived carries no input — fall back to the result.
  const result = toolResult(p)
  return result ? oneLine(result.content) : ''
}

export function piSummaryTag(event: ParsedEvent): string | null {
  if (!isToolSubtype(event.subtype)) {
    return null
  }
  const p = payloadOf(event)
  return toolCallTag(event.toolName ?? str(p.tool_name) ?? null, toolInputOf(p))
}

export function piSummary(event: ParsedEvent): string {
  const p = payloadOf(event)
  if (isToolSubtype(event.subtype)) {
    return toolSummary(event, p)
  }
  switch (event.subtype) {
    case 'SessionStart': {
      const parts = [`Session ${str(p.source) ?? 'start'}`]
      const model = str(p.model)
      if (model) {
        parts.push(str(p.provider) ? `${model} (${str(p.provider)})` : model)
      }
      const mode = str(p.pi_mode)
      if (mode) {
        parts.push(mode)
      }
      return parts.join(' · ')
    }
    case 'SessionEnd':
      return `Session ended${str(p.reason) ? ` (${str(p.reason)})` : ''}`
    case 'SessionRename':
      return str(p.name) ? `Renamed to "${str(p.name)}"` : 'Session renamed'
    case 'SessionTree': {
      const from = str(p.old_leaf_id)?.slice(0, 8) ?? '—'
      const to = str(p.new_leaf_id)?.slice(0, 8) ?? '—'
      return `Tree navigation ${from} → ${to}`
    }
    case 'SystemPrompt': {
      const chars = num(p.system_prompt_chars) ?? str(p.system_prompt)?.length ?? 0
      return `System prompt · ${chars.toLocaleString()} chars · ~${formatTokens(estimateTokens(chars))} tok`
    }
    case 'UserPromptSubmit': {
      const text = oneLine(str(p.prompt) ?? '')
      const images = num(p.images) ?? 0
      return images > 0 ? `${text} (+${plural(images, 'image')})` : text
    }
    case 'UserBash':
      return `!${str(p.command) ?? ''}${p.exclude_from_context === true ? ' (excluded from context)' : ''}`
    case 'LLMGeneration':
      return llmSummary(p)
    case 'Stop': {
      const ctx = contextSummary(obj(p.context))
      return ctx ? `Settled · ${ctx}` : 'Settled'
    }
    case 'SubagentStart': {
      const desc = str(p.agent_description)
      const bg = p.background === true ? ' (background)' : ''
      return `${agentNameOf(p)}${desc ? ` · ${oneLine(desc)}` : ''}${bg}`
    }
    case 'SubagentStop': {
      const parts = [agentNameOf(p)]
      const turns = num(p.turn_count)
      if (turns != null) {
        parts.push(plural(turns, 'turn'))
      }
      const tools = num(p.tool_uses)
      if (tools != null) {
        parts.push(plural(tools, 'tool'))
      }
      if (num(p.input_tokens) != null || num(p.output_tokens) != null) {
        parts.push(
          `in ${formatTokens(num(p.input_tokens))} out ${formatTokens(num(p.output_tokens))}`,
        )
      }
      const dur = num(p.duration_ms)
      if (dur != null) {
        parts.push(formatMs(dur))
      }
      return parts.join(' · ')
    }
    case 'PreCompact': {
      const ctx = contextSummary(obj(p.context))
      return `Compacting (${str(p.trigger) ?? 'unknown'})${ctx ? ` · ${ctx}` : ''}`
    }
    case 'PostCompact': {
      const before = num(p.tokens_before)
      return `Compacted (${str(p.trigger) ?? 'unknown'})${before != null ? ` · ${formatTokens(before)} before` : ''}`
    }
    case 'CompactionFailed': {
      const err = str(p.error)
      return `Compaction failed (${str(p.trigger) ?? 'unknown'})${err ? `: ${oneLine(err)}` : ''}`
    }
    case 'ModelChange': {
      const model = str(p.model) ?? '?'
      const prev = str(p.previous_model)
      const source = str(p.source)
      return `${prev ? `${prev} → ` : ''}${model}${source ? ` (${source})` : ''}`
    }
    case 'ThinkingLevelChange': {
      const prev = str(p.previous_level)
      return `${prev ? `${prev} → ` : ''}${str(p.level) ?? '?'}`
    }
    case 'Notification':
      return oneLine(str(p.message) ?? 'pi is waiting for input')
    case 'CustomMessage': {
      const type = str(p.custom_type)
      const text = oneLine(str(p.text) ?? '')
      return type ? `[${type}] ${text}` : text
    }
    default:
      return ''
  }
}

// ── Prose ───────────────────────────────────────────────────────────

/** First line of a failed tool's error, for display under the row. */
function toolErrorLine(event: ParsedEvent, p: Payload): string | null {
  if (!piIsFailure(event)) {
    return null
  }
  const err = str(p.error) ?? toolResult(p)?.content
  if (!err) {
    return null
  }
  if (piToolKind(event.toolName) === 'bash') {
    const parsed = parseBashOutput(err, true)
    return parsed.statusLine
      ? `${parsed.statusLine}${parsed.output ? ` — ${oneLine(parsed.output)}` : ''}`
      : oneLine(err)
  }
  return oneLine(err)
}

export function piProse(event: ParsedEvent): string | null {
  const p = payloadOf(event)
  if (isToolSubtype(event.subtype)) {
    return toolErrorLine(event, p)
  }
  switch (event.subtype) {
    case 'UserPromptSubmit':
      return str(p.prompt) ?? null
    case 'LLMGeneration':
      return str(p.text) ?? str(p.error_message) ?? null
    case 'CustomMessage':
      return p.custom_type === 'subagent-result' ? (str(p.text) ?? null) : null
    case 'Notification':
      return str(p.message) ?? null
    case 'CompactionFailed':
      return str(p.error) ?? null
    default:
      return null
  }
}

// ── Badges ──────────────────────────────────────────────────────────

export function piBadges(event: ParsedEvent): RowBadge[] {
  const p = payloadOf(event)
  const out: RowBadge[] = []
  if (event.subtype === 'UserPromptSubmit' && p.source === 'extension') {
    out.push({
      text: 'injected',
      tone: 'warn',
      title: 'Sent by an extension, not typed by the user (source: extension)',
    })
  }
  if (event.subtype === 'SubagentStart' && p.background === true) {
    out.push({ text: 'background', tone: 'muted' })
  }
  if (isToolSubtype(event.subtype) && piToolKind(event.toolName) === 'spawn') {
    if (toolInputOf(p)?.run_in_background === true) {
      out.push({ text: 'background', tone: 'muted' })
    }
  }
  if (event.subtype === 'CustomMessage' && p.custom_type === 'subagent-result') {
    out.push({ text: 'subagent result', tone: 'accent' })
  }
  if (event.subtype === 'UserBash' && p.exclude_from_context === true) {
    out.push({ text: 'not in context', tone: 'muted' })
  }
  if (event.subtype === 'LLMGeneration') {
    const status = num(p.http_status)
    if (status != null && status >= 400) {
      out.push({ text: `HTTP ${status}`, tone: 'fail' })
    }
  }
  return out
}

// ── Chat ────────────────────────────────────────────────────────────

export function piChat(event: ParsedEvent): ChatMessage | null {
  const p = payloadOf(event)
  switch (event.subtype) {
    case 'UserPromptSubmit': {
      const text = str(p.prompt)
      if (!text) {
        return null
      }
      return {
        kind: 'user',
        text,
        source: str(p.source),
        injected: p.source === 'extension',
        images: num(p.images),
      }
    }
    case 'LLMGeneration': {
      const text = str(p.text)
      const thinking = str(p.thinking)
      const failed = llmFailed(p)
      if (!text && !thinking && !failed) {
        return null
      }
      const msg: ChatMessage = {
        kind: 'assistant',
        text: text ?? str(p.error_message) ?? '',
      }
      if (thinking) {
        msg.thinking = thinking
      }
      if (failed) {
        msg.failed = true
      }
      return msg
    }
    case 'SubagentStart':
      return {
        kind: 'subagent-start',
        agentName: str(p.agent_name),
        description: str(p.agent_description),
      }
    case 'SubagentStop':
      return {
        kind: 'subagent-stop',
        agentName: str(p.agent_name),
        description: str(p.agent_description),
      }
    case 'CustomMessage': {
      const text = str(p.text)
      if (p.custom_type !== 'subagent-result' || !text) {
        return null
      }
      return { kind: 'subagent-result', text }
    }
    case 'Notification':
      return { kind: 'status', text: str(p.message) ?? 'pi is waiting for input' }
    default:
      return null
  }
}

// ── Linkage ─────────────────────────────────────────────────────────

export function piSpawnLink(event: ParsedEvent): SpawnLink | null {
  const p = payloadOf(event)
  if (event.subtype === 'SubagentStart') {
    const agentId = str(p.agent_id)
    if (!agentId) {
      return null
    }
    return {
      agentId,
      parentToolUseId: str(p.parent_tool_use_id) ?? null,
      parentAgentId: str(p.parent_agent_id) ?? null,
      agentType: str(p.agent_type),
      agentName: str(p.agent_name),
      description: str(p.agent_description),
      background: p.background === true,
    }
  }
  // A background Agent call returns before its child settles; the extension
  // reads the child's id from the result and names it here.
  if (
    (event.subtype === 'PostToolUse' || event.subtype === 'PostToolUseFailure') &&
    str(p.spawned_agent_id) &&
    event.toolUseId
  ) {
    return {
      agentId: str(p.spawned_agent_id)!,
      parentToolUseId: event.toolUseId,
      parentAgentId: str(p.agent_id) ?? null,
      background: true,
    }
  }
  return null
}

export function piIdentity(event: ParsedEvent): AgentIdentity | null {
  const p = payloadOf(event)
  const agentId = str(p.agent_id)
  if (!agentId) {
    return null
  }
  return {
    agentId,
    // Top-level children hang off the session's root agent, whose id is the session id.
    parentAgentId: str(p.parent_agent_id) ?? str(p.session_id) ?? event.sessionId,
    name: str(p.agent_name) ?? null,
    agentType: str(p.agent_type) ?? null,
    description: str(p.agent_description) ?? null,
  }
}
