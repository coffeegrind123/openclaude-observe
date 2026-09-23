import { describe, it, expect } from 'vitest'
import {
  formatTps,
  formatRatio,
  compactTokens,
  contextLevel,
  weightedDecodeTps,
  weightedAcceptance,
  latestContext,
} from './stack-format'
import type { StackSample } from '@/types/stack'

function sample(p: Partial<StackSample>): StackSample {
  return {
    at: 0,
    intervalMs: 5000,
    decodeTps: null,
    prefillTps: null,
    acceptance: null,
    acceptedPerDraft: null,
    cacheReuse: null,
    generatedTokens: 0,
    prefillTokens: 0,
    cachedTokens: 0,
    draftTokens: 0,
    acceptedTokens: 0,
    drafts: 0,
    requestsProcessing: 0,
    requestsDeferred: 0,
    context: null,
    ...p,
  }
}

describe('stack-format', () => {
  it('formats rates, ratios and token counts', () => {
    expect(formatTps(63.94)).toBe('63.9 t/s')
    expect(formatTps(1982.1)).toBe('1,982 t/s')
    expect(formatTps(null)).toBe('—')
    expect(formatRatio(0.6312)).toBe('63%')
    expect(formatRatio(null)).toBe('—')
    expect(compactTokens(1284)).toBe('1.3K')
    expect(compactTokens(1_200_000)).toBe('1.2M')
    expect(compactTokens(12)).toBe('12')
  })

  it('grades context fill', () => {
    expect(contextLevel(10)).toBe('ok')
    expect(contextLevel(70)).toBe('warn')
    expect(contextLevel(85)).toBe('critical')
  })

  it('weights decode speed by tokens, ignoring idle samples', () => {
    const avg = weightedDecodeTps([
      sample({ decodeTps: 100, generatedTokens: 1000 }), // 10 s
      sample({ decodeTps: 10, generatedTokens: 10 }), // 1 s
      sample({ decodeTps: null }),
    ])
    expect(avg).toBeCloseTo(1010 / 11)
    expect(weightedDecodeTps([sample({})])).toBeNull()
  })

  it('weights acceptance by drafted tokens', () => {
    expect(
      weightedAcceptance([
        sample({ draftTokens: 100, acceptedTokens: 80 }),
        sample({ draftTokens: 10, acceptedTokens: 0 }),
      ]),
    ).toBeCloseTo(80 / 110)
    expect(weightedAcceptance([])).toBeNull()
  })

  it('finds the most recent context reading', () => {
    const ctx = { currentTokens: 1, contextWindow: 10, percent: 10, model: null }
    expect(latestContext([sample({ context: ctx }), sample({})])).toBe(ctx)
    expect(latestContext([])).toBeNull()
  })
})
