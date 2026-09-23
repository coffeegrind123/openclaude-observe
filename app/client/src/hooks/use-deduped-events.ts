import { useMemo, useRef } from 'react'
import type { ParsedEvent } from '@/types'
import { useFilterStore } from '@/stores/filter-store'
import { useUIStore } from '@/stores/ui-store'
import { applyFilters } from '@/lib/filters/matcher'
import { passesAllFilter } from '@/lib/filters/all-filter'
import type { CompiledFilter } from '@/lib/filters/types'
import { agentClassFor } from '@/agents/registry'
import type { SpawnInfo, SpawnLink } from '@/agents/types'

export interface PayloadSnapshot {
  subtype: string
  timestamp: number
  payload: Record<string, unknown>
}

export interface PairedPayloads {
  pre: PayloadSnapshot
  post: PayloadSnapshot | null // null when still pending (no PostToolUse yet)
}

export interface DedupedEventsResult {
  /** Deduped list of events with PostToolUse merged into PreToolUse rows */
  deduped: ParsedEvent[]
  /** Map from subagent ID to the toolUseId of the call that spawned it */
  spawnToolUseIds: Map<string, string>
  /** Map from a spawning call's toolUseId to the subagent it spawned */
  spawnedAgentIds: Map<string, string>
  /** Map from subagent ID to how it was spawned (description, prompt, parent, …) */
  spawnInfo: Map<string, SpawnInfo>
  /** Map from merged (PostToolUse) event ID to the displayed (PreToolUse) row's event ID */
  mergedIdMap: Map<number, number>
  /** For tool rows: the Pre and Post payload snapshots, keyed by the row's event ID */
  pairedPayloads: Map<number, PairedPayloads>
}

/**
 * Incremental dedupe: merges PostToolUse into the corresponding PreToolUse
 * row, records subagent linkage from the links events declare (the agent
 * class's `spawnLink` — for pi, SubagentStart's `parent_tool_use_id` and a
 * background Agent result's `spawned_agent_id`), and tags each row with the
 * filter pills it matches.
 *
 * Events arrive append-only between WS flushes, so `process()` only runs
 * the newly appended tail and reuses every existing row object. A full
 * reprocess happens when the compiled filters change or the array is not
 * an append of the last one (session switch, refetch — detected by
 * checking that the first and last processed source objects are still in
 * place).
 *
 * Maps are mutated in place; each call returns a fresh result object and
 * a fresh `deduped` array, and any row or PairedPayloads entry that
 * changed is replaced with a new object so memoized consumers re-render.
 *
 * With `merge` off (the user's Pre/Post merge toggle) nothing is folded:
 * every event is its own row and no payloads are paired. Subagent linkage
 * and the Pre row's final status still come through, so the spawn chips and
 * the call's outcome read the same in both modes. Flipping the mode is a
 * full reprocess, like a filter change.
 */
export class DedupedEventsProcessor {
  private rows: ParsedEvent[] = []
  private toolUseMap = new Map<string, number>() // toolUseId -> index in rows
  private spawns = new Map<string, string>() // subagentId -> toolUseId
  private spawned = new Map<string, string>() // toolUseId -> subagentId
  private info = new Map<string, SpawnInfo>()
  private idMap = new Map<number, number>() // merged event ID -> displayed row event ID
  private pairedPayloads = new Map<number, PairedPayloads>()
  private processedCount = 0
  private firstSource: ParsedEvent | null = null
  private lastSource: ParsedEvent | null = null
  private compiled: readonly CompiledFilter[] | null = null
  private merge = true

  process(
    events: ParsedEvent[],
    compiled: readonly CompiledFilter[],
    merge = true,
  ): DedupedEventsResult {
    if (merge !== this.merge || !this.isAppendOf(events, compiled)) {
      this.reset(compiled)
      this.merge = merge
    }
    for (let i = this.processedCount; i < events.length; i++) {
      this.processOne(events[i])
    }
    this.processedCount = events.length
    this.firstSource = events[0] ?? null
    this.lastSource = events[events.length - 1] ?? null

    return {
      deduped: this.rows.slice(),
      spawnToolUseIds: this.spawns,
      spawnedAgentIds: this.spawned,
      spawnInfo: this.info,
      mergedIdMap: this.idMap,
      pairedPayloads: this.pairedPayloads,
    }
  }

