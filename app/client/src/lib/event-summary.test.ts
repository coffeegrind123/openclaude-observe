import { describe, it, expect } from 'vitest'
import { getEventSummary, getEventSummaryTag, extractBashBinary } from './event-summary'
import { piFixtureEvents } from '@/test/pi-fixture'
import type { ParsedEvent } from '@/types'

function pi(subtype: string, payload: Record<string, unknown>, extra: Partial<ParsedEvent> = {}) {
  const e: ParsedEvent = {
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
    ...extra,
  }
  return e
}

function tool(toolName: string, input: Record<string, unknown>, cwd = '/work/proj') {
  return pi(
    'PreToolUse',
    { tool_name: toolName, tool_input: input, cwd },
    { toolName, toolUseId: 't' },
  )
}

describe('getEventSummary — real pi capture', () => {
  const events = piFixtureEvents()
  const byIndex = (i: number) => getEventSummary(events[i - 1])

  it('summarises every one of the 24 envelopes', () => {
    for (const e of events) {
      expect(getEventSummary(e), `${e.id} ${e.subtype}`).not.toBe('')
    }
  })

  it('session lifecycle', () => {
    expect(byIndex(1)).toBe('Session startup · qwen3.8-27b (forge) · print')
    expect(byIndex(24)).toBe('Session ended (quit)')
    expect(byIndex(23)).toBe('Settled · context 7.1k/98.3k (7%)')
  })

  it('system prompt with size and token estimate', () => {
    expect(byIndex(3)).toBe('System prompt · 408 chars · ~102 tok')
  })

  it('tool calls from their real arguments', () => {
    expect(byIndex(5)).toBe('notes.txt')
    expect(byIndex(6)).toBe('echo hi')
    expect(byIndex(7)).toBe('cat missing-file.txt')
    expect(byIndex(12)).toBe('general-purpose · Count lines in notes.txt')
  })

  it('LLM generations with tokens, timing and requested tools', () => {
    expect(byIndex(4)).toBe('qwen3.8-27b · in 6.7k out 247 · 9.3s · → read, bash×2')
    expect(byIndex(11)).toBe('qwen3.8-27b · in 46 out 101 cache 99% · 2.9s · → Agent')
  })

  it('subagent start / stop', () => {
    expect(byIndex(13)).toBe('general-purpose#f322fa95 · Count lines in notes.txt')
    expect(byIndex(20)).toBe('general-purpose#f322fa95 · 2 turns · 1 tool · in 3.8k out 57 · 6.2s')
  })
})

describe('getEventSummary — pi tools', () => {
  it('read with offset / limit and cwd-relative path', () => {
    expect(
      getEventSummary(tool('read', { path: '/work/proj/src/a.ts', offset: 10, limit: 5 })),
    ).toBe('src/a.ts · lines 10–14')
  })

  it('edit counts the real edits[] blocks', () => {
    const e = tool('edit', {
      path: 'src/a.ts',
      edits: [
        { oldText: 'a', newText: 'b' },
        { oldText: 'c', newText: 'd' },
      ],
    })
    expect(getEventSummary(e)).toBe('src/a.ts · 2 edits')
  })

  it('write counts lines of content', () => {
    expect(getEventSummary(tool('write', { path: 'x.md', content: 'a\nb\nc' }))).toBe(
      'x.md · 3 lines',
    )
  })

  it('grep / find / ls', () => {
    expect(
      getEventSummary(
        tool('grep', { pattern: 'TODO', path: 'src', glob: '*.ts', ignoreCase: true }),
      ),
    ).toBe('/TODO/i in src (*.ts)')
    expect(getEventSummary(tool('find', { pattern: '**/*.json', path: 'app' }))).toBe(
      '**/*.json in app',
    )
    expect(getEventSummary(tool('ls', {}))).toBe('.')
  })

  it('mcp proxy modes and browser direct tools', () => {
    expect(getEventSummary(tool('mcp', { search: 'cookie' }))).toBe('search "cookie"')
    expect(getEventSummary(tool('mcp', { tool: 'browser_set_cookie', args: '{"name":"a"}' }))).toBe(
      'browser_set_cookie name=a',
    )
    expect(getEventSummary(tool('mcp', {}))).toBe('status')
    expect(getEventSummary(tool('browser_navigate', { url: 'https://example.com' }))).toBe(
      'url=https://example.com',
    )
  })

  it('subagent control tools', () => {
    expect(getEventSummary(tool('SubAgent', { prompt: 'do it', agent: 'Explore' }))).toBe(
      'Explore · do it',
    )
    expect(getEventSummary(tool('StopAgent', { agent_id: 'abc123' }))).toBe('stop abc123')
    expect(getEventSummary(tool('AgentStatus', {}))).toBe('agent status')
  })
})

