// app/server/src/storage/sqlite-adapter.ts

import Database from 'better-sqlite3'
import { config } from '../config'
import type {
  EventStore,
  InsertEventParams,
  InsertEventResult,
  NotificationTransition,
  EventFilters,
  StoredEvent,
  OrphanRepairResult,
} from './types'
import { DuplicateEventSignatureError } from './types'
import type { Filter, FilterRow, FilterPattern } from '../types'
import { randomUUID } from 'node:crypto'
import { canonicalJson } from '../utils/event-signature'
import { SEED_FILTERS, OBSOLETE_DEFAULT_FILTER_IDS, SUPERSEDED_SEED_PATTERNS } from './seed-filters'

function escapeLike(str: string): string {
  return str.replace(/[%_]/g, '\\$&')
}

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
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)

    const projectCols = this.db.prepare("PRAGMA table_info('projects')").all() as { name: string }[]
    // Written by nothing and read by nothing since the pi conversion.
    if (projectCols.some((c) => c.name === 'metadata')) {
      this.db.exec('ALTER TABLE projects DROP COLUMN metadata')
    }
    if (!projectCols.some((c) => c.name === 'cwd')) {
      this.db.exec('ALTER TABLE projects ADD COLUMN cwd TEXT')
    }

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        project_id INTEGER REFERENCES projects(id),
        slug TEXT,
        status TEXT DEFAULT 'active',
        started_at INTEGER NOT NULL,
        stopped_at INTEGER,
        transcript_path TEXT,
        metadata TEXT,
        event_count INTEGER NOT NULL DEFAULT 0,
        agent_count INTEGER NOT NULL DEFAULT 0,
        last_activity INTEGER,
        pending_notification_ts INTEGER,
        pending_notification_agents TEXT,
        pending_notification_count INTEGER NOT NULL DEFAULT 0,
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
    // Legacy notification tracking. Still added to pre-notification databases
    // because the project_id rebuild below copies it; the pending_notification_*
    // migration further down converts it and drops it.
    const hasPendingNotification = sessionCols.some((c) => c.name === 'pending_notification_ts')
    if (!hasPendingNotification && !sessionCols.some((c) => c.name === 'last_notification_ts')) {
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

    // Migration: allow project_id to be NULL so sessions can exist without
    // a project (the "unassigned" bucket). SQLite doesn't support ALTER
    // COLUMN, so we recreate the sessions table when the column is NOT NULL.
    const projectIdInfo = sessionCols.find((c) => c.name === 'project_id')
    if (projectIdInfo) {
      const projectIdNotNull = (projectIdInfo as any).notnull === 1
      if (projectIdNotNull) {
        // Recreate the sessions table without the NOT NULL constraint.
        // Only the 14 columns from the original CREATE TABLE — token columns
        // haven't been added yet (they're added further down after this
        // block). Using SELECT * vs. the hardcoded 14 columns would crash
        // with "20 columns but 14 values were supplied."
        const beforeCount = (
          this.db.prepare('SELECT COUNT(*) AS c FROM sessions').get() as { c: number }
        ).c
        this.db.exec(`
          PRAGMA foreign_keys = OFF;
          BEGIN;
          CREATE TABLE sessions_new (
            id TEXT PRIMARY KEY,
            project_id INTEGER REFERENCES projects(id),
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
          );
          INSERT INTO sessions_new SELECT
            id, project_id, slug, status, started_at, stopped_at,
            transcript_path, metadata, event_count, agent_count,
            last_activity, last_notification_ts, created_at, updated_at
          FROM sessions;
          DROP TABLE sessions;
          ALTER TABLE sessions_new RENAME TO sessions;
          COMMIT;
          PRAGMA foreign_keys = ON;
        `)
        const afterCount = (
          this.db.prepare('SELECT COUNT(*) AS c FROM sessions').get() as { c: number }
        ).c
        if (afterCount !== beforeCount) {
          throw new Error(
            `sessions migration lost rows: had ${beforeCount}, now have ${afterCount}`,
          )
        }
      }
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
        agent_class TEXT DEFAULT 'pi',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id),
        FOREIGN KEY (parent_agent_id) REFERENCES agents(id)
      )
    `)

    // Migrations for agents
    const agentCols = this.db.prepare("PRAGMA table_info('agents')").all() as { name: string }[]
    // pi subagents run in-process and have no transcript of their own, and
    // agent metadata was only ever set by the retired PATCH /agents/:id.
    for (const col of ['metadata', 'transcript_path']) {
      if (agentCols.some((c) => c.name === col)) {
        this.db.exec(`ALTER TABLE agents DROP COLUMN ${col}`)
      }
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
        signature_hash TEXT,
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
    // Additive migration: signature_hash column for event dedup. Existing
    // rows stay NULL (SQLite treats NULLs as distinct under UNIQUE, so they
    // don't collide).
    if (!eventCols.some((c) => c.name === 'signature_hash')) {
      this.db.exec('ALTER TABLE events ADD COLUMN signature_hash TEXT')
    }

    // Pending-notification state replaces last_notification_ts, which only
    // inferred "pending" from `last_activity = last_notification_ts` — so any
    // event, a subagent's included, cleared the bell. A session that was
    // pending under the old rule stays pending, owned by the agent that raised
    // the notification (the root agent, whose id is the session id, if unknown).
    if (!hasPendingNotification) {
      this.db.exec('ALTER TABLE sessions ADD COLUMN pending_notification_ts INTEGER')
      this.db.exec('ALTER TABLE sessions ADD COLUMN pending_notification_agents TEXT')
      this.db.exec(
        'ALTER TABLE sessions ADD COLUMN pending_notification_count INTEGER NOT NULL DEFAULT 0',
      )
      this.db.exec(`
        UPDATE sessions SET
          pending_notification_ts = last_notification_ts,
          pending_notification_agents = json_array(COALESCE(
            (SELECT agent_id FROM events
               WHERE session_id = sessions.id AND timestamp = sessions.last_notification_ts
               ORDER BY id DESC LIMIT 1),
            sessions.id
          )),
          pending_notification_count = MAX(1, (
            SELECT COUNT(*) FROM events e
            WHERE e.session_id = sessions.id
              AND e.subtype = 'Notification'
              AND e.timestamp > COALESCE(
                (SELECT MAX(timestamp) FROM events e2
                   WHERE e2.session_id = sessions.id
                     AND COALESCE(e2.subtype, '') != 'Notification'),
                0
              )
          ))
        WHERE last_notification_ts IS NOT NULL AND last_activity = last_notification_ts
      `)
    }
    const sessionColsNow = this.db.prepare("PRAGMA table_info('sessions')").all() as {
      name: string
    }[]
    if (sessionColsNow.some((c) => c.name === 'last_notification_ts')) {
      this.db.exec('ALTER TABLE sessions DROP COLUMN last_notification_ts')
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

    // The instances table held OpenClaude's multi-instance topology (daemon,
    // pipes, coordinator, bridge), which pi has no equivalent of. Dropped
    // rather than left behind: its FK to sessions would otherwise block
    // deleting any session that still has instance rows.
    this.db.exec('DROP INDEX IF EXISTS idx_instances_session')
    this.db.exec('DROP INDEX IF EXISTS idx_events_instance')
    this.db.exec('DROP TABLE IF EXISTS instances')

    // First-boot setup for the filters table. We don't have any users
    // in the wild with a partial filters schema yet (this branch hasn't
    // shipped), so the install path is intentionally one-shot: create
    // the table with all current columns, seed the defaults once, then
    // leave it alone forever. After this, both schema and rows are
    // user-controlled — seeds don't re-apply on subsequent boots, and
    // the only way to bring defaults back to their original values is
    // the "Reload defaults" button (which routes through
    // resetDefaultFilters → runSeedDefaults with the explicit upsert).
    //
    // Side effect: a default the user deletes will stay deleted across
    // restarts. Users who want to silence a default should disable it
    // rather than delete it.
    const filtersTableExists = !!this.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='filters'")
      .get()
    if (!filtersTableExists) {
      this.db.exec(`
        CREATE TABLE filters (
          id          TEXT PRIMARY KEY,
          name        TEXT NOT NULL,
          pill_name   TEXT NOT NULL,
          display     TEXT NOT NULL CHECK(display IN ('primary','secondary')),
          combinator  TEXT NOT NULL CHECK(combinator IN ('and','or')) DEFAULT 'and',
          patterns    TEXT NOT NULL,
          kind        TEXT NOT NULL CHECK(kind IN ('default','user')),
          enabled     INTEGER NOT NULL DEFAULT 1,
          config      TEXT NOT NULL DEFAULT '{}',
          created_at  INTEGER NOT NULL,
          updated_at  INTEGER NOT NULL
        )
      `)
      this.runSeedDefaults()
    } else {
      // Existing installations: backfill seeds added in newer releases —
      // never updating an existing row, so user customizations to defaults
      // are preserved — and remove the defaults that were retired.
      this.installMissingSeedDefaults()
      this.upgradeUneditedSeedDefaults()
      const drop = this.db.prepare("DELETE FROM filters WHERE id = ? AND kind = 'default'")
      for (const id of OBSOLETE_DEFAULT_FILTER_IDS) {
        drop.run(id)
      }
    }

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
    this.db.exec(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_events_signature_hash ON events(signature_hash)',
    )
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_agents_session ON agents(session_id)')
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_agents_parent ON agents(parent_agent_id)')
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id)')
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
      { id: number } | undefined
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
    agentClass?: string | null,
  ): Promise<void> {
    const now = Date.now()
    const existing = this.db.prepare('SELECT id FROM agents WHERE id = ?').get(id)
    this.db
      .prepare(
        `
      INSERT INTO agents (id, session_id, parent_agent_id, name, description, agent_type, agent_class, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, 'pi'), ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = COALESCE(excluded.name, agents.name),
        description = COALESCE(excluded.description, agents.description),
        agent_type = COALESCE(excluded.agent_type, agents.agent_type),
        agent_class = COALESCE(?, agents.agent_class),
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
        agentClass ?? null,
        now,
        now,
        agentClass ?? null,
        now,
      )

    if (!existing) {
      this.db
        .prepare('UPDATE sessions SET agent_count = agent_count + 1 WHERE id = ?')
        .run(sessionId)
    }
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

  async insertEvent(params: InsertEventParams): Promise<InsertEventResult> {
    const now = Date.now()
    // Wrap the INSERT + counter UPDATEs in a single transaction so a
    // mid-operation failure doesn't leave the event count out of sync.
    const tx = this.db.transaction(() => {
      const result = this.db
        .prepare(
          `
        INSERT INTO events (agent_id, session_id, type, subtype, tool_name, timestamp, created_at, payload, tool_use_id, signature_hash)
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
          params.signatureHash ?? null,
        )

      this.db
        .prepare(
          `UPDATE sessions SET
            event_count = event_count + 1,
            last_activity = MAX(COALESCE(last_activity, 0), ?)
          WHERE id = ?`,
        )
        .run(params.timestamp, params.sessionId)

      const isNotification =
        params.isNotification ?? config.notificationEventSubtypes.has(params.subtype ?? '')
      const notificationTransition = this.applyNotification(
        params.sessionId,
        isNotification,
        isNotification ? (params.notificationOwnerId ?? params.agentId) : params.agentId,
        params.timestamp,
      )

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

      return { eventId: Number(result.lastInsertRowid), notificationTransition }
    })

    try {
      return tx()
    } catch (e: any) {
      // A concurrent identical POST won the race to insert this signature.
      // The transaction rolled back; surface it as a typed error so the
      // route can return the winner's id instead of double-counting.
      if (
        params.signatureHash &&
        e?.code === 'SQLITE_CONSTRAINT_UNIQUE' &&
        String(e.message ?? '').includes('events.signature_hash')
      ) {
        throw new DuplicateEventSignatureError(params.signatureHash)
      }
      throw e
    }
  }

  /**
   * Update a session's pending-notification state for one event.
   *
   * State is the set of agents with an unanswered notification. A
   * notification adds its owner; any other event removes the agent that
   * produced it. So only the agent that raised a notification can clear it —
   * a subagent working in the background leaves the main agent's pending
   * dialog alone. The session is pending while the set is non-empty.
   */
  private applyNotification(
    sessionId: string,
    isNotification: boolean,
    agentId: string,
    timestamp: number,
  ): NotificationTransition {
    const row = this.db
      .prepare('SELECT pending_notification_agents AS agents FROM sessions WHERE id = ?')
      .get(sessionId) as { agents: string | null } | undefined
    if (!row) {
      return 'none'
    }
    let agents: string[] = []
    try {
      const parsed = row.agents ? JSON.parse(row.agents) : []
      agents = Array.isArray(parsed) ? parsed.filter((a) => typeof a === 'string') : []
    } catch {
      agents = []
    }

    if (isNotification) {
      const next = agents.includes(agentId) ? agents : [...agents, agentId]
      this.db
        .prepare(
          `UPDATE sessions SET
            pending_notification_ts = MAX(COALESCE(pending_notification_ts, 0), ?),
            pending_notification_agents = ?,
            pending_notification_count = pending_notification_count + 1
          WHERE id = ?`,
        )
        .run(timestamp, JSON.stringify(next), sessionId)
      return 'set'
    }

    if (!agents.includes(agentId)) {
      return 'none'
    }
    const next = agents.filter((a) => a !== agentId)
    if (next.length > 0) {
      this.db
        .prepare('UPDATE sessions SET pending_notification_agents = ? WHERE id = ?')
        .run(JSON.stringify(next), sessionId)
      return 'none'
    }
    this.db
      .prepare(
        `UPDATE sessions SET
          pending_notification_ts = NULL,
          pending_notification_agents = NULL,
          pending_notification_count = 0
        WHERE id = ?`,
      )
      .run(sessionId)
    return 'cleared'
  }

  async getSessionsWithPendingNotifications(sinceTs: number): Promise<any[]> {
    // `sinceTs` lets clients cheaply resume from their last-seen cursor on
    // page load. State is maintained by insertEvent (applyNotification).
    return this.db
      .prepare(
        `
      SELECT
        id AS session_id,
        project_id,
        pending_notification_ts,
        pending_notification_count AS count
      FROM sessions
      WHERE pending_notification_ts IS NOT NULL
        AND pending_notification_ts > ?
      ORDER BY pending_notification_ts DESC
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

  async findEventBySignatureHash(hash: string): Promise<{ id: number } | null> {
    const row = this.db
      .prepare('SELECT id FROM events WHERE signature_hash = ? LIMIT 1')
      .get(hash) as { id: number } | undefined
    return row ? { id: Number(row.id) } : null
  }

  async getSessionTranscriptPath(sessionId: string): Promise<string | null> {
    const row = this.db
      .prepare(`SELECT transcript_path FROM sessions WHERE id = ?`)
      .get(sessionId) as { transcript_path: string | null } | undefined
    return row?.transcript_path ?? null
  }

  async getAgentById(agentId: string): Promise<any | null> {
    return this.db.prepare(`SELECT * FROM agents WHERE id = ?`).get(agentId) || null
  }

  async listFilters(): Promise<Filter[]> {
    const rows = this.db.prepare('SELECT * FROM filters ORDER BY kind, name').all() as FilterRow[]
    return rows.map((r) => this.rowToFilter(r))
  }

  async getFilterById(id: string): Promise<Filter | null> {
    const row = this.db.prepare('SELECT * FROM filters WHERE id = ?').get(id) as
      FilterRow | undefined
    return row ? this.rowToFilter(row) : null
  }

  async createFilter(input: {
    name: string
    pillName: string
    display: 'primary' | 'secondary'
    combinator: 'and' | 'or'
    patterns: FilterPattern[]
    config?: Record<string, unknown>
  }): Promise<Filter> {
    const id = randomUUID()
    const now = Date.now()
    this.db
      .prepare(
        `INSERT INTO filters (id, name, pill_name, display, combinator, patterns, kind, enabled, config, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'user', 1, ?, ?, ?)`,
      )
      .run(
        id,
        input.name,
        input.pillName,
        input.display,
        input.combinator,
        JSON.stringify(input.patterns),
        JSON.stringify(input.config ?? {}),
        now,
        now,
      )
    return (await this.getFilterById(id)) as Filter
  }

  async deleteFilter(id: string): Promise<void> {
    this.db.prepare('DELETE FROM filters WHERE id = ?').run(id)
  }

  async updateFilter(
    id: string,
    patch: Partial<{
      name: string
      pillName: string
      display: 'primary' | 'secondary'
      combinator: 'and' | 'or'
      patterns: FilterPattern[]
      enabled: boolean
      config: Record<string, unknown>
    }>,
  ): Promise<Filter> {
    const existing = await this.getFilterById(id)
    if (!existing) throw new Error(`filter ${id} not found`)
    const merged = {
      name: patch.name ?? existing.name,
      pillName: patch.pillName ?? existing.pillName,
      display: patch.display ?? existing.display,
      combinator: patch.combinator ?? existing.combinator,
      patterns: patch.patterns ?? existing.patterns,
      enabled: patch.enabled ?? existing.enabled,
      config: patch.config ?? existing.config,
    }
    this.db
      .prepare(
        `UPDATE filters
         SET name = ?, pill_name = ?, display = ?, combinator = ?, patterns = ?, enabled = ?, config = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        merged.name,
        merged.pillName,
        merged.display,
        merged.combinator,
        JSON.stringify(merged.patterns),
        merged.enabled ? 1 : 0,
        JSON.stringify(merged.config),
        Date.now(),
        id,
      )
    return (await this.getFilterById(id)) as Filter
  }

  async duplicateFilter(id: string): Promise<Filter> {
    const orig = await this.getFilterById(id)
    if (!orig) throw new Error(`filter ${id} not found`)
    return await this.createFilter({
      name: `${orig.name} (copy)`,
      pillName: orig.pillName,
      display: orig.display,
      combinator: orig.combinator,
      patterns: orig.patterns,
      config: orig.config,
    })
  }

  // Insert (or, on explicit reset, upsert) the default filter seeds.
  // Called from two places:
  //   1. Constructor — only when the filters table is brand new, so
  //      the ON CONFLICT branch never fires; this is effectively an
  //      INSERT seeding a fresh DB.
  //   2. resetDefaultFilters (the "Reload defaults" button) — here
  //      the upsert is the point: each default's name, pillName,
  //      display, combinator, patterns, and config snap back to seed
  //      values. `enabled` is intentionally NOT touched so a user
  //      who silenced a default keeps it silenced after a reset.
  private runSeedDefaults(): void {
    const insert = this.db.prepare(
      `INSERT INTO filters (id, name, pill_name, display, combinator, patterns, kind, enabled, config, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'default', 1, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         pill_name = excluded.pill_name,
         display = excluded.display,
         combinator = excluded.combinator,
         patterns = excluded.patterns,
         config = excluded.config,
         updated_at = excluded.updated_at`,
    )
    const now = Date.now()
    const tx = this.db.transaction(() => {
      for (const s of SEED_FILTERS) {
        insert.run(
          s.id,
          s.name,
          s.pillName,
          s.display,
          s.combinator,
          JSON.stringify(s.patterns),
          JSON.stringify(s.config ?? {}),
          now,
          now,
        )
      }
    })
    tx()
  }

  async seedDefaultFilters(): Promise<void> {
    this.runSeedDefaults()
  }

  // Insert any SEED_FILTERS rows whose id isn't already in the filters
  // table. Used during init on existing installs so a new release that
  // adds a default (e.g. `default-all`) lands without disturbing rows
  // the user has already customized. Never updates existing rows.
  private installMissingSeedDefaults(): void {
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO filters
       (id, name, pill_name, display, combinator, patterns, kind, enabled, config, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'default', 1, ?, ?, ?)`,
    )
    const now = Date.now()
    const tx = this.db.transaction(() => {
      for (const s of SEED_FILTERS) {
        insert.run(
          s.id,
          s.name,
          s.pillName,
          s.display,
          s.combinator,
          JSON.stringify(s.patterns),
          JSON.stringify(s.config ?? {}),
          now,
          now,
        )
      }
    })
    tx()
  }

  // Replace the patterns of default rows still holding a superseded seed
  // version with the current seed's. Compared structurally, so key order
  // in the stored JSON doesn't matter; any other value is a user edit.
  private upgradeUneditedSeedDefaults(): void {
    const read = this.db.prepare("SELECT patterns FROM filters WHERE id = ? AND kind = 'default'")
    const write = this.db.prepare('UPDATE filters SET patterns = ?, updated_at = ? WHERE id = ?')
    const now = Date.now()
    for (const [id, versions] of Object.entries(SUPERSEDED_SEED_PATTERNS)) {
      const seed = SEED_FILTERS.find((s) => s.id === id)
      const row = read.get(id) as { patterns: string } | undefined
      if (!seed || !row) {
        continue
      }
      let stored: unknown
      try {
        stored = JSON.parse(row.patterns)
      } catch {
        continue
      }
      const current = canonicalJson(stored)
      if (!versions.some((v) => canonicalJson(v) === current)) {
        continue
      }
      write.run(JSON.stringify(seed.patterns), now, id)
    }
  }

  async resetDefaultFilters(): Promise<Filter[]> {
    await this.seedDefaultFilters()
    return (await this.listFilters()).filter((f) => f.kind === 'default')
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
      sql += " AND payload LIKE ? ESCAPE '\\'"
      const term = `%${escapeLike(filters.search)}%`
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
      StoredEvent | undefined
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
    const tx = this.db.transaction(() => {
      const events = this.db
        .prepare('DELETE FROM events WHERE session_id = ?')
        .run(sessionId).changes
      const agents = this.db
        .prepare('DELETE FROM agents WHERE session_id = ?')
        .run(sessionId).changes
      this.db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId)
      return { events, agents }
    })
    return tx()
  }

  async deleteProject(
    projectId: number,
  ): Promise<{ sessionIds: string[]; sessions: number; agents: number; events: number }> {
    const tx = this.db.transaction(() => {
      const rows = this.db
        .prepare('SELECT id FROM sessions WHERE project_id = ?')
        .all(projectId) as {
        id: string
      }[]
      const sessionIds = rows.map((s) => s.id)
      let events = 0
      let agents = 0
      for (const sessionId of sessionIds) {
        events += this.db.prepare('DELETE FROM events WHERE session_id = ?').run(sessionId).changes
        agents += this.db.prepare('DELETE FROM agents WHERE session_id = ?').run(sessionId).changes
      }
      const sessions = this.db
        .prepare('DELETE FROM sessions WHERE project_id = ?')
        .run(projectId).changes
      this.db.prepare('DELETE FROM projects WHERE id = ?').run(projectId)
      return { sessionIds, sessions, agents, events }
    })
    return tx()
  }

  async clearAllData(): Promise<{
    projects: number
    sessions: number
    agents: number
    events: number
  }> {
    const events = this.db.prepare('DELETE FROM events WHERE 1=1').run().changes
    const agents = this.db.prepare('DELETE FROM agents WHERE 1=1').run().changes
    const sessions = this.db.prepare('DELETE FROM sessions WHERE 1=1').run().changes
    const projects = this.db.prepare('DELETE FROM projects WHERE 1=1').run().changes
    return { projects, sessions, agents, events }
  }

  async deleteSessions(
    sessionIds: string[],
  ): Promise<{ events: number; agents: number; sessions: number }> {
    if (sessionIds.length === 0) return { events: 0, agents: 0, sessions: 0 }
    // Wrap in a transaction so a mid-loop failure doesn't leave orphaned
    // events/agents pointing at a deleted session row.
    // Children first (events, agents), then the session row, as in
    // deleteSession().
    const tx = this.db.transaction((ids: string[]) => {
      let events = 0
      let agents = 0
      let sessions = 0
      const delEvents = this.db.prepare('DELETE FROM events WHERE session_id = ?')
      const delAgents = this.db.prepare('DELETE FROM agents WHERE session_id = ?')
      const delSession = this.db.prepare('DELETE FROM sessions WHERE id = ?')
      for (const id of ids) {
        events += delEvents.run(id).changes
        agents += delAgents.run(id).changes
        sessions += delSession.run(id).changes
      }
      return { events, agents, sessions }
    })
    return tx(sessionIds)
  }

  async getDbStats(): Promise<{ sessionCount: number; eventCount: number }> {
    const sessionRow = this.db.prepare('SELECT COUNT(*) as c FROM sessions').get() as { c: number }
    const eventRow = this.db.prepare('SELECT COUNT(*) as c FROM events').get() as { c: number }
    return { sessionCount: sessionRow.c, eventCount: eventRow.c }
  }

  async vacuum(): Promise<void> {
    // VACUUM cannot run inside a transaction. better-sqlite3 exposes it
    // directly via exec(). The DB briefly locks for writes, but for a
    // local single-user tool the tradeoff is fine.
    this.db.exec('VACUUM')
  }

  async clearSessionEvents(sessionId: string): Promise<{ events: number; agents: number }> {
    const tx = this.db.transaction(() => {
      const events = this.db
        .prepare('DELETE FROM events WHERE session_id = ?')
        .run(sessionId).changes
      const agents = this.db
        .prepare('DELETE FROM agents WHERE session_id = ?')
        .run(sessionId).changes
      this.db
        .prepare(
          'UPDATE sessions SET event_count = 0, agent_count = 0, last_activity = NULL, total_input_tokens = 0, total_output_tokens = 0, total_cache_read_tokens = 0, total_cache_creation_tokens = 0, total_duration_ms = 0, llm_call_count = 0 WHERE id = ?',
        )
        .run(sessionId)
      return { events, agents }
    })
    return tx()
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

  async getUnassignedSessions(limit: number = 50): Promise<any[]> {
    return this.db
      .prepare(
        `
      SELECT s.*,
        p.slug as project_slug,
        p.name as project_name
      FROM sessions s
      LEFT JOIN projects p ON p.id = s.project_id
      WHERE s.project_id IS NULL
      ORDER BY COALESCE(s.last_activity, s.started_at) DESC
      LIMIT ?
    `,
      )
      .all(limit)
  }

  async getRecentSessions(limit: number = 20, since?: number): Promise<any[]> {
    // LEFT JOIN so orphaned sessions (project deleted out from under them)
    // still appear in the recent list. The repairOrphans pass should make
    // this rare, but the LEFT JOIN is defensive — without it, an orphaned
    // active session would silently disappear from the UI.
    return (
      this.db
        .prepare(
          `
      SELECT s.*,
        p.slug as project_slug,
        p.name as project_name
      FROM sessions s
      LEFT JOIN projects p ON p.id = s.project_id
      ${since != null ? 'WHERE COALESCE(s.last_activity, s.started_at) >= ?' : ''}
      ORDER BY COALESCE(s.last_activity, s.started_at) DESC
      LIMIT ?
    `,
        )
        // The window filters on the same expression the list is ordered by.
        .all(...(since != null ? [since, limit] : [limit]))
    )
  }

  async repairOrphans(): Promise<OrphanRepairResult> {
    return this.db.transaction(() => {
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

      // 2. Agents with invalid session_id -> delete (no recovery possible since
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

      // 4. Events with invalid session_id -> delete. Also covers events that
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

      // 5. Events with invalid agent_id -> delete (similar to above).
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
    })()
  }

  async healthCheck(): Promise<{ ok: boolean; error?: string }> {
    try {
      const row = this.db.prepare('SELECT 1 AS ok').get() as { ok: number } | undefined
      if (row?.ok !== 1) return { ok: false, error: 'SQLite query returned unexpected result' }

      // Verify tables exist
      const tables = this.db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('projects','sessions','events','agents')",
        )
        .all() as { name: string }[]
      if (tables.length < 4) {
        const missing = ['projects', 'sessions', 'events', 'agents'].filter(
          (t) => !tables.some((r) => r.name === t),
        )
        return { ok: false, error: `Missing tables: ${missing.join(', ')}` }
      }

      return { ok: true }
    } catch (err: any) {
      return { ok: false, error: err.message || 'Unknown database error' }
    }
  }

  private rowToFilter(row: FilterRow): Filter {
    let config: Record<string, unknown> = {}
    try {
      const parsed = JSON.parse(row.config || '{}')
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) config = parsed
    } catch {
      // Bad JSON in the column — surface as an empty config rather than
      // crashing the list endpoint.
    }
    return {
      id: row.id,
      name: row.name,
      pillName: row.pill_name,
      display: row.display as 'primary' | 'secondary',
      combinator: row.combinator as 'and' | 'or',
      patterns: JSON.parse(row.patterns),
      kind: row.kind as 'default' | 'user',
      enabled: row.enabled === 1,
      config,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  close(): void {
    this.db.close()
  }
}
