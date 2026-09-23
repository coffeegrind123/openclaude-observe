import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, screen } from '@testing-library/react'
import { renderWithProviders } from '@/test/test-utils'
import { EventStream } from './event-stream'
import { DedupedEventsProvider } from '@/hooks/deduped-events-context'
import { useUIStore } from '@/stores/ui-store'
import { useFilterStore } from '@/stores/filter-store'
import { compileFilters } from '@/lib/filters/compile'
import type { ParsedEvent, Agent, Filter } from '@/types'
import { piFixtureEvents, piFixtureAgents } from '@/test/pi-fixture'

// ── Mock hooks ──────────────────────────────────────────────

const mockEvents: ParsedEvent[] = []
const mockAgents: Agent[] = []
const mockEventsState = { isLoading: false, isError: false }

vi.mock('@/hooks/use-events', () => ({
  useEvents: () => ({
    data: mockEventsState.isLoading ? undefined : mockEvents,
    isLoading: mockEventsState.isLoading,
    isError: mockEventsState.isError,
    error: null,
  }),
}))

vi.mock('@/hooks/use-agents', () => ({
  useAgents: () => mockAgents,
}))

// Mock timeago.js to return stable strings
vi.mock('timeago.js', () => ({
  format: () => 'just now',
}))

function renderStream() {
  return renderWithProviders(
    <DedupedEventsProvider>
      <EventStream />
    </DedupedEventsProvider>,
  )
}

function setMockEvents(events: ParsedEvent[]) {
  mockEvents.length = 0
  mockEvents.push(...events)
}

function setMockAgents(agents: Agent[]) {
  mockAgents.length = 0
  mockAgents.push(...agents)
}

/**
 * Seed the filter store so useDedupedEvents can tag each event with
 * `filters.primary` / `filters.secondary`. A `Prompts` primary filter and
 * a `{toolName}` secondary filter cover the cases exercised below.
 */
function initializeFilterStore() {
  const seedFilters: Filter[] = [
    {
      id: 'default-dynamic-tool-name',
      name: 'Dynamic tool name',
      pillName: '{toolName}',
      display: 'secondary',
      combinator: 'and',
      patterns: [{ target: 'hook', regex: '^(PreToolUse|PostToolUse|PostToolUseFailure)$' }],
      kind: 'default',
      enabled: true,
      config: {},
      createdAt: 0,
      updatedAt: 0,
    },
    {
      id: 'default-prompts',
      name: 'Prompts',
      pillName: 'Prompts',
      display: 'primary',
      combinator: 'and',
      patterns: [{ target: 'hook', regex: '^(UserPromptSubmit|UserBash)$' }],
      kind: 'default',
      enabled: true,
      config: {},
      createdAt: 0,
      updatedAt: 0,
    },
  ]
  useFilterStore.setState({
    filters: seedFilters,
    compiled: compileFilters(seedFilters),
    loaded: true,
  })
}

// Every event is a pi envelope (agent_class: 'pi'), as the server stores them.
function makeEvent(overrides: Partial<ParsedEvent>): ParsedEvent {
  const { payload, ...rest } = overrides
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
    ...rest,
    payload: { agent_class: 'pi', ...(payload ?? {}) },
  }
}

function makeAgent(overrides: Partial<Agent>): Agent {
  return {
    id: 'agent-1',
    sessionId: 'sess-1',
    parentAgentId: null,
    name: null,
    description: null,
    status: 'active',
    eventCount: 0,
    firstEventAt: Date.now(),
    lastEventAt: Date.now(),
    ...overrides,
  }
}

beforeEach(() => {
  setMockEvents([])
  setMockAgents([])
  initializeFilterStore()

  // Reset UI store
  useUIStore.setState({
    selectedProjectId: 1,
    selectedSessionId: 'sess-1',
    selectedAgentIds: [],
    activePrimaryFilters: [],
    activeSecondaryFilters: [],
    searchQuery: '',
    autoFollow: true,
    expandedEventIds: new Set(),
    expandAllCounter: 0,
    selectedEventId: null,
    scrollToEventId: null,
    flashingEventId: null,
    sessionFilterStates: new Map(),
  })
})

