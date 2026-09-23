import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, renderHook } from '@testing-library/react'
import { DedupedEventsProvider, useSessionDedupedEvents } from './deduped-events-context'
import type { DedupedEventsResult } from './use-deduped-events'
import { useUIStore } from '@/stores/ui-store'
import { useFilterStore } from '@/stores/filter-store'
import type { ParsedEvent } from '@/types'

const { mockEvents } = vi.hoisted(() => ({ mockEvents: { current: [] as ParsedEvent[] } }))

vi.mock('@/hooks/use-events', () => ({
  useEvents: () => ({ data: mockEvents.current, isLoading: false, isError: false, error: null }),
}))

function makeEvent(id: number, overrides: Partial<ParsedEvent> = {}): ParsedEvent {
  return {
    id,
    agentId: 'agent-1',
    sessionId: 'sess-1',
    type: 'hook',
    subtype: 'UserPromptSubmit',
    toolName: null,
    toolUseId: null,
    status: 'pending',
    timestamp: 1_000 + id,
    createdAt: 1_000 + id,
    payload: {},
    ...overrides,
  }
}

beforeEach(() => {
  useUIStore.setState({ selectedSessionId: 'sess-1', rewindMode: false, frozenEvents: null })
  useFilterStore.setState({ compiled: [] })
  mockEvents.current = [
    makeEvent(1),
    makeEvent(2, { type: 'tool', subtype: 'PreToolUse', toolName: 'bash', toolUseId: 'tu-1' }),
    makeEvent(3, { type: 'tool', subtype: 'PostToolUse', toolName: 'bash', toolUseId: 'tu-1' }),
  ]
})

describe('DedupedEventsProvider', () => {
  it('hands every consumer the same processed result', () => {
    const seen: DedupedEventsResult[] = []
    function Consumer() {
      seen.push(useSessionDedupedEvents())
      return null
    }

    render(
      <DedupedEventsProvider>
        <Consumer />
        <Consumer />
        <Consumer />
      </DedupedEventsProvider>,
    )

    expect(seen.length).toBeGreaterThanOrEqual(3)
    const last = seen.at(-1)!
    expect(seen.slice(-3).every((r) => r === last)).toBe(true)
    expect(last.deduped.map((e) => e.id)).toEqual([1, 2])
    expect(last.mergedIdMap.get(3)).toBe(2)
  })

  it('reads the frozen snapshot in rewind mode', () => {
    useUIStore.setState({ rewindMode: true, frozenEvents: [makeEvent(10)] })
    const { result } = renderHook(() => useSessionDedupedEvents(), {
      wrapper: ({ children }) => <DedupedEventsProvider>{children}</DedupedEventsProvider>,
    })

    expect(result.current.deduped.map((e) => e.id)).toEqual([10])
  })

  it('throws when used outside the provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => renderHook(() => useSessionDedupedEvents())).toThrow(/DedupedEventsProvider/)
  })
})
