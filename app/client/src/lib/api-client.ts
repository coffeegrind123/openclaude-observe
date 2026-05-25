import { API_BASE } from '@/config/api'
import type {
  Project,
  Session,
  RecentSession,
  ServerAgent,
  ParsedEvent,
  NotificationPayload,
  Filter,
} from '@/types'

/**
 * Rich error thrown by all api.* methods on failure. Carries the HTTP status,
 * the server's error message (if it returned a JSON body with `message` or
 * `error`), and the request path so toasts can display useful context.
 */
export class ApiError extends Error {
  status: number
  path: string
  serverMessage?: string

  constructor(status: number, path: string, message: string, serverMessage?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.path = path
    this.serverMessage = serverMessage
  }
}

async function parseErrorBody(res: Response): Promise<string | undefined> {
  try {
    const body = await res.json()
    if (typeof body === 'object' && body !== null) {
      // Server convention: { error: { message, details?, ... } }
      if (typeof body.error === 'object' && body.error !== null) {
        const err = body.error
        if (err.details) return `${err.message}: ${err.details}`
        return err.message
      }
      // Legacy fallback
      if (typeof body.error === 'string') return body.error
    }
  } catch {
    // not JSON; fall through
  }
  return undefined
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, init)
  } catch (err) {
    // Network failure (server down, CORS, DNS, etc.)
    const message = err instanceof Error ? err.message : 'Network error'
    throw new ApiError(0, path, `Network error: ${message}`)
  }
  if (!res.ok) {
    const serverMessage = await parseErrorBody(res)
    const message = serverMessage
      ? `${res.status} ${res.statusText}: ${serverMessage}`
      : `${res.status} ${res.statusText}`
    throw new ApiError(res.status, path, message, serverMessage)
  }
  return res.json()
}

/**
 * Like fetchJson but for endpoints that return no body (DELETE, etc.).
 * Still validates the response status and throws ApiError on failure.
 */
async function fetchVoid(path: string, init?: RequestInit): Promise<void> {
  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, init)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Network error'
    throw new ApiError(0, path, `Network error: ${message}`)
  }
  if (!res.ok) {
    const serverMessage = await parseErrorBody(res)
    const message = serverMessage
      ? `${res.status} ${res.statusText}: ${serverMessage}`
      : `${res.status} ${res.statusText}`
    throw new ApiError(res.status, path, message, serverMessage)
  }
}