  private isAppendOf(events: ParsedEvent[], compiled: readonly CompiledFilter[]): boolean {
    if (compiled !== this.compiled || events.length < this.processedCount) {
      return false
    }
    if (this.processedCount === 0) {
      return true
    }
    return events[0] === this.firstSource && events[this.processedCount - 1] === this.lastSource
  }

  private reset(compiled: readonly CompiledFilter[]) {
    this.rows = []
    this.toolUseMap = new Map()
    this.spawns = new Map()
    this.spawned = new Map()
    this.info = new Map()
    this.idMap = new Map()
    this.pairedPayloads = new Map()
    this.processedCount = 0
    this.firstSource = null
    this.lastSource = null
    this.compiled = compiled
  }

  // Tag a displayed row with the filter pills it matches + whether it
  // passes the All filter's exclusions. Maps the native event shape
  // (subtype) onto the matcher's RawEvent (hookName).
  private tag(e: ParsedEvent): ParsedEvent {
    const compiled = this.compiled ?? []
    const raw = { hookName: e.subtype, payload: e.payload }
    return {
      ...e,
      filters: applyFilters(raw, e.toolName, compiled),
      displayEventStream: passesAllFilter(raw, e.toolName, compiled),
    }
  }

  /**
   * Record a declared parent → child link. The spawning call's PreToolUse
   * normally precedes the child's SubagentStart, so its input (prompt,
   * description) is read from that row; a link can also arrive from both
   * SubagentStart and a background call's PostToolUse, so fields merge.
   */
  private link(link: SpawnLink, e: ParsedEvent) {
    const prev = this.info.get(link.agentId) ?? {}
    const next: SpawnInfo = { ...prev }
    if (link.parentToolUseId) {
      this.spawns.set(link.agentId, link.parentToolUseId)
      this.spawned.set(link.parentToolUseId, link.agentId)
      next.parentToolUseId = link.parentToolUseId
      const idx = this.toolUseMap.get(link.parentToolUseId)
      if (idx !== undefined) {
        const spawnRow = this.rows[idx]
        next.spawnEventId = spawnRow.id
        const input = (this.pairedPayloads.get(spawnRow.id)?.pre.payload ?? spawnRow.payload)
          .tool_input as Record<string, unknown> | undefined
        if (typeof input?.prompt === 'string') {
          next.prompt = input.prompt
        }
        if (typeof input?.description === 'string' && !next.description) {
          next.description = input.description
        }
      }
    }
    if (link.parentAgentId !== undefined && link.parentAgentId !== null) {
      next.parentAgentId = link.parentAgentId
    } else if (next.parentAgentId === undefined) {
      next.parentAgentId = null
    }
    if (link.description) {
      next.description = link.description
    }
    if (link.agentType) {
      next.agentType = link.agentType
    }
    if (link.agentName) {
      next.agentName = link.agentName
    }
    if (link.background) {
      next.background = true
    }
    if (e.subtype === 'SubagentStart') {
      next.startEventId = e.id
    }
    this.info.set(link.agentId, next)
  }

