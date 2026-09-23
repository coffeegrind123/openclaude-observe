import { describe, it, expect, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useDedupedEvents } from './use-deduped-events'
import { useFilterStore } from '@/stores/filter-store'
import { useUIStore } from '@/stores/ui-store'
import { piFixtureEvents, PI_SUBAGENT_ID, PI_AGENT_TOOL_USE_ID } from '@/test/pi-fixture'
import type { ParsedEvent } from '@/types'

let nextId = 1

function makeEvent(overrides: Partial<ParsedEvent> = {}): ParsedEvent {
  const id = nextId++
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

function pre(toolUseId: string, toolName = 'bash'): ParsedEvent {
  return makeEvent({
    type: 'tool',
    subtype: 'PreToolUse',
    toolName,
    toolUseId,
    payload: { agent_class: 'pi', tool_input: { command: 'ls', description: 'd', prompt: 'p' } },
  })
}

function post(toolUseId: string, toolName = 'bash', payload: Record<string, unknown> = {}) {
  return makeEvent({ type: 'tool', subtype: 'PostToolUse', toolName, toolUseId, payload })
}

// pi's SubagentStart: the child's own event, naming the call that spawned it.
function subagentStart(
  agentId: string,
  parentToolUseId: string,
  extra: Record<string, unknown> = {},
) {
  return makeEvent({
    agentId,
    type: 'system',
    subtype: 'SubagentStart',
    payload: {
      agent_class: 'pi',
      agent_id: agentId,
      agent_type: 'Explore',
      agent_name: `Explore#${agentId.slice(0, 8)}`,
      agent_description: 'look around',
      parent_tool_use_id: parentToolUseId,
      background: false,
      ...extra,
    },
  })
}

beforeEach(() => {
  nextId = 1
  useFilterStore.setState({ compiled: [] })
  useUIStore.setState({ mergeToolEvents: true })
})

describe('useDedupedEvents incremental processing', () => {
  it('reuses row objects for already-processed events when events are appended', () => {
    const a = makeEvent()
    const b = pre('tu-1')
    const { result, rerender } = renderHook(({ events }) => useDedupedEvents(events), {
      initialProps: { events: [a, b] },
    })
    const firstRows = result.current.deduped

    rerender({ events: [a, b, makeEvent()] })

    expect(result.current.deduped).toHaveLength(3)
    expect(result.current.deduped).not.toBe(firstRows)
    expect(result.current.deduped[0]).toBe(firstRows[0])
    expect(result.current.deduped[1]).toBe(firstRows[1])
  })

  it('merges an appended PostToolUse into the earlier PreToolUse row', () => {
    const p = pre('tu-1', 'Agent')
    const { result, rerender } = renderHook(({ events }) => useDedupedEvents(events), {
      initialProps: { events: [p] },
    })
    const preRow = result.current.deduped[0]
    const prePaired = result.current.pairedPayloads.get(p.id)
    expect(prePaired?.post).toBeNull()

    const start = subagentStart('sub-1', 'tu-1')
    const q = post('tu-1', 'Agent', { tool_response: { content: '2', details: null } })
    rerender({ events: [p, start, q] })

    const rows = result.current.deduped
    expect(rows).toHaveLength(2)
    expect(rows[0]).not.toBe(preRow)
    expect(rows[0].status).toBe('completed')
    expect(rows[0].payload).toEqual({ tool_response: { content: '2', details: null } })
    expect(result.current.mergedIdMap.get(q.id)).toBe(p.id)
    expect(result.current.spawnToolUseIds.get('sub-1')).toBe('tu-1')
    expect(result.current.spawnedAgentIds.get('tu-1')).toBe('sub-1')
    expect(result.current.spawnInfo.get('sub-1')).toEqual({
      parentToolUseId: 'tu-1',
      parentAgentId: null,
      spawnEventId: p.id,
      startEventId: start.id,
      prompt: 'p',
      description: 'look around',
      agentType: 'Explore',
      agentName: 'Explore#sub-1',
    })
    // A fresh paired-payload object so memoized rows see the change.
    const paired = result.current.pairedPayloads.get(p.id)
    expect(paired).not.toBe(prePaired)
    expect(paired?.post?.subtype).toBe('PostToolUse')
  })

  it('produces the same result incrementally as from scratch', () => {
    const events = [
      makeEvent(),
      pre('tu-1'),
      pre('tu-2', 'Agent'),
      post('tu-1'),
      post('tu-3'),
      subagentStart('sub-9', 'tu-2'),
      post('tu-2', 'Agent', { tool_response: { content: 'x', details: null } }),
      makeEvent({ subtype: 'Stop' }),
    ]

    const incremental = renderHook(({ events }) => useDedupedEvents(events), {
      initialProps: { events: events.slice(0, 2) },
    })
    for (let n = 3; n <= events.length; n++) {
      incremental.rerender({ events: events.slice(0, n) })
    }
    const scratch = renderHook(() => useDedupedEvents(events))

    const inc = incremental.result.current
    const full = scratch.result.current
    expect(inc.deduped).toEqual(full.deduped)
    expect([...inc.mergedIdMap]).toEqual([...full.mergedIdMap])
    expect([...inc.spawnToolUseIds]).toEqual([...full.spawnToolUseIds])
    expect([...inc.spawnedAgentIds]).toEqual([...full.spawnedAgentIds])
    expect(full.spawnToolUseIds.get('sub-9')).toBe('tu-2')
    expect([...inc.spawnInfo]).toEqual([...full.spawnInfo])
    expect([...inc.pairedPayloads]).toEqual([...full.pairedPayloads])
  })

  it('fully reprocesses when the events array is replaced rather than appended', () => {
    const a = makeEvent()
    const b = makeEvent()
    const { result, rerender } = renderHook(({ events }) => useDedupedEvents(events), {
      initialProps: { events: [a, b] },
    })

    // Refetch: same ids, new objects with different content.
    const a2 = { ...a, payload: { refetched: true } }
    const b2 = { ...b }
    rerender({ events: [a2, b2, makeEvent()] })

    expect(result.current.deduped).toHaveLength(3)
    expect(result.current.deduped[0].payload).toEqual({ refetched: true })
  })

  it('fully reprocesses when the event list shrinks (session switch)', () => {
    const { result, rerender } = renderHook(({ events }) => useDedupedEvents(events), {
      initialProps: { events: [makeEvent(), makeEvent(), makeEvent()] },
    })
    const other = makeEvent({ sessionId: 'sess-2' })
    rerender({ events: [other] })

    expect(result.current.deduped).toHaveLength(1)
    expect(result.current.deduped[0].id).toBe(other.id)
  })

  it('links a nested SubAgent child to its spawning subagent', () => {
    const outer = pre('tu-outer', 'Agent')
    const outerStart = subagentStart('sub-outer', 'tu-outer')
    const inner = makeEvent({
      agentId: 'sub-outer',
      type: 'tool',
      subtype: 'PreToolUse',
      toolName: 'SubAgent',
      toolUseId: 'tu-inner',
      payload: { agent_class: 'pi', agent_id: 'sub-outer', tool_input: { prompt: 'nested task' } },
    })
    const innerStart = subagentStart('sub-inner', 'tu-inner', { parent_agent_id: 'sub-outer' })
    const { result } = renderHook(() => useDedupedEvents([outer, outerStart, inner, innerStart]))

    expect(result.current.spawnedAgentIds.get('tu-inner')).toBe('sub-inner')
    expect(result.current.spawnInfo.get('sub-inner')).toMatchObject({
      parentAgentId: 'sub-outer',
      parentToolUseId: 'tu-inner',
      spawnEventId: inner.id,
      prompt: 'nested task',
    })
  })

  it('links a background Agent call through spawned_agent_id', () => {
    const call = pre('tu-bg', 'Agent')
    const result1 = post('tu-bg', 'Agent', {
      agent_class: 'pi',
      tool_response: { content: 'Agent ID: sub-bg-123456', details: { background: true } },
      spawned_agent_id: 'sub-bg-123456',
    })
    const { result } = renderHook(() => useDedupedEvents([call, result1]))
    expect(result.current.spawnToolUseIds.get('sub-bg-123456')).toBe('tu-bg')
    expect(result.current.spawnInfo.get('sub-bg-123456')).toMatchObject({ background: true })
  })

  it('returns an empty result for undefined events', () => {
    const { result } = renderHook(() => useDedupedEvents(undefined))
    expect(result.current.deduped).toEqual([])
    expect(result.current.pairedPayloads.size).toBe(0)
  })
})

describe('Pre/Post merge toggle (mergeToolEvents)', () => {
  it('with merging off, every hook event is its own row — nothing folded, nothing paired', () => {
    useUIStore.setState({ mergeToolEvents: false })
    const events = piFixtureEvents()
    const { result } = renderHook(() => useDedupedEvents(events))

    expect(result.current.deduped).toHaveLength(events.length)
    expect(result.current.deduped.map((e) => e.id)).toEqual(events.map((e) => e.id))
    expect(result.current.mergedIdMap.size).toBe(0)
    expect(result.current.pairedPayloads.size).toBe(0)
    // Post rows keep their own payload.
    const posts = result.current.deduped.filter((e) => e.subtype === 'PostToolUse')
    expect(posts.length).toBeGreaterThan(0)
    for (const row of posts) {
      expect(row.payload.tool_response).toBeDefined()
    }
  })

  it('with merging off, a Pre row still reflects how its call ended', () => {
    useUIStore.setState({ mergeToolEvents: false })
    const p = pre('tu-1')
    const q = makeEvent({
      type: 'tool',
      subtype: 'PostToolUseFailure',
      toolName: 'bash',
      toolUseId: 'tu-1',
      payload: { is_error: true },
    })
    const { result } = renderHook(() => useDedupedEvents([p, q]))
    const [preRow, postRow] = result.current.deduped
    expect(preRow.subtype).toBe('PreToolUse')
    expect(preRow.status).toBe('failed')
    // The Pre row keeps its own input payload.
    expect(preRow.payload).toEqual(p.payload)
    expect(postRow.subtype).toBe('PostToolUseFailure')
    expect(postRow.status).toBe('failed')
  })

  it('with merging off, subagent linkage is unchanged', () => {
    useUIStore.setState({ mergeToolEvents: false })
    const { result } = renderHook(() => useDedupedEvents(piFixtureEvents()))
    expect(result.current.spawnToolUseIds.get(PI_SUBAGENT_ID)).toBe(PI_AGENT_TOOL_USE_ID)
    expect(result.current.spawnedAgentIds.get(PI_AGENT_TOOL_USE_ID)).toBe(PI_SUBAGENT_ID)
    expect(result.current.spawnInfo.get(PI_SUBAGENT_ID)?.spawnEventId).toBeDefined()
  })

  it('toggling reprocesses from scratch in both directions', () => {
    const events = piFixtureEvents()
    const { result, rerender } = renderHook(() => useDedupedEvents(events))
    const merged = result.current.deduped.length
    expect(merged).toBeLessThan(events.length)

    act(() => useUIStore.getState().setMergeToolEvents(false))
    rerender()
    expect(result.current.deduped).toHaveLength(events.length)

    act(() => useUIStore.getState().setMergeToolEvents(true))
    rerender()
    expect(result.current.deduped).toHaveLength(merged)
    expect(result.current.mergedIdMap.size).toBeGreaterThan(0)
  })

  it('the setting persists across reloads', () => {
    useUIStore.getState().setMergeToolEvents(false)
    expect(localStorage.getItem('instantcoffee-observe-merge-tool-events')).toBe('false')
    useUIStore.getState().setMergeToolEvents(true)
    expect(localStorage.getItem('instantcoffee-observe-merge-tool-events')).toBe('true')
  })
})
