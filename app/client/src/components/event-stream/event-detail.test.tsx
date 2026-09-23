import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { renderHook } from '@testing-library/react'
import { EventDetail } from './event-detail'
import { useDedupedEvents } from '@/hooks/use-deduped-events'
import { useFilterStore } from '@/stores/filter-store'
import { useUIStore } from '@/stores/ui-store'
import {
  piFixtureEvents,
  piFixtureAgents,
  PI_SUBAGENT_ID,
  PI_AGENT_TOOL_USE_ID,
} from '@/test/pi-fixture'
import type { Agent, ParsedEvent } from '@/types'

vi.mock('@/lib/api-client', () => ({
  api: { getThread: vi.fn(() => Promise.resolve([])) },
}))

const agentMap = new Map<string, Agent>(piFixtureAgents().map((a) => [a.id, a]))

beforeEach(() => {
  useFilterStore.setState({ compiled: [] })
  useUIStore.setState({ selectedAgentIds: [], scrollToEventId: null, selectedEventId: null })
})

/** The deduped pipeline over the real capture, as the stream sees it. */
function pipeline() {
  const events = piFixtureEvents()
  const { result } = renderHook(() => useDedupedEvents(events))
  return { events, ...result.current }
}

/** Render the detail for a deduped row the way EventRow / Inspector do. */
function renderRow(row: ParsedEvent) {
  const p = pipeline()
  const spawnedAgentId = row.toolUseId ? p.spawnedAgentIds.get(row.toolUseId) : undefined
  return render(
    <EventDetail
      event={row}
      agentMap={agentMap}
      spawnInfo={p.spawnInfo.get(row.agentId)}
      spawnedAgentId={spawnedAgentId}
      spawnedInfo={spawnedAgentId ? p.spawnInfo.get(spawnedAgentId) : undefined}
      pairedPayloads={p.pairedPayloads.get(row.id)}
    />,
  )
}

function row(predicate: (e: ParsedEvent) => boolean): ParsedEvent {
  const found = pipeline().deduped.find(predicate)
  if (!found) {
    throw new Error('row not found')
  }
  return found
}

