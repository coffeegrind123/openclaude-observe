import { describe, test, expect, beforeEach, vi } from 'vitest'
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { EventStore } from '../storage/types'

// Isolate the pricing module's disk cache to a fresh tmp dir for the
// whole suite. Without this, repeated test runs would share state via
// the file system.
const sharedDataDir = vi.hoisted(() => {
  const fs = require('node:fs') as typeof import('node:fs')
  const os = require('node:os') as typeof import('node:os')
  const path = require('node:path') as typeof import('node:path')
  return fs.mkdtempSync(path.join(os.tmpdir(), 'transcript-parser-index-'))
})
vi.mock('../config', () => ({
  config: { dataDir: sharedDataDir, transcriptStats: { enabled: true } },
}))

import { parseSessionTranscripts } from './index'
import { _testReset } from './models-pricing'

beforeEach(() => {
  // Reset in-memory cache; also wipe the disk cache file between tests
  // so the next fetch isn't served stale.
  _testReset()
  try {
    rmSync(join(sharedDataDir, 'models-dev.json'))
  } catch {}
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        deepseek: {
          models: {
            'deepseek-flash': {
              id: 'deepseek-flash',
              cost: { input: 15, output: 75, cache_read: 1.5, cache_write: 18.75 },
            },
          },
        },
      }),
    }),
  )
})

// pi session format v3: a header line, then entries forming a tree by
// id/parentId. Assistant usage carries pi's own cost; `cost` omitted below
// means "pi recorded none", which forces the models.dev pricing path.
type Line = Record<string, unknown>

function header(): Line {
  return {
    type: 'session',
    version: 3,
    id: 'sess1',
    timestamp: '2026-05-22T00:00:00.000Z',
    cwd: '/w',
  }
}

function user(id: string, parentId: string | null, at: string, text: string): Line {
  return {
    type: 'message',
    id,
    parentId,
    timestamp: at,
    message: { role: 'user', content: [{ type: 'text', text }] },
  }
}

function assistant(
  id: string,
  parentId: string,
  at: string,
  model: string,
  usage: { input: number; output: number; cacheRead?: number; costTotal?: number },
  content: unknown[] = [{ type: 'text', text: 'ok' }],
): Line {
  const u: Record<string, unknown> = {
    input: usage.input,
    output: usage.output,
    cacheRead: usage.cacheRead ?? 0,
    cacheWrite: 0,
  }
  if (usage.costTotal !== undefined) {
    u.cost = { total: usage.costTotal }
  }
  return {
    type: 'message',
    id,
    parentId,
    timestamp: at,
    message: {
      role: 'assistant',
      model,
      provider: 'p',
      stopReason: 'stop',
      responseId: `r-${id}`,
      usage: u,
      content,
    },
  }
}

function writeSession(lines: Line[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'transcript-stats-pi-'))
  const p = join(dir, 'session.jsonl')
  writeFileSync(p, lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
  return p
}

function makeStore(opts: { agents: Array<{ id: string; agent_class: string }> }): EventStore {
  return {
    getSessionTranscriptPath: async () => null,
    getAgentsForSession: async () => opts.agents as any,
  } as unknown as EventStore
}

const PI = [{ id: 'sess1', agent_class: 'pi' }]
const REAL_SESSION = join(__dirname, 'agents', '__fixtures__', 'pi-session.jsonl')

