import { describe, test, expect } from 'vitest'
import { parseRawEvent } from './parser'

// ---------------------------------------------------------------------------
// Hook format (hook_event_name present)
// ---------------------------------------------------------------------------
describe('parseRawEvent — hook format', () => {
  test('SessionStart', () => {
    const raw = {
      hook_event_name: 'SessionStart',
      project_name: 'hook-proj',
      session_id: 'hook-sess-1',
      timestamp: 1711411200000,
      version: '2.2.0',
      gitBranch: 'feat/hooks',
      cwd: '/home/dev/repo',
      entrypoint: 'cli',
      permissionMode: 'auto',
    }

    const result = parseRawEvent(raw)
    expect(result.type).toBe('session')
    expect(result.subtype).toBe('SessionStart')
    expect(result.projectName).toBe('hook-proj')
    expect(result.sessionId).toBe('hook-sess-1')
    expect(result.toolName).toBeNull()
    expect(result.subAgentId).toBeNull()
    expect(result.ownerAgentId).toBeNull()
    expect(result.metadata).toEqual({
      version: '2.2.0',
      gitBranch: 'feat/hooks',
      cwd: '/home/dev/repo',
      entrypoint: 'cli',
      permissionMode: 'auto',
    })
  })

  test('UserPromptSubmit', () => {
    const raw = {
      hook_event_name: 'UserPromptSubmit',
      project_name: 'hook-proj',
      session_id: 'hook-sess-1',
      timestamp: 1711411201000,
    }

    const result = parseRawEvent(raw)
    expect(result.type).toBe('user')
    expect(result.subtype).toBe('UserPromptSubmit')
  })

  test('PreToolUse with non-Agent tool', () => {
    const raw = {
      hook_event_name: 'PreToolUse',
      project_name: 'hook-proj',
      session_id: 'hook-sess-1',
      tool_name: 'Bash',
      tool_input: { command: 'ls -la' },
      timestamp: 1711411202000,
    }

    const result = parseRawEvent(raw)
    expect(result.type).toBe('tool')
    expect(result.subtype).toBe('PreToolUse')
    expect(result.toolName).toBe('Bash')
    expect(result.subAgentName).toBeNull()
  })

  test('PreToolUse with Agent tool extracts name and description from tool_input', () => {
    const raw = {
      hook_event_name: 'PreToolUse',
      project_name: 'hook-proj',
      session_id: 'hook-sess-1',
      tool_name: 'Agent',
      tool_input: { name: 'ls-agent', description: 'Run ls in the repo', prompt: 'List files' },
      timestamp: 1711411202000,
    }

    const result = parseRawEvent(raw)
    expect(result.type).toBe('tool')
    expect(result.subtype).toBe('PreToolUse')
    expect(result.toolName).toBe('Agent')
    expect(result.subAgentName).toBe('ls-agent')
    expect(result.subAgentDescription).toBe('Run ls in the repo')
    expect(result.subAgentId).toBeNull()
  })

  test('PostToolUse with non-Agent tool', () => {
    const raw = {
      hook_event_name: 'PostToolUse',
      project_name: 'hook-proj',
      session_id: 'hook-sess-1',
      tool_name: 'Read',
      tool_input: { file_path: '/tmp/test.txt' },
      tool_response: { content: 'file contents' },
      timestamp: 1711411203000,
    }

    const result = parseRawEvent(raw)
    expect(result.type).toBe('tool')
    expect(result.subtype).toBe('PostToolUse')
    expect(result.toolName).toBe('Read')
    expect(result.subAgentId).toBeNull()
    expect(result.subAgentName).toBeNull()
  })

  test('PostToolUse with Agent tool extracts subAgentId, name, and description', () => {
    const raw = {
      hook_event_name: 'PostToolUse',
      project_name: 'hook-proj',
      session_id: 'hook-sess-1',
      tool_name: 'Agent',
      tool_input: {
        name: 'file-searcher',
        description: 'Search for files',
        prompt: 'Find all .ts files',
      },
      tool_response: { agentId: 'sub-agent-abc', result: 'done' },
      timestamp: 1711411203000,
    }

    const result = parseRawEvent(raw)
    expect(result.type).toBe('tool')
    expect(result.subtype).toBe('PostToolUse')
    expect(result.toolName).toBe('Agent')
    expect(result.subAgentId).toBe('sub-agent-abc')
    expect(result.subAgentName).toBe('file-searcher')
    expect(result.subAgentDescription).toBe('Search for files')
  })

  test('PostToolUse:Agent without tool_response does not set subAgentId', () => {
    const raw = {
      hook_event_name: 'PostToolUse',
      project_name: 'hook-proj',
      session_id: 'hook-sess-1',
      tool_name: 'Agent',
      tool_input: { description: 'Do something' },
      timestamp: 1711411203000,
    }

    const result = parseRawEvent(raw)
    expect(result.toolName).toBe('Agent')
    expect(result.subAgentId).toBeNull()
    expect(result.subAgentName).toBeNull()
  })

  test('Stop', () => {
    const raw = {
      hook_event_name: 'Stop',
      project_name: 'hook-proj',
      session_id: 'hook-sess-1',
      timestamp: 1711411204000,
    }

    const result = parseRawEvent(raw)
    expect(result.type).toBe('system')
    expect(result.subtype).toBe('Stop')
  })

  test('SubagentStop extracts subAgentId from agent_id', () => {
    const raw = {
      hook_event_name: 'SubagentStop',
      project_name: 'hook-proj',
      session_id: 'hook-sess-1',
      agent_id: 'sub-agent-xyz',
      timestamp: 1711411205000,
    }

    const result = parseRawEvent(raw)
    expect(result.type).toBe('system')
    expect(result.subtype).toBe('SubagentStop')
    expect(result.subAgentId).toBe('sub-agent-xyz')
    // ownerAgentId is also agent_id (they use the same field)
    expect(result.ownerAgentId).toBe('sub-agent-xyz')
  })

  test('PostToolUseFailure', () => {
    const raw = {
      hook_event_name: 'PostToolUseFailure',
      project_name: 'hook-proj',
      session_id: 'hook-sess-1',
      tool_name: 'Bash',
      timestamp: 1711411206000,
    }

    const result = parseRawEvent(raw)
    expect(result.type).toBe('tool')
    expect(result.subtype).toBe('PostToolUseFailure')
    expect(result.toolName).toBe('Bash')
  })

  test('Notification', () => {
    const raw = {
      hook_event_name: 'Notification',
      project_name: 'hook-proj',
      session_id: 'hook-sess-1',
      timestamp: 1711411207000,
    }

    const result = parseRawEvent(raw)
    expect(result.type).toBe('system')
    expect(result.subtype).toBe('Notification')
  })

  test('unknown hook event name falls through to default', () => {
    const raw = {
      hook_event_name: 'FutureEvent',
      project_name: 'hook-proj',
      session_id: 'hook-sess-1',
      timestamp: 1711411208000,
    }

    const result = parseRawEvent(raw)
    expect(result.type).toBe('system')
    expect(result.subtype).toBe('FutureEvent')
  })

  test('hook event from subagent has ownerAgentId from agent_id', () => {
    const raw = {
      hook_event_name: 'PreToolUse',
      project_name: 'hook-proj',
      session_id: 'hook-sess-1',
      agent_id: 'sub-agent-owner',
      tool_name: 'Bash',
      timestamp: 1711411209000,
    }

    const result = parseRawEvent(raw)
    expect(result.ownerAgentId).toBe('sub-agent-owner')
    expect(result.type).toBe('tool')
    expect(result.subtype).toBe('PreToolUse')
  })

  test('hook event extracts tool_use_id', () => {
    const raw = {
      hook_event_name: 'PreToolUse',
      project_name: 'hook-proj',
      session_id: 'hook-sess-1',
      tool_name: 'Read',
      tool_use_id: 'toolu_12345',
      timestamp: 1711411210000,
    }

    const result = parseRawEvent(raw)
    expect(result.toolUseId).toBe('toolu_12345')
  })

  test('hook event — extracts transcript_path', () => {
    const parsed = parseRawEvent({
      hook_event_name: 'PreToolUse',
      session_id: 'sess-1',
      tool_name: 'Bash',
      tool_input: { command: 'ls' },
      transcript_path: '/Users/joe/.claude/projects/-Users-joe-my-app/sess-1.jsonl',
      timestamp: 1000,
    })
    expect(parsed.transcriptPath).toBe('/Users/joe/.claude/projects/-Users-joe-my-app/sess-1.jsonl')
  })

  test('hook event — transcriptPath is null when not present', () => {
    const parsed = parseRawEvent({
      hook_event_name: 'Stop',
      session_id: 'sess-1',
      timestamp: 1000,
    })
    expect(parsed.transcriptPath).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Common behavior: metadata, timestamp, defaults
// ---------------------------------------------------------------------------
describe('parseRawEvent — common behavior', () => {
  test('extracts all metadata keys when present', () => {
    const raw = {
      hook_event_name: 'SessionStart',
      project_name: 'proj',
      session_id: 'sess',
      timestamp: 1711411200000,
      version: '2.2.0',
      gitBranch: 'main',
      cwd: '/home/user',
      entrypoint: 'cli',
      permissionMode: 'auto',
      userType: 'pro',
      permission_mode: 'auto_accept',
    }

    const result = parseRawEvent(raw)
    expect(result.metadata).toEqual({
      version: '2.2.0',
      gitBranch: 'main',
      cwd: '/home/user',
      entrypoint: 'cli',
      permissionMode: 'auto',
      userType: 'pro',
      permission_mode: 'auto_accept',
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
