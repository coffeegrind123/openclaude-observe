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

  it('drops events tagged kind="background" regardless of subtype', () => {
    expect(
      classifyChatEvent(
        makeEvent({
          subtype: 'UserPromptSubmit',
          payload: { prompt: '<tick>1:10:04 AM</tick>', kind: 'background' },
        }),
      ),
    ).toBeNull()
    expect(
      classifyChatEvent(
        makeEvent({
          subtype: 'Stop',
          payload: { last_assistant_message: 'hi', kind: 'background' },
        }),
      ),
    ).toBeNull()
  })

  it('drops UserPromptSubmit with synthetic wrapper prefix even without kind tag', () => {
    // Fallback for older openclaude senders that didn't set payload.kind.
    for (const prompt of [
      '<tick>1:10:04 AM</tick>',
      '<system-reminder>no active todos</system-reminder>',
      '<local-command-stdout>total 0</local-command-stdout>',
      '<task-notification>done</task-notification>',
      'A background agent completed a task: review PR',
    ]) {
      expect(
        classifyChatEvent(makeEvent({ subtype: 'UserPromptSubmit', payload: { prompt } })),
      ).toBeNull()
    }
  })

  it('keeps real user prompts that merely contain an angle-bracket tag midway', () => {
    const result = classifyChatEvent(
      makeEvent({
        subtype: 'UserPromptSubmit',
        payload: { prompt: 'please explain <tick> in our event stream' },
      }),
    )
    expect(result).toEqual({ kind: 'user', text: 'please explain <tick> in our event stream' })
  })
})

describe('buildChatEntries — thinking correlation', () => {
  it('attaches thinking_preview from LLMGeneration events in the same turn to the Stop bubble', () => {
    const events: ParsedEvent[] = [
      makeEvent({
        id: 1,
        subtype: 'UserPromptSubmit',
        timestamp: 1000,
        payload: { prompt: 'fix the bug' },
      }),
      makeEvent({
        id: 2,
        subtype: 'LLMGeneration',
        timestamp: 1100,
        payload: { thinking_preview: 'first I should read the file' },
      }),
      makeEvent({
        id: 3,
        subtype: 'LLMGeneration',
        timestamp: 1200,
        payload: { thinking_preview: 'now I know how to fix it' },
      }),
      makeEvent({
        id: 4,
        subtype: 'Stop',
        timestamp: 1300,
        payload: { last_assistant_message: 'Done!' },
      }),
    ]
    const entries = buildChatEntries(events)
    const stopEntry = entries.find((e) => e.event.id === 4)
    expect(stopEntry).toBeDefined()
    expect(stopEntry!.message).toMatchObject({
      kind: 'assistant',
      text: 'Done!',
      thinking: 'first I should read the file\n\n---\n\nnow I know how to fix it',
    })
  })

  it('scopes thinking to the current turn — earlier LLMs do not leak into later Stops', () => {
    const events: ParsedEvent[] = [
      makeEvent({
        id: 1,
        subtype: 'UserPromptSubmit',
        timestamp: 1000,
        payload: { prompt: 'q1' },
      }),
      makeEvent({
        id: 2,
        subtype: 'LLMGeneration',
        timestamp: 1100,
        payload: { thinking_preview: 'turn-1 thinking' },
      }),
      makeEvent({
        id: 3,
        subtype: 'Stop',
        timestamp: 1200,
        payload: { last_assistant_message: 'A1' },
      }),
      makeEvent({
        id: 4,
        subtype: 'UserPromptSubmit',
        timestamp: 1300,
        payload: { prompt: 'q2' },
      }),
      makeEvent({
        id: 5,
        subtype: 'LLMGeneration',
        timestamp: 1400,
        payload: { thinking_preview: 'turn-2 thinking' },
      }),
      makeEvent({
        id: 6,
        subtype: 'Stop',
        timestamp: 1500,
        payload: { last_assistant_message: 'A2' },
      }),
    ]
    const entries = buildChatEntries(events)
    const a1 = entries.find((e) => e.event.id === 3)!
    const a2 = entries.find((e) => e.event.id === 6)!
    expect((a1.message as { thinking?: string }).thinking).toBe('turn-1 thinking')
    expect((a2.message as { thinking?: string }).thinking).toBe('turn-2 thinking')
  })

  it('keeps thinking scoped per-agent so subagent LLMs do not leak into main Stops', () => {
    const events: ParsedEvent[] = [
      makeEvent({
        id: 1,
        agentId: 'main',
        subtype: 'UserPromptSubmit',
        timestamp: 1000,
        payload: { prompt: 'do the thing' },
      }),
      makeEvent({
        id: 2,
        agentId: 'sub-1',
        subtype: 'LLMGeneration',
        timestamp: 1100,
        payload: { thinking_preview: 'subagent internal thinking' },
      }),
      makeEvent({
        id: 3,
        agentId: 'sub-1',
        subtype: 'SubagentStop',
        timestamp: 1200,
        payload: { last_assistant_message: 'sub done' },
      }),
      makeEvent({
        id: 4,
        agentId: 'main',
        subtype: 'LLMGeneration',
        timestamp: 1300,
        payload: { thinking_preview: 'main thinking' },
      }),
      makeEvent({
        id: 5,
        agentId: 'main',
        subtype: 'Stop',
        timestamp: 1400,
        payload: { last_assistant_message: 'main done' },
      }),
    ]
    const entries = buildChatEntries(events)
    const subStop = entries.find((e) => e.event.id === 3)!
    const mainStop = entries.find((e) => e.event.id === 5)!
    expect((subStop.message as { thinking?: string }).thinking).toBe(
      'subagent internal thinking',
    )
    // Main stop must NOT include the subagent's thinking.
    expect((mainStop.message as { thinking?: string }).thinking).toBe('main thinking')
  })

  it('leaves thinking undefined when no LLMGeneration has thinking_preview', () => {
    const events: ParsedEvent[] = [
      makeEvent({
        id: 1,
        subtype: 'UserPromptSubmit',
        timestamp: 1000,
        payload: { prompt: 'hi' },
      }),
      makeEvent({
        id: 2,
        subtype: 'LLMGeneration',
        timestamp: 1100,
        payload: {}, // no thinking
      }),
      makeEvent({
        id: 3,
        subtype: 'Stop',
        timestamp: 1200,
        payload: { last_assistant_message: 'hey' },
      }),
    ]
    const entries = buildChatEntries(events)
    const stopEntry = entries.find((e) => e.event.id === 3)!
    expect((stopEntry.message as { thinking?: string }).thinking).toBeUndefined()
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