describe('EventDetail — real pi capture', () => {
  it('renders a detail body for every one of the 24 envelopes', () => {
    for (const e of piFixtureEvents()) {
      const { container, unmount } = render(<EventDetail event={e} agentMap={agentMap} />)
      expect(container.textContent, `${e.id} ${e.subtype}`).not.toContain('No renderer')
      unmount()
    }
  })

  it('read shows the path and the file content from tool_response.content', () => {
    renderRow(row((e) => e.toolName === 'read'))
    expect(screen.getAllByText('notes.txt').length).toBeGreaterThan(0)
    expect(screen.getByText(/alpha/)).toBeInTheDocument()
    expect(screen.getByText('146ms')).toBeInTheDocument()
  })

  it('bash shows command, output and exit 0', () => {
    renderRow(row((e) => e.toolUseId === 'call_17337b69'))
    expect(screen.getByTestId('bash-status')).toHaveTextContent('exit 0')
    expect(screen.getByText('hi', { selector: 'div' })).toBeInTheDocument()
  })

  it('the failing bash reads as failed with its exit code and stderr', () => {
    const failing = row((e) => e.toolUseId === 'call_316a9d0c')
    expect(failing.status).toBe('failed')
    renderRow(failing)
    expect(screen.getByTestId('bash-status')).toHaveTextContent('exit 1')
    expect(screen.getByText('failed')).toBeInTheDocument()
    expect(screen.getByText('Command exited with code 1')).toBeInTheDocument()
    expect(screen.getByText(/No such file or directory/)).toBeInTheDocument()
  })

  it('the Agent call links to the subagent it spawned, with its result details', () => {
    renderRow(row((e) => e.toolUseId === PI_AGENT_TOOL_USE_ID))
    const link = screen.getByTestId('agent-link')
    expect(within(link).getByText('general-purpose#f322fa95')).toBeInTheDocument()
    expect(screen.getByText('Count lines in notes.txt')).toBeInTheDocument()
    expect(screen.getByText('in 3.8k · out 57')).toBeInTheDocument()
    expect(screen.getByText('Qwen3.8-27B local (forge)')).toBeInTheDocument()

    fireEvent.click(within(link).getByText(/only/))
    expect(useUIStore.getState().selectedAgentIds).toEqual([PI_SUBAGENT_ID])

    fireEvent.click(within(link).getByText(/start/))
    expect(useUIStore.getState().scrollToEventId).toBe(13)
  })

  it("the subagent's SubagentStart links back to the spawning call and shows the task prompt", () => {
    renderRow(row((e) => e.subtype === 'SubagentStart'))
    expect(screen.getByText('call_358b73ae')).toBeInTheDocument()
    expect(screen.getByText(/Use bash to run: wc -l notes.txt/)).toBeInTheDocument()
    fireEvent.click(screen.getByText(/spawning call/))
    expect(useUIStore.getState().scrollToEventId).toBe(12)
  })

  it('SubagentStop shows turns, tool uses, tokens and duration', () => {
    renderRow(row((e) => e.subtype === 'SubagentStop'))
    expect(screen.getByText('3,815')).toBeInTheDocument()
    expect(screen.getByText('57')).toBeInTheDocument()
    expect(screen.getByText('6.2s')).toBeInTheDocument()
  })

  it('LLMGeneration shows tokens, timing, context and requested tools', () => {
    renderRow(row((e) => e.id === 4))
    expect(screen.getByText('6,652')).toBeInTheDocument()
    expect(screen.getByText('247')).toBeInTheDocument()
    expect(screen.getByText('9,269ms')).toBeInTheDocument()
    expect(screen.getByText('9.28s')).toBeInTheDocument()
    // ttft 9269 of 9277 ms: arrived in one burst, so no decode speed.
    expect(screen.getByText(/response arrived in one burst/)).toBeInTheDocument()
    expect(screen.getByText('6,899 / 98,304 (7.0%)')).toBeInTheDocument()
    expect(screen.getByText('HTTP 200')).toBeInTheDocument()
    expect(screen.getAllByText('bash')).toHaveLength(2)
    expect(screen.getByText('read')).toBeInTheDocument()
    expect(screen.getByText('Thinking')).toBeInTheDocument()
  })

  it('LLMGeneration derives client tokens/s when the response streamed', () => {
    const base = piFixtureEvents()[3]
    const streamed = {
      ...base,
      payload: { ...base.payload, ttft_ms: 1000, duration_ms: 3000, output_tokens: 100 },
    }
    render(<EventDetail event={streamed} agentMap={agentMap} />)
    expect(screen.getByText('50.0 (client-derived)')).toBeInTheDocument()
  })

  it('SystemPrompt is collapsed by default with size and token estimate', () => {
    renderRow(row((e) => e.id === 3))
    const toggle = screen.getByRole('button', { name: /System prompt/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText(/408 chars · ~102 tok/)).toBeInTheDocument()
    expect(screen.queryByText(/expert coding assistant/)).toBeNull()
    fireEvent.click(toggle)
    expect(screen.getByText(/expert coding assistant/)).toBeInTheDocument()
  })

  it('the subagent prompt is labelled as its task', () => {
    renderRow(row((e) => e.id === 14))
    expect(screen.getByText('task prompt for general-purpose#f322fa95')).toBeInTheDocument()
  })

  it('Stop shows the context usage', () => {
    renderRow(row((e) => e.subtype === 'Stop'))
    expect(screen.getByText('7,076 / 98,304 (7.2%)')).toBeInTheDocument()
  })
})

describe('EventDetail — pi tools beyond the capture', () => {
  function tool(
    toolName: string,
    input: Record<string, unknown>,
    response: unknown,
    failed = false,
  ) {
    const pre: ParsedEvent = {
      id: 100,
      agentId: 's',
      sessionId: 's',
      type: 'tool',
      subtype: 'PreToolUse',
      toolName,
      toolUseId: 'tu',
      status: 'running',
      timestamp: 0,
      payload: { agent_class: 'pi', tool_name: toolName, tool_input: input, cwd: '/w' },
    }
    const postPayload = {
      agent_class: 'pi',
      tool_name: toolName,
      tool_input: input,
      tool_response: response,
      is_error: failed,
      duration_ms: 12,
      cwd: '/w',
    }
    const merged: ParsedEvent = {
      ...pre,
      status: failed ? 'failed' : 'completed',
      payload: postPayload,
    }
    return render(
      <EventDetail
        event={merged}
        agentMap={new Map()}
        pairedPayloads={{
          pre: { subtype: 'PreToolUse', timestamp: 0, payload: pre.payload },
          post: {
            subtype: failed ? 'PostToolUseFailure' : 'PostToolUse',
            timestamp: 1,
            payload: postPayload,
          },
        }}
      />,
    )
  }

  it('edit renders the applied diff from details.diff and each edits[] block', () => {
    tool(
      'edit',
      { path: '/w/a.ts', edits: [{ oldText: 'const a = 1', newText: 'const a = 2' }] },
      {
        content: 'Successfully replaced 1 block(s) in a.ts.',
        details: { diff: '-1 const a = 1\n+1 const a = 2', patch: '', firstChangedLine: 1 },
      },
    )
    expect(screen.getByText('-1 const a = 1')).toBeInTheDocument()
    expect(screen.getByText('first change at line 1')).toBeInTheDocument()
    fireEvent.click(screen.getByText('edits'))
    expect(screen.getByText('+1')).toBeInTheDocument()
  })

  it('write renders the content it wrote', () => {
    tool(
      'write',
      { path: '/w/n.txt', content: 'hello world' },
      { content: 'Successfully wrote to n.txt', details: null },
    )
    expect(screen.getByText('Successfully wrote to n.txt')).toBeInTheDocument()
    expect(screen.getByText('11 chars')).toBeInTheDocument()
  })

  it('grep parses path:line: matches and the trailing limit notice', () => {
    tool(
      'grep',
      { pattern: 'TODO', path: 'src' },
      {
        content:
          'src/a.ts:3: // TODO one\nsrc/b.ts:9: // TODO two\n\n[100 matches limit reached. Use limit=200 for more, or refine pattern]',
        details: { matchLimitReached: 100 },
      },
    )
    expect(screen.getByText('2 matches')).toBeInTheDocument()
    expect(screen.getByText(/100 matches limit reached/)).toBeInTheDocument()
  })

  it('ls lists entries, directories marked', () => {
    tool('ls', { path: 'src' }, { content: 'a.ts\nlib/', details: null })
    expect(screen.getByText('2 entries')).toBeInTheDocument()
    expect(screen.getByText('lib/')).toBeInTheDocument()
  })

  it('mcp shows the proxy call and its result', () => {
    tool(
      'mcp',
      { tool: 'browser_set_cookie', args: { name: 'sid' } },
      { content: 'cookie set', details: {} },
    )
    expect(screen.getByText('browser_set_cookie name=sid')).toBeInTheDocument()
    expect(screen.getByText('cookie set')).toBeInTheDocument()
  })

  it('browser direct tools show their arguments', () => {
    tool(
      'browser_navigate',
      { url: 'https://example.com' },
      { content: 'Navigated', details: { server: 'browser', tool: 'navigate' } },
    )
    expect(screen.getByText('https://example.com')).toBeInTheDocument()
    expect(screen.getByText('Navigated')).toBeInTheDocument()
  })

  it('a timed-out bash reads as timed out', () => {
    tool(
      'bash',
      { command: 'sleep 99', timeout: 5 },
      { content: 'Command timed out after 5 seconds', details: {} },
      true,
    )
    expect(screen.getByTestId('bash-status')).toHaveTextContent('timed out')
    expect(screen.getByText('timeout 5s')).toBeInTheDocument()
  })
})

describe('EventDetail — default class', () => {
  it('renders a legacy claude-code event as generic JSON', () => {
    const legacy: ParsedEvent = {
      id: 1,
      agentId: 'a',
      sessionId: 'a',
      type: 'hook',
      subtype: 'TaskCreated',
      toolName: null,
      toolUseId: null,
      status: 'pending',
      timestamp: 0,
      payload: { agent_class: 'claude-code', task_subject: 'Wire up auth' },
    }
    render(<EventDetail event={legacy} agentMap={new Map()} />)
    expect(screen.getByText(/No renderer for this agent class/)).toBeInTheDocument()
    expect(screen.getByText('claude-code')).toBeInTheDocument()
  })
})
