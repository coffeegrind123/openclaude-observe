// Parser for pi session transcripts (session format v3).
//
//   <agentDir>/sessions/--<cwd>--/<iso>_<uuid>.jsonl
//
// Line 1 is the header {type:"session", version:3, id, timestamp, cwd}. Every
// other line is an entry {type, id, parentId, timestamp} and the entries form a
// TREE (/tree and /fork branch it). Stats count every entry on every branch:
// each assistant message is a request that was actually made and paid for,
// whichever branch it ended up on.
//
// Shapes verified against a real pi 0.85.1 session from the instantcoffee
// stack (__fixtures__/pi-session.jsonl):
//
//   message  {message: {role: "user"|"assistant"|"toolResult"|..., ...}}
//     assistant: usage {input, output, cacheRead, cacheWrite, reasoning,
//                totalTokens, cost{total}}, model, provider, stopReason,
//                responseId, content[] incl. {type:"toolCall", id, name, arguments}
//     toolResult: toolCallId, toolName, isError, details, timestamp (ms)
//   custom   {customType:"subagent-turn", data:{agentId, shortId, agentType,
//             phase:"brief"|"turn"|"done"|..., description?, lines[]}}
//   model_change, thinking_level_change, compaction, branch_summary, label,
//   session_info — carried but not needed for stats.
//
// Subagents never get a transcript of their own (pi-subagents-lite runs them
// on SessionManager.inMemory). What survives is the parent's Agent/SubAgent
// tool result, whose `details` carry the child's totals, plus the
// `subagent-turn` entries, whose "brief" names the child's id.

import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import type {
  AgentParseResult,
  TranscriptCall,
  TranscriptSubagent,
  TranscriptToolStat,
  TranscriptUsage,
} from '../types'

const SPAWN_TOOLS = new Set(['Agent', 'SubAgent'])
const READ_TOOLS = new Set(['read'])
const EDIT_TOOLS = new Set(['edit', 'write'])
const SHELL_TOOLS = new Set(['bash'])
// `git [global options] commit`, where -C and -c take a value: `git -C repo commit`.
const GIT_COMMIT_REGEX = /\bgit\s+(?:(?:-C|-c)\s+\S+\s+|--?[\w-]+(?:=\S+)?\s+)*commit\b/

interface Entry {
  type: string
  id: string | null
  parentId: string | null
  timestamp: number
  raw: any
}

interface ToolUse {
  id: string
  name: string
  timestamp: number
  args: Record<string, unknown>
  assistantEntryId: string | null
}

function toMs(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string') {
    const t = Date.parse(value)
    return Number.isNaN(t) ? 0 : t
  }
  return 0
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

function textOf(content: unknown): string {
  if (typeof content === 'string') {
    return content
  }
  if (!Array.isArray(content)) {
    return ''
  }
  return content
    .filter((b: any) => b?.type === 'text' && typeof b.text === 'string')
    .map((b: any) => b.text as string)
    .join('\n')
}

function usageOf(u: any): TranscriptUsage {
  // pi reports input EXCLUDING cache hits (forge_cached_tokens.py splits them
  // out), matching the Claude convention the rest of the stats code assumes.
  return {
    inputTokens: num(u?.input),
    outputTokens: num(u?.output),
    cacheReadTokens: num(u?.cacheRead),
    cacheCreate5mTokens: num(u?.cacheWrite),
    cacheCreate1hTokens: num(u?.cacheWrite1h),
  }
}