describe('getEventSummary — other pi events', () => {
  it.each([
    ['SessionRename', { name: 'refactor' }, 'Renamed to "refactor"'],
    [
      'SessionTree',
      { old_leaf_id: 'aaaaaaaa11', new_leaf_id: 'bbbbbbbb22' },
      'Tree navigation aaaaaaaa → bbbbbbbb',
    ],
    [
      'UserBash',
      { command: 'git status', exclude_from_context: true },
      '!git status (excluded from context)',
    ],
    [
      'PreCompact',
      { trigger: 'threshold', context: { tokens: 90000, contextWindow: 98304, percent: 91.5 } },
      'Compacting (threshold) · context 90.0k/98.3k (92%)',
    ],
    [
      'PostCompact',
      { trigger: 'manual', tokens_before: 45000 },
      'Compacted (manual) · 45.0k before',
    ],
    [
      'CompactionFailed',
      { trigger: 'overflow', error: 'boom' },
      'Compaction failed (overflow): boom',
    ],
    ['ModelChange', { model: 'b', previous_model: 'a', source: 'cycle' }, 'a → b (cycle)'],
    ['ThinkingLevelChange', { level: 'high', previous_level: 'off' }, 'off → high'],
    ['Notification', { message: 'Allow write?' }, 'Allow write?'],
    ['CustomMessage', { custom_type: 'subagent-result', text: 'done' }, '[subagent-result] done'],
  ])('%s', (subtype, payload, expected) => {
    expect(getEventSummary(pi(subtype, payload))).toBe(expected)
  })

  it('marks prompts with images', () => {
    expect(getEventSummary(pi('UserPromptSubmit', { prompt: 'look', images: 2 }))).toBe(
      'look (+2 images)',
    )
  })
})

describe('getEventSummary — default class', () => {
  it('shows a legacy claude-code event without assuming its shape', () => {
    const legacy: ParsedEvent = {
      ...pi('UserPromptSubmit', {}),
      payload: { agent_class: 'claude-code', prompt: 'old prompt' },
    }
    expect(getEventSummary(legacy)).toBe('old prompt')
  })
})

describe('extractBashBinary', () => {
  it.each([
    ['ls -la', 'ls'],
    ['FOO=1 npm test', 'npm'],
    ['cd src && make', 'make'],
    ['/usr/bin/env python3 x.py', 'env'],
    ['$(echo x)', null],
  ])('%s → %s', (cmd, bin) => {
    expect(extractBashBinary(cmd)).toBe(bin)
  })
})

describe('getEventSummaryTag', () => {
  it('tags a bash call with the binary it runs, kept out of the summary', () => {
    const e = tool('bash', { command: 'npm test -- --run' })
    expect(getEventSummaryTag(e)).toBe('npm')
    expect(getEventSummary(e)).toBe('npm test -- --run')
  })

  it('tags a script run by path with its file name', () => {
    expect(getEventSummaryTag(tool('bash', { command: './scripts/run.sh --fast' }))).toBe('run.sh')
  })

  it('no tag when nothing in the command looks like a binary', () => {
    expect(getEventSummaryTag(tool('bash', { command: '"$EDITOR"' }))).toBeNull()
  })

  it('never splits a bracketed path on another tool', () => {
    const e = tool('read', { path: '/work/proj/app/[id]/page.tsx' })
    expect(getEventSummaryTag(e)).toBeNull()
    expect(getEventSummary(e)).toBe('app/[id]/page.tsx')
  })

  it('non-tool events have no tag', () => {
    expect(getEventSummaryTag(pi('UserPromptSubmit', { prompt: 'hi' }))).toBeNull()
  })
})
