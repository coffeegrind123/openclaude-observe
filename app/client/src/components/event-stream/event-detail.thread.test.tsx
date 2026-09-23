import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import { EventDetail } from './event-detail'
import { useFilterStore } from '@/stores/filter-store'
import { useUIStore } from '@/stores/ui-store'
import { compileFilters } from '@/lib/filters/compile'
import { piFixtureEvents, piFixtureAgents, PI_SESSION_ID } from '@/test/pi-fixture'
import type { Agent, Filter } from '@/types'

// GET /events/:id/thread for the captured prompt: the top-level agent's
// prompt→Stop window, raw — SystemPrompt included, Pre and Post both present.
const { getThread } = vi.hoisted(() => ({ getThread: vi.fn() }))
vi.mock('@/lib/api-client', () => ({ api: { getThread } }))

const agentMap = new Map<string, Agent>(piFixtureAgents().map((a) => [a.id, a]))
const EVENTS = piFixtureEvents()
const TOP = EVENTS.filter((e) => e.agentId === PI_SESSION_ID && e.subtype !== 'SessionStart')
const PROMPT = TOP.find((e) => e.subtype === 'UserPromptSubmit')!

const ALL_EXCLUDING_SYSTEM_PROMPT: Filter = {
  id: 'default-all',
  name: 'All',
  pillName: 'All',
  display: 'primary',
  combinator: 'and',
  patterns: [{ target: 'hook', regex: '^SystemPrompt$', negate: true }],
  kind: 'default',
  enabled: true,
  config: { role: 'all-exclusions' },
  createdAt: 0,
  updatedAt: 0,
}

beforeEach(() => {
  getThread.mockReset()
  getThread.mockResolvedValue(TOP)
  useFilterStore.setState({ compiled: [] })
  useUIStore.setState({
    scrollToEventId: null,
    threadCollapsed: false,
    threadRemeasureEventId: null,
    mergeToolEvents: true,
  })
})

async function renderThread() {
  const utils = render(<EventDetail event={PROMPT} agentMap={agentMap} />)
  const list = await screen.findByTestId('thread-rows')
  return { ...utils, list }
}

describe('EventDetail conversation thread', () => {
  it('sits below the raw payload, so the payload is reachable without scrolling a long turn', async () => {
    const { container } = await renderThread()
    const text = container.textContent ?? ''
    expect(text.indexOf('Raw payload')).toBeGreaterThanOrEqual(0)
    expect(text.indexOf('Raw payload')).toBeLessThan(text.indexOf('Conversation thread'))
  })

  it('rows are clickable and scroll the stream to that event', async () => {
    const { list } = await renderThread()
    const rows = within(list).getAllByRole('button')
    const llm = TOP.find((e) => e.subtype === 'LLMGeneration')!
    const llmRow = rows.find((r) => r.dataset.eventId === String(llm.id))!
    fireEvent.click(llmRow)
    expect(useUIStore.getState().scrollToEventId).toBe(llm.id)

    // Keyboard too.
    useUIStore.setState({ scrollToEventId: null })
    fireEvent.keyDown(llmRow, { key: 'Enter' })
    expect(useUIStore.getState().scrollToEventId).toBe(llm.id)
  })

  it('merged PostToolUse events fold into their Pre row, keeping the outcome', async () => {
    const { list } = await renderThread()
    const ids = within(list)
      .getAllByRole('button')
      .map((r) => Number(r.dataset.eventId))
    const posts = TOP.filter(
      (e) => e.subtype === 'PostToolUse' || e.subtype === 'PostToolUseFailure',
    )
    expect(posts.length).toBeGreaterThan(0)
    for (const p of posts) {
      expect(ids).not.toContain(p.id)
    }
  })

  it('with Pre/Post merging off, the thread shows every hook event like the stream', async () => {
    useUIStore.setState({ mergeToolEvents: false })
    const { list } = await renderThread()
    expect(within(list).getAllByRole('button')).toHaveLength(TOP.length)
  })

  it('respects the All filter: events it hides in the stream are hidden here too', async () => {
    useFilterStore.setState({ compiled: compileFilters([ALL_EXCLUDING_SYSTEM_PROMPT]) })
    const { list } = await renderThread()
    const systemPrompt = TOP.find((e) => e.subtype === 'SystemPrompt')!
    const ids = within(list)
      .getAllByRole('button')
      .map((r) => Number(r.dataset.eventId))
    expect(ids).not.toContain(systemPrompt.id)
    expect(ids).toContain(PROMPT.id)
  })

  it('collapses and expands; the choice seeds the next detail and asks the stream to re-measure', async () => {
    const { unmount } = await renderThread()
    const header = screen.getByRole('button', { name: /Conversation thread/ })
    fireEvent.click(header)

    expect(screen.queryByTestId('thread-rows')).toBeNull()
    // Collapsed header shows how many rows are hidden.
    expect(header.textContent).toMatch(/\(\d+\)/)
    expect(useUIStore.getState().threadCollapsed).toBe(true)
    expect(useUIStore.getState().threadRemeasureEventId).toBe(PROMPT.id)
    unmount()

    // A newly opened detail starts collapsed…
    render(<EventDetail event={PROMPT} agentMap={agentMap} />)
    await waitFor(() => expect(getThread).toHaveBeenCalledTimes(2))
    expect(screen.queryByTestId('thread-rows')).toBeNull()
    // …and expanding it shows the rows again.
    fireEvent.click(screen.getByRole('button', { name: /Conversation thread/ }))
    expect(await screen.findByTestId('thread-rows')).toBeInTheDocument()
  })

  it("toggling one open thread doesn't collapse another open detail", async () => {
    render(
      <>
        <EventDetail event={PROMPT} agentMap={agentMap} />
        <EventDetail event={PROMPT} agentMap={agentMap} />
      </>,
    )
    await waitFor(() => expect(screen.getAllByTestId('thread-rows')).toHaveLength(2))
    fireEvent.click(screen.getAllByRole('button', { name: /Conversation thread/ })[0])
    expect(screen.getAllByTestId('thread-rows')).toHaveLength(1)
  })
})