async function readEntries(path: string): Promise<{ entries: Entry[]; badLines: number }> {
  const entries: Entry[] = []
  let badLines = 0
  const rl = createInterface({
    input: createReadStream(path, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  })
  for await (const line of rl) {
    if (!line.trim()) {
      continue
    }
    let raw: any
    try {
      raw = JSON.parse(line)
    } catch {
      badLines++
      continue
    }
    if (!raw || typeof raw.type !== 'string') {
      badLines++
      continue
    }
    entries.push({
      type: raw.type,
      id: typeof raw.id === 'string' ? raw.id : null,
      parentId: typeof raw.parentId === 'string' ? raw.parentId : null,
      timestamp: toMs(raw.timestamp),
      raw,
    })
  }
  return { entries, badLines }
}

export async function parsePiSession(mainJsonlPath: string): Promise<AgentParseResult> {
  const { entries, badLines } = await readEntries(mainJsonlPath)
  const errors: AgentParseResult['errors'] = []
  if (badLines > 0) {
    errors.push({
      scope: 'main',
      code: 'parse_error',
      message: `${badLines} unparseable line(s) in ${mainJsonlPath}`,
    })
  }

  const byId = new Map<string, Entry>()
  for (const e of entries) {
    if (e.id) {
      byId.set(e.id, e)
    }
  }

  // The prompt an entry answers: its nearest user-message ancestor. Memoised
  // because every entry walks the same chains.
  const promptOf = new Map<string, string | null>()
  const isUserMessage = (e: Entry) => e.type === 'message' && e.raw.message?.role === 'user'
  function resolvePrompt(start: Entry): string | null {
    const trail: string[] = []
    let cur: Entry | undefined = start
    let found: string | null = null
    while (cur) {
      if (cur.id && promptOf.has(cur.id)) {
        found = promptOf.get(cur.id) ?? null
        break
      }
      if (isUserMessage(cur)) {
        found = cur.id
        break
      }
      if (cur.id) {
        trail.push(cur.id)
      }
      cur = cur.parentId ? byId.get(cur.parentId) : undefined
    }
    for (const id of trail) {
      promptOf.set(id, found)
    }
    return found
  }

  const calls: TranscriptCall[] = []
  const prompts: AgentParseResult['prompts'] = {}
  const lastTimestampByPromptId: Record<string, number> = {}
  const toolUses = new Map<string, ToolUse>()
  const toolResults = new Map<
    string,
    { timestamp: number; isError: boolean; details: any; name: string }
  >()
  const briefs: Array<{
    agentId: string
    agentType: string | null
    description: string | null
    parentId: string | null
  }> = []
  let firstTs = Infinity
  let lastTs = 0
  let userPrompts = 0

  for (const e of entries) {
    if (e.type === 'session') {
      continue
    }
    if (e.timestamp > 0) {
      firstTs = Math.min(firstTs, e.timestamp)
      lastTs = Math.max(lastTs, e.timestamp)
    }

    const promptId = resolvePrompt(e)
    if (promptId && e.timestamp > 0) {
      lastTimestampByPromptId[promptId] = Math.max(
        lastTimestampByPromptId[promptId] ?? 0,
        e.timestamp,
      )
    }

    if (
      e.type === 'custom' &&
      e.raw.customType === 'subagent-turn' &&
      e.raw.data?.phase === 'brief'
    ) {
      const d = e.raw.data
      briefs.push({
        agentId: String(d.agentId ?? d.shortId ?? ''),
        agentType: typeof d.agentType === 'string' ? d.agentType : null,
        description: typeof d.description === 'string' ? d.description : null,
        parentId: e.parentId,
      })
      continue
    }

    if (e.type !== 'message') {
      continue
    }
    const msg = e.raw.message ?? {}

    if (msg.role === 'user') {
      userPrompts++
      if (e.id) {
        // pi has no slash-command expansion lines, so command is always null.
        prompts[e.id] = { text: textOf(msg.content), timestamp: e.timestamp, command: null }
      }
      continue
    }

    if (msg.role === 'assistant') {
      const toolUseIds: string[] = []
      for (const block of Array.isArray(msg.content) ? msg.content : []) {
        if (block?.type !== 'toolCall' || typeof block.id !== 'string') {
          continue
        }
        toolUseIds.push(block.id)
        toolUses.set(block.id, {
          id: block.id,
          name: String(block.name ?? 'unknown'),
          timestamp: e.timestamp,
          args: block.arguments && typeof block.arguments === 'object' ? block.arguments : {},
          assistantEntryId: e.id,
        })
      }
      // A message with no usage never reached the provider (aborted before
      // the request, or a local placeholder) — not a request.
      if (!msg.usage) {
        continue
      }
      calls.push({
        costUsd: typeof msg.usage.cost?.total === 'number' ? msg.usage.cost.total : null,
        messageId: String(msg.responseId ?? e.id ?? `line-${calls.length}`),
        requestId: typeof msg.responseId === 'string' ? msg.responseId : null,
        timestamp: e.timestamp,
        model: String(msg.model ?? 'unknown'),
        isSidechain: false,
        serviceTier: null,
        stopReason: typeof msg.stopReason === 'string' ? msg.stopReason : null,
        usage: usageOf(msg.usage),
        toolUseIds,
        promptId,
      })
      continue
    }

    if (msg.role === 'toolResult' && typeof msg.toolCallId === 'string') {
      toolResults.set(msg.toolCallId, {
        timestamp: toMs(msg.timestamp) || e.timestamp,
        isError: msg.isError === true,
        details: msg.details,
        name: String(msg.toolName ?? ''),
      })
    }
  }

  const tools = aggregateTools(toolUses, toolResults)
  const subagents = buildSubagents(toolUses, toolResults, briefs)

  return {
    calls,
    prompts,
    lastTimestampByPromptId,
    // Subagents link to prompts via toolUseId (the parent's Agent call);
    // there is no raw promptId → uuid indirection in pi transcripts.
    promptIdToUuid: {},
    subagents,
    errors,
    startedAt: Number.isFinite(firstTs) ? firstTs : null,
    durationMs: Number.isFinite(firstTs) && lastTs >= firstTs ? lastTs - firstTs : null,
    toolCalls: tools.toolCalls,
    filesRead: tools.filesRead,
    filesEdited: tools.filesEdited,
    gitCommits: tools.gitCommits,
    toolStats: tools.toolStats,
    userPrompts,
  }
}

function aggregateTools(
  uses: Map<string, ToolUse>,
  results: Map<string, { timestamp: number }>,
): Pick<AgentParseResult, 'toolCalls' | 'filesRead' | 'filesEdited' | 'gitCommits' | 'toolStats'> {
  const filesRead = new Set<string>()
  const filesEdited = new Set<string>()
  let gitCommits = 0
  const perTool = new Map<
    string,
    { count: number; durations: number[]; longestMs: number; longestId: string | null }
  >()

  for (const use of uses.values()) {
    const path = typeof use.args.path === 'string' ? use.args.path : null
    if (READ_TOOLS.has(use.name) && path) {
      filesRead.add(path)
    } else if (EDIT_TOOLS.has(use.name) && path) {
      filesEdited.add(path)
    } else if (SHELL_TOOLS.has(use.name) && typeof use.args.command === 'string') {
      if (GIT_COMMIT_REGEX.test(use.args.command)) {
        gitCommits++
      }
    }

    const acc = perTool.get(use.name) ?? { count: 0, durations: [], longestMs: 0, longestId: null }
    acc.count++
    // The assistant entry is written when the message finishes streaming, which
    // is when execution starts; the result entry when it ends.
    const end = results.get(use.id)?.timestamp
    if (end && end > use.timestamp) {
      const dur = end - use.timestamp
      acc.durations.push(dur)
      if (dur > acc.longestMs) {
        acc.longestMs = dur
        acc.longestId = use.id
      }
    }
    perTool.set(use.name, acc)
  }

  const toolStats: TranscriptToolStat[] = [...perTool.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .map(([name, acc]) => {
      const d = acc.durations.slice().sort((a, b) => a - b)
      const mid = Math.floor(d.length / 2)
      return {
        name,
        count: acc.count,
        minMs: d.length ? d[0] : null,
        medianMs:
          d.length === 0
            ? null
            : d.length % 2 === 0
              ? Math.round((d[mid - 1] + d[mid]) / 2)
              : d[mid],
        maxMs: d.length ? d[d.length - 1] : null,
        longestToolUseId: acc.longestId,
      }
    })

  return {
    toolCalls: uses.size,
    filesRead: filesRead.size,
    filesEdited: filesEdited.size,
    gitCommits,
    toolStats,
  }
}

function buildSubagents(
  uses: Map<string, ToolUse>,
  results: Map<string, { timestamp: number; details: any }>,
  briefs: Array<{
    agentId: string
    agentType: string | null
    description: string | null
    parentId: string | null
  }>,
): TranscriptSubagent[] {
  const unclaimed = [...briefs]
  const rows: TranscriptSubagent[] = []

  for (const use of uses.values()) {
    if (!SPAWN_TOOLS.has(use.name)) {
      continue
    }
    const details = results.get(use.id)?.details ?? {}
    const description = typeof use.args.description === 'string' ? use.args.description : null

    // The brief hangs off the assistant message that made the call; with
    // several calls in one message, the description tells them apart.
    const idx = unclaimed.findIndex(
      (b) =>
        b.parentId === use.assistantEntryId &&
        (!description || !b.description || b.description === description),
    )
    const brief = idx >= 0 ? unclaimed.splice(idx, 1)[0] : undefined

    const costUsd = typeof details.cost === 'number' ? details.cost : null
    rows.push({
      agentId: brief?.agentId || use.id,
      agentType:
        details.type ??
        brief?.agentType ??
        (typeof use.args.agent === 'string' ? use.args.agent : null),
      description: details.description ?? description,
      toolUseId: use.id,
      originPromptId: null,
      model: String(details.modelId ?? 'unknown'),
      requests: num(details.turnCount),
      inputTokens: num(details.input),
      outputTokens: num(details.output),
      cacheReadTokens: 0,
      cacheCreate5mTokens: 0,
      cacheCreate1hTokens: 0,
      durationMs: num(details.durationMs),
      toolCount: num(details.toolUses),
      costCents: costUsd === null ? null : costUsd * 100,
    })
  }
  return rows
}
