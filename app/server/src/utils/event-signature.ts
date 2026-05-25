import { createHash } from 'node:crypto'
import type { ParsedRawEvent } from '../parser'

const BUCKET_MS = 5000

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value))
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(obj).sort()) {
      out[key] = sortKeys(obj[key])
    }
    return out
  }
  return value
}

/**
 * Stable signature for dedup. Identical events within the same 5-second
 * bucket produce the same hash; >5s apart they don't — treated as distinct
 * real events. Native OTel can re-deliver the same span (retries, duplicate
 * exporters); this collapses those at ingestion.
 *
 * The raw payload already encodes agent_id / tool_use_id / instance_id, so
 * hashing it (plus the session + dispatch fields + cwd + time bucket) is
 * sufficient to identify a re-delivery of the same logical event.
 */
export function computeEventSignature(parsed: ParsedRawEvent, cwd: string | null): string {
  const material = {
    session_id: parsed.sessionId,
    subtype: parsed.subtype ?? null,
    tool_name: parsed.toolName ?? null,
    tool_use_id: parsed.toolUseId ?? null,
    instance_id: parsed.instanceId ?? null,
    cwd: cwd ?? null,
    payload: parsed.raw,
    ts_bucket: Math.floor(parsed.timestamp / BUCKET_MS),
  }
  return createHash('sha256').update(canonicalJson(material)).digest('hex')
}
