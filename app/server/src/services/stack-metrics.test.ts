import { describe, test, expect, vi } from 'vitest'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import {
  parseLlamaMetrics,
  diffSnapshots,
  isReset,
  totalsOf,
  parseForgeUsage,
  StackPoller,
  type LlamaSnapshot,
} from './stack-metrics'

// Real /metrics body captured from the instantcoffee stack (llama.cpp b11118).
const FIXTURE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '__fixtures__', 'llama-metrics-b11118.txt'),
  'utf8',
)

function snap(counters: Record<string, number>, at = 0, restartToken: string | null = 't1'): LlamaSnapshot {
  return { at, restartToken, counters, acceptedPerPos: [] }
}

describe('parseLlamaMetrics', () => {
  test('parses the real llama.cpp exposition', () => {
    const s = parseLlamaMetrics(FIXTURE, 'tok', 123)

    expect(s.at).toBe(123)
    expect(s.restartToken).toBe('tok')
    for (const name of [
      'prompt_tokens_total',
      'prompt_tokens_cached_total',
      'tokens_predicted_total',
      'tokens_predicted_seconds_total',
      'spec_decode_num_draft_tokens_total',
      'spec_decode_num_accepted_tokens_total',
      'spec_decode_num_drafts_total',
      'requests_processing',
    ]) {
      expect(typeof s.counters[name], name).toBe('number')
    }
    expect(s.acceptedPerPos.length).toBeGreaterThan(4)
    // Draft positions can only be reached in order, so acceptance never rises
    // with depth.
    for (let i = 1; i < s.acceptedPerPos.length; i++) {
      expect(s.acceptedPerPos[i]).toBeLessThanOrEqual(s.acceptedPerPos[i - 1])
    }
  })

  test('ignores comments, blank lines, junk values and foreign metrics', () => {
    const s = parseLlamaMetrics(
      [
        '# HELP llamacpp:x help',
        '',
        'llamacpp:tokens_predicted_total 10',
        'llamacpp:bad NaN-ish',
        'other_exporter_metric 5',
        'llamacpp:spec_decode_num_accepted_tokens_per_pos_total{position="2"} 3',
      ].join('\n'),
      null,
      0,
    )

    expect(s.counters).toEqual({ tokens_predicted_total: 10 })
    expect(s.acceptedPerPos).toEqual([0, 0, 3])
  })
})

describe('diffSnapshots', () => {
  test('computes busy-time rates and ratios over the interval', () => {
    const prev = snap(
      {
        tokens_predicted_total: 100,
        tokens_predicted_seconds_total: 2,
        prompt_tokens_total: 1000,
        prompt_seconds_total: 1,
        prompt_tokens_cached_total: 5000,
        spec_decode_num_draft_tokens_total: 50,
        spec_decode_num_accepted_tokens_total: 30,
        spec_decode_num_drafts_total: 10,
      },
      1000,
    )
    const cur = snap(
      {
        tokens_predicted_total: 700,
        tokens_predicted_seconds_total: 12,
        prompt_tokens_total: 3000,
        prompt_seconds_total: 2,
        prompt_tokens_cached_total: 11000,
        spec_decode_num_draft_tokens_total: 150,
        spec_decode_num_accepted_tokens_total: 90,
        spec_decode_num_drafts_total: 30,
        requests_processing: 1,
      },
      6000,
    )

    const s = diffSnapshots(prev, cur, null)
    expect(s.intervalMs).toBe(5000)
    expect(s.decodeTps).toBe(60) // 600 tokens / 10 busy seconds
    expect(s.prefillTps).toBe(2000)
    expect(s.acceptance).toBe(0.6)
    expect(s.acceptedPerDraft).toBe(3)
    // prompt_tokens_total excludes cache hits: 6000 cached of 8000 total.
    expect(s.cacheReuse).toBe(0.75)
    expect(s.requestsProcessing).toBe(1)
  })

  test('reports null rates for an idle interval rather than 0 or NaN', () => {
    const c = { tokens_predicted_total: 5, tokens_predicted_seconds_total: 1 }
    const s = diffSnapshots(snap(c, 0), snap(c, 5000), null)

    expect(s.decodeTps).toBeNull()
    expect(s.prefillTps).toBeNull()
    expect(s.acceptance).toBeNull()
    expect(s.cacheReuse).toBeNull()
    expect(s.generatedTokens).toBe(0)
  })
})

describe('isReset', () => {
  test('detects a changed restart token', () => {
    expect(isReset(snap({}, 0, 'a'), snap({}, 1, 'b'))).toBe(true)
  })

  test('detects a counter going backwards even without a token', () => {
    expect(
      isReset(snap({ tokens_predicted_total: 50 }, 0, null), snap({ tokens_predicted_total: 3 }, 1, null)),
    ).toBe(true)
  })

  test('gauges falling is not a reset', () => {
    expect(isReset(snap({ requests_processing: 1 }), snap({ requests_processing: 0 }))).toBe(false)
  })
})

describe('totalsOf', () => {
  test('derives lifetime ratios from the real fixture', () => {
    const t = totalsOf(parseLlamaMetrics(FIXTURE, null, 0))
    expect(t.acceptance).toBeGreaterThan(0)
    expect(t.acceptance).toBeLessThanOrEqual(1)
    expect(t.cacheReuse).toBeGreaterThan(0)
    expect(t.cacheReuse).toBeLessThanOrEqual(1)
  })
})

