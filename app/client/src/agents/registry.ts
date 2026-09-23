import type { Agent, ParsedEvent } from '@/types'
import type { AgentClass } from './types'
import { piClass } from './pi'
import { defaultClass } from './default'

// Explicit table rather than side-effect registration: every class is known at
// build time and tests get the same registry as the app without an init step.
const CLASSES: ReadonlyMap<string, AgentClass> = new Map([[piClass.id, piClass]])

/** Legacy `claude-code` rows (and any unknown producer) resolve to the default class. */
export function getAgentClass(id: string | null | undefined): AgentClass {
  return (id && CLASSES.get(id)) || defaultClass
}

export function registeredAgentClasses(): AgentClass[] {
  return [...CLASSES.values()]
}

/**
 * The class for one event: its agent's `agentClass`, then the envelope's
 * `agent_class`, then the default.
 */
export function agentClassFor(event: ParsedEvent, agent?: Agent | null): AgentClass {
  const fromAgent = agent?.agentClass
  if (fromAgent) {
    return getAgentClass(fromAgent)
  }
  const fromPayload = (event.payload as Record<string, unknown> | undefined)?.agent_class
  return getAgentClass(typeof fromPayload === 'string' ? fromPayload : null)
}

export { defaultClass, piClass }
