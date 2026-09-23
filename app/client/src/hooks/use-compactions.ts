// Hook: pair each PreCompact with its outcome (PostCompact or CompactionFailed)
// on the same agent, with the context size before and after.
//
// pi reports `context` (ctx.getContextUsage) on PreCompact and PostCompact and
// `tokens_before` on PostCompact; when one is missing the flanking
// LLMGeneration's `context_tokens` stands in.

import { useMemo } from 'react'
import type { ParsedEvent } from '@/types'

export interface CompactionInfo {
  preEventId: number
  /** The PostCompact or CompactionFailed event, when it has arrived. */
  postEventId: number | null
  /** pi's reason: 'manual' | 'threshold' | 'overflow' (or 'unknown'). */
  trigger: string
  failed: boolean
  error?: string | null
  willRetry: boolean
  customInstructions?: string | null
  compactSummary?: string | null
  tokensBefore: number
  tokensAfter: number
  tokensDropped: number
  timestampStart: number
  timestampEnd: number | null
}

type P = Record<string, unknown>

function numOr(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function contextTokens(p: P | undefined): number | null {
  const ctx = p?.context as P | undefined
  return typeof ctx?.tokens === 'number' ? ctx.tokens : null
}

/** Context size an LLM call left behind: context_tokens, else its prompt size. */
function llmContext(p: P): number | null {
  if (typeof p.context_tokens === 'number') {
    return p.context_tokens
  }
  if (typeof p.input_tokens === 'number') {
    return p.input_tokens + numOr(p.cache_read_tokens) + numOr(p.cache_creation_tokens)
  }
  return null
}

export function buildCompactions(events: readonly ParsedEvent[]): Map<number, CompactionInfo> {
  const result = new Map<number, CompactionInfo>()

  function llmNear(from: number, step: 1 | -1, agentId: string): number | null {
    for (let j = from + step; j >= 0 && j < events.length; j += step) {
      const e = events[j]
      if (e.subtype === 'LLMGeneration' && e.agentId === agentId) {
        return llmContext(e.payload as P)
      }
    }
    return null
  }

  for (let i = 0; i < events.length; i++) {
    const ev = events[i]
    if (ev.subtype !== 'PreCompact') {
      continue
    }
    const p = ev.payload as P

    let postIdx = -1
    for (let j = i + 1; j < events.length; j++) {
      const e = events[j]
      if (e.agentId !== ev.agentId) {
        continue
      }
      if (e.subtype === 'PostCompact' || e.subtype === 'CompactionFailed') {
        postIdx = j
        break
      }
      if (e.subtype === 'PreCompact') {
        break
      }
    }
    const post = postIdx >= 0 ? events[postIdx] : null
    const pp = post?.payload as P | undefined
    const failed = post?.subtype === 'CompactionFailed'

    const tokensBefore =
      (typeof pp?.tokens_before === 'number' ? pp.tokens_before : null) ??
      contextTokens(p) ??
      llmNear(i, -1, ev.agentId) ??
      0
    const tokensAfter =
      post && !failed ? (contextTokens(pp) ?? llmNear(postIdx, 1, ev.agentId) ?? 0) : 0

    result.set(ev.id, {
      preEventId: ev.id,
      postEventId: post?.id ?? null,
      trigger: typeof p.trigger === 'string' ? p.trigger : 'unknown',
      failed,
      error: failed && typeof pp?.error === 'string' ? pp.error : null,
      willRetry: (pp?.will_retry ?? p.will_retry) === true,
      customInstructions: typeof p.custom_instructions === 'string' ? p.custom_instructions : null,
      compactSummary: typeof pp?.summary === 'string' && pp.summary ? pp.summary : null,
      tokensBefore,
      tokensAfter,
      tokensDropped: tokensAfter > 0 ? Math.max(0, tokensBefore - tokensAfter) : 0,
      timestampStart: ev.timestamp,
      timestampEnd: post?.timestamp ?? null,
    })
  }
  return result
}

export function useCompactions(events: ParsedEvent[] | undefined): Map<number, CompactionInfo> {
  return useMemo(() => buildCompactions(events ?? []), [events])
}