describe('parseForgeUsage', () => {
  test('parses the real forge body', () => {
    expect(
      parseForgeUsage({
        current_usage_tokens: 22402,
        context_window_tokens: 98304,
        usage_percent: 22.78,
        model: 'qwen3.8-27b',
        context_window_source: 'operator_config',
      }),
    ).toEqual({ currentTokens: 22402, contextWindow: 98304, percent: 22.78, model: 'qwen3.8-27b' })
  })

  test('rejects unexpected shapes', () => {
    expect(parseForgeUsage(null)).toBeNull()
    expect(parseForgeUsage({ current_usage_tokens: 'x', context_window_tokens: 1 })).toBeNull()
    expect(parseForgeUsage({ current_usage_tokens: 1, context_window_tokens: 0 })).toBeNull()
  })
})

describe('StackPoller', () => {
  function metricsBody(predicted: number, seconds: number) {
    return `llamacpp:tokens_predicted_total ${predicted}\nllamacpp:tokens_predicted_seconds_total ${seconds}\n`
  }

  function makeFetch(responses: Array<{ body: string; token: string } | Error>) {
    let i = 0
    return vi.fn(async (url: string) => {
      if (String(url).endsWith('/forge/usage')) {
        return new Response(JSON.stringify({ current_usage_tokens: 10, context_window_tokens: 100 }))
      }
      const r = responses[Math.min(i++, responses.length - 1)]
      if (r instanceof Error) {
        throw r
      }
      return new Response(r.body, { headers: { 'Process-Start-Time-Unix': r.token } })
    }) as unknown as typeof fetch
  }

  function poller(fetchFn: typeof fetch, onSample = vi.fn(), onStatus = vi.fn()) {
    let t = 0
    const p = new StackPoller({
      llamaUrl: 'http://llama',
      forgeUrl: 'http://forge',
      pollMs: 5000,
      timeoutMs: 1000,
      maxSamples: 2,
      fetchFn,
      now: () => (t += 5000),
      onSample,
      onStatus,
    })
    return { p, onSample, onStatus }
  }

  test('first poll only baselines; second emits a sample with context', async () => {
    const { p, onSample } = poller(
      makeFetch([
        { body: metricsBody(0, 0), token: 'a' },
        { body: metricsBody(100, 2), token: 'a' },
      ]),
    )

    await p.tick()
    expect(onSample).not.toHaveBeenCalled()
    expect(p.view().status.state).toBe('ok')

    await p.tick()
    expect(onSample).toHaveBeenCalledTimes(1)
    const latest = p.view().latest!
    expect(latest.decodeTps).toBe(50)
    expect(latest.context?.percent).toBe(10)
  })

  test('a llama restart re-baselines instead of emitting a bogus sample', async () => {
    const { p, onSample } = poller(
      makeFetch([
        { body: metricsBody(1000, 20), token: 'a' },
        { body: metricsBody(10, 1), token: 'b' },
        { body: metricsBody(70, 2), token: 'b' },
      ]),
    )

    await p.tick()
    await p.tick()
    expect(onSample).not.toHaveBeenCalled()
    expect(p.view().status.restarts).toBe(1)

    await p.tick()
    expect(p.view().latest!.decodeTps).toBe(60)
  })

  test('unreachable llama is reported, then recovers', async () => {
    const { p, onStatus } = poller(
      makeFetch([
        new Error('fetch failed'),
        { body: metricsBody(0, 0), token: 'a' },
      ]),
    )

    await p.tick()
    expect(p.view().status).toMatchObject({ state: 'unreachable', lastError: 'fetch failed' })

    await p.tick()
    expect(p.view().status.state).toBe('ok')
    expect(onStatus.mock.calls.map((c) => c[0].state)).toEqual(['unreachable', 'ok'])
  })

  test('a /metrics timeout is "stalled" (llama is up, its queue is not answering), not "unreachable"', async () => {
    const timeout = new DOMException('The operation was aborted due to timeout', 'TimeoutError')
    const { p } = poller(makeFetch([timeout]))

    await p.tick()
    expect(p.view().status.state).toBe('stalled')
    expect(p.view().status.lastError).toMatch(/queue/)
  })

  test('keeps at most maxSamples', async () => {
    const { p } = poller(
      makeFetch([
        { body: metricsBody(0, 0), token: 'a' },
        { body: metricsBody(10, 1), token: 'a' },
        { body: metricsBody(20, 2), token: 'a' },
        { body: metricsBody(30, 3), token: 'a' },
      ]),
    )
    for (let i = 0; i < 4; i++) {
      await p.tick()
    }
    expect(p.view().samples).toHaveLength(2)
  })

  test('pollMs 0 is disabled and never starts', () => {
    const fetchFn = makeFetch([])
    const p = new StackPoller({
      llamaUrl: 'x',
      forgeUrl: 'y',
      pollMs: 0,
      timeoutMs: 1,
      maxSamples: 1,
      fetchFn,
    })
    p.start()
    expect(p.view().status.state).toBe('disabled')
    expect(fetchFn).not.toHaveBeenCalled()
  })
})
