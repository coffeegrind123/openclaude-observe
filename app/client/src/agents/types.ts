import type { ComponentType } from 'react'
import type { Agent, ParsedEvent } from '@/types'
import type { PairedPayloads } from '@/hooks/use-deduped-events'
import type { TranscriptStatsData, TranscriptStatsModelPricing } from '@/lib/api-client'

/**
 * Per-agent-class behaviour. The event pipeline (dedupe, filters, stream,
 * timeline) is class-agnostic; everything that depends on what a producer
 * actually puts in its payloads goes through one of these.
 *
 * Resolution: the event's agent `agentClass`, then `payload.agent_class`,
 * then the default class (see registry.ts).
 */
export interface AgentClass {
  /** Registry id, matching the producer's `agent_class`. */
  id: string
  displayName: string

  /** Row label for the event ("Tool", "LLM", "you", …). */
  label(event: ParsedEvent): string
  /** Tool name as displayed on tool rows; null for non-tool events. */
  toolLabel(event: ParsedEvent): string | null
  /** One-line summary for the row, tooltips and thread lists. No truncation. */
  summary(event: ParsedEvent): string
  /** Short tag the row shows muted ahead of the summary (a bash call's binary), or null. */
  summaryTag(event: ParsedEvent): string | null
  /** Conversational text shown under the row header, or null. */
  prose(event: ParsedEvent): string | null
  /** Key into the event icon registry (lib/event-icon-registry.ts). */
  iconId(event: ParsedEvent): string
  /** Whether the row should read as a failure (red bead, red status). */
  isFailure(event: ParsedEvent): boolean
  /** Small highlighted badges on the row (e.g. "injected", "background"). */
  badges(event: ParsedEvent): RowBadge[]
  /** Chat view of the event for the talk lens, or null when it is not conversation. */
  chat(event: ParsedEvent): ChatMessage | null
  /** Parent/child linkage an event declares, if any (see SpawnLink). */
  spawnLink(event: ParsedEvent): SpawnLink | null
  /** Identity of the agent that emitted the event, when the payload carries it. */
  identity(event: ParsedEvent): AgentIdentity | null
  /** Whether a tool of this name spawns a subagent. */
  isSpawnTool(toolName: string | null): boolean

  /** Detail body for the inspector / inline expansion. */
  EventDetail: ComponentType<EventDetailProps>

  /** Session stats from events, for classes whose events carry usage. Absent → transcript only. */
  stats?: AgentStatsProvider
}

/** model id (as the events name it) → pricing, or null when models.dev doesn't know it. */
export type PricingMap = Record<string, TranscriptStatsModelPricing | null>

/**
 * Per-class token stats computed from events. The Stats modal uses it when the
 * session's transcript can't be read; the result has the transcript dataset's
 * shape so the Token Usage tables render it unchanged.
 */
export interface AgentStatsProvider {
  /** Models whose price is needed — those of requests with no recorded cost. */
  modelIds(events: ParsedEvent[]): string[]
  computeTokenStats(
    events: ParsedEvent[],
    sessionId: string,
    pricing: PricingMap,
  ): TranscriptStatsData
}

export interface RowBadge {
  text: string
  tone: 'accent' | 'warn' | 'fail' | 'muted'
  title?: string
}

export type ChatMessage =
  | { kind: 'user'; text: string; source?: string; injected?: boolean; images?: number }
  | { kind: 'assistant'; text: string; thinking?: string; failed?: boolean }
  | { kind: 'subagent-start'; agentName?: string; description?: string }
  | { kind: 'subagent-stop'; agentName?: string; description?: string }
  | { kind: 'subagent-result'; text: string }
  | { kind: 'status'; text: string }

/**
 * A declared parent → child link. pi's SubagentStart names the spawning call
 * (`parent_tool_use_id`) and, for nested delegation, the spawning subagent
 * (`parent_agent_id`); a background `Agent` call's PostToolUse names the child
 * it started (`spawned_agent_id`).
 */
export interface SpawnLink {
  agentId: string
  parentToolUseId: string | null
  parentAgentId: string | null
  agentType?: string
  agentName?: string
  description?: string
  background?: boolean
}

export interface AgentIdentity {
  agentId: string
  parentAgentId: string | null
  name: string | null
  agentType: string | null
  description: string | null
}

/** How a subagent was spawned — accumulated from its SpawnLink(s) and the spawning call. */
export interface SpawnInfo {
  description?: string
  prompt?: string
  agentType?: string
  agentName?: string
  parentToolUseId?: string
  parentAgentId?: string | null
  background?: boolean
  /** Event id of the displayed spawning tool row (the PreToolUse). */
  spawnEventId?: number
  /** Event id of the child's SubagentStart. */
  startEventId?: number
}

export interface EventDetailProps {
  event: ParsedEvent
  agentMap: Map<string, Agent>
  /** For an event of a subagent: how that subagent was spawned. */
  spawnInfo?: SpawnInfo
  /** For a spawning tool row: the agent it spawned. */
  spawnedAgentId?: string | null
  /** For a spawning tool row: how that agent was spawned (carries its SubagentStart id). */
  spawnedInfo?: SpawnInfo
  /** For a tool row: the PreToolUse / PostToolUse payload pair. */
  pairedPayloads?: PairedPayloads
}
