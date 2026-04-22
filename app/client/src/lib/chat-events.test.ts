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
    expect(classifyChatEvent(makeEvent({ subtype: null }))).toBeNull()
  })

  it('classifies LLMGeneration with response_preview as assistant', () => {
    const result = classifyChatEvent(
      makeEvent({
        subtype: 'LLMGeneration',
        payload: { response_preview: 'Let me check the file.' },
      }),
    )
    expect(result).toEqual({ kind: 'assistant', text: 'Let me check the file.' })
  })

  it('classifies LLMGeneration with only thinking_preview as empty-text assistant', () => {
    const result = classifyChatEvent(
      makeEvent({
        subtype: 'LLMGeneration',
        payload: { thinking_preview: 'pondering...' },
      }),
    )
    expect(result).toEqual({ kind: 'assistant', text: '', thinking: 'pondering...' })
  })

  it('drops LLMGeneration with neither response_preview nor thinking_preview', () => {
    expect(classifyChatEvent(makeEvent({ subtype: 'LLMGeneration', payload: {} }))).toBeNull()
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

describe('buildChatEntries — LLMGeneration ↔ Stop merging', () => {
  it('emits one assistant bubble per LLMGeneration so intermediate turns are visible', () => {
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
        payload: {
          response_preview: 'Let me read the file first.',
          thinking_preview: 'first I should read the file',
        },
      }),
      makeEvent({
        id: 3,
        subtype: 'LLMGeneration',
        timestamp: 1200,
        payload: {
          response_preview: 'Now applying the fix.',
          thinking_preview: 'now I know how to fix it',
        },
      }),
      makeEvent({
        id: 4,
        subtype: 'Stop',
        timestamp: 1300,
        payload: { last_assistant_message: 'Done! Here is the full rationale…' },
      }),
    ]
    const entries = buildChatEntries(events)
    // User prompt + 2 LLM bubbles (Stop merges into the last one, no extra bubble).
    expect(entries).toHaveLength(3)
    expect(entries[0].message).toMatchObject({ kind: 'user', text: 'fix the bug' })
    expect(entries[1].message).toMatchObject({
      kind: 'assistant',
      text: 'Let me read the file first.',
      thinking: 'first I should read the file',
    })
    // Stop merged into the second LLMGeneration bubble — text upgraded to the
    // fuller last_assistant_message, thinking preserved from the LLM call.
    expect(entries[2].event.id).toBe(3)
    expect(entries[2].message).toMatchObject({
      kind: 'assistant',
      text: 'Done! Here is the full rationale…',
      thinking: 'now I know how to fix it',
    })
  })

  it('emits a standalone Stop bubble when no LLMGeneration preceded it on that agent', () => {
    const events: ParsedEvent[] = [
      makeEvent({
        id: 1,
        subtype: 'UserPromptSubmit',
        timestamp: 1000,
        payload: { prompt: 'hi' },
      }),
      makeEvent({
        id: 2,
        subtype: 'Stop',
        timestamp: 2000,
        payload: { last_assistant_message: 'hey' },
      }),
    ]
    const entries = buildChatEntries(events)
    expect(entries).toHaveLength(2)
    expect(entries[1].event.id).toBe(2)
    expect(entries[1].message).toEqual({ kind: 'assistant', text: 'hey' })
  })

  it('UserPromptSubmit opens a new turn — a Stop after it does not merge into an older LLM', () => {
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
        payload: { response_preview: 'turn-1 reply' },
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
        subtype: 'Stop',
        timestamp: 1400,
        payload: { last_assistant_message: 'A2' },
      }),
    ]
    const entries = buildChatEntries(events)
    // q1, merged(LLM+Stop→A1), q2, standalone Stop A2
    expect(entries.map((e) => [e.event.id, e.message.kind])).toEqual([
      [1, 'user'],
      [2, 'assistant'],
      [4, 'user'],
      [5, 'assistant'],
    ])
    expect((entries[1].message as { text: string }).text).toBe('A1')
    expect((entries[3].message as { text: string }).text).toBe('A2')
  })

  it('merges per-agent: Stop on agent A does not consume agent B’s LLMGeneration', () => {
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
        payload: { response_preview: 'subagent progress' },
      }),
      makeEvent({
        id: 3,
        agentId: 'main',
        subtype: 'Stop',
        timestamp: 1200,
        payload: { last_assistant_message: 'main done' },
      }),
    ]
    const entries = buildChatEntries(events)
    // main's Stop can't merge into sub-1's LLM, so sub-1's bubble stays and
    // main's Stop emits its own standalone bubble.
    expect(entries).toHaveLength(3)
    expect(entries[0].event.id).toBe(1)
    expect(entries[1].event.id).toBe(2)
    expect((entries[1].message as { text: string }).text).toBe('subagent progress')
    expect(entries[2].event.id).toBe(3)
    expect((entries[2].message as { text: string }).text).toBe('main done')
  })

  it('StopFailure marks the merged bubble failed', () => {
    const events: ParsedEvent[] = [
      makeEvent({
        id: 1,
        subtype: 'UserPromptSubmit',
        timestamp: 1000,
        payload: { prompt: 'go' },
      }),
      makeEvent({
        id: 2,
        subtype: 'LLMGeneration',
        timestamp: 1100,
        payload: { response_preview: 'starting…' },
      }),
      makeEvent({
        id: 3,
        subtype: 'StopFailure',
        timestamp: 1200,
        payload: { last_assistant_message: 'blew up' },
      }),
    ]
    const entries = buildChatEntries(events)
    expect(entries).toHaveLength(2)
    expect(entries[1].event.id).toBe(2)
    expect(entries[1].message).toMatchObject({
      kind: 'assistant',
      text: 'blew up',
      failed: true,
    })
  })

  it('drops LLMGenerations that fire inside a PreCompact → PostCompact window', () => {
    const events: ParsedEvent[] = [
      makeEvent({
        id: 1,
        subtype: 'UserPromptSubmit',
        timestamp: 1000,
        payload: { prompt: 'do work' },
      }),
      makeEvent({
        id: 2,
        subtype: 'LLMGeneration',
        timestamp: 1100,
        payload: { response_preview: 'real assistant reply' },
      }),
      makeEvent({ id: 3, subtype: 'PreCompact', timestamp: 1200, payload: {} }),
      makeEvent({
        id: 4,
        subtype: 'LLMGeneration',
        timestamp: 1210,
        payload: { response_preview: '<analysis>compaction summary</analysis>' },
      }),
      makeEvent({ id: 5, subtype: 'PostCompact', timestamp: 1300, payload: {} }),
      makeEvent({
        id: 6,
        subtype: 'LLMGeneration',
        timestamp: 1400,
        payload: { response_preview: 'back to normal work' },
      }),
    ]
    const entries = buildChatEntries(events)
    const texts = entries.map((e) => [e.event.id, (e.message as { text?: string }).text])
    expect(texts).toEqual([
      [1, 'do work'],
      [2, 'real assistant reply'],
      [6, 'back to normal work'],
    ])
  })

  it('recovers from a dropped PostCompact when the next UserPromptSubmit arrives', () => {
    const events: ParsedEvent[] = [
      makeEvent({
        id: 1,
        subtype: 'UserPromptSubmit',
        timestamp: 1000,
        payload: { prompt: 'q1' },
      }),
      makeEvent({ id: 2, subtype: 'PreCompact', timestamp: 1100, payload: {} }),
      makeEvent({
        id: 3,
        subtype: 'LLMGeneration',
        timestamp: 1150,
        payload: { response_preview: 'compactor chatter' },
      }),
      // PostCompact missing (crash). Next turn should NOT stay hidden.
      makeEvent({
        id: 4,
        subtype: 'UserPromptSubmit',
        timestamp: 1200,
        payload: { prompt: 'q2' },
      }),
      makeEvent({
        id: 5,
        subtype: 'LLMGeneration',
        timestamp: 1250,
        payload: { response_preview: 'agent reply to q2' },
      }),
    ]
    const entries = buildChatEntries(events)
    expect(entries.map((e) => e.event.id)).toEqual([1, 4, 5])
    expect((entries[2].message as { text: string }).text).toBe('agent reply to q2')
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
        'LLMGeneration',
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
