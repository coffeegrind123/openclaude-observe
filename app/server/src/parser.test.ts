import { describe, test, expect } from 'vitest'
import { parseRawEvent } from './parser'

// ---------------------------------------------------------------------------
// pi envelope (docs/pi-protocol.md)
// ---------------------------------------------------------------------------
const BASE = {
  agent_class: 'pi',
  session_id: '01a0cea5-b997-73d4-853f-9a594c831c4e',
  timestamp: 1790173524016,
  cwd: '/work/proj',
  transcript_path: '/home/u/.pi/agent/sessions/--work-proj--/s.jsonl',
  model: 'qwen3.8-27b',
  provider: 'forge',
}

describe('parseRawEvent — pi envelope', () => {
  test('SessionStart', () => {
    const r = parseRawEvent({ ...BASE, hook_event_name: 'SessionStart', source: 'startup', thinking_level: 'off' })

    expect(r.type).toBe('session')
    expect(r.subtype).toBe('SessionStart')
    expect(r.sessionId).toBe(BASE.session_id)
    expect(r.transcriptPath).toBe(BASE.transcript_path)
    expect(r.agentClass).toBe('pi')
    expect(r.ownerAgentId).toBeNull()
    expect(r.metadata).toMatchObject({ cwd: '/work/proj', model: 'qwen3.8-27b', provider: 'forge', thinking_level: 'off' })
  })

  test.each([
    ['UserPromptSubmit', 'user'],
    ['UserBash', 'user'],
    ['LLMGeneration', 'llm'],
    ['Stop', 'system'],
    ['PreCompact', 'system'],
    ['PostCompact', 'system'],
    ['SubagentStart', 'system'],
    ['SubagentStop', 'system'],
    ['SessionEnd', 'session'],
    ['SystemPrompt', 'session'],
    ['ModelChange', 'system'],
  ])('%s is typed %s', (name, type) => {
    const r = parseRawEvent({ ...BASE, hook_event_name: name })
    expect(r.type).toBe(type)
    expect(r.subtype).toBe(name)
  })

  test('tool events carry tool name and id; lowercase pi tool names are kept as-is', () => {
    const r = parseRawEvent({
      ...BASE,
      hook_event_name: 'PostToolUseFailure',
      tool_name: 'bash',
      tool_use_id: 'call_316a9d0c',
      tool_input: { command: 'cat missing-file.txt' },
      is_error: true,
    })
    expect(r.type).toBe('tool')
    expect(r.toolName).toBe('bash')
    expect(r.toolUseId).toBe('call_316a9d0c')
  })

  test('tool_name on a non-tool event is not treated as a tool', () => {
    expect(parseRawEvent({ ...BASE, hook_event_name: 'Stop', tool_name: 'bash' }).toolName).toBeNull()
  })

  test('subagent events name their agent and its spawner explicitly', () => {
    const r = parseRawEvent({
      ...BASE,
      hook_event_name: 'PreToolUse',
      tool_name: 'bash',
      tool_use_id: 'call_c8a6d7d4',
      agent_id: '01a0cea0-6acb-7624-ac0d-3596141578f2',
      agent_type: 'general-purpose',
      agent_name: 'general-purpose#e8181b66',
      agent_description: 'Count lines in notes.txt',
      parent_tool_use_id: 'call_5ec3e22b',
      parent_agent_id: 'child-that-spawned-it',
    })
    expect(r).toMatchObject({
      ownerAgentId: '01a0cea0-6acb-7624-ac0d-3596141578f2',
      ownerAgentType: 'general-purpose',
      ownerAgentName: 'general-purpose#e8181b66',
      ownerAgentDescription: 'Count lines in notes.txt',
      parentToolUseId: 'call_5ec3e22b',
      parentAgentId: 'child-that-spawned-it',
    })
  })

  test('an event name this server does not know is still stored, as system', () => {
    const r = parseRawEvent({ ...BASE, hook_event_name: 'SomethingNewer' })
    expect(r.type).toBe('system')
    expect(r.subtype).toBe('SomethingNewer')
  })

  test('ids are length-capped and non-strings ignored', () => {
    const r = parseRawEvent({ ...BASE, hook_event_name: 'Stop', session_id: 'x'.repeat(1000), agent_id: 42 })
    expect(r.sessionId).toHaveLength(256)
    expect(r.ownerAgentId).toBeNull()
  })
})

