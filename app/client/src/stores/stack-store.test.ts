import { describe, it, expect, beforeEach } from 'vitest'
import { useStackStore, MAX_STACK_SAMPLES } from './stack-store'
import type { StackSample, StackTotals } from '@/types/stack'

const totals: StackTotals = {
  generatedTokens: 0,
  prefillTokens: 0,
  cachedTokens: 0,
  drafts: 0,
  draftTokens: 0,
  acceptance: null,
  acceptedPerDraft: null,
  cacheReuse: null,
  decodeTps: null,
  prefillTps: null,
  acceptedPerPos: [],
}

function sample(at: number): StackSample {
  return {
    at,
    intervalMs: 5000,
    decodeTps: 50,
    prefillTps: null,
    acceptance: null,
    acceptedPerDraft: null,
    cacheReuse: null,
    generatedTokens: 1,
    prefillTokens: 0,
    cachedTokens: 0,
    draftTokens: 0,
    acceptedTokens: 0,
    drafts: 0,
    requestsProcessing: 0,
    requestsDeferred: 0,
    context: null,
  }
}

describe('stack-store', () => {
  beforeEach(() => {
    useStackStore.setState({ status: { state: 'starting' }, samples: [], totals: null, hydrated: false })
  })

  it('keeps a live sample that arrived before the initial snapshot', () => {
    useStackStore.getState().pushSample(sample(30), totals)
    useStackStore.getState().hydrate({
      status: { state: 'ok' },
      latest: sample(20),
      totals,
      samples: [sample(10), sample(20)],
    })
    expect(useStackStore.getState().samples.map((s) => s.at)).toEqual([10, 20, 30])
    expect(useStackStore.getState().hydrated).toBe(true)
  })

  it('ignores out-of-order and duplicate samples', () => {
    const { pushSample } = useStackStore.getState()
    pushSample(sample(10), totals)
    pushSample(sample(10), totals)
    pushSample(sample(5), totals)
    expect(useStackStore.getState().samples.map((s) => s.at)).toEqual([10])
  })

  it('caps history and marks the stack ok when samples flow', () => {
    useStackStore.setState({ status: { state: 'unreachable', lastError: 'x' } })
    for (let i = 1; i <= MAX_STACK_SAMPLES + 5; i++) {
      useStackStore.getState().pushSample(sample(i), totals)
    }
    const s = useStackStore.getState()
    expect(s.samples).toHaveLength(MAX_STACK_SAMPLES)
    expect(s.samples[0].at).toBe(6)
    expect(s.status.state).toBe('ok')
  })
})
