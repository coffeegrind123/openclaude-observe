import { describe, it, expect } from 'vitest'
import { classifyChatEvent } from './chat-events'
import { piFixtureEvents } from '@/test/pi-fixture'
import type { ParsedEvent } from '@/types'

function pi(subtype: string, payload: Record<string, unknown>): ParsedEvent {
  return {
    id: 1,
    agentId: 'root',
    sessionId: 'root',
    type: 'system',
    subtype,
    toolName: null,
    toolUseId: null,
    status: 'pending',
    timestamp: 0,
    payload: { agent_class: 'pi', ...payload },
  }
}

describe('classifyChatEvent (pi)', () => {
  it('classifies the conversation in the real capture', () => {
    const kinds = piFixtureEvents()
      .map((e) => [e.id, classifyChatEvent(e)?.kind] as const)
      .filter(([, k]) => k != null)
    expect(kinds).toEqual([
      [2, 'user'],
      [4, 'assistant'], // thinking only
      [11, 'assistant'],
      [13, 'subagent-start'],
      [14, 'user'], // the subagent's task prompt
      [16, 'assistant'],
      [19, 'assistant'],
      [20, 'subagent-stop'],
      [22, 'assistant'],
    ])
  })

  it('carries text and thinking of an LLM generation', () => {
    const final = piFixtureEvents()[21]
    expect(classifyChatEvent(final)).toEqual({
      kind: 'assistant',
      text: 'DONE',
      thinking: 'All steps complete. Reply with DONE.\n',
    })
  })

  it('marks extension-sourced prompts as injected', () => {
    expect(
      classifyChatEvent(pi('UserPromptSubmit', { prompt: 'loop tick', source: 'extension' })),
    ).toEqual({
      kind: 'user',
      text: 'loop tick',
      source: 'extension',
      injected: true,
      images: undefined,
    })
  })

  it('keeps a failed generation even without text', () => {
    expect(
      classifyChatEvent(pi('LLMGeneration', { stop_reason: 'error', error_message: '503' })),
    ).toEqual({
      kind: 'assistant',
      text: '503',
      failed: true,
    })
  })

  it('drops tool-only generations and non-conversational events', () => {
    expect(classifyChatEvent(pi('LLMGeneration', { text: '', thinking: '' }))).toBeNull()
    expect(classifyChatEvent(pi('Stop', {}))).toBeNull()
    expect(classifyChatEvent(pi('SystemPrompt', { system_prompt: 'x' }))).toBeNull()
    expect(classifyChatEvent(pi('CustomMessage', { custom_type: 'persona', text: 'x' }))).toBeNull()
  })

  it('includes background subagent results and notifications', () => {
    expect(
      classifyChatEvent(pi('CustomMessage', { custom_type: 'subagent-result', text: 'found it' })),
    ).toEqual({
      kind: 'subagent-result',
      text: 'found it',
    })
    expect(classifyChatEvent(pi('Notification', { message: 'Confirm?' }))).toEqual({
      kind: 'status',
      text: 'Confirm?',
    })
  })

  it('treats unknown classes as non-conversational', () => {
    const legacy = {
      ...pi('UserPromptSubmit', { prompt: 'x' }),
      payload: { agent_class: 'claude-code', prompt: 'x' },
    }
    expect(classifyChatEvent(legacy)).toBeNull()
  })
})
