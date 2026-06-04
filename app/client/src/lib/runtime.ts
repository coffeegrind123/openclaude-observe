// Runtime derivation — compute elapsed time between paired events
// (e.g. Stop → preceding LLMGeneration, SubagentStop → SubagentStart).

import type { ParsedEvent } from '@/types'

/**
 * Compute the runtime in milliseconds for an event by finding its matching
 * start event in the events array. Returns null when no match is found.
 *
 * - Stop / stop_hook_summary → most recent preceding LLMGeneration on same agent
 * - SubagentStop → most recent preceding SubagentStart on same agent
 */
export function computeRuntimeMs(event: ParsedEvent, allEvents: ParsedEvent[]): number | null {
  const evIdx = allEvents.findIndex((e) => e.id === event.id)
  if (evIdx < 0) return null

  if (event.subtype === 'Stop' || event.subtype === 'stop_hook_summary') {
    // Walk backwards to find the most recent LLMGeneration for this agent
    for (let i = evIdx - 1; i >= 0; i--) {
      const e = allEvents[i]
      if (e.subtype === 'LLMGeneration' && e.agentId === event.agentId) {
        return Math.abs(event.timestamp - e.timestamp)
      }
    }
  }

  if (event.subtype === 'SubagentStop') {
    for (let i = evIdx - 1; i >= 0; i--) {
      const e = allEvents[i]
      if (e.subtype === 'SubagentStart' && e.agentId === event.agentId) {
        return Math.abs(event.timestamp - e.timestamp)
      }
    }
  }

  return null
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