describe('parseSessionTranscripts', () => {
  test('a local model with pi-recorded cost 0 costs 0, not "unknown", with no pricing entry', async () => {
    const path = writeSession([
      header(),
      user('u1', null, '2026-05-22T00:00:00.000Z', 'hi'),
      assistant('a1', 'u1', '2026-05-22T00:00:01.000Z', 'qwen3.8-27b', {
        input: 1000,
        output: 500,
        costTotal: 0,
      }),
    ])
    const stats = await parseSessionTranscripts('sess1', makeStore({ agents: PI }), path)

    expect(stats.summary.totalCalls).toBe(1)
    expect(stats.byModel[0]).toMatchObject({ model: 'qwen3.8-27b', costCents: 0 })
    expect(stats.summary.costTotalCents).toBe(0)
    expect(stats.models['qwen3.8-27b'].pricing).toBeNull()
  })

  test("pi's recorded cost wins over models.dev pricing", async () => {
    const path = writeSession([
      header(),
      user('u1', null, '2026-05-22T00:00:00.000Z', 'hi'),
      assistant('a1', 'u1', '2026-05-22T00:00:01.000Z', 'deepseek-flash', {
        input: 1000,
        output: 500,
        costTotal: 0.02,
      }),
    ])
    const stats = await parseSessionTranscripts('sess1', makeStore({ agents: PI }), path)
    expect(stats.byModel[0].costCents).toBeCloseTo(2)
  })

  test('without a recorded cost, models.dev pricing applies', async () => {
    const path = writeSession([
      header(),
      user('u1', null, '2026-05-22T00:00:00.000Z', 'hi'),
      assistant('a1', 'u1', '2026-05-22T00:00:01.000Z', 'deepseek-flash', {
        input: 1000,
        output: 500,
      }),
    ])
    const stats = await parseSessionTranscripts('sess1', makeStore({ agents: PI }), path)
    // 1000 input * $15/M + 500 output * $75/M = $0.0525 → 5 cents
    expect(stats.byModel[0].costCents).toBe(5)
    expect(stats.models['deepseek-flash'].pricing).toMatchObject({ inputPerM: 15 })
  })

  test('cost is null (unknown) when there is neither a recorded cost nor pricing', async () => {
    const path = writeSession([
      header(),
      user('u1', null, '2026-05-22T00:00:00.000Z', 'hi'),
      assistant('a1', 'u1', '2026-05-22T00:00:01.000Z', 'mystery-model', { input: 1, output: 1 }),
    ])
    const stats = await parseSessionTranscripts('sess1', makeStore({ agents: PI }), path)
    expect(stats.byModel[0].costCents).toBeNull()
    expect(stats.summary.costTotalCents).toBeNull()
  })

  test('prompt duration is self-contained: the idle gap between prompts does not bleed in', async () => {
    const path = writeSession([
      header(),
      user('u1', null, '2026-06-01T00:00:00.000Z', 'first'),
      assistant('a1', 'u1', '2026-06-01T00:00:10.000Z', 'qwen3.8-27b', {
        input: 1,
        output: 1,
        costTotal: 0,
      }),
      user('u2', 'a1', '2026-06-01T00:10:10.000Z', 'second'),
      assistant('a2', 'u2', '2026-06-01T00:10:13.000Z', 'qwen3.8-27b', {
        input: 1,
        output: 1,
        costTotal: 0,
      }),
    ])
    const stats = await parseSessionTranscripts('sess1', makeStore({ agents: PI }), path)

    const p1 = stats.prompts.find((p) => p.promptId === 'u1')!
    const p2 = stats.prompts.find((p) => p.promptId === 'u2')!
    expect(p1.durationMs).toBe(10_000)
    expect(p2.durationMs).toBe(3_000)
  })

  test('a subagent recovered from its Agent result folds into the spawning prompt', async () => {
    const path = writeSession([
      header(),
      user('u1', null, '2026-06-01T00:00:00.000Z', 'delegate'),
      assistant(
        'a1',
        'u1',
        '2026-06-01T00:00:01.000Z',
        'qwen3.8-27b',
        { input: 100, output: 10, costTotal: 0 },
        [
          {
            type: 'toolCall',
            id: 'call_1',
            name: 'Agent',
            arguments: { prompt: 'x', description: 'look' },
          },
        ],
      ),
      {
        type: 'message',
        id: 'r1',
        parentId: 'a1',
        timestamp: '2026-06-01T00:00:09.000Z',
        message: {
          role: 'toolResult',
          toolCallId: 'call_1',
          toolName: 'Agent',
          isError: false,
          content: [{ type: 'text', text: '2' }],
          details: {
            type: 'explorer',
            turnCount: 3,
            toolUses: 2,
            input: 3000,
            output: 200,
            durationMs: 8000,
            modelId: 'deepseek-flash',
            cost: 0.03,
          },
        },
      },
    ])
    const stats = await parseSessionTranscripts('sess1', makeStore({ agents: PI }), path)

    expect(stats.subagents).toHaveLength(1)
    expect(stats.subagents[0]).toMatchObject({
      agentType: 'explorer',
      toolUseId: 'call_1',
      requests: 3,
      costCents: 3,
    })
    const prompt = stats.prompts.find((p) => p.promptId === 'u1')!
    expect(prompt.inputTokens).toBe(3100)
    expect(prompt.costCents).toBeCloseTo(3)
    expect(stats.summary.totalCalls).toBe(4)
  })

  test('the real captured session parses end to end', async () => {
    const stats = await parseSessionTranscripts('sess1', makeStore({ agents: PI }), REAL_SESSION)

    expect(stats.errors).toEqual([])
    expect(stats.summary.userPrompts).toBe(1)
    // 3 top-level requests + the subagent's 2 turns
    expect(stats.summary.totalCalls).toBe(5)
    expect(stats.summary.costTotalCents).toBe(0)
    expect(stats.subagents).toHaveLength(1)
    expect(stats.summary.toolStats.find((t) => t.name === 'bash')?.count).toBe(2)
  })

  test('unsupported main agent class records an error without failing', async () => {
    const path = writeSession([header()])
    const stats = await parseSessionTranscripts(
      'sess1',
      makeStore({ agents: [{ id: 'sess1', agent_class: 'some-future-runtime' }] }),
      path,
    )
    expect(stats.errors).toContainEqual(
      expect.objectContaining({
        scope: 'main',
        code: 'parse_error',
        message: expect.stringContaining('some-future-runtime'),
      }),
    )
    expect(stats.byModel).toHaveLength(0)
  })
})
