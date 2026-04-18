// Hook: compute compaction boundaries by pairing PreCompact → PostCompact
// events and looking at the flanking LLMGeneration events to derive the
// actual token drop (OpenClaude's PreCompact payload doesn't carry tokens,
// so we read them from the adjacent LLM calls).

import { useMemo } from 'react'
import type { ParsedEvent } from '@/types'

export interface CompactionInfo {
  preEventId: number
  postEventId: number | null
  trigger: 'manual' | 'auto' | 'unknown'
  customInstructions?: string | null
  compactSummary?: string | null
  tokensBefore: number
  tokensAfter: number
  tokensDropped: number
  timestampStart: number
  timestampEnd: number | null
}

export function useCompactions(events: ParsedEvent[] | undefined): Map<number, CompactionInfo> {
  return useMemo(() => {
    const result = new Map<number, CompactionInfo>()
    if (!events || events.length === 0) return result

    // Find last LLMGeneration input_tokens before index `i`.
    function prevLlmTokens(i: number): number {
      for (let j = i - 1; j >= 0; j--) {
        if (events![j].subtype === 'LLMGeneration') {
          const p = events![j].payload as Record<string, any>
          const v = p.input_tokens
          if (typeof v === 'number') return v
        }
      }
      return 0
    }

    // Find first LLMGeneration input_tokens after index `i`.
    function nextLlmTokens(i: number): number {
      for (let j = i + 1; j < events!.length; j++) {
        if (events![j].subtype === 'LLMGeneration') {
          const p = events![j].payload as Record<string, any>
          const v = p.input_tokens
          if (typeof v === 'number') return v
        }
      }
      return 0
    }

    // Walk events, pair PreCompact with its next PostCompact (linear scan
    // because compactions are sequential per session).
    for (let i = 0; i < events.length; i++) {
      const ev = events[i]
      if (ev.subtype !== 'PreCompact') continue
      const p = ev.payload as Record<string, any>
      const trigger = (p.trigger as 'manual' | 'auto') || 'unknown'

      // Find paired PostCompact
      let postIdx = -1
      for (let j = i + 1; j < events.length; j++) {
        if (events[j].subtype === 'PostCompact') {
          postIdx = j
          break
        }
        // Don't pair across another PreCompact (shouldn't happen but defensive).
        if (events[j].subtype === 'PreCompact') break
      }
      const post = postIdx >= 0 ? events[postIdx] : null
      const postPayload = post?.payload as Record<string, any> | undefined

      const tokensBefore = prevLlmTokens(i)
      const tokensAfter = postIdx >= 0 ? nextLlmTokens(postIdx) : 0
      const tokensDropped = Math.max(0, tokensBefore - tokensAfter)

      result.set(ev.id, {
        preEventId: ev.id,
        postEventId: post?.id ?? null,
        trigger,
        customInstructions: (p.custom_instructions as string | null) ?? null,
        compactSummary: (postPayload?.compact_summary as string | null) ?? null,
        tokensBefore,
        tokensAfter,
        tokensDropped,
        timestampStart: ev.timestamp,
        timestampEnd: post?.timestamp ?? null,
      })
    }
    return result
  }, [events])
}
