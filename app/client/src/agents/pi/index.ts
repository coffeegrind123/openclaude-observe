import type { AgentClass } from '../types'
import {
  piBadges,
  piChat,
  piIconId,
  piIdentity,
  piIsFailure,
  piLabel,
  piProse,
  piSpawnLink,
  piSummary,
  piSummaryTag,
  piToolLabel,
} from './describe'
import { SPAWN_TOOLS } from './tools'
import { PiEventDetail } from './event-detail'
import { piStatsProvider } from './stats'

/** pi (pi.dev) via the instantcoffee observe extension — see docs/pi-protocol.md. */
export const piClass: AgentClass = {
  id: 'pi',
  displayName: 'pi',
  label: piLabel,
  toolLabel: piToolLabel,
  summary: piSummary,
  summaryTag: piSummaryTag,
  prose: piProse,
  iconId: piIconId,
  isFailure: piIsFailure,
  badges: piBadges,
  chat: piChat,
  spawnLink: piSpawnLink,
  identity: piIdentity,
  isSpawnTool: (toolName) => toolName != null && SPAWN_TOOLS.has(toolName),
  EventDetail: PiEventDetail,
  stats: piStatsProvider,
}
