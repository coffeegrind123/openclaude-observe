// Token usage for a pi session computed from its events, for when the JSONL
// transcript can't be read (`--no-session`, a transcript outside the configured
// pi homes, transcript stats disabled, a missing file).
//
// Every LLMGeneration carries the request's usage and the cost pi itself
// recorded (`cost_usd`, from the operator's model config — 0 for a local model
// on forge). That recorded cost wins; models.dev pricing (GET
// /api/models/pricing) only prices requests that carry none. Same rule as the
// server's transcript-parser callCostCents.
//
// Subagents run in-memory and have no transcript of their own, but their
// LLMGeneration events carry `agent_id`, so they get exact per-request rows
// here too.

import type { ParsedEvent } from '@/types'
import type {
  TranscriptStatsByModel,
  TranscriptStatsData,
  TranscriptStatsModelPricing,
  TranscriptStatsPrompt,
  TranscriptStatsSubagent,
} from '@/lib/api-client'
import type { AgentStatsProvider, PricingMap } from '../types'
import { num, str, type Payload } from '../payload'

interface Usage {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

interface Call {
  agentId: string
  model: string
  timestamp: number
  usage: Usage
  costCents: number | null
}

function payloadOf(e: ParsedEvent): Payload {
  return (e.payload ?? {}) as Payload
}

/** The model that actually served the request, else the one pi asked for. */
function modelOf(p: Payload): string {
  return str(p.actual_model) ?? str(p.model) ?? 'unknown'
}

function isTopLevel(e: ParsedEvent, sessionId: string): boolean {
  return e.agentId === sessionId && str(payloadOf(e).agent_id) == null
}

/** Bundled input as the tables show it: fresh + cache read + cache write. */
function bundledInput(u: Usage): number {
  return u.input + u.cacheRead + u.cacheWrite
}

function priceCents(u: Usage, pricing: TranscriptStatsModelPricing): number {
  const dollars =
    (u.input * pricing.inputPerM +
      u.output * pricing.outputPerM +
      u.cacheRead * pricing.cacheReadPerM +
      u.cacheWrite * pricing.cacheCreate5mPerM) /
    1_000_000
  return dollars * 100
}

/** One request's cost in cents: pi's recorded cost, else pricing, else unknown. */
export function callCostCents(
  p: Payload,
  usage: Usage,
  model: string,
  pricing: PricingMap,
): number | null {
  const recorded = num(p.cost_usd)
  if (recorded != null) {
    return recorded * 100
  }
  const rate = pricing[model]
  return rate ? priceCents(usage, rate) : null
}

/** Running sum where any unknown term makes the total unknown. */
function addCost(total: number | null, term: number | null): number | null {
  return total === null || term === null ? null : total + term
}

function llmCalls(events: ParsedEvent[], pricing: PricingMap): Call[] {
  const calls: Call[] = []
  for (const e of events) {
    if (e.subtype !== 'LLMGeneration') {
      continue
    }
    const p = payloadOf(e)
    const usage: Usage = {
      input: num(p.input_tokens) ?? 0,
      output: num(p.output_tokens) ?? 0,
      cacheRead: num(p.cache_read_tokens) ?? 0,
      cacheWrite: num(p.cache_creation_tokens) ?? 0,
    }
    const model = modelOf(p)
    calls.push({
      agentId: e.agentId,
      model,
      timestamp: e.timestamp,
      usage,
      costCents: callCostCents(p, usage, model, pricing),
    })
  }
  return calls
}

function byModel(calls: Call[]): TranscriptStatsByModel[] {
  const rows = new Map<string, TranscriptStatsByModel>()
  for (const c of calls) {
    const row = rows.get(c.model) ?? {
      model: c.model,
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreate5mTokens: 0,
      cacheCreate1hTokens: 0,
      costCents: 0,
    }
    row.calls += 1
    row.inputTokens += bundledInput(c.usage)
    row.outputTokens += c.usage.output
    row.cacheReadTokens += c.usage.cacheRead
    row.cacheCreate5mTokens += c.usage.cacheWrite
    row.costCents = addCost(row.costCents, c.costCents)
    rows.set(c.model, row)
  }
  return [...rows.values()]
}

function subagents(
  events: ParsedEvent[],
  calls: Call[],
  sessionId: string,
): TranscriptStatsSubagent[] {
  const rows = new Map<string, TranscriptStatsSubagent & { first: number; last: number }>()
  const row = (agentId: string, ts: number) => {
    let r = rows.get(agentId)
    if (!r) {
      r = {
        agentId,
        agentType: null,
        description: null,
        toolUseId: null,
        model: '',
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreate5mTokens: 0,
        cacheCreate1hTokens: 0,
        durationMs: 0,
        toolCount: 0,
        costCents: 0,
        first: ts,
        last: ts,
      }
      rows.set(agentId, r)
    }
    r.first = Math.min(r.first, ts)
    r.last = Math.max(r.last, ts)
    return r
  }

  for (const e of events) {
    if (isTopLevel(e, sessionId)) {
      continue
    }
    const p = payloadOf(e)
    const r = row(e.agentId, e.timestamp)
    r.agentType = r.agentType ?? str(p.agent_type) ?? null
    r.description = r.description ?? str(p.agent_description) ?? null
    r.toolUseId = r.toolUseId ?? str(p.parent_tool_use_id) ?? null
    if (e.subtype === 'PreToolUse') {
      r.toolCount += 1
    }
    if (e.subtype === 'SubagentStop') {
      const d = num(p.duration_ms)
      if (d != null) {
        r.durationMs = d
      }
    }
  }

  // Most-used model per subagent: applyMainAgentFromTranscript subtracts a
  // subagent's totals from the byModel row of its `model`.
  const modelCounts = new Map<string, Map<string, number>>()
  for (const c of calls) {
    if (c.agentId === sessionId) {
      continue
    }
    const r = row(c.agentId, c.timestamp)
    r.requests += 1
    r.inputTokens += bundledInput(c.usage)
    r.outputTokens += c.usage.output
    r.cacheReadTokens += c.usage.cacheRead
    r.cacheCreate5mTokens += c.usage.cacheWrite
    r.costCents = addCost(r.costCents, c.costCents)
    const counts = modelCounts.get(c.agentId) ?? new Map<string, number>()
    counts.set(c.model, (counts.get(c.model) ?? 0) + 1)
    modelCounts.set(c.agentId, counts)
  }

  return [...rows.values()].map(({ first, last, ...r }) => {
    const counts = modelCounts.get(r.agentId)
    const model = counts ? [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0] : ''
    return { ...r, model, durationMs: r.durationMs || last - first }
  })
}

/**
 * Prompt buckets: each top-level UserPromptSubmit opens one and owns every
 * event until the next. Subagents run inside their parent's turn, so their
 * requests land in the prompt that spawned them.
 */
function prompts(events: ParsedEvent[], sessionId: string, pricing: PricingMap) {
  const out: TranscriptStatsPrompt[] = []
  let cur: (TranscriptStatsPrompt & { models: string[]; last: number }) | null = null
  const close = () => {
    if (!cur) {
      return
    }
    const { last, ...row } = cur
    out.push({ ...row, durationMs: last - row.timestamp })
    cur = null
  }

  for (const e of events) {
    const p = payloadOf(e)
    if (e.subtype === 'UserPromptSubmit' && isTopLevel(e, sessionId)) {
      close()
      cur = {
        promptId: String(e.id),
        text: str(p.prompt) ?? '',
        command: null,
        timestamp: e.timestamp,
        durationMs: null,
        toolCount: 0,
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreate5mTokens: 0,
        cacheCreate1hTokens: 0,
        models: [],
        costCents: 0,
        last: e.timestamp,
      }
      continue
    }
    if (!cur) {
      continue
    }
    const bucket: TranscriptStatsPrompt & { models: string[]; last: number } = cur
    bucket.last = Math.max(bucket.last, e.timestamp)
    if (e.subtype === 'PreToolUse') {
      bucket.toolCount += 1
    }
    if (e.subtype !== 'LLMGeneration') {
      continue
    }
    const [call] = llmCalls([e], pricing)
    bucket.requests += 1
    bucket.inputTokens += bundledInput(call.usage)
    bucket.outputTokens += call.usage.output
    bucket.cacheReadTokens += call.usage.cacheRead
    bucket.cacheCreate5mTokens += call.usage.cacheWrite
    bucket.costCents = addCost(bucket.costCents, call.costCents)
    if (!bucket.models.includes(call.model)) {
      bucket.models.push(call.model)
    }
  }
  close()
  return out
}

export function piModelIds(events: ParsedEvent[]): string[] {
  const ids = new Set<string>()
  for (const e of events) {
    if (e.subtype !== 'LLMGeneration') {
      continue
    }
    const p = payloadOf(e)
    // Only requests without a recorded cost need a price.
    if (num(p.cost_usd) != null) {
      continue
    }
    ids.add(modelOf(p))
  }
  return [...ids].sort()
}

export function piTokenStats(
  events: ParsedEvent[],
  sessionId: string,
  pricing: PricingMap,
): TranscriptStatsData {
  const calls = llmCalls(events, pricing)
  const models = byModel(calls)

  let inputTotal = 0
  let outputTotal = 0
  let cacheRead = 0
  let costTotalCents: number | null = 0
  for (const c of calls) {
    inputTotal += bundledInput(c.usage)
    outputTotal += c.usage.output
    cacheRead += c.usage.cacheRead
    costTotalCents = addCost(costTotalCents, c.costCents)
  }

  const promptRows = prompts(events, sessionId, pricing)
  const startedAt = events.length > 0 ? events[0].timestamp : null
  const endedAt = events.length > 0 ? events[events.length - 1].timestamp : null

  return {
    source: 'events',
    summary: {
      totalCalls: calls.length,
      inputTotal,
      outputTotal,
      cacheHitRate: inputTotal > 0 ? cacheRead / inputTotal : 0,
      costTotalCents,
      startedAt,
      durationMs: startedAt != null && endedAt != null ? endedAt - startedAt : null,
      toolCalls: events.filter((e) => e.subtype === 'PreToolUse').length,
      // Overview counts stay events-derived in SessionStats; these are
      // transcript-only refinements.
      filesRead: 0,
      filesEdited: 0,
      gitCommits: 0,
      toolStats: [],
      userPrompts: promptRows.length,
    },
    byModel: models,
    prompts: promptRows,
    subagents: subagents(events, calls, sessionId),
    models: Object.fromEntries(models.map((m) => [m.model, { pricing: pricing[m.model] ?? null }])),
    errors: [],
  }
}

export const piStatsProvider: AgentStatsProvider = {
  modelIds: piModelIds,
  computeTokenStats: piTokenStats,
}
