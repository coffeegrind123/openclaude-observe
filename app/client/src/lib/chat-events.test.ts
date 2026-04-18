import { describe, it, expect } from 'vitest'
import { buildChatEntries, classifyChatEvent, CHAT_SUBTYPES } from './chat-events'
import type { ParsedEvent } from '@/types'

function makeEvent(overrides: Partial<ParsedEvent> = {}): ParsedEvent {
  return {
    id: 1,
    agentId: 'agent-1',
    sessionId: 'sess-1',
    type: 'hook',
    subtype: null,
    toolName: null,
    toolUseId: null,
    status: 'pending',
    timestamp: Date.now(),
    createdAt: Date.now(),
    payload: {},
    ...overrides,
  }
}

describe('classifyChatEvent', () => {
  it('returns null for non-chat subtypes', () => {
    expect(classifyChatEvent(makeEvent({ subtype: 'PreToolUse' }))).toBeNull()
    expect(classifyChatEvent(makeEvent({ subtype: 'SessionStart' }))).toBeNull()
    expect(classifyChatEvent(makeEvent({ subtype: 'LLMGeneration' }))).toBeNull()
    expect(classifyChatEvent(makeEvent({ subtype: null }))).toBeNull()
  })

  it('classifies UserPromptSubmit as user when prompt is set', () => {
    const result = classifyChatEvent(
      makeEvent({ subtype: 'UserPromptSubmit', payload: { prompt: 'Fix the bug' } }),
    )
    expect(result).toEqual({ kind: 'user', text: 'Fix the bug' })
  })

  it('falls back to message.content for UserPromptSubmit', () => {
    const result = classifyChatEvent(
      makeEvent({
        subtype: 'UserPromptSubmit',
        payload: { message: { content: 'Hello' } },
      }),
    )
    expect(result).toEqual({ kind: 'user', text: 'Hello' })
  })

  it('drops UserPromptSubmit with no prompt content', () => {
    expect(classifyChatEvent(makeEvent({ subtype: 'UserPromptSubmit', payload: {} }))).toBeNull()
  })

  it('classifies Stop with last_assistant_message as assistant', () => {
    const result = classifyChatEvent(
      makeEvent({
        subtype: 'Stop',
        payload: { last_assistant_message: 'Here is your answer.' },
      }),
    )
    expect(result).toEqual({ kind: 'assistant', text: 'Here is your answer.' })
  })

  it('drops Stop without last_assistant_message', () => {
    expect(classifyChatEvent(makeEvent({ subtype: 'Stop', payload: {} }))).toBeNull()
  })

  it('marks StopFailure as failed assistant turn', () => {
    const result = classifyChatEvent(
      makeEvent({
        subtype: 'StopFailure',
        payload: { last_assistant_message: 'Oops' },
      }),
    )
    expect(result).toEqual({ kind: 'assistant', text: 'Oops', failed: true })
  })

  it('renders StopFailure without a message as a generic failure bubble', () => {
    const result = classifyChatEvent(makeEvent({ subtype: 'StopFailure', payload: {} }))
    expect(result).toEqual({ kind: 'assistant', text: 'Turn failed', failed: true })
  })

  it('classifies SubagentStart with prompt + description', () => {
    const result = classifyChatEvent(
      makeEvent({
        subtype: 'SubagentStart',
        payload: { agent_name: 'researcher', description: 'Find X', prompt: 'Please find X' },
      }),
    )
    expect(result).toEqual({
      kind: 'subagent-start',
      agentName: 'researcher',
      description: 'Find X',
      prompt: 'Please find X',
    })
  })

  it('classifies SubagentStop with result text', () => {
    const result = classifyChatEvent(
      makeEvent({
        subtype: 'SubagentStop',
        payload: { agent_name: 'researcher', last_assistant_message: 'Found it' },
      }),
    )
    expect(result).toEqual({
      kind: 'subagent-stop',
      agentName: 'researcher',
      text: 'Found it',
    })
  })

  it('classifies TaskCreated and TaskCompleted with descriptions', () => {
    expect(
      classifyChatEvent(
        makeEvent({ subtype: 'TaskCreated', payload: { description: 'Write tests' } }),
      ),
    ).toEqual({ kind: 'task', status: 'created', description: 'Write tests' })

    expect(
      classifyChatEvent(
        makeEvent({ subtype: 'TaskCompleted', payload: { task_description: 'Write tests' } }),
      ),
    ).toEqual({ kind: 'task', status: 'completed', description: 'Write tests' })
  })

  it('classifies TeammateIdle with name and reason', () => {
    const result = classifyChatEvent(
      makeEvent({
        subtype: 'TeammateIdle',
        payload: { teammate_name: 'worker-1', reason: 'awaiting input' },
      }),
    )
    expect(result).toEqual({
      kind: 'status',
      teammateName: 'worker-1',
      reason: 'awaiting input',
    })
  })

  it('CHAT_SUBTYPES is the full set of handled subtypes', () => {
    // If this test fails you likely added a new subtype to classifyChatEvent
    // without updating CHAT_SUBTYPES (or vice versa).
    expect(CHAT_SUBTYPES).toEqual(
      new Set([
        'UserPromptSubmit',
        'Stop',
        'stop_hook_summary',
        'StopFailure',
        'SubagentStart',
        'SubagentStop',
        'TaskCreated',
        'TaskCompleted',
        'TeammateIdle',
      ]),
    )
  })
})

describe('buildChatEntries', () => {
  it('returns empty list for undefined input', () => {
    expect(buildChatEntries(undefined)).toEqual([])
  })

  it('drops events that do not classify and keeps chat order', () => {
    const events: ParsedEvent[] = [
      makeEvent({ id: 1, subtype: 'SessionStart', payload: { source: 'cli' } }),
      makeEvent({
        id: 2,
        subtype: 'UserPromptSubmit',
        payload: { prompt: 'Hi' },
        timestamp: 1000,
      }),
      makeEvent({
        id: 3,
        subtype: 'PreToolUse',
        toolName: 'Bash',
        payload: { tool_input: { command: 'ls' } },
      }),
      makeEvent({
        id: 4,
        subtype: 'Stop',
        payload: { last_assistant_message: 'Hello!' },
        timestamp: 2000,
      }),
    ]

    const entries = buildChatEntries(events)
    expect(entries).toHaveLength(2)
    expect(entries[0].event.id).toBe(2)
    expect(entries[0].message).toEqual({ kind: 'user', text: 'Hi' })
    expect(entries[1].event.id).toBe(4)
    expect(entries[1].message).toEqual({ kind: 'assistant', text: 'Hello!' })
  })
})