  private processOne(e: ParsedEvent) {
    if (!this.merge) {
      this.processUnmerged(e)
      return
    }
    const isPost = e.subtype === 'PostToolUse' || e.subtype === 'PostToolUseFailure'
    const spawnLink = agentClassFor(e).spawnLink(e)

    if (e.subtype === 'PreToolUse' && e.toolUseId) {
      this.toolUseMap.set(e.toolUseId, this.rows.length)
      this.rows.push(this.tag(e))
      // Seed the paired payloads with just the Pre for now (Post may arrive later)
      this.pairedPayloads.set(e.id, {
        pre: { subtype: e.subtype, timestamp: e.timestamp, payload: e.payload },
        post: null,
      })
      return
    }

    if (isPost && e.toolUseId && !this.toolUseMap.has(e.toolUseId)) {
      // Standalone PostToolUse with no matching PreToolUse — its own row
      this.toolUseMap.set(e.toolUseId, this.rows.length)
      this.rows.push(
        this.tag({ ...e, status: e.subtype === 'PostToolUseFailure' ? 'failed' : 'completed' }),
      )
      this.pairedPayloads.set(e.id, {
        pre: { subtype: e.subtype!, timestamp: e.timestamp, payload: e.payload },
        post: null,
      })
      if (spawnLink) {
        this.link(spawnLink, e)
      }
      return
    }

    if (isPost && e.toolUseId) {
      const idx = this.toolUseMap.get(e.toolUseId)!
      const preEvent = this.rows[idx]
      this.rows[idx] = this.tag({
        ...preEvent,
        status: e.subtype === 'PostToolUseFailure' ? 'failed' : 'completed',
        payload: e.payload,
      })
      // Map the PostToolUse ID to the PreToolUse row ID so scroll-to works
      this.idMap.set(e.id, preEvent.id)
      const existing = this.pairedPayloads.get(preEvent.id)
      if (existing) {
        this.pairedPayloads.set(preEvent.id, {
          ...existing,
          post: { subtype: e.subtype!, timestamp: e.timestamp, payload: e.payload },
        })
      }
      if (spawnLink) {
        this.link(spawnLink, e)
      }
      return
    }

    if (spawnLink) {
      this.link(spawnLink, e)
    }
    this.rows.push(this.tag(e))
  }

  private processUnmerged(e: ParsedEvent) {
    const isPost = e.subtype === 'PostToolUse' || e.subtype === 'PostToolUseFailure'
    const spawnLink = agentClassFor(e).spawnLink(e)

    if (e.subtype === 'PreToolUse' && e.toolUseId) {
      // Remembered so a SubagentStart can find its spawning call's input.
      this.toolUseMap.set(e.toolUseId, this.rows.length)
    }

    if (isPost) {
      const status = e.subtype === 'PostToolUseFailure' ? 'failed' : 'completed'
      const idx = e.toolUseId ? this.toolUseMap.get(e.toolUseId) : undefined
      if (idx !== undefined) {
        // The Pre row keeps its own payload; only its lifecycle status moves
        // on, so it doesn't spin as "running" forever.
        this.rows[idx] = { ...this.rows[idx], status }
      } else if (e.toolUseId) {
        this.toolUseMap.set(e.toolUseId, this.rows.length)
      }
      if (spawnLink) {
        this.link(spawnLink, e)
      }
      this.rows.push(this.tag({ ...e, status }))
      return
    }

    if (spawnLink) {
      this.link(spawnLink, e)
    }
    this.rows.push(this.tag(e))
  }
}

function emptyResult(): DedupedEventsResult {
  return {
    deduped: [],
    spawnToolUseIds: new Map(),
    spawnedAgentIds: new Map(),
    spawnInfo: new Map(),
    mergedIdMap: new Map(),
    pairedPayloads: new Map(),
  }
}

/**
 * Per-caller dedupe backed by a DedupedEventsProcessor, so appends only
 * process the new tail. Components rendering the selected session should
 * read the shared result via useSessionDedupedEvents() instead of calling
 * this again — see deduped-events-context.tsx.
 */
export function useDedupedEvents(events: ParsedEvent[] | undefined): DedupedEventsResult {
  const compiled = useFilterStore((s) => s.compiled)
  const merge = useUIStore((s) => s.mergeToolEvents)
  const processorRef = useRef<DedupedEventsProcessor | null>(null)
  return useMemo(() => {
    if (!events) {
      return emptyResult()
    }
    if (!processorRef.current) {
      processorRef.current = new DedupedEventsProcessor()
    }
    return processorRef.current.process(events, compiled, merge)
  }, [events, compiled, merge])
}
