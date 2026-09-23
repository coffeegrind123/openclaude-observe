import { describe, test, expect } from 'vitest'
import { computeSessionContext, estimateTokens } from './context'
import type { StoredEvent } from './storage/types'

let nextId = 1
function ev(subtype: string, payload: Record<string, unknown>, opts: { agent?: string; tool?: string; t?: number } = {}): StoredEvent {
  const id = nextId++
  return {
    id,
    agent_id: opts.agent ?? 'sess',
    session_id: 'sess',
    type: 'x',
    subtype,
    tool_name: opts.tool ?? null,
    tool_use_id: null,
    timestamp: opts.t ?? id,
    created_at: id,
    payload: JSON.stringify(payload),
  }
}

function bucket(turn: { buckets: { category: string; tokens: number }[] }, category: string) {
  return turn.buckets.find((b) => b.category === category)!.tokens
}

describe('computeSessionContext', () => {
  test('the system prompt is a standing cost on every turn and outputs carry forward', () => {
    const events = [
      ev('SystemPrompt', { system_prompt: 'x'.repeat(400), system_prompt_chars: 4000 }),
      ev('UserPromptSubmit', { prompt: 'y'.repeat(40) }),
      ev('LLMGeneration', { input_tokens: 1100, output_tokens: 50 }),
      ev('PostToolUse', { tool_name: 'read', tool_input: { path: 'a.ts' }, tool_response: { content: 'z'.repeat(800) } }, { tool: 'read' }),
      ev('LLMGeneration', { input_tokens: 60, cache_read_tokens: 1150, output_tokens: 10 }),
    ]
    const r = computeSessionContext(events)

    expect(r.turns).toHaveLength(2)
    const [t1, t2] = r.turns
    expect(bucket(t1, 'system-prompt')).toBe(1000) // from chars, not the clipped text
    expect(bucket(t2, 'system-prompt')).toBe(1000)
    expect(bucket(t1, 'user-message')).toBe(10)
    expect(bucket(t2, 'user-message')).toBe(10) // still in the window
    expect(bucket(t2, 'tool-output')).toBe(200)
    expect(bucket(t2, 'assistant-output')).toBe(50)
    expect(t2.estimatedTokens).toBe(1000 + 10 + 200 + 50)
    // sources are only what the turn added
    expect(t2.buckets.find((b) => b.category === 'user-message')!.sources).toHaveLength(0)
    expect(t2.buckets.find((b) => b.category === 'tool-output')!.sources[0].description).toBe('read: a.ts')
    // aggregates count each source once
    expect(r.aggregates['user-message']).toEqual({ tokens: 10, count: 1 })
    expect(r.peakInputTokens).toBe(1210)
  })

  test('a new system prompt replaces the old one', () => {
    const r = computeSessionContext([
      ev('SystemPrompt', { system_prompt_chars: 400 }),
      ev('SystemPrompt', { system_prompt_chars: 800 }),
      ev('LLMGeneration', { input_tokens: 1 }),
    ])
    expect(bucket(r.turns[0], 'system-prompt')).toBe(200)
  })

  test('compaction drops the conversation but keeps the system prompt and adds the summary', () => {
    const r = computeSessionContext([
      ev('SystemPrompt', { system_prompt_chars: 400 }),
      ev('UserPromptSubmit', { prompt: 'p'.repeat(400) }),
      ev('LLMGeneration', { input_tokens: 1, output_tokens: 300 }),
      ev('PostCompact', { summary: 's'.repeat(80), trigger: 'threshold' }),
      ev('LLMGeneration', { input_tokens: 1 }),
    ])
    const after = r.turns[1]
    expect(bucket(after, 'system-prompt')).toBe(100)
    expect(bucket(after, 'compaction-summary')).toBe(20)
    expect(bucket(after, 'user-message')).toBe(0)
    expect(bucket(after, 'assistant-output')).toBe(0)
  })

  test('delegation and injected messages have their own categories', () => {
    const r = computeSessionContext([
      ev('PostToolUse', { tool_name: 'Agent', tool_input: { description: 'count' }, tool_response: { content: 'd'.repeat(40) } }, { tool: 'Agent' }),
      ev('CustomMessage', { custom_type: 'subagent-result', text: 'r'.repeat(40) }),
      ev('CustomMessage', { custom_type: 'persona-note', text: 'n'.repeat(40) }),
      ev('LLMGeneration', { input_tokens: 1 }),
    ])
    expect(bucket(r.turns[0], 'delegation')).toBe(20)
    expect(bucket(r.turns[0], 'injected')).toBe(10)
  })

  test("a subagent's events never count against its parent's window", () => {
    const events = [
      ev('UserPromptSubmit', { prompt: 'q'.repeat(40) }),
      ev('PostToolUse', { tool_name: 'bash', tool_response: { content: 'c'.repeat(4000) } }, { agent: 'child', tool: 'bash' }),
      ev('LLMGeneration', { input_tokens: 5 }, { agent: 'child' }),
      ev('LLMGeneration', { input_tokens: 10 }),
    ]
    const parent = computeSessionContext(events)
    expect(parent.turns).toHaveLength(1)
    expect(bucket(parent.turns[0], 'tool-output')).toBe(0)

    const child = computeSessionContext(events, 'child')
    expect(child.agentId).toBe('child')
    expect(bucket(child.turns[0], 'tool-output')).toBe(1000)
  })

  test('@-mentions are split out of the prompt, ignoring code fences', () => {
    const r = computeSessionContext([
      ev('UserPromptSubmit', { prompt: 'look at @src/a.ts\n```\n@not/this\n```' }),
      ev('LLMGeneration', { input_tokens: 1 }),
    ])
    const mentioned = r.turns[0].buckets.find((b) => b.category === 'mentioned-file')!
    expect(mentioned.sources[0].description).toBe('1 @-mention: src/a.ts')
  })

  test('estimateTokens rounds up and treats empty as zero', () => {
    expect(estimateTokens('')).toBe(0)
    expect(estimateTokens('abc')).toBe(1)
    expect(estimateTokens('abcde')).toBe(2)
  })
})
