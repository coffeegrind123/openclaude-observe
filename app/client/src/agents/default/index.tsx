// Fallback class for events whose producer we don't model: unknown agent
// classes and legacy rows recorded under `claude-code` before the pi
// conversion. It makes no assumptions about payload shape beyond the
// server's own columns (subtype, toolName), and shows the payload as JSON.

import type { ParsedEvent } from '@/types'
import type { AgentClass, EventDetailProps } from '../types'
import { asText, isToolSubtype, obj, oneLine, str, summarizeArgs, type Payload } from '../payload'
import { hasIconEntry } from '@/lib/event-icon-registry'
import { DetailCode, DetailRow } from '@/components/event-stream/detail-parts'

function summary(event: ParsedEvent): string {
  const p = event.payload as Payload
  if (isToolSubtype(event.subtype)) {
    return summarizeArgs(obj(p.tool_input))
  }
  for (const key of ['prompt', 'message', 'text', 'summary', 'reason']) {
    const v = str(p[key])
    if (v) {
      return oneLine(v)
    }
  }
  return ''
}

function iconId(event: ParsedEvent): string {
  if (isToolSubtype(event.subtype)) {
    return event.subtype === 'PostToolUseFailure' ? 'PostToolUseFailure' : 'PreToolUse'
  }
  if (event.subtype && hasIconEntry(event.subtype)) {
    return event.subtype
  }
  return 'Default'
}

function DefaultEventDetail({ event, pairedPayloads }: EventDetailProps) {
  const p = event.payload as Payload
  const input = obj(pairedPayloads?.pre.payload.tool_input) ?? obj(p.tool_input)
  return (
    <div className="space-y-1.5">
      <DetailRow label="Event" value={event.subtype ?? event.type} />
      <DetailRow label="Class" value={str(p.agent_class) ?? 'unknown'} />
      {event.toolName && <DetailRow label="Tool" value={event.toolName} mono />}
      {input && <DetailCode label="Input" value={asText(input)} />}
      {p.tool_response !== undefined && (
        <DetailCode label="Response" value={asText(p.tool_response)} />
      )}
      <div className="text-[10px] text-muted-foreground">
        No renderer for this agent class — the full payload is below.
      </div>
    </div>
  )
}

export const defaultClass: AgentClass = {
  id: 'default',
  displayName: 'unknown',
  label: (event) => (isToolSubtype(event.subtype) ? 'Tool' : (event.subtype ?? event.type)),
  toolLabel: (event) => (isToolSubtype(event.subtype) ? event.toolName : null),
  summary,
  summaryTag: () => null,
  prose: () => null,
  iconId,
  isFailure: (event) => event.subtype === 'PostToolUseFailure' || event.status === 'failed',
  badges: () => [],
  chat: () => null,
  spawnLink: () => null,
  identity: () => null,
  isSpawnTool: () => false,
  EventDetail: DefaultEventDetail,
}
