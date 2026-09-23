import type { StackSample, StackTotals, StackStatus } from './stack'
export interface Project {
  id: number
  slug: string
  name: string
  createdAt: number
  sessionCount?: number
}

export interface Label {
  id: string
  name: string
  createdAt: number
}

export interface Session {
  id: string
  projectId: number
  projectSlug?: string
  projectName?: string
  transcriptPath?: string | null
  slug: string | null
  status: string
  startedAt: number
  stoppedAt: number | null
  metadata: Record<string, unknown> | null
  agentCount: number
  eventCount: number
  lastActivity: number | null
  totalInputTokens: number
  totalOutputTokens: number
  totalCacheReadTokens: number
  totalCacheCreationTokens: number
  totalDurationMs: number
  llmCallCount: number
}

/** Agent metadata from the server — no derived state */
export interface ServerAgent {
  id: string
  sessionId: string
  parentAgentId: string | null
  name: string | null
  description: string | null
  agentType?: string | null
  /** Producer class ('pi'; legacy rows 'claude-code'). Absent from servers that
   *  don't expose it — the client then derives it from the agent's events. */
  agentClass?: string | null
}

/** Agent with UI-derived state (computed from events) */
export interface Agent extends ServerAgent {
  status: 'active' | 'stopped'
  eventCount: number
  firstEventAt: number | null
  lastEventAt: number | null
  cwd?: string | null
}

export interface ParsedEvent {
  id: number
  agentId: string
  sessionId: string
  type: string
  subtype: string | null
  toolName: string | null
  toolUseId: string | null
  status: string
  timestamp: number
  // Optional — server-side ingest timestamp. Not broadcast over WS;
  // included in GET /sessions/:id/events only when ?fields=createdAt.
  createdAt?: number
  payload: Record<string, unknown>
  /** Pill names this event matches, by display category. Computed
   *  client-side in useDedupedEvents from the compiled filter set. */
  filters?: { primary: string[]; secondary: string[] }
  /** Whether this event passes the All filter's exclusions (visible in
   *  the stream / timeline). Computed alongside `filters`. */
  displayEventStream?: boolean
}

export interface RecentSession {
  id: string
  projectId: number
  projectSlug: string
  projectName: string
  slug: string | null
  transcriptPath?: string | null
  status: string
  startedAt: number
  stoppedAt: number | null
  metadata: Record<string, unknown> | null
  agentCount: number
  eventCount: number
  lastActivity: number
  totalInputTokens: number
  totalOutputTokens: number
  totalCacheReadTokens: number
  totalCacheCreationTokens: number
  totalDurationMs: number
  llmCallCount: number
}

export interface NotificationPayload {
  sessionId: string
  projectId: number
  latestNotificationTs: number
  count: number
}

export type WSMessage =
  | { type: 'event'; data: ParsedEvent }
  | { type: 'session_update'; data: Session }
  | { type: 'project_update'; data: { id: number; name: string } }
  | { type: 'notification'; data: { sessionId: string; projectId: number; ts: number } }
  | { type: 'notification_clear'; data: { sessionId: string; ts: number } }
  | {
      type: 'activity'
      // projectId is absent from servers predating the project-pulse field.
      data: { sessionId: string; projectId?: number | null; eventId: number; ts: number }
    }
  | { type: 'filter:created'; filter: Filter }
  | { type: 'filter:updated'; filter: Filter }
  | { type: 'filter:deleted'; id: string }
  | { type: 'filter:bulk-changed' }
  | { type: 'stack_metrics'; data: { sample: StackSample; totals: StackTotals } }
  | { type: 'stack_status'; data: StackStatus }

export type WSClientMessage = { type: 'subscribe'; sessionId: string } | { type: 'unsubscribe' }

// === Filters (mirror server shape) ===

export type { FilterTarget, FilterDisplay, FilterCombinator, FilterKind } from '@/lib/filters/types'
import type { FilterDisplay, FilterCombinator, FilterKind, FilterTarget } from '@/lib/filters/types'

export interface FilterPattern {
  target: FilterTarget
  regex: string
  /** Inverts the match: the pattern "matches" when the regex does NOT
   *  match the target. Lets users express negation without lookahead
   *  (RE2 has no lookahead). Default false / absent. */
  negate?: boolean
  /** RE2-portable flag subset: `i` / `m` / `s`. */
  flags?: string
}

export interface Filter {
  id: string
  name: string
  pillName: string
  display: FilterDisplay
  combinator: FilterCombinator
  patterns: FilterPattern[]
  kind: FilterKind
  enabled: boolean
  /** Free-form JSON config bag (e.g. `color`). Server passes it through. */
  config: Record<string, unknown>
  createdAt: number
  updatedAt: number
}
