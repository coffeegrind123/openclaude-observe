import { describe, test, expect } from 'vitest'
import { canonicalJson, computeEventSignature } from './event-signature'
import type { ParsedRawEvent } from '../parser'

function makeParsed(overrides: Partial<ParsedRawEvent> = {}): ParsedRawEvent {
  return {
    projectName: null,
    type: 'tool',
    sessionId: 'sess-1',
    slug: null,
    transcriptPath: null,
    subtype: 'PreToolUse',
    toolName: 'Bash',
    toolUseId: 'tu-1',
    timestamp: 1_000_000,
    ownerAgentId: null,
    subAgentId: null,
    subAgentName: null,
    subAgentDescription: null,
    instanceId: null,
    metadata: {},
    raw: { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 'tu-1' },
    ...overrides,
  } as ParsedRawEvent
}

describe('canonicalJson', () => {
  test('sorts object keys recursively so key order does not affect output', () => {
    const a = canonicalJson({ b: 1, a: { d: 4, c: 3 } })
    const b = canonicalJson({ a: { c: 3, d: 4 }, b: 1 })
    expect(a).toBe(b)
    expect(a).toBe('{"a":{"c":3,"d":4},"b":1}')
  })

  test('preserves array order', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]')
  })
})

describe('computeEventSignature', () => {
  test('identical events in the same 5s bucket hash identically', () => {
    const h1 = computeEventSignature(makeParsed({ timestamp: 1_000_000 }), '/repo')
    const h2 = computeEventSignature(makeParsed({ timestamp: 1_004_999 }), '/repo')
    expect(h1).toBe(h2)
  })

  test('the same event >5s apart hashes differently (distinct real events)', () => {
    const h1 = computeEventSignature(makeParsed({ timestamp: 1_000_000 }), '/repo')
    const h2 = computeEventSignature(makeParsed({ timestamp: 1_006_000 }), '/repo')
    expect(h1).not.toBe(h2)
  })

  test('different payload yields a different hash', () => {
    const h1 = computeEventSignature(makeParsed({ raw: { a: 1 } }), '/repo')
    const h2 = computeEventSignature(makeParsed({ raw: { a: 2 } }), '/repo')
    expect(h1).not.toBe(h2)
  })

  test('different session / cwd / subtype each change the hash', () => {
    const base = computeEventSignature(makeParsed(), '/repo')
    expect(computeEventSignature(makeParsed({ sessionId: 'other' }), '/repo')).not.toBe(base)
    expect(computeEventSignature(makeParsed(), '/other')).not.toBe(base)
    expect(computeEventSignature(makeParsed({ subtype: 'PostToolUse' }), '/repo')).not.toBe(base)
  })

  test('null cwd is stable', () => {
    const h1 = computeEventSignature(makeParsed(), null)
    const h2 = computeEventSignature(makeParsed(), null)
    expect(h1).toBe(h2)
  })
})