describe('EventStream', () => {
  it('should show "Select a project" when no session selected', () => {
    useUIStore.setState({ selectedSessionId: null })
    renderStream()
    expect(screen.getByText('Select a project to view events')).toBeInTheDocument()
  })

  it('should show "No events in this session" when session selected but no events', () => {
    setMockEvents([])
    renderStream()
    expect(screen.getByText('No events in this session')).toBeInTheDocument()
  })

  it('should show loading spinner while events are loading', () => {
    mockEventsState.isLoading = true
    renderStream()
    expect(screen.getByText('Loading events...')).toBeInTheDocument()
    mockEventsState.isLoading = false
  })

  it('should render events when available', () => {
    setMockEvents([
      makeEvent({
        id: 1,
        subtype: 'UserPromptSubmit',
        payload: { prompt: 'Fix the bug' },
        timestamp: 1700000000000,
      }),
      makeEvent({
        id: 2,
        subtype: 'SessionStart',
        payload: { source: 'cli' },
        timestamp: 1700000001000,
      }),
    ])
    setMockAgents([makeAgent({ id: 'agent-1' })])

    renderStream()

    // Should show event count
    expect(screen.getByText('2')).toBeInTheDocument()
    // Should show event summaries
    expect(screen.getByText('Fix the bug')).toBeInTheDocument()
    expect(screen.getByText('Session cli')).toBeInTheDocument()
  })

  // ── PreToolUse + PostToolUse deduplication ────────────────

  it('should merge PreToolUse + PostToolUse into a single row', () => {
    setMockEvents([
      makeEvent({
        id: 1,
        subtype: 'PreToolUse',
        toolName: 'bash',
        toolUseId: 'tu-1',
        status: 'pending',
        payload: { tool_input: { command: 'ls' } },
        timestamp: 1700000000000,
      }),
      makeEvent({
        id: 2,
        subtype: 'PostToolUse',
        toolName: 'bash',
        toolUseId: 'tu-1',
        status: 'completed',
        payload: {
          tool_input: { command: 'ls' },
          tool_response: { content: 'files', details: null },
        },
        timestamp: 1700000001000,
      }),
    ])
    setMockAgents([makeAgent({ id: 'agent-1' })])

    renderStream()

    // Should show only 1 event (merged), not 2
    expect(screen.getByText('1')).toBeInTheDocument()
    // The tool name should appear
    const bashElements = screen.getAllByText('bash')
    expect(bashElements.length).toBeGreaterThan(0)
  })

  it('should show merged PreToolUse + PostToolUseFailure as failed status', () => {
    // When merged, the event keeps subtype='PreToolUse' but gets status='failed'.
    // The payload is replaced with PostToolUseFailure's payload.
    // The event row detects failure via status, not subtype.
    setMockEvents([
      makeEvent({
        id: 1,
        subtype: 'PreToolUse',
        toolName: 'bash',
        toolUseId: 'tu-fail',
        status: 'pending',
        payload: { tool_input: { command: 'bad-cmd' } },
        timestamp: 1700000000000,
      }),
      makeEvent({
        id: 2,
        subtype: 'PostToolUseFailure',
        toolName: 'bash',
        toolUseId: 'tu-fail',
        status: 'failed',
        payload: {
          error: 'bash: bad-cmd: command not found\n\nCommand exited with code 127',
          is_error: true,
          tool_input: { command: 'bad-cmd' },
        },
        timestamp: 1700000001000,
      }),
    ])
    setMockAgents([makeAgent({ id: 'agent-1' })])

    renderStream()

    // Should show 1 merged event (not 2)
    expect(screen.getByText('1')).toBeInTheDocument()
    // The merged row keeps subtype PreToolUse so summary uses tool_input from PostToolUseFailure payload.
    // The binary extractBashBinary finds is a separate, muted tag ahead of the command.
    expect(screen.getByText('bad-cmd', { selector: '[data-summary-tag]' })).toBeInTheDocument()
    expect(
      screen.getByText('bad-cmd', { selector: ':not([data-summary-tag])' }),
    ).toBeInTheDocument()
    // The failure's status line reads under the row.
    expect(screen.getByText(/Command exited with code 127/)).toBeInTheDocument()
  })

  it('should NOT merge events with different toolUseIds', () => {
    setMockEvents([
      makeEvent({
        id: 1,
        subtype: 'PreToolUse',
        toolName: 'bash',
        toolUseId: 'tu-1',
        payload: { tool_input: { command: 'ls' } },
        timestamp: 1700000000000,
      }),
      makeEvent({
        id: 2,
        subtype: 'PreToolUse',
        toolName: 'read',
        toolUseId: 'tu-2',
        payload: { tool_input: { path: '/tmp/f.txt' } },
        timestamp: 1700000001000,
      }),
    ])
    setMockAgents([makeAgent({ id: 'agent-1' })])

    renderStream()

    // Should show 2 events (no merge)
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  // ── Agent filtering ───────────────────────────────────────

  it('should filter events by selected agent IDs', () => {
    setMockEvents([
      makeEvent({
        id: 1,
        agentId: 'agent-1',
        subtype: 'UserPromptSubmit',
        payload: { prompt: 'Agent 1 prompt' },
        timestamp: 1700000000000,
      }),
      makeEvent({
        id: 2,
        agentId: 'agent-2',
        subtype: 'UserPromptSubmit',
        payload: { prompt: 'Agent 2 prompt' },
        timestamp: 1700000001000,
      }),
    ])
    setMockAgents([
      makeAgent({ id: 'agent-1' }),
      makeAgent({ id: 'agent-2', parentAgentId: 'agent-1' }),
    ])

    // Select only agent-1
    useUIStore.setState({ selectedAgentIds: ['agent-1'] })

    renderStream()

    expect(screen.getByText('Agent 1 prompt')).toBeInTheDocument()
    expect(screen.queryByText('Agent 2 prompt')).not.toBeInTheDocument()
  })

  // ── Static/tool filter application ────────────────────────

  it('should apply static filters to events', () => {
    setMockEvents([
      makeEvent({
        id: 1,
        subtype: 'UserPromptSubmit',
        payload: { prompt: 'My prompt' },
        timestamp: 1700000000000,
      }),
      makeEvent({
        id: 2,
        subtype: 'SessionStart',
        payload: { source: 'cli' },
        timestamp: 1700000001000,
      }),
    ])
    setMockAgents([makeAgent({ id: 'agent-1' })])

    // Only show Prompts
    useUIStore.setState({ activePrimaryFilters: ['Prompts'] })

    renderStream()

    expect(screen.getByText('My prompt')).toBeInTheDocument()
    expect(screen.queryByText('Session cli')).not.toBeInTheDocument()
  })

  it('should apply tool name filters to events', () => {
    setMockEvents([
      makeEvent({
        id: 1,
        subtype: 'PreToolUse',
        toolName: 'bash',
        toolUseId: 'tu-1',
        payload: { tool_input: { command: 'ls -la' } },
        timestamp: 1700000000000,
      }),
      makeEvent({
        id: 2,
        subtype: 'PreToolUse',
        toolName: 'read',
        toolUseId: 'tu-2',
        payload: { tool_input: { path: '/tmp/file.txt' } },
        timestamp: 1700000001000,
      }),
    ])
    setMockAgents([makeAgent({ id: 'agent-1' })])

    // Only show Bash tools
    useUIStore.setState({ activeSecondaryFilters: ['bash'] })

    renderStream()

    // Bash event should be visible
    expect(screen.getByText('ls -la')).toBeInTheDocument()
    expect(screen.getByText('ls', { selector: '[data-summary-tag]' })).toBeInTheDocument()
    // Read event should be filtered out
    expect(screen.queryByText('/tmp/file.txt')).not.toBeInTheDocument()
  })

  // ── Event count display ───────────────────────────────────

  it('should show raw count when filters reduce the visible count', () => {
    setMockEvents([
      makeEvent({
        id: 1,
        subtype: 'UserPromptSubmit',
        payload: { prompt: 'Hello' },
        timestamp: 1700000000000,
      }),
      makeEvent({
        id: 2,
        subtype: 'SessionStart',
        payload: {},
        timestamp: 1700000001000,
      }),
    ])
    setMockAgents([makeAgent({ id: 'agent-1' })])

    // Filter to only Prompts (1 visible out of 2 raw)
    useUIStore.setState({ activePrimaryFilters: ['Prompts'] })

    renderStream()

    // Should show "1" for filtered count and "2 raw" for total
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText(/2 raw/)).toBeInTheDocument()
  })

  // ── Agent label display ───────────────────────────────────

  it('should show agent labels when multiple agents exist', () => {
    setMockEvents([
      makeEvent({
        id: 1,
        agentId: 'agent-1',
        subtype: 'UserPromptSubmit',
        payload: { prompt: 'Hello' },
        timestamp: 1700000000000,
      }),
    ])
    setMockAgents([
      makeAgent({ id: 'agent-1', parentAgentId: null }),
      makeAgent({ id: 'agent-2', parentAgentId: 'agent-1', name: 'worker' }),
    ])

    renderStream()

    // With 2 agents, should show agent labels
    expect(screen.getByText('Main')).toBeInTheDocument()
  })

  it('should NOT show agent labels when only one agent exists', () => {
    setMockEvents([
      makeEvent({
        id: 1,
        agentId: 'agent-1',
        subtype: 'UserPromptSubmit',
        payload: { prompt: 'Hello' },
        timestamp: 1700000000000,
      }),
    ])
    setMockAgents([makeAgent({ id: 'agent-1' })])

    renderStream()

    // With only 1 agent, "Main" label should not appear
    expect(screen.queryByText('Main')).not.toBeInTheDocument()
  })

  // ── The real pi capture ───────────────────────────────────

  describe('real pi capture', () => {
    // setup.ts reports every element as 800px tall, so the virtualizer would
    // mount only a couple of measured rows; give rows (data-index) a row height
    // so the whole 19-row stream mounts.
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')!
    beforeEach(() => {
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
        configurable: true,
        get(this: HTMLElement) {
          return this.hasAttribute('data-index') ? 24 : 800
        },
      })
    })
    afterEach(() => {
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', original)
    })

    it('renders all 24 envelopes as 19 rows (5 tool results merged into their calls)', () => {
      setMockEvents(piFixtureEvents())
      setMockAgents(piFixtureAgents())
      renderStream()

      expect(screen.getByText('19')).toBeInTheDocument()
      expect(screen.getByText(/24 raw/)).toBeInTheDocument()
    })

    it('shows pi tool rows with their real arguments and the failing bash as failed', () => {
      setMockEvents(piFixtureEvents())
      setMockAgents(piFixtureAgents())
      renderStream()

      expect(screen.getByText('echo hi')).toBeInTheDocument()
      expect(screen.getByText('cat missing-file.txt')).toBeInTheDocument()
      expect(
        screen.getByText(/Command exited with code 1 — cat: missing-file.txt: No such file/),
      ).toBeInTheDocument()
    })

    it("attributes the subagent's events to it and links the Agent call to it", () => {
      setMockEvents(piFixtureEvents())
      setMockAgents(piFixtureAgents())
      renderStream()

      // Agent row → spawned subagent chip.
      expect(screen.getByTestId('spawned-agent')).toHaveTextContent('general-purpose#f322fa95')
      // The subagent's own rows carry its label; its prompt reads as its task.
      expect(screen.getAllByText('general-purpose#f322fa95').length).toBeGreaterThan(1)
      expect(screen.getAllByText('task').length).toBe(1)
      expect(screen.getByText('wc -l notes.txt')).toBeInTheDocument()
    })

    it('shows LLM generations with tokens and timing', () => {
      setMockEvents(piFixtureEvents())
      setMockAgents(piFixtureAgents())
      renderStream()

      expect(
        screen.getByText('qwen3.8-27b · in 6.7k out 247 · 9.3s · → read, bash×2'),
      ).toBeInTheDocument()
      expect(screen.getByText('DONE')).toBeInTheDocument()
    })

    it('narrows to the subagent plus the call that spawned it', () => {
      setMockEvents(piFixtureEvents())
      setMockAgents(piFixtureAgents())
      useUIStore.setState({ selectedAgentIds: ['01a0cea8-63cb-73d4-853f-9a5b79957320'] })
      renderStream()

      // 8 subagent events − 1 merged tool result + the spawning Agent row.
      expect(screen.getByText('8')).toBeInTheDocument()
      expect(screen.getByTestId('spawned-agent')).toBeInTheDocument()
      expect(screen.queryByText('echo hi')).not.toBeInTheDocument()
    })

    it('talk lens keeps only the conversation', () => {
      setMockEvents(piFixtureEvents())
      setMockAgents(piFixtureAgents())
      useUIStore.setState({ talkMode: true })
      renderStream()

      expect(screen.getByText('9')).toBeInTheDocument()
      expect(screen.queryByText('echo hi')).not.toBeInTheDocument()
      useUIStore.setState({ talkMode: false })
    })

    it('with Pre/Post merging off, shows all 24 hook events labelled by hook name', () => {
      setMockEvents(piFixtureEvents())
      setMockAgents(piFixtureAgents())
      useUIStore.setState({ mergeToolEvents: false })
      try {
        renderStream()
        expect(screen.getByText('24')).toBeInTheDocument()
        // No "/ N raw" — nothing is folded away.
        expect(screen.queryByText(/raw/)).not.toBeInTheDocument()
        expect(screen.getAllByText('PreToolUse').length).toBe(5)
        expect(screen.getAllByText('PostToolUse').length).toBeGreaterThan(0)
        expect(screen.getAllByText('PostToolUseFailure').length).toBe(1)
      } finally {
        useUIStore.setState({ mergeToolEvents: true })
      }
    })

    it('re-measures a row whose conversation thread was toggled, then clears the request', () => {
      setMockEvents(piFixtureEvents())
      setMockAgents(piFixtureAgents())
      renderStream()
      const prompt = piFixtureEvents().find((e) => e.subtype === 'UserPromptSubmit')!
      act(() => useUIStore.getState().setThreadRemeasureEventId(prompt.id))
      expect(useUIStore.getState().threadRemeasureEventId).toBeNull()
    })
  })
})
