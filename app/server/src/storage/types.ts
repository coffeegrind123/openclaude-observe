// app/server/src/storage/types.ts

import type { Filter } from '../types'

export class DuplicateEventSignatureError extends Error {
  constructor(public readonly signatureHash: string) {
    super(`Duplicate event signature: ${signatureHash}`)
    this.name = 'DuplicateEventSignatureError'
  }
}

export interface InsertEventParams {
  agentId: string
  sessionId: string
  type: string
  subtype: string | null
  toolName: string | null
  timestamp: number
  payload: Record<string, unknown>
  toolUseId?: string | null
  /** Stable signature for dedup. When set, a UNIQUE constraint is enforced. */
  signatureHash?: string | null
  /** Whether this event raises a notification. Computed by the route from
   *  config.notificationEventSubtypes; falls back to that same set when
   *  omitted. */
  isNotification?: boolean
  /** The agent whose next event answers this notification. Defaults to
   *  agentId; a subagent's lifecycle event hands it to the parent. */
  notificationOwnerId?: string
}

/** How an insert changed the session's pending-notification state. */
export type NotificationTransition = 'set' | 'cleared' | 'none'

export interface InsertEventResult {
  eventId: number
  notificationTransition: NotificationTransition
}

export interface EventFilters {
  agentIds?: string[]
  type?: string
  subtype?: string
  search?: string
  limit?: number
  offset?: number
}

export interface StoredEvent {
  id: number
  agent_id: string
  session_id: string
  type: string
  subtype: string | null
  tool_name: string | null
  tool_use_id: string | null
  timestamp: number
  created_at: number
  payload: string // JSON string in DB
}

export interface EventStore {
  createProject(
    slug: string,
    name: string,
    transcriptPath: string | null,
    cwd?: string | null,
  ): Promise<number>
  getProjectById(id: number): Promise<any | null>
  getProjectBySlug(slug: string): Promise<any | null>
  getProjectByCwd(cwd: string): Promise<any | null>
  getProjectByTranscriptPath(transcriptPath: string): Promise<any | null>
  updateProjectCwd(projectId: number, cwd: string): Promise<void>
  updateProjectName(projectId: number, name: string): Promise<void>
  isSlugAvailable(slug: string): Promise<boolean>
  deleteProject(
    projectId: number,
  ): Promise<{ sessionIds: string[]; sessions: number; agents: number; events: number }>
  upsertSession(
    id: string,
    projectId: number,
    slug: string | null,
    metadata: Record<string, unknown> | null,
    timestamp: number,
    transcriptPath?: string | null,
  ): Promise<void>
  upsertAgent(
    id: string,
    sessionId: string,
    parentAgentId: string | null,
    name: string | null,
    description: string | null,
    agentType?: string | null,
    agentClass?: string | null,
  ): Promise<void>
  updateSessionStatus(id: string, status: string): Promise<void>
  patchSessionMetadata(sessionId: string, patch: Record<string, unknown>): Promise<void>
  updateSessionSlug(sessionId: string, slug: string): Promise<void>
  updateSessionProject(sessionId: string, projectId: number): Promise<void>
  insertEvent(params: InsertEventParams): Promise<InsertEventResult>
  findEventBySignatureHash(hash: string): Promise<{ id: number } | null>
  getProjects(): Promise<any[]>
  getSessionsForProject(projectId: number): Promise<any[]>
  getSessionById(sessionId: string): Promise<any | null>
  getSessionTranscriptPath(sessionId: string): Promise<string | null>
  getAgentById(agentId: string): Promise<any | null>
  getSessionsWithPendingNotifications(sinceTs: number): Promise<any[]>
  getAgentsForSession(sessionId: string): Promise<any[]>
  getEventsForSession(sessionId: string, filters?: EventFilters): Promise<StoredEvent[]>
  getEventsForAgent(agentId: string): Promise<StoredEvent[]>
  getThreadForEvent(eventId: number): Promise<StoredEvent[]>
  getEventsSince(sessionId: string, sinceTimestamp: number): Promise<StoredEvent[]>
  deleteSession(sessionId: string): Promise<{ events: number; agents: number }>
  deleteSessions(
    sessionIds: string[],
  ): Promise<{ events: number; agents: number; sessions: number }>
  clearAllData(): Promise<{ projects: number; sessions: number; agents: number; events: number }>
  clearSessionEvents(sessionId: string): Promise<{ events: number; agents: number }>
  getSessionUsage(sessionId: string): Promise<{
    sessionId: string
    totalInputTokens: number
    totalOutputTokens: number
    totalCacheReadTokens: number
    totalCacheCreationTokens: number
    totalDurationMs: number
    llmCallCount: number
    agentUsage: Array<{
      agentId: string
      agentName: string | null
      inputTokens: number
      outputTokens: number
      cacheReadTokens: number
      cacheCreationTokens: number
      durationMs: number
      llmCallCount: number
    }>
  } | null>
  getDbStats(): Promise<{ sessionCount: number; eventCount: number }>
  vacuum(): Promise<void>
  /** Newest activity first. With `since` (epoch ms), only sessions whose
   *  last activity is at or after it. */
  getRecentSessions(limit?: number, since?: number): Promise<any[]>
  getUnassignedSessions(limit?: number): Promise<any[]>
  healthCheck(): Promise<{ ok: boolean; error?: string }>
  /**
   * Scan all tables for rows with broken foreign keys and repair them.
   * - Sessions with invalid project_id → reassigned to the 'unknown' project
   * - Agents with invalid session_id → deleted
   * - Agents with invalid parent_agent_id → parent_agent_id set to NULL
   * - Events with invalid session_id or agent_id → deleted
   *
   * Returns a summary of what was repaired.
   */
  repairOrphans(): Promise<OrphanRepairResult>
  close(): void
  // === Filters ===
  listFilters(): Promise<Filter[]>
  getFilterById(id: string): Promise<Filter | null>
  createFilter(input: {
    name: string
    pillName: string
    display: 'primary' | 'secondary'
    combinator: 'and' | 'or'
    patterns: { target: 'hook' | 'tool' | 'payload'; regex: string }[]
  }): Promise<Filter>
  updateFilter(
    id: string,
    patch: Partial<{
      name: string
      pillName: string
      display: 'primary' | 'secondary'
      combinator: 'and' | 'or'
      patterns: { target: 'hook' | 'tool' | 'payload'; regex: string }[]
      enabled: boolean
    }>,
  ): Promise<Filter>
  deleteFilter(id: string): Promise<void>
  duplicateFilter(id: string): Promise<Filter>
  resetDefaultFilters(): Promise<Filter[]>
  /** Idempotent. Inserts missing defaults; updates name/pill_name/display/combinator/patterns of existing rows; never touches enabled. */
  seedDefaultFilters(): Promise<void>
}

export interface OrphanRepairResult {
  sessionsReassigned: number
  agentsDeleted: number
  agentsReparented: number
  eventsDeleted: number
}
