// app/server/src/parser.ts
// Extracts structural fields from raw JSONL events.
// NO formatting, NO truncation, NO summary generation — that's the client's job.

import { stripRepoUrlCredentials } from './utils/repo-url'

export interface ParsedRawEvent {
  projectName: string | null
  sessionId: string
  slug: string | null
  transcriptPath: string | null
  type: string
  subtype: string | null
  toolName: string | null
  toolUseId: string | null
  timestamp: number
  // Producer, e.g. "pi". Stored on the agents it creates.
  agentClass: string | null
  // The subagent this event belongs to (payload.agent_id). The pi extension
  // resolves this itself — pi exposes no parent link — and sends it explicitly
  // on every event from a subagent, along with who spawned it.
  ownerAgentId: string | null
  ownerAgentType: string | null
  ownerAgentName: string | null
  ownerAgentDescription: string | null
  // Set when a subagent spawned this one (nested delegation); null when the
  // top-level session did.
  parentAgentId: string | null
  // tool_use_id of the Agent/SubAgent call that spawned the owner.
  parentToolUseId: string | null
  metadata: Record<string, unknown>
  raw: Record<string, unknown>
}

// Each pi event name (see docs/pi-protocol.md) and the coarse type the
// stream groups it under. Anything unlisted is stored as a 'system' event
// under its own name, so a newer extension never gets its events dropped.
const EVENT_TYPES: Record<string, string> = {
  SessionStart: 'session',
  SessionEnd: 'session',
  SessionRename: 'session',
  SessionTree: 'session',
  SystemPrompt: 'session',
  UserPromptSubmit: 'user',
  UserBash: 'user',
  PreToolUse: 'tool',
  PostToolUse: 'tool',
  PostToolUseFailure: 'tool',
  LLMGeneration: 'llm',
  Stop: 'system',
  SubagentStart: 'system',
  SubagentStop: 'system',
  PreCompact: 'system',
  PostCompact: 'system',
  CompactionFailed: 'system',
  ModelChange: 'system',
  ThinkingLevelChange: 'system',
  CustomMessage: 'system',
  Notification: 'system',
}

const TOOL_EVENTS = new Set(['PreToolUse', 'PostToolUse', 'PostToolUseFailure'])

const METADATA_KEYS = [
  'cwd',
  'model',
  'provider',
  'agent_class',
  'thinking_level',
  'context_window',
  'pi_mode',
  'input_tokens',
  'output_tokens',
  'cache_read_tokens',
  'cache_creation_tokens',
  'ttft_ms',
  'duration_ms',
]

const MAX_ID = 256
const MAX_GIT_BRANCH = 256
const MAX_REPO_URL = 2048

function str(v: unknown, max = MAX_ID): string | null {
  return typeof v === 'string' && v !== '' ? v.slice(0, max) : null
}

export function parseRawEvent(raw: Record<string, unknown>): ParsedRawEvent {
  // Guard against excessively large payloads that could OOM the server.
  try {
    if (JSON.stringify(raw).length > 1_000_000) {
      return {
        projectName: null,
        sessionId: 'rejected-oversized',
        slug: null,
        transcriptPath: null,
        type: 'system',
        subtype: 'RejectedOversized',
        toolName: null,
        toolUseId: null,
        timestamp: Date.now(),
        agentClass: null,
        ownerAgentId: null,
        ownerAgentType: null,
        ownerAgentName: null,
        ownerAgentDescription: null,
        parentAgentId: null,
        parentToolUseId: null,
        metadata: {},
        raw,
      }
    }
  } catch {
    // If serialization throws (e.g. circular reference), continue parsing.
  }

  const meta = raw.meta as Record<string, unknown> | undefined
  const hookEventName = str(raw.hook_event_name, 200)

  let type: string
  let subtype: string | null
  if (hookEventName) {
    type = EVENT_TYPES[hookEventName] ?? 'system'
    subtype = hookEventName
  } else {
    type = str(raw.type, 200) ?? 'unknown'
    subtype = str(raw.subtype, 200)
  }

  const metadata: Record<string, unknown> = {}
  for (const key of METADATA_KEYS) {
    if (raw[key] === undefined) {
      continue
    }
    const value = raw[key]
    metadata[key] = key === 'cwd' && typeof value === 'string' ? value.slice(0, 1024) : value
  }

  // Git context describes the top-level session's checkout. A subagent's is
  // ignored so a child working elsewhere can't overwrite it. null is kept:
  // it clears a stale value when the session leaves a repository.
  if (!raw.agent_id) {
    if (raw.git_branch !== undefined) {
      metadata.git_branch = str(raw.git_branch, MAX_GIT_BRANCH)
    }
    if (raw.git_repository_url !== undefined) {
      metadata.git_repository_url = stripRepoUrlCredentials(
        str(raw.git_repository_url, MAX_REPO_URL),
      )
    }
  }

  return {
    projectName: str(raw.project_name),
    sessionId: str(raw.session_id) ?? 'unknown',
    slug: str(raw.slug),
    transcriptPath: str(raw.transcript_path, 4096),
    type,
    subtype,
    toolName: hookEventName && TOOL_EVENTS.has(hookEventName) ? str(raw.tool_name) : null,
    toolUseId: str(raw.tool_use_id),
    timestamp: parseTimestamp(meta?.timestamp ?? raw.timestamp),
    agentClass: str(raw.agent_class, 64),
    ownerAgentId: str(raw.agent_id),
    ownerAgentType: str(raw.agent_type),
    ownerAgentName: str(raw.agent_name),
    ownerAgentDescription: str(raw.agent_description, 2000),
    parentAgentId: str(raw.parent_agent_id),
    parentToolUseId: str(raw.parent_tool_use_id),
    metadata,
    raw,
  }
}

// Guard against bogus future timestamps. A sentinel like `9999999999999`
// (year 2286) injected by a test fixture — or a misconfigured CLI — will
// poison downstream views that compute session spans (rewind timeline
// blows the pixel budget; session sort orders get thrown off). We allow
// up to 24h in the future to tolerate clock skew / timezone drift, then
// clamp anything further to the ingest time.
const FUTURE_TS_CAP_MS = 24 * 60 * 60 * 1000

function parseTimestamp(ts: unknown): number {
  const parsed = coerceTimestamp(ts)
  const now = Date.now()
  if (parsed > now + FUTURE_TS_CAP_MS) {
    console.warn(
      `[parser] Clamping future timestamp ${parsed} (>${FUTURE_TS_CAP_MS / 3600000}h ahead) to now=${now}`,
    )
    return now
  }
  return parsed
}

// The contract is epoch milliseconds, but some emitters (e.g. Python
// `time.time()`) send epoch *seconds*, possibly fractional. Read as ms those
// land in Jan 1970 and drop the session out of every recent-time window.
// A plausible recent instant in seconds falls in [1e9, 1e12) (2001 onward);
// the same instant in ms is >= 1e12. Values below 1e9 are fixtures/sentinels
// and are left untouched; parseTimestamp still clamps the upper extreme.
const EPOCH_SECONDS_MIN = 1e9
const EPOCH_MS_MIN = 1e12

function normalizeEpochUnits(ts: number): number {
  if (ts >= EPOCH_SECONDS_MIN && ts < EPOCH_MS_MIN) {
    return Math.round(ts * 1000)
  }
  return ts
}

function coerceTimestamp(ts: unknown): number {
  if (typeof ts === 'number' && !isNaN(ts)) return normalizeEpochUnits(ts)
  if (typeof ts === 'string') {
    const parsed = new Date(ts).getTime()
    return isNaN(parsed) ? Date.now() : parsed
  }
  return Date.now()
}
