// app/server/src/types.ts

// === Database Row Types ===

export interface ProjectRow {
  id: number
  slug: string
  name: string
  transcript_path: string | null
  created_at: number
  updated_at: number
}

export interface SessionRow {
  id: string
  project_id: number
  slug: string | null
  status: string
  started_at: number
  stopped_at: number | null
  metadata: string | null
  created_at: number
  updated_at: number
}

export interface AgentRow {
  id: string
  session_id: string
  parent_agent_id: string | null
  name: string | null
  description: string | null
  agent_type: string | null
  agent_class: string
  created_at: number
  updated_at: number
}

export interface EventRow {
  id: number
  agent_id: string
  session_id: string
  type: string
  subtype: string | null
  tool_name: string | null
  timestamp: number
  created_at: number
  payload: string
  tool_use_id: string | null
  instance_id: string | null
}

export interface InstanceRow {
  id: string
  session_id: string
  role: string
  name: string | null
  machine_id: string | null
  pid: number | null
  first_seen: number
  last_heartbeat: number
  status: string
}

// === API Response Types ===

export interface Project {
  id: number
  slug: string
  name: string
  createdAt: number
  sessionCount?: number
}

export interface Session {
  id: string
  projectId: number
  slug: string | null
  status: string
  startedAt: number
  stoppedAt: number | null
  metadata: Record<string, unknown> | null
  agentCount?: number
  eventCount?: number
}

export interface Agent {
  id: string
  sessionId: string
  parentAgentId: string | null
  name: string | null
  description: string | null
  agentType?: string | null
}

export interface ParsedEvent {
  id: number
  agentId: string
  sessionId: string
  type: string
  subtype: string | null
  toolName: string | null
  toolUseId: string | null
  instanceId: string | null
  status: string // derived from subtype, not stored
  timestamp: number
  // Optional — server-side ingest timestamp. Dropped from WS broadcast and
  // GET /sessions/:id/events default response; included only when the
  // GET endpoint is called with ?fields=createdAt.
  createdAt?: number
  payload: Record<string, unknown>
}

// === WebSocket Message Types ===

export type WSMessage =
  | { type: 'event'; data: ParsedEvent }
  | { type: 'session_update'; data: Session }
  | { type: 'project_update'; data: { id: number; name: string } }
  | { type: 'instance_update'; data: InstanceRow }

// Messages FROM clients
export type WSClientMessage = { type: 'subscribe'; sessionId: string } | { type: 'unsubscribe' }

// === Filter types ===

export type FilterTarget = 'hook' | 'tool' | 'payload'
export type FilterDisplay = 'primary' | 'secondary'
export type FilterCombinator = 'and' | 'or'
export type FilterKind = 'default' | 'user'

export interface FilterPattern {
  target: FilterTarget
  regex: string
  /**
   * Inverts the match result for this pattern: if true, the pattern
   * "matches" the event when the regex does NOT match the target.
   * Lets users express negation without lookahead — important for the
   * planned RE2 backend, which has no lookahead/lookbehind support.
   * Default is false / absent.
   */
  negate?: boolean
  /**
   * Regex flags as a string. Subset that both JS RegExp and RE2
   * support: `i` (case-insensitive), `m` (multiline), `s` (dot matches
   * newline). Today we pass these as `new RegExp(source, flags)`; on
   * the RE2 backend we'll inject as inline `(?flags)` prefix.
   */
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
  /**
   * Free-form JSON config bag. Lets us add new per-filter knobs (color,
   * icon, ordering, etc.) without a schema migration each time. Server
   * passes the JSON through verbatim — no validation of contents. Known
   * keys today: `color` (any valid CSS color string applied to the
   * filter's pill).
   */
  config: Record<string, unknown>
  createdAt: number
  updatedAt: number
}

export interface FilterRow {
  id: string
  name: string
  pill_name: string
  display: string
  combinator: string
  patterns: string // JSON
  kind: string
  enabled: number // 0/1
  config: string // JSON
  created_at: number
  updated_at: number
}
