// app/server/src/storage/sqlite-adapter.ts

import Database from 'better-sqlite3'
import type {
  EventStore,
  InsertEventParams,
  EventFilters,
  StoredEvent,
  OrphanRepairResult,
} from './types'
import type { InstanceRow } from '../types'

export class SqliteAdapter implements EventStore {
  private db: Database.Database

  constructor(dbPath: string) {
    this.db = new Database(dbPath)

    // PRAGMAs
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('synchronous = NORMAL')
    this.db.pragma('foreign_keys = ON')
    this.db.pragma('cache_size = -64000') // 64MB cache (default 2MB)
    this.db.pragma('temp_store = MEMORY')
    this.db.pragma('mmap_size = 30000000') // 30MB memory-mapped I/O

    // Create tables
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        slug TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        transcript_path TEXT,
        cwd TEXT,
        metadata TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)

    // Migration: add metadata to projects if missing
    const projectCols = this.db.prepare("PRAGMA table_info('projects')").all() as { name: string }[]
    if (!projectCols.some((c) => c.name === 'metadata')) {
      this.db.exec('ALTER TABLE projects ADD COLUMN metadata TEXT')
    }
    if (!projectCols.some((c) => c.name === 'cwd')) {
      this.db.exec('ALTER TABLE projects ADD COLUMN cwd TEXT')
    }

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        project_id INTEGER NOT NULL REFERENCES projects(id),
        slug TEXT,
        status TEXT DEFAULT 'active',
        started_at INTEGER NOT NULL,
        stopped_at INTEGER,
        transcript_path TEXT,
        metadata TEXT,
        event_count INTEGER NOT NULL DEFAULT 0,
        agent_count INTEGER NOT NULL DEFAULT 0,
        last_activity INTEGER,
        last_notification_ts INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)

    // Migrations for sessions
    const sessionCols = this.db.prepare("PRAGMA table_info('sessions')").all() as { name: string }[]
    if (!sessionCols.some((c) => c.name === 'transcript_path')) {
      this.db.exec('ALTER TABLE sessions ADD COLUMN transcript_path TEXT')
    }
    if (!sessionCols.some((c) => c.name === 'event_count')) {
      this.db.exec('ALTER TABLE sessions ADD COLUMN event_count INTEGER NOT NULL DEFAULT 0')
      this.db.exec('ALTER TABLE sessions ADD COLUMN agent_count INTEGER NOT NULL DEFAULT 0')
      this.db.exec('ALTER TABLE sessions ADD COLUMN last_activity INTEGER')
      // Backfill from existing data
      this.db.exec(`
        UPDATE sessions SET
          event_count = (SELECT COUNT(*) FROM events WHERE session_id = sessions.id),
          agent_count = (SELECT COUNT(*) FROM agents WHERE session_id = sessions.id),
          last_activity = (SELECT MAX(timestamp) FROM events WHERE session_id = sessions.id)
      `)
    }
    // Notification tracking — `last_notification_ts` alongside the
    // existing `last_activity` column is enough to test "pending":
    // a session has a pending notification iff
    //   last_notification_ts IS NOT NULL AND last_activity = last_notification_ts
    // (the most recent event IS the notification). Any subsequent
    // activity auto-clears by bumping `last_activity`.
    if (!sessionCols.some((c) => c.name === 'last_notification_ts')) {
      this.db.exec('ALTER TABLE sessions ADD COLUMN last_notification_ts INTEGER')
      // Backfill from existing events
      this.db.exec(`
        UPDATE sessions SET
          last_notification_ts = (
            SELECT MAX(timestamp) FROM events
            WHERE session_id = sessions.id AND subtype = 'Notification'
          )
      `)
    }

    // Token columns are added here; the backfill UPDATE that reads from the
    // events table runs after that table is created further down.
    const needsTokenBackfill = !sessionCols.some((c) => c.name === 'total_input_tokens')
    if (needsTokenBackfill) {
      this.db.exec('ALTER TABLE sessions ADD COLUMN total_input_tokens INTEGER NOT NULL DEFAULT 0')
      this.db.exec('ALTER TABLE sessions ADD COLUMN total_output_tokens INTEGER NOT NULL DEFAULT 0')
      this.db.exec(
        'ALTER TABLE sessions ADD COLUMN total_cache_read_tokens INTEGER NOT NULL DEFAULT 0',
      )
      this.db.exec(
        'ALTER TABLE sessions ADD COLUMN total_cache_creation_tokens INTEGER NOT NULL DEFAULT 0',
      )
      this.db.exec('ALTER TABLE sessions ADD COLUMN total_duration_ms INTEGER NOT NULL DEFAULT 0')
      this.db.exec('ALTER TABLE sessions ADD COLUMN llm_call_count INTEGER NOT NULL DEFAULT 0')
    }

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        parent_agent_id TEXT,
        name TEXT,
        description TEXT,
        agent_type TEXT,
        agent_class TEXT DEFAULT 'claude-code',
        transcript_path TEXT,
        metadata TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id),
        FOREIGN KEY (parent_agent_id) REFERENCES agents(id)
      )
    `)

    // Migrations for agents
    const agentCols = this.db.prepare("PRAGMA table_info('agents')").all() as { name: string }[]
    if (!agentCols.some((c) => c.name === 'metadata')) {
      this.db.exec('ALTER TABLE agents ADD COLUMN metadata TEXT')
    }
    if (!agentCols.some((c) => c.name === 'transcript_path')) {
      this.db.exec('ALTER TABLE agents ADD COLUMN transcript_path TEXT')
    }

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        type TEXT NOT NULL,
        subtype TEXT,
        tool_name TEXT,
        timestamp INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        payload TEXT NOT NULL,
        tool_use_id TEXT,
        FOREIGN KEY (agent_id) REFERENCES agents(id),
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      )
    `)

    // Migration: add created_at, drop summary and status from events
    const eventCols = this.db.prepare("PRAGMA table_info('events')").all() as { name: string }[]
    if (!eventCols.some((c) => c.name === 'created_at')) {
      this.db.exec('ALTER TABLE events ADD COLUMN created_at INTEGER')
      this.db.exec('UPDATE events SET created_at = timestamp WHERE created_at IS NULL')
    }
    if (eventCols.some((c) => c.name === 'summary')) {
      this.db.exec('ALTER TABLE events DROP COLUMN summary')
    }
    if (eventCols.some((c) => c.name === 'status')) {
      this.db.exec('ALTER TABLE events DROP COLUMN status')
    }
    if (!eventCols.some((c) => c.name === 'instance_id')) {
      this.db.exec('ALTER TABLE events ADD COLUMN instance_id TEXT')
    }

    // Run the token backfill now that the events table is guaranteed to exist.
    // No-op on fresh DBs (zero events) but keeps historical migrations correct.
    if (needsTokenBackfill) {
      this.db.exec(`
        UPDATE sessions SET
          total_input_tokens = COALESCE((SELECT SUM(COALESCE(json_extract(payload, '$.input_tokens'), 0)) FROM events WHERE session_id = sessions.id AND subtype = 'LLMGeneration'), 0),
          total_output_tokens = COALESCE((SELECT SUM(COALESCE(json_extract(payload, '$.output_tokens'), 0)) FROM events WHERE session_id = sessions.id AND subtype = 'LLMGeneration'), 0),
          total_cache_read_tokens = COALESCE((SELECT SUM(COALESCE(json_extract(payload, '$.cache_read_tokens'), 0)) FROM events WHERE session_id = sessions.id AND subtype = 'LLMGeneration'), 0),
          total_cache_creation_tokens = COALESCE((SELECT SUM(COALESCE(json_extract(payload, '$.cache_creation_tokens'), 0)) FROM events WHERE session_id = sessions.id AND subtype = 'LLMGeneration'), 0),
          total_duration_ms = COALESCE((SELECT SUM(COALESCE(json_extract(payload, '$.duration_ms'), 0)) FROM events WHERE session_id = sessions.id AND subtype = 'LLMGeneration'), 0),
          llm_call_count = COALESCE((SELECT COUNT(*) FROM events WHERE session_id = sessions.id AND subtype = 'LLMGeneration'), 0)
      `)
    }

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS instances (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'main',
        name TEXT,
        machine_id TEXT,
        pid INTEGER,
        first_seen INTEGER NOT NULL,
        last_heartbeat INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      )
    `)

    // Create indexes
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_projects_slug ON projects(slug)')
    this.db.exec(
      'CREATE INDEX IF NOT EXISTS idx_projects_transcript_path ON projects(transcript_path)',
    )
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_projects_cwd ON projects(cwd)')
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id, timestamp)')
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_events_agent ON events(agent_id, timestamp)')
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_events_type ON events(type, subtype)')
    this.db.exec(
      'CREATE INDEX IF NOT EXISTS idx_events_session_agent ON events(session_id, agent_id, timestamp)',
    )
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_events_tool_use_id ON events(tool_use_id)')
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_agents_session ON agents(session_id)')
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_agents_parent ON agents(parent_agent_id)')
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id)')
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_instances_session ON instances(session_id)')
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_events_instance ON events(instance_id)')
  }

  async createProject(
    slug: string,
    name: string,
    transcriptPath: string | null,
    cwd: string | null = null,
  ): Promise<number> {
    const now = Date.now()
    const result = this.db
      .prepare(
        'INSERT INTO projects (slug, name, transcript_path, cwd, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(slug, name, transcriptPath, cwd, now, now)
    return result.lastInsertRowid as number
  }

  async getProjectById(id: number): Promise<any | null> {
    return this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) || null
  }

  async getProjectBySlug(slug: string): Promise<any | null> {
    return this.db.prepare(`SELECT * FROM projects WHERE slug = ?`).get(slug) || null
  }

  async getProjectByCwd(cwd: string): Promise<any | null> {
    return this.db.prepare(`SELECT * FROM projects WHERE cwd = ?`).get(cwd) || null
  }

  async updateProjectCwd(projectId: number, cwd: string): Promise<void> {
    const now = Date.now()
    this.db
      .prepare('UPDATE projects SET cwd = ?, updated_at = ? WHERE id = ?')
      .run(cwd, now, projectId)
  }

  async getProjectByTranscriptPath(transcriptPath: string): Promise<any | null> {
    return (
      this.db.prepare(`SELECT * FROM projects WHERE transcript_path = ?`).get(transcriptPath) ||
      null
    )
  }

  async updateProjectName(projectId: number, name: string): Promise<void> {
    this.db
      .prepare('UPDATE projects SET name = ?, updated_at = ? WHERE id = ?')
      .run(name, Date.now(), projectId)
  }

  async isSlugAvailable(slug: string): Promise<boolean> {
    const row = this.db.prepare(`SELECT id FROM projects WHERE slug = ?`).get(slug) as
      | { id: number }
      | undefined
    return row === undefined
  }

  async upsertSession(
    id: string,
    projectId: number,
    slug: string | null,
    metadata: Record<string, unknown> | null,
    timestamp: number,
    transcriptPath?: string | null,
  ): Promise<void> {
    const now = Date.now()
    this.db
      .prepare(
        `
      INSERT INTO sessions (id, project_id, slug, status, started_at, transcript_path, metadata, created_at, updated_at)
      VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        slug = COALESCE(excluded.slug, sessions.slug),
        transcript_path = COALESCE(excluded.transcript_path, sessions.transcript_path),
        metadata = CASE
          WHEN excluded.metadata IS NULL THEN sessions.metadata
          WHEN sessions.metadata IS NULL THEN excluded.metadata
          ELSE json_patch(sessions.metadata, excluded.metadata)
        END,
        updated_at = ?
    `,
      )
      .run(
        id,
        projectId,
        slug,
        timestamp,
        transcriptPath || null,
        metadata ? JSON.stringify(metadata) : null,
        now,
        now,
        now,
      )
  }

  async upsertAgent(
    id: string,
    sessionId: string,
    parentAgentId: string | null,
    name: string | null,
    description: string | null,
    agentType?: string | null,
    transcriptPath?: string | null,
  ): Promise<void> {
    const now = Date.now()
    const existing = this.db.prepare('SELECT id FROM agents WHERE id = ?').get(id)
    this.db
      .prepare(
        `
      INSERT INTO agents (id, session_id, parent_agent_id, name, description, agent_type, transcript_path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = COALESCE(excluded.name, agents.name),
        description = COALESCE(excluded.description, agents.description),
        agent_type = COALESCE(excluded.agent_type, agents.agent_type),
        transcript_path = COALESCE(excluded.transcript_path, agents.transcript_path),
        updated_at = ?
    `,
      )
      .run(
        id,
        sessionId,
        parentAgentId,
        name,
        description,
        agentType ?? null,
        transcriptPath ?? null,
        now,
        now,
        now,
      )

    if (!existing) {
      this.db
        .prepare('UPDATE sessions SET agent_count = agent_count + 1 WHERE id = ?')
        .run(sessionId)
    }
  }

  async updateAgentType(id: string, agentType: string): Promise<void> {
    this.db
      .prepare('UPDATE agents SET agent_type = ?, updated_at = ? WHERE id = ?')
      .run(agentType, Date.now(), id)
  }

  async updateSessionStatus(id: string, status: string): Promise<void> {
    this.db
      .prepare(
        `
      UPDATE sessions SET status = ?, stopped_at = ? WHERE id = ?
    `,
      )
      .run(status, status === 'stopped' ? Date.now() : null, id)
  }

  async updateSessionProject(sessionId: string, projectId: number): Promise<void> {
    this.db
      .prepare('UPDATE sessions SET project_id = ?, updated_at = ? WHERE id = ?')
      .run(projectId, Date.now(), sessionId)
  }

  async patchSessionMetadata(sessionId: string, patch: Record<string, unknown>): Promise<void> {
    this.db
      .prepare(
        `UPDATE sessions SET metadata = json_patch(COALESCE(metadata, '{}'), ?), updated_at = ? WHERE id = ?`,
      )
      .run(JSON.stringify(patch), Date.now(), sessionId)
  }

  async updateSessionSlug(sessionId: string, slug: string): Promise<void> {
    this.db
      .prepare(
        `
      UPDATE sessions SET slug = ? WHERE id = ?
    `,
      )
      .run(slug, sessionId)
  }

  async updateAgentName(agentId: string, name: string): Promise<void> {
    this.db
      .prepare('UPDATE agents SET name = ?, updated_at = ? WHERE id = ?')
      .run(name, Date.now(), agentId)
  }

  async insertEvent(params: InsertEventParams): Promise<number> {
    const now = Date.now()
    const result = this.db
      .prepare(
        `
      INSERT INTO events (agent_id, session_id, type, subtype, tool_name, timestamp, created_at, payload, tool_use_id, instance_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        params.agentId,
        params.sessionId,
        params.type,
        params.subtype,
        params.toolName,
        params.timestamp,
        now,
        JSON.stringify(params.payload),
        params.toolUseId || null,
        params.instanceId || null,
      )

    // Update cached counters on session. `last_activity` is the
    // max across all events; `last_notification_ts` only advances for
    // Notification-subtype events. "Pending" is inferred from those
    // two columns (see getSessionsWithPendingNotifications).
    const isNotification = params.subtype === 'Notification'
    this.db
      .prepare(
        `UPDATE sessions SET
          event_count = event_count + 1,
          last_activity = MAX(COALESCE(last_activity, 0), ?),
          last_notification_ts = CASE
            WHEN ? = 1 THEN MAX(COALESCE(last_notification_ts, 0), ?)
            ELSE last_notification_ts
          END
        WHERE id = ?`,
      )
      .run(params.timestamp, isNotification ? 1 : 0, params.timestamp, params.sessionId)

    // Accumulate token counters for LLM events
    if (params.subtype === 'LLMGeneration') {
      const p = params.payload as Record<string, any>
      this.db
        .prepare(
          `UPDATE sessions SET
            total_input_tokens = total_input_tokens + ?,
            total_output_tokens = total_output_tokens + ?,
            total_cache_read_tokens = total_cache_read_tokens + ?,
            total_cache_creation_tokens = total_cache_creation_tokens + ?,
            total_duration_ms = total_duration_ms + ?,
            llm_call_count = llm_call_count + 1
          WHERE id = ?`,
        )
        .run(
          (p.input_tokens as number) || 0,
          (p.output_tokens as number) || 0,
          (p.cache_read_tokens as number) || 0,
          (p.cache_creation_tokens as number) || 0,
          (p.duration_ms as number) || 0,
          params.sessionId,
        )
    }

    return Number(result.lastInsertRowid)
  }

  async getSessionsWithPendingNotifications(sinceTs: number): Promise<any[]> {
    // A session is "pending" when its most recent event is a
    // Notification — i.e. last_activity equals last_notification_ts.
    // `sinceTs` lets clients cheaply resume from their last-seen
    // cursor on page load. The count subquery is O(k) where k is the
    // number of events on the pending sessions (small N), and hits the
    // existing (session_id, timestamp) index.
    return this.db
      .prepare(
        `
      SELECT
        s.id as session_id,
        s.project_id,
        s.last_notification_ts,
        (
          SELECT COUNT(*) FROM events e
          WHERE e.session_id = s.id
            AND e.subtype = 'Notification'
            AND e.timestamp > COALESCE(
              (SELECT MAX(timestamp) FROM events e2
                 WHERE e2.session_id = s.id
                   AND COALESCE(e2.subtype, '') != 'Notification'),
              0
            )
        ) AS count
      FROM sessions s
      WHERE s.last_notification_ts IS NOT NULL
        AND s.last_activity = s.last_notification_ts
        AND s.last_notification_ts > ?
      ORDER BY s.last_notification_ts DESC
    `,
      )
      .all(sinceTs)
  }

  async getProjects(): Promise<any[]> {
    return this.db
      .prepare(
        `
      SELECT p.id, p.slug, p.name, p.transcript_path, p.created_at,
        COUNT(DISTINCT s.id) as session_count
      FROM projects p
      LEFT JOIN sessions s ON s.project_id = p.id
      GROUP BY p.id
      ORDER BY p.name ASC
    `,
      )
      .all()
  }

  async getSessionsForProject(projectId: number): Promise<any[]> {
    return this.db
      .prepare(
        `
      SELECT s.*
      FROM sessions s
      WHERE s.project_id = ?
      ORDER BY COALESCE(s.last_activity, s.started_at) DESC
    `,
      )
      .all(projectId)
  }

  async getSessionById(sessionId: string): Promise<any | null> {
    return (
      this.db
        .prepare(
          `
      SELECT s.*,
        p.slug as project_slug,
        p.name as project_name
      FROM sessions s
      LEFT JOIN projects p ON p.id = s.project_id
      WHERE s.id = ?
    `,
        )
        .get(sessionId) || null
    )
  }

  async getAgentById(agentId: string): Promise<any | null> {
    return this.db.prepare(`SELECT * FROM agents WHERE id = ?`).get(agentId) || null
  }

  async getAgentsForSession(sessionId: string): Promise<any[]> {
    return this.db
      .prepare('SELECT * FROM agents WHERE session_id = ? ORDER BY created_at ASC')
      .all(sessionId)
  }

  async getEventsForSession(sessionId: string, filters?: EventFilters): Promise<StoredEvent[]> {
    let sql = 'SELECT * FROM events WHERE session_id = ?'
    const params: any[] = [sessionId]

    if (filters?.agentIds && filters.agentIds.length > 0) {
      const placeholders = filters.agentIds.map(() => '?').join(',')
      sql += ` AND agent_id IN (${placeholders})`
      params.push(...filters.agentIds)
    }

    if (filters?.type) {
      sql += ' AND type = ?'
      params.push(filters.type)
    }

    if (filters?.subtype) {
      sql += ' AND subtype = ?'
      params.push(filters.subtype)
    }

    if (filters?.search) {
      sql += ' AND payload LIKE ?'
      const term = `%${filters.search}%`
      params.push(term)
    }

    sql += ' ORDER BY timestamp ASC'

    if (filters?.limit) {
      sql += ' LIMIT ?'
      params.push(filters.limit)
      if (filters?.offset) {
        sql += ' OFFSET ?'
        params.push(filters.offset)
      }
    }

    return this.db.prepare(sql).all(...params) as StoredEvent[]
  }

  async getEventsForAgent(agentId: string): Promise<StoredEvent[]> {
    return this.db
      .prepare(
        `
      SELECT * FROM events WHERE agent_id = ? ORDER BY timestamp ASC
    `,
      )
      .all(agentId) as StoredEvent[]
  }

  async getThreadForEvent(eventId: number): Promise<StoredEvent[]> {
    const event = this.db.prepare('SELECT * FROM events WHERE id = ?').get(eventId) as
      | StoredEvent
      | undefined
    if (!event) return []

    const sessionId = event.session_id
    const agentId = event.agent_id

    // For SubagentStop or events from a non-root agent:
    // return all events belonging to that specific agent
    const isSubagent = agentId !== sessionId
    if (event.subtype === 'SubagentStop' || isSubagent) {
      return this.db
        .prepare('SELECT * FROM events WHERE agent_id = ? ORDER BY timestamp ASC')
        .all(agentId) as StoredEvent[]
    }

    // For root agent events: find the turn boundary (Prompt -> Stop)
    const prevPrompt = this.db
      .prepare(
        `SELECT timestamp FROM events
         WHERE session_id = ? AND subtype = 'UserPromptSubmit' AND timestamp <= ?
         ORDER BY timestamp DESC LIMIT 1`,
      )
      .get(sessionId, event.timestamp) as { timestamp: number } | undefined

    const startTs = prevPrompt ? prevPrompt.timestamp : 0

    // End at the first Stop or next UserPromptSubmit
    const nextBoundary = this.db
      .prepare(
        `SELECT timestamp FROM events
         WHERE session_id = ? AND timestamp > ?
           AND (subtype = 'UserPromptSubmit' OR subtype = 'Stop' OR subtype = 'SubagentStop')
         ORDER BY timestamp ASC LIMIT 1`,
      )
      .get(sessionId, startTs) as { timestamp: number } | undefined

    const endTs = nextBoundary ? nextBoundary.timestamp : Infinity

    if (endTs === Infinity) {
      return this.db
        .prepare(
          'SELECT * FROM events WHERE session_id = ? AND timestamp >= ? ORDER BY timestamp ASC',
        )
        .all(sessionId, startTs) as StoredEvent[]
    }

    return this.db
      .prepare(
        'SELECT * FROM events WHERE session_id = ? AND timestamp >= ? AND timestamp <= ? ORDER BY timestamp ASC',
      )
      .all(sessionId, startTs, endTs) as StoredEvent[]
  }

  async getEventsSince(sessionId: string, sinceTimestamp: number): Promise<StoredEvent[]> {
    return this.db
      .prepare(
        `
      SELECT * FROM events WHERE session_id = ? AND timestamp > ? ORDER BY timestamp ASC
    `,
      )
      .all(sessionId, sinceTimestamp) as StoredEvent[]
  }

  async deleteSession(sessionId: string): Promise<{ events: number; agents: number }> {
    this.db.prepare('DELETE FROM instances WHERE session_id = ?').run(sessionId)
    const events = this.db.prepare('DELETE FROM events WHERE session_id = ?').run(sessionId).changes
    const agents = this.db.prepare('DELETE FROM agents WHERE session_id = ?').run(sessionId).changes
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId)
    return { events, agents }
  }

  async deleteProject(
    projectId: number,
  ): Promise<{ sessionIds: string[]; sessions: number; agents: number; events: number }> {
    const rows = this.db.prepare('SELECT id FROM sessions WHERE project_id = ?').all(projectId) as {
      id: string
    }[]
    const sessionIds = rows.map((s) => s.id)
    let events = 0
    let agents = 0
    for (const sessionId of sessionIds) {
      this.db.prepare('DELETE FROM instances WHERE session_id = ?').run(sessionId)
      events += this.db.prepare('DELETE FROM events WHERE session_id = ?').run(sessionId).changes
      agents += this.db.prepare('DELETE FROM agents WHERE session_id = ?').run(sessionId).changes
    }
    const sessions = this.db
      .prepare('DELETE FROM sessions WHERE project_id = ?')
      .run(projectId).changes
    this.db.prepare('DELETE FROM projects WHERE id = ?').run(projectId)
    return { sessionIds, sessions, agents, events }
  }

  async clearAllData(): Promise<{
    projects: number
    sessions: number
    agents: number
    events: number
  }> {
    this.db.prepare('DELETE FROM instances WHERE 1=1').run()
    const events = this.db.prepare('DELETE FROM events WHERE 1=1').run().changes
    const agents = this.db.prepare('DELETE FROM agents WHERE 1=1').run().changes
    const sessions = this.db.prepare('DELETE FROM sessions WHERE 1=1').run().changes
    const projects = this.db.prepare('DELETE FROM projects WHERE 1=1').run().changes
    return { projects, sessions, agents, events }
  }

  async clearSessionEvents(sessionId: string): Promise<{ events: number; agents: number }> {
    const events = this.db.prepare('DELETE FROM events WHERE session_id = ?').run(sessionId).changes
    const agents = this.db.prepare('DELETE FROM agents WHERE session_id = ?').run(sessionId).changes
    this.db
      .prepare(
        'UPDATE sessions SET event_count = 0, agent_count = 0, last_activity = NULL, total_input_tokens = 0, total_output_tokens = 0, total_cache_read_tokens = 0, total_cache_creation_tokens = 0, total_duration_ms = 0, llm_call_count = 0 WHERE id = ?',
      )
      .run(sessionId)
    return { events, agents }
  }

  async getSessionUsage(sessionId: string): Promise<{
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
  } | null> {
    const session = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as any
    if (!session) return null

    const agentRows = this.db
      .prepare(
        `SELECT
          e.agent_id,
          a.name as agent_name,
          COALESCE(SUM(COALESCE(json_extract(e.payload, '$.input_tokens'), 0)), 0) as input_tokens,
          COALESCE(SUM(COALESCE(json_extract(e.payload, '$.output_tokens'), 0)), 0) as output_tokens,
          COALESCE(SUM(COALESCE(json_extract(e.payload, '$.cache_read_tokens'), 0)), 0) as cache_read_tokens,
          COALESCE(SUM(COALESCE(json_extract(e.payload, '$.cache_creation_tokens'), 0)), 0) as cache_creation_tokens,
          COALESCE(SUM(COALESCE(json_extract(e.payload, '$.duration_ms'), 0)), 0) as duration_ms,
          COUNT(*) as llm_call_count
        FROM events e
        LEFT JOIN agents a ON a.id = e.agent_id
        WHERE e.session_id = ? AND e.subtype = 'LLMGeneration'
        GROUP BY e.agent_id
        ORDER BY input_tokens DESC`,
      )
      .all(sessionId) as any[]

    return {
      sessionId,
      totalInputTokens: session.total_input_tokens || 0,
      totalOutputTokens: session.total_output_tokens || 0,
      totalCacheReadTokens: session.total_cache_read_tokens || 0,
      totalCacheCreationTokens: session.total_cache_creation_tokens || 0,
      totalDurationMs: session.total_duration_ms || 0,
      llmCallCount: session.llm_call_count || 0,
      agentUsage: agentRows.map((r: any) => ({
        agentId: r.agent_id,
        agentName: r.agent_name,
        inputTokens: r.input_tokens,
        outputTokens: r.output_tokens,
        cacheReadTokens: r.cache_read_tokens,
        cacheCreationTokens: r.cache_creation_tokens,
        durationMs: r.duration_ms,
        llmCallCount: r.llm_call_count,
      })),
    }
  }

  async getRecentSessions(limit: number = 20): Promise<any[]> {
    // LEFT JOIN so orphaned sessions (project deleted out from under them)
    // still appear in the recent list. The repairOrphans pass should make
    // this rare, but the LEFT JOIN is defensive — without it, an orphaned
    // active session would silently disappear from the UI.
    return this.db
      .prepare(
        `
      SELECT s.*,
        p.slug as project_slug,
        p.name as project_name
      FROM sessions s
      LEFT JOIN projects p ON p.id = s.project_id
      ORDER BY COALESCE(s.last_activity, s.started_at) DESC
      LIMIT ?
    `,
      )
      .all(limit)
  }

  async repairOrphans(): Promise<OrphanRepairResult> {
    const result: OrphanRepairResult = {
      sessionsReassigned: 0,
      agentsDeleted: 0,
      agentsReparented: 0,
      eventsDeleted: 0,
    }

    // 1. Sessions with invalid project_id (project doesn't exist or is null).
    //    Reassign to the 'unknown' project, creating it if needed.
    const orphanedSessions = this.db
      .prepare(
        `SELECT s.id FROM sessions s
         LEFT JOIN projects p ON p.id = s.project_id
         WHERE p.id IS NULL`,
      )
      .all() as { id: string }[]

    if (orphanedSessions.length > 0) {
      // Get-or-create the 'unknown' project
      let unknownProject = this.db
        .prepare('SELECT id FROM projects WHERE slug = ?')
        .get('unknown') as { id: number } | undefined
      if (!unknownProject) {
        const now = Date.now()
        const ins = this.db
          .prepare(
            'INSERT INTO projects (slug, name, transcript_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
          )
          .run('unknown', 'unknown', null, now, now)
        unknownProject = { id: Number(ins.lastInsertRowid) }
      }
      const update = this.db.prepare(
        'UPDATE sessions SET project_id = ?, updated_at = ? WHERE id = ?',
      )
      const now = Date.now()
      for (const s of orphanedSessions) {
        update.run(unknownProject.id, now, s.id)
        result.sessionsReassigned++
      }
    }

    // 2. Agents with invalid session_id → delete (no recovery possible since
    //    the session and all its events are gone).
    //    Note: we have to delete events for these agents first or the events
    //    table FK from agents would also fail when something tries to read them.
    const orphanedAgents = this.db
      .prepare(
        `SELECT a.id FROM agents a
         LEFT JOIN sessions s ON s.id = a.session_id
         WHERE s.id IS NULL`,
      )
      .all() as { id: string }[]
    if (orphanedAgents.length > 0) {
      const deleteEvents = this.db.prepare('DELETE FROM events WHERE agent_id = ?')
      const deleteAgent = this.db.prepare('DELETE FROM agents WHERE id = ?')
      for (const a of orphanedAgents) {
        const eventDel = deleteEvents.run(a.id)
        result.eventsDeleted += eventDel.changes
        deleteAgent.run(a.id)
        result.agentsDeleted++
      }
    }

    // 3. Agents with invalid parent_agent_id (parent has been deleted but
    //    the child remains). Null out the parent rather than deleting — the
    //    agent itself is still meaningful, just no longer part of a hierarchy.
    const reparented = this.db
      .prepare(
        `UPDATE agents
         SET parent_agent_id = NULL, updated_at = ?
         WHERE parent_agent_id IS NOT NULL
         AND parent_agent_id NOT IN (SELECT id FROM agents)`,
      )
      .run(Date.now())
    result.agentsReparented = reparented.changes

    // 4. Events with invalid session_id → delete. Also covers events that
    //    survived an interrupted delete cascade.
    //    Note: this is a NOT IN subquery against the full events table, so
    //    it scans all events. For very large databases (100k+ events) it
    //    may take a few hundred ms — acceptable since this only runs once
    //    on server startup.
    const orphanedSessionEvents = this.db
      .prepare(
        `DELETE FROM events
         WHERE session_id NOT IN (SELECT id FROM sessions)`,
      )
      .run()
    result.eventsDeleted += orphanedSessionEvents.changes

    // 5. Events with invalid agent_id → delete (similar to above).
    const orphanedAgentEvents = this.db
      .prepare(
        `DELETE FROM events
         WHERE agent_id NOT IN (SELECT id FROM agents)`,
      )
      .run()
    result.eventsDeleted += orphanedAgentEvents.changes

    // 6. Recompute cached counts on sessions if anything was repaired,
    //    since insertEvent/upsertAgent maintain these incrementally.
    if (result.sessionsReassigned > 0 || result.agentsDeleted > 0 || result.eventsDeleted > 0) {
      this.db.exec(`
        UPDATE sessions SET
          event_count = (SELECT COUNT(*) FROM events WHERE session_id = sessions.id),
          agent_count = (SELECT COUNT(*) FROM agents WHERE session_id = sessions.id),
          last_activity = (SELECT MAX(timestamp) FROM events WHERE session_id = sessions.id)
      `)
    }

    return result
  }

  upsertInstance(
    id: string,
    sessionId: string,
    role: string,
    name: string | null,
    machineId: string | null,
    pid: number | null,
  ): void {
    const now = Date.now()
    this.db
      .prepare(
        `INSERT INTO instances (id, session_id, role, name, machine_id, pid, first_seen, last_heartbeat, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')
         ON CONFLICT(id) DO UPDATE SET
           role = excluded.role,
           name = COALESCE(excluded.name, instances.name),
           machine_id = COALESCE(excluded.machine_id, instances.machine_id),
           pid = COALESCE(excluded.pid, instances.pid),
           last_heartbeat = excluded.last_heartbeat,
           status = 'active'`,
      )
      .run(id, sessionId, role, name, machineId, pid, now, now)
  }

  updateInstanceHeartbeat(id: string, timestamp: number): void {
    this.db
      .prepare('UPDATE instances SET last_heartbeat = ?, status = ? WHERE id = ?')
      .run(timestamp, 'active', id)
  }

  getInstancesForSession(sessionId: string): InstanceRow[] {
    return this.db
      .prepare('SELECT * FROM instances WHERE session_id = ? ORDER BY first_seen ASC')
      .all(sessionId) as InstanceRow[]
  }

  async healthCheck(): Promise<{ ok: boolean; error?: string }> {
    try {
      const row = this.db.prepare('SELECT 1 AS ok').get() as { ok: number } | undefined
      if (row?.ok !== 1) return { ok: false, error: 'SQLite query returned unexpected result' }

      // Verify tables exist
      const tables = this.db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('projects','sessions','events','agents','instances')",
        )
        .all() as { name: string }[]
      if (tables.length < 5) {
        const missing = ['projects', 'sessions', 'events', 'agents', 'instances'].filter(
          (t) => !tables.some((r) => r.name === t),
        )
        return { ok: false, error: `Missing tables: ${missing.join(', ')}` }
      }

      return { ok: true }
    } catch (err: any) {
      return { ok: false, error: err.message || 'Unknown database error' }
    }
  }
}
