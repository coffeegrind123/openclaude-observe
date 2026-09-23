import { describe, expect, it } from 'vitest'
import { piFixtureEvents, PI_SESSION_ID, PI_SUBAGENT_ID } from '@/test/pi-fixture'
import { piClass } from '@/agents/registry'
import { piModelIds, piTokenStats } from './stats'
import { buildAgentsTable } from '@/components/settings/sections/token-usage-section'
import type { ParsedEvent } from '@/types'

const RATE = {
  inputPerM: 1,
  outputPerM: 10,
  cacheReadPerM: 0.1,
  cacheCreate5mPerM: 2,
  cacheCreate1hPerM: 2,
}

/** The fixture with pi's recorded cost removed from every generation. */
function withoutRecordedCost(events: ParsedEvent[]): ParsedEvent[] {
  return events.map((e) => {
    if (e.subtype !== 'LLMGeneration') {
      return e
    }
    const { cost_usd: _drop, ...payload } = e.payload as Record<string, unknown>
    return { ...e, payload }
  })
}

describe('pi stats provider (events → token dataset)', () => {
  it('is registered on the pi agent class', () => {
    expect(piClass.stats).toBeDefined()
  })

  it('totals every LLMGeneration of the captured session, parent and subagent', () => {
    const stats = piTokenStats(piFixtureEvents(), PI_SESSION_ID, {})

    expect(stats.source).toBe('events')
    expect(stats.summary.totalCalls).toBe(5)
    // Bundled input: fresh + cache read + cache write, as the transcript tables show it.
    expect(stats.summary.inputTotal).toBe(6652 + 46 + 6900 + 3796 + 19 + 3834 + 7063)
    expect(stats.summary.outputTotal).toBe(247 + 101 + 39 + 18 + 13)
    expect(stats.summary.cacheHitRate).toBeCloseTo((6900 + 3834) / stats.summary.inputTotal)
    expect(stats.summary.userPrompts).toBe(1)
    expect(stats.byModel).toHaveLength(1)
    expect(stats.byModel[0].model).toBe('qwen3.8-27b')
    expect(stats.byModel[0].calls).toBe(5)
  })

  it("pi's recorded cost wins: forge's cost_usd 0 is a real $0, not 'unknown'", () => {
    // Even with a models.dev price for the model, the recorded 0 stands.
    const stats = piTokenStats(piFixtureEvents(), PI_SESSION_ID, { 'qwen3.8-27b': RATE })
    expect(stats.summary.costTotalCents).toBe(0)
    expect(stats.byModel[0].costCents).toBe(0)
    // Nothing needs pricing when every request carries a cost.
    expect(piModelIds(piFixtureEvents())).toEqual([])
  })

  it('prices requests without a recorded cost from models.dev', () => {
    const events = withoutRecordedCost(piFixtureEvents())
    expect(piModelIds(events)).toEqual(['qwen3.8-27b'])

    const stats = piTokenStats(events, PI_SESSION_ID, { 'qwen3.8-27b': RATE })
    const fresh = 6652 + 46 + 3796 + 19 + 7063
    const cacheRead = 6900 + 3834
    const output = 247 + 101 + 39 + 18 + 13
    const expectedCents = ((fresh * 1 + output * 10 + cacheRead * 0.1) / 1_000_000) * 100
    expect(stats.summary.costTotalCents).toBeCloseTo(expectedCents, 6)
    expect(stats.models['qwen3.8-27b'].pricing).toEqual(RATE)
  })

  it('an unpriced request without a recorded cost makes the total unknown', () => {
    const stats = piTokenStats(withoutRecordedCost(piFixtureEvents()), PI_SESSION_ID, {})
    expect(stats.summary.costTotalCents).toBeNull()
    expect(stats.models['qwen3.8-27b'].pricing).toBeNull()
  })

  it('gives the in-memory subagent its own row from its agent_id events', () => {
    const stats = piTokenStats(piFixtureEvents(), PI_SESSION_ID, {})
    expect(stats.subagents).toHaveLength(1)
    const sub = stats.subagents[0]
    expect(sub.agentId).toBe(PI_SUBAGENT_ID)
    expect(sub.agentType).toBe('general-purpose')
    expect(sub.description).toBe('Count lines in notes.txt')
    expect(sub.toolUseId).toBe('call_358b73ae')
    expect(sub.model).toBe('qwen3.8-27b')
    expect(sub.requests).toBe(2)
    expect(sub.inputTokens).toBe(3796 + 19 + 3834)
    expect(sub.outputTokens).toBe(39 + 18)
    expect(sub.toolCount).toBeGreaterThan(0)
    expect(sub.durationMs).toBeGreaterThan(0)
  })

  it('attributes the subagent requests to the prompt that spawned it', () => {
    const stats = piTokenStats(piFixtureEvents(), PI_SESSION_ID, {})
    expect(stats.prompts).toHaveLength(1)
    const prompt = stats.prompts[0]
    expect(prompt.text).toMatch(/^Do exactly these steps/)
    expect(prompt.requests).toBe(5)
    expect(prompt.models).toEqual(['qwen3.8-27b'])
    expect(prompt.costCents).toBe(0)
    expect(prompt.durationMs).toBeGreaterThan(0)
  })

  it('feeds the Agents table: main agent = totals minus the subagent', () => {
    const stats = piTokenStats(piFixtureEvents(), PI_SESSION_ID, {})
    const { agentRows } = buildAgentsTable({
      mainAgentId: PI_SESSION_ID,
      sessionDurationMs: 1000,
      mainAgentToolCount: 4,
      eventSubagents: [],
      transcript: stats,
    })
    const main = agentRows.find((r) => r.isMain)!
    expect(main.requests).toBe(3)
    expect(main.outputTokens).toBe(247 + 101 + 13)
    const sub = agentRows.find((r) => r.agentId === PI_SUBAGENT_ID)!
    expect(sub.requests).toBe(2)
  })
})
