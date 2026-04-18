// app/server/src/storage/types.ts

import type { InstanceRow } from '../types'

export interface InsertEventParams {
  agentId: string
  sessionId: string
  type: string
  subtype: string | null
  toolName: string | null
  timestamp: number
  payload: Record<string, unknown>
  toolUseId?: string | null
  instanceId?: string | null
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
  instance_id: string | null
  timestamp: number
  created_at: number
  payload: string // JSON string in DB
}

export interface EventStore {
  createProject(slug: string, name: string, transcriptPath: string | null): Promise<number>
  getProjectById(id: number): Promise<any | null>
  getProjectBySlug(slug: string): Promise<any | null>
  getProjectByTranscriptPath(transcriptPath: string): Promise<any | null>
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
    transcriptPath?: string | null,
  ): Promise<void>
  updateAgentType(id: string, agentType: string): Promise<void>
  updateSessionStatus(id: string, status: string): Promise<void>
  patchSessionMetadata(sessionId: string, patch: Record<string, unknown>): Promise<void>
  updateSessionSlug(sessionId: string, slug: string): Promise<void>
  updateSessionProject(sessionId: string, projectId: number): Promise<void>
  updateAgentName(agentId: string, name: string): Promise<void>
  insertEvent(params: InsertEventParams): Promise<number>
  upsertInstance(
    id: string,
    sessionId: string,
    role: string,
    name: string | null,
    machineId: string | null,
    pid: number | null,
  ): void
  updateInstanceHeartbeat(id: string, timestamp: number): void
  getInstancesForSession(sessionId: string): InstanceRow[]
  getProjects(): Promise<any[]>
  getSessionsForProject(projectId: number): Promise<any[]>
  getSessionById(sessionId: string): Promise<any | null>
  getAgentById(agentId: string): Promise<any | null>
  getAgentsForSession(sessionId: string): Promise<any[]>
  getEventsForSession(sessionId: string, filters?: EventFilters): Promise<StoredEvent[]>
  getEventsForAgent(agentId: string): Promise<StoredEvent[]>
  getThreadForEvent(eventId: number): Promise<StoredEvent[]>
  getEventsSince(sessionId: string, sinceTimestamp: number): Promise<StoredEvent[]>
  deleteSession(sessionId: string): Promise<{ events: number; agents: number }>
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
  getRecentSessions(limit?: number): Promise<any[]>
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
}

export interface OrphanRepairResult {
  sessionsReassigned: number
  agentsDeleted: number
  agentsReparented: number
  eventsDeleted: number
}