describe('parseRawEvent — common behavior', () => {
  test('extracts only the known metadata keys', () => {
    const raw = {
      hook_event_name: 'LLMGeneration',
      session_id: 'sess',
      timestamp: 1711411200000,
      cwd: '/home/user',
      model: 'qwen3.8-27b',
      provider: 'forge',
      agent_class: 'pi',
      input_tokens: 196,
      output_tokens: 106,
      cache_read_tokens: 5615,
      cache_creation_tokens: 0,
      ttft_ms: 200,
      duration_ms: 500,
      text: 'not metadata',
    }

    expect(parseRawEvent(raw).metadata).toEqual({
      cwd: '/home/user',
      model: 'qwen3.8-27b',
      provider: 'forge',
      agent_class: 'pi',
      input_tokens: 196,
      output_tokens: 106,
      cache_read_tokens: 5615,
      cache_creation_tokens: 0,
      ttft_ms: 200,
      duration_ms: 500,
    })
  })

  test('metadata is empty when no metadata keys are present', () => {
    const raw = {
      project_name: 'proj',
      session_id: 'sess',
      type: 'user',
      timestamp: 1711411200000,
    }

    const result = parseRawEvent(raw)
    expect(result.metadata).toEqual({})
  })

  test('projectName defaults to null when not present', () => {
    const parsed = parseRawEvent({ hook_event_name: 'Stop', session_id: 'x' })
    expect(parsed.projectName).toBeNull()
  })

  test('defaults sessionId to "unknown" when session_id is absent', () => {
    const raw = { project_name: 'p', type: 'user', timestamp: 1711411200000 }
    const result = parseRawEvent(raw)
    expect(result.sessionId).toBe('unknown')
  })

  test('slug is null when not provided', () => {
    const raw = { project_name: 'p', session_id: 's', type: 'user', timestamp: 1711411200000 }
    const result = parseRawEvent(raw)
    expect(result.slug).toBeNull()
  })

  test('raw is passed through as-is', () => {
    const raw = {
      project_name: 'p',
      session_id: 's',
      type: 'user',
      timestamp: 1711411200000,
      custom_field: 'hello',
    }
    const result = parseRawEvent(raw)
    expect(result.raw).toBe(raw)
  })
})

// ---------------------------------------------------------------------------
// parseTimestamp (exercised through parseRawEvent)
// ---------------------------------------------------------------------------
describe('parseRawEvent — timestamp parsing', () => {
  test('numeric timestamp is used directly', () => {
    const raw = { project_name: 'p', session_id: 's', type: 'user', timestamp: 1711411200000 }
    const result = parseRawEvent(raw)
    expect(result.timestamp).toBe(1711411200000)
  })

  test('fractional epoch-seconds timestamp is scaled to integer ms', () => {
    // Python time.time() style; read as ms it would land in Jan 1970.
    const raw = { project_name: 'p', session_id: 's', type: 'user', timestamp: 1780084122.37901 }
    expect(parseRawEvent(raw).timestamp).toBe(1780084122379)
  })

  test('epoch-seconds band boundary: 1e9 scales, just under does not', () => {
    const base = { project_name: 'p', session_id: 's', type: 'user' }
    expect(parseRawEvent({ ...base, timestamp: 1e9 }).timestamp).toBe(1e9 * 1000)
    expect(parseRawEvent({ ...base, timestamp: 1e9 - 1 }).timestamp).toBe(1e9 - 1)
  })

  test('small fixture/sentinel timestamps and ms timestamps pass through', () => {
    const base = { project_name: 'p', session_id: 's', type: 'user' }
    expect(parseRawEvent({ ...base, timestamp: 1000 }).timestamp).toBe(1000)
    expect(parseRawEvent({ ...base, timestamp: 0 }).timestamp).toBe(0)
    expect(parseRawEvent({ ...base, timestamp: 1e12 }).timestamp).toBe(1e12)
  })

  test('meta.timestamp in epoch seconds is scaled to ms', () => {
    const raw = {
      project_name: 'p',
      session_id: 's',
      type: 'user',
      meta: { timestamp: 1711411200 },
    }
    expect(parseRawEvent(raw).timestamp).toBe(1711411200000)
  })

  test('ISO string timestamp is converted to epoch ms', () => {
    const raw = {
      project_name: 'p',
      session_id: 's',
      type: 'user',
      timestamp: '2026-03-25T22:24:17.686Z',
    }
    const result = parseRawEvent(raw)
    expect(result.timestamp).toBe(new Date('2026-03-25T22:24:17.686Z').getTime())
  })

  test('invalid string timestamp falls back to Date.now()', () => {
    const now = Date.now()
    const raw = { project_name: 'p', session_id: 's', type: 'user', timestamp: 'not-a-date' }
    const result = parseRawEvent(raw)
    // Should be close to now (within 1 second)
    expect(result.timestamp).toBeGreaterThanOrEqual(now - 1000)
    expect(result.timestamp).toBeLessThanOrEqual(now + 1000)
  })

  test('missing timestamp falls back to Date.now()', () => {
    const now = Date.now()
    const raw = { project_name: 'p', session_id: 's', type: 'user' }
    const result = parseRawEvent(raw)
    expect(result.timestamp).toBeGreaterThanOrEqual(now - 1000)
    expect(result.timestamp).toBeLessThanOrEqual(now + 1000)
  })

  test('null timestamp falls back to Date.now()', () => {
    const now = Date.now()
    const raw = { project_name: 'p', session_id: 's', type: 'user', timestamp: null }
    const result = parseRawEvent(raw)
    expect(result.timestamp).toBeGreaterThanOrEqual(now - 1000)
    expect(result.timestamp).toBeLessThanOrEqual(now + 1000)
  })
})
