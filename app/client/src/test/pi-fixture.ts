// The 24 real envelopes the pi observe extension produced from a captured
// session (prompt; parallel read / bash / failing bash / Agent; a
// general-purpose subagent with its own prompt, LLM and tool events; Stop;
// SessionEnd), turned into events the way the server stores them
// (app/server/src/routes/events.ts + sessions.ts).

import raw from '../../../server/src/routes/__fixtures__/pi-envelopes.jsonl?raw'
import type { Agent, ParsedEvent } from '@/types'

// app/server/src/parser.ts EVENT_TYPES
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
}
const TOOL_EVENTS = new Set(['PreToolUse', 'PostToolUse', 'PostToolUseFailure'])

function deriveEventStatus(subtype: string): string {
  if (subtype === 'PreToolUse') {
    return 'running'
  }
  if (subtype === 'PostToolUse') {
    return 'completed'
  }
  return 'pending'
}

export const PI_ENVELOPES: Record<string, unknown>[] = raw
  .split('\n')
  .filter((l) => l.trim().length > 0)
  .map((l) => JSON.parse(l))

export const PI_SESSION_ID = PI_ENVELOPES[0].session_id as string
export const PI_SUBAGENT_ID = '01a0cea8-63cb-73d4-853f-9a5b79957320'
export const PI_AGENT_TOOL_USE_ID = 'call_358b73ae'

export function piFixtureEvents(): ParsedEvent[] {
  return PI_ENVELOPES.map((env, i) => {
    const subtype = env.hook_event_name as string
    const isTool = TOOL_EVENTS.has(subtype)
    return {
      id: i + 1,
      agentId: (env.agent_id as string | undefined) ?? (env.session_id as string),
      sessionId: env.session_id as string,
      type: EVENT_TYPES[subtype] ?? 'system',
      subtype,
      toolName: isTool ? ((env.tool_name as string | undefined) ?? null) : null,
      toolUseId: (env.tool_use_id as string | undefined) ?? null,
      status: deriveEventStatus(subtype),
      timestamp: env.timestamp as number,
      createdAt: env.timestamp as number,
      payload: env,
    }
  })
}

/** The agents GET /api/sessions/:id/agents returns for this session. */
export function piFixtureAgents(): Agent[] {
  return [
    {
      id: PI_SESSION_ID,
      sessionId: PI_SESSION_ID,
      parentAgentId: null,
      name: null,
      description: null,
      agentType: null,
      agentClass: 'pi',
      status: 'stopped',
      eventCount: 16,
      firstEventAt: 1790173523938,
      lastEventAt: 1790173549090,
    },
    {
      id: PI_SUBAGENT_ID,
      sessionId: PI_SESSION_ID,
      parentAgentId: PI_SESSION_ID,
      name: 'general-purpose#f322fa95',
      description: 'Count lines in notes.txt',
      agentType: 'general-purpose',
      agentClass: 'pi',
      status: 'stopped',
      eventCount: 8,
      firstEventAt: 1790173537921,
      lastEventAt: 1790173544141,
    },
  ]
}
