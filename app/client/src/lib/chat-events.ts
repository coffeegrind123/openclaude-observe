// The "talk" lens: which events read as conversation. Classification is per
// agent class (see AgentClass.chat); this module is the shared entry point.

import type { Agent, ParsedEvent } from '@/types'
import type { ChatMessage } from '@/agents/types'
import { agentClassFor } from '@/agents/registry'

export type { ChatMessage }

/** Chat view of an event, or null when it is not part of the conversation. */
export function classifyChatEvent(event: ParsedEvent, agent?: Agent | null): ChatMessage | null {
  return agentClassFor(event, agent).chat(event)
}
