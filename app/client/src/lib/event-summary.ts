// Row summaries come from the event's agent class; this is the shared entry
// point for components that only have an event (and maybe its agent).

import type { Agent, ParsedEvent } from '@/types'
import { agentClassFor } from '@/agents/registry'

export { extractBashBinary } from './bash-binary'

/** One-line summary of an event. No truncation — the UI handles that via CSS. */
export function getEventSummary(event: ParsedEvent, agent?: Agent | null): string {
  return agentClassFor(event, agent).summary(event)
}