export const api = {
  getProjects: () => fetchJson<Project[]>('/projects'),
  getPendingNotifications: (sinceTs: number) =>
    fetchJson<NotificationPayload[]>(`/notifications?since=${sinceTs}`),
  getRecentSessions: (limit?: number) =>
    fetchJson<RecentSession[]>(`/sessions/recent${limit ? `?limit=${limit}` : ''}`),
  getSessions: (projectId: number) => fetchJson<Session[]>(`/projects/${projectId}/sessions`),
  getSession: (sessionId: string) =>
    fetchJson<Session>(`/sessions/${encodeURIComponent(sessionId)}`),
  getAgent: (agentId: string) => fetchJson<ServerAgent>(`/agents/${encodeURIComponent(agentId)}`),
  getAgents: (sessionId: string) =>
    fetchJson<ServerAgent[]>(`/sessions/${encodeURIComponent(sessionId)}/agents`),
  getEvents: (
    sessionId: string,
    filters?: {
      agentIds?: string[]
      type?: string
      subtype?: string
      search?: string
      limit?: number
      offset?: number
    },
  ) => {
    const params = new URLSearchParams()
    if (filters?.agentIds?.length) params.set('agentId', filters.agentIds.join(','))
    if (filters?.type) params.set('type', filters.type)
    if (filters?.subtype) params.set('subtype', filters.subtype)
    if (filters?.search) params.set('search', filters.search)
    if (filters?.limit) params.set('limit', String(filters.limit))
    if (filters?.offset) params.set('offset', String(filters.offset))
    // The endpoint defaults to a lean payload; opt in to the fields the
    // client code reads off each event (event-row passes sessionId to
    // ContextBadge; createdAt is read by paired-event runtime calculations).
    params.set('fields', 'sessionId,createdAt')
    return fetchJson<ParsedEvent[]>(
      `/sessions/${encodeURIComponent(sessionId)}/events?${params.toString()}`,
    )
  },
  getThread: (eventId: number) => fetchJson<ParsedEvent[]>(`/events/${eventId}/thread`),
  getSessionUsage: (sessionId: string) =>
    fetchJson<{
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
    }>(`/sessions/${encodeURIComponent(sessionId)}/usage`),
  getSessionContext: (sessionId: string) =>
    fetchJson<import('@/types/context').SessionContextBreakdown>(
      `/sessions/${encodeURIComponent(sessionId)}/context`,
    ),
  deleteSession: (sessionId: string) =>
    fetchVoid(`/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' }),
  clearSessionEvents: (sessionId: string) =>
    fetchVoid(`/sessions/${encodeURIComponent(sessionId)}/events`, { method: 'DELETE' }),
  deleteProject: (projectId: number) => fetchVoid(`/projects/${projectId}`, { method: 'DELETE' }),
  deleteAllData: () => fetchVoid(`/data`, { method: 'DELETE' }),
  updateAgentMetadata: (agentId: string, data: { agentType?: string; name?: string }) =>
    fetchVoid(`/agents/${encodeURIComponent(agentId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),
  updateSessionSlug: (sessionId: string, slug: string) =>
    fetchVoid(`/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug }),
    }),
  patchSessionMetadata: (sessionId: string, patch: Record<string, unknown>) =>
    fetchVoid(`/sessions/${encodeURIComponent(sessionId)}/metadata`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }),
  moveSession: (sessionId: string, projectId: number) =>
    fetchVoid(`/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId }),
    }),
  renameProject: (projectId: number, name: string) =>
    fetchVoid(`/projects/${projectId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }),
  createProject: (data: { name: string; slug?: string }) =>
    fetchJson<Project>(`/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),
  getChangelog: () => fetchJson<{ markdown: string }>('/changelog'),
  getDbStats: () =>
    fetchJson<{ dbPath: string; sizeBytes: number; sessionCount: number; eventCount: number }>(
      '/db/stats',
    ),
  bulkDeleteSessions: (sessionIds: string[]) =>
    fetchJson<{
      ok: true
      deleted: { events: number; agents: number; sessions: number }
      sizeBefore: number
      sizeAfter: number
    }>('/sessions/bulk-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionIds }),
    }),
  // Unlike other api.* methods which throw ApiError on non-2xx, this
  // endpoint returns a discriminated-union response. The UI maps each
  // `error` code to a distinct user-facing message; treating these as
  // exceptions would lose that information.
  getTranscriptStats: async (sessionId: string): Promise<TranscriptStatsResponse> => {
    const res = await fetch(
      `${API_BASE}/sessions/${encodeURIComponent(sessionId)}/transcript-stats`,
    )
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: (body.error as TranscriptStatsErrorCode) ?? 'unknown',
        message: body.message ?? 'Unknown error',
      }
    }
    return { ok: true, status: 200, data: body as TranscriptStatsData }
  },

  // ── Filters ──
  listFilters: () => fetchJson<Filter[]>('/filters'),
  createFilter: (input: {
    name: string
    pillName: string
    display: 'primary' | 'secondary'
    combinator: 'and' | 'or'
    patterns: { target: 'hook' | 'tool' | 'payload'; regex: string }[]
    config?: Record<string, unknown>
  }) =>
    fetchJson<Filter>('/filters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),
  updateFilter: (
    id: string,
    patch: Partial<{
      name: string
      pillName: string
      display: 'primary' | 'secondary'
      combinator: 'and' | 'or'
      patterns: { target: 'hook' | 'tool' | 'payload'; regex: string }[]
      enabled: boolean
      config: Record<string, unknown>
    }>,
  ) =>
    fetchJson<Filter>(`/filters/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }),
  deleteFilter: (id: string) =>
    fetchVoid(`/filters/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  duplicateFilter: (id: string) =>
    fetchJson<Filter>(`/filters/${encodeURIComponent(id)}/duplicate`, { method: 'POST' }),
  resetDefaultFilters: () => fetchJson<Filter[]>(`/filters/defaults/reset`, { method: 'POST' }),
}

// ── Transcript stats types (V2: matches server transcript-parser) ──

export interface TranscriptStatsByModel {
  model: string
  calls: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreate5mTokens: number
  cacheCreate1hTokens: number
  costCents: number | null
}

export interface TranscriptStatsPrompt {
  promptId: string
  text: string
  timestamp: number
  durationMs: number | null
  toolCount: number
  requests: number
  /** Bundled input (fresh + cache_read + cache_write). */
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreate5mTokens: number
  cacheCreate1hTokens: number
  models: string[]
  costCents: number | null
}

export interface TranscriptStatsSubagent {
  agentId: string
  agentType: string | null
  description: string | null
  toolUseId: string | null
  model: string
  requests: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreate5mTokens: number
  cacheCreate1hTokens: number
  durationMs: number
  toolCount: number
  costCents: number | null
}

export interface TranscriptStatsModelPricing {
  inputPerM: number
  outputPerM: number
  cacheReadPerM: number
  cacheCreate5mPerM: number
  cacheCreate1hPerM: number
}

export interface TranscriptStatsParseError {
  scope: 'main' | 'subagent'
  agentId?: string
  code: 'missing' | 'unreadable' | 'parse_error'
  message: string
}

export interface TranscriptStatsToolStat {
  name: string
  count: number
  minMs: number | null
  medianMs: number | null
  maxMs: number | null
  longestToolUseId: string | null
}

export interface TranscriptStatsData {
  source: 'jsonl'
  summary: {
    totalCalls: number
    inputTotal: number
    outputTotal: number
    cacheHitRate: number
    costTotalCents: number | null
    startedAt: number | null
    durationMs: number | null
    toolCalls: number
    filesRead: number
    filesEdited: number
    gitCommits: number
    toolStats: TranscriptStatsToolStat[]
    userPrompts: number
  }
  byModel: TranscriptStatsByModel[]
  prompts: TranscriptStatsPrompt[]
  subagents: TranscriptStatsSubagent[]
  models: Record<string, { pricing: TranscriptStatsModelPricing | null }>
  errors: TranscriptStatsParseError[]
}

export type TranscriptStatsErrorCode =
  | 'disabled'
  | 'no_transcript'
  | 'file_not_found'
  | 'file_unreadable'
  | 'file_too_large'
  | 'parse_error'
  | 'unknown'

export type TranscriptStatsResponse =
  | { ok: true; status: 200; data: TranscriptStatsData }
  | {
      ok: false
      status: number
      error: TranscriptStatsErrorCode
      message: string
    }
