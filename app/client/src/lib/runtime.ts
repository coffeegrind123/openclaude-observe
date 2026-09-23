// Runtime derivation — elapsed time between paired events:
//   Stop          ← the agent's most recent UserPromptSubmit (the turn)
//   SubagentStop  ← the same subagent's SubagentStart
//   PostCompact / CompactionFailed ← the agent's most recent PreCompact
//   PreToolUse row ← its PostToolUse / PostToolUseFailure (by tool_use_id);
//                    the Post's own `duration_ms` wins when present, since it
//                    is measured by the producer from tool start, not arrival.

import type { ParsedEvent } from '@/types'

function durationField(e: ParsedEvent): number | null {
  const d = (e.payload as Record<string, unknown> | undefined)?.duration_ms
  return typeof d === 'number' && Number.isFinite(d) ? d : null
}

/**
 * One pass over the session's raw events. Keyed by the id of the event the
 * runtime is displayed on (for tools, the PreToolUse id — the row the dedupe
 * pipeline keeps).
 */
export function buildRuntimeMap(events: readonly ParsedEvent[]): Map<number, number> {
  const out = new Map<number, number>()
  const lastPrompt = new Map<string, number>() // agentId → timestamp
  const subStart = new Map<string, number>() // agentId → timestamp
  const lastPreCompact = new Map<string, number>() // agentId → timestamp
  const preTool = new Map<string, ParsedEvent>() // toolUseId → PreToolUse

  for (const e of events) {
    switch (e.subtype) {
      case 'UserPromptSubmit':
        lastPrompt.set(e.agentId, e.timestamp)
        break
      case 'Stop': {
        const start = lastPrompt.get(e.agentId)
        if (start !== undefined) {
          out.set(e.id, Math.max(0, e.timestamp - start))
        }
        break
      }
      case 'SubagentStart':
        subStart.set(e.agentId, e.timestamp)
        break
      case 'SubagentStop': {
        const start = subStart.get(e.agentId)
        const own = durationField(e)
        if (own != null) {
          out.set(e.id, own)
        } else if (start !== undefined) {
          out.set(e.id, Math.max(0, e.timestamp - start))
        }
        break
      }
      case 'PreCompact':
        lastPreCompact.set(e.agentId, e.timestamp)
        break
      case 'PostCompact':
      case 'CompactionFailed': {
        const start = lastPreCompact.get(e.agentId)
        if (start !== undefined) {
          out.set(e.id, Math.max(0, e.timestamp - start))
        }
        break
      }
      case 'PreToolUse':
        if (e.toolUseId) {
          preTool.set(e.toolUseId, e)
        }
        break
      case 'PostToolUse':
      case 'PostToolUseFailure': {
        if (!e.toolUseId) {
          break
        }
        const pre = preTool.get(e.toolUseId)
        const own = durationField(e)
        const target = pre?.id ?? e.id
        if (own != null) {
          out.set(target, own)
        } else if (pre) {
          out.set(target, Math.max(0, e.timestamp - pre.timestamp))
        }
        break
      }
    }
  }
  return out
}

/** Runtime for a single event; null when it has no pair. */
export function computeRuntimeMs(
  event: ParsedEvent,
  allEvents: readonly ParsedEvent[],
): number | null {
  return buildRuntimeMap(allEvents).get(event.id) ?? null
}

/** Format a duration in ms as a compact runtime string:
 *  <1s → "500ms", <60s → "5.2s", <60m → "1m 3s", >=60m → "1h 23m". */
export function formatRuntime(ms: number): string {
  if (!isFinite(ms) || ms < 0) return '—'
  if (ms < 1000) return `${Math.round(ms)}ms`
  const totalSec = ms / 1000
  if (totalSec < 60) return `${totalSec < 10 ? totalSec.toFixed(1) : Math.round(totalSec)}s`
  const totalMin = Math.floor(totalSec / 60)
  const sec = Math.round(totalSec - totalMin * 60)
  if (totalMin < 60) return `${totalMin}m ${sec}s`
  const hr = Math.floor(totalMin / 60)
  const min = totalMin - hr * 60
  return `${hr}h ${min}m`
}
