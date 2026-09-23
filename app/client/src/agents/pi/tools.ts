// pi tool shapes, taken from the tool definitions pi 0.85.1 ships
// (dist/core/tools/*.d.ts), pi-subagents-lite (registration.ts,
// agents/tool-execution.ts) and pi-mcp-adapter 2.26 (index.ts). The observe
// extension forwards `tool_input` verbatim and flattens the result to
// `tool_response: { content: <joined text blocks>, details }`.

import { num, obj, oneLine, relPath, str, summarizeArgs, type Payload } from '../payload'
import { extractBashBinary } from '@/lib/bash-binary'

export type PiToolKind =
  | 'read'
  | 'bash'
  | 'edit'
  | 'write'
  | 'grep'
  | 'find'
  | 'ls'
  | 'spawn'
  | 'stop-agent'
  | 'agent-status'
  | 'mcp'
  | 'mcp-script'
  | 'browser'
  | 'other'

const BUILTIN_KINDS: Record<string, PiToolKind> = {
  read: 'read',
  bash: 'bash',
  edit: 'edit',
  write: 'write',
  grep: 'grep',
  find: 'find',
  ls: 'ls',
  // pi-subagents-lite: `Agent` for the operator's session, `SubAgent` for a
  // child allowed to delegate (SUBAGENT_MAX_DEPTH=2).
  Agent: 'spawn',
  SubAgent: 'spawn',
  StopAgent: 'stop-agent',
  AgentStatus: 'agent-status',
  // pi-mcp-adapter: the proxy tool and the script tool.
  mcp: 'mcp',
  mcpScript: 'mcp-script',
}

// pi-mcp-adapter registers a server's direct tools as `<server>_<tool>`; the
// instantcoffee stack's browser server is named `browser`.
const BROWSER_PREFIX = 'browser_'

export const SPAWN_TOOLS: ReadonlySet<string> = new Set(['Agent', 'SubAgent'])

export function piToolKind(toolName: string | null | undefined): PiToolKind {
  if (!toolName) {
    return 'other'
  }
  const kind = BUILTIN_KINDS[toolName]
  if (kind) {
    return kind
  }
  if (toolName.startsWith(BROWSER_PREFIX)) {
    return 'browser'
  }
  return 'other'
}

/** Icon registry id for a pi tool. */
export function piToolIconId(toolName: string | null | undefined): string {
  const kind = piToolKind(toolName)
  if (kind === 'browser') {
    return 'browser'
  }
  if (kind === 'other' || !toolName) {
    return 'PreToolUse'
  }
  return toolName
}

// ── Tool result ─────────────────────────────────────────────────────

export interface PiToolResult {
  /** Joined text blocks of the result; images arrive as "[image <mime>]". */
  content: string
  details: Payload | null
}

export function toolResult(payload: Payload): PiToolResult | null {
  const r = obj(payload.tool_response)
  if (!r) {
    return null
  }
  return {
    content: typeof r.content === 'string' ? r.content : '',
    details: obj(r.details) ?? null,
  }
}

/** `details.truncation` (TruncationResult in pi's truncate.d.ts). */
export interface PiTruncation {
  truncated: boolean
  truncatedBy: 'lines' | 'bytes' | null
  totalLines?: number
  totalBytes?: number
  outputLines?: number
  outputBytes?: number
}

export function truncationOf(details: Payload | null): PiTruncation | null {
  const t = obj(details?.truncation)
  if (!t || t.truncated !== true) {
    return null
  }
  return {
    truncated: true,
    truncatedBy: t.truncatedBy === 'lines' || t.truncatedBy === 'bytes' ? t.truncatedBy : null,
    totalLines: num(t.totalLines),
    totalBytes: num(t.totalBytes),
    outputLines: num(t.outputLines),
    outputBytes: num(t.outputBytes),
  }
}

// ── read ────────────────────────────────────────────────────────────

// read appends one bracketed continuation notice after a blank line when it
// stops short of the end of the file (read.js: "[Showing lines X-Y of N…]",
// "[N more lines in file. Use offset=…]", "[Line N is …, exceeds … limit…]").
const READ_NOTICE_RE =
  /(?:^|\n\n)(\[(?:Showing lines |Line \d+ is |\d+ more lines in file)[^\n]*\])$/

export interface ReadOutput {
  content: string
  notice: string | null
}

export function splitReadOutput(text: string): ReadOutput {
  const m = READ_NOTICE_RE.exec(text)
  if (!m) {
    return { content: text, notice: null }
  }
  return { content: text.slice(0, m.index), notice: m[1] }
}

// grep / find / ls append their limit and truncation notices as one
// bracketed line after a blank line ("[100 matches limit reached. …]").
const TRAILING_NOTICE_RE = /\n\n(\[[^\n]*\])$/

export function splitNotice(text: string): ReadOutput {
  const m = TRAILING_NOTICE_RE.exec(text)
  if (!m) {
    return { content: text, notice: null }
  }
  return { content: text.slice(0, m.index), notice: m[1] }
}

// ── bash ────────────────────────────────────────────────────────────

// bash.js throws with the output plus one of these status lines appended
// after a blank line; success returns the output alone.
const BASH_STATUS_RE =
  /(?:^|\n\n)(Command exited with code (-?\d+)|Command timed out after (\d+) seconds|Command aborted)$/

export interface BashOutput {
  output: string
  exitCode: number | null
  status: 'ok' | 'exit' | 'timeout' | 'aborted' | 'error'
  statusLine: string | null
}

export function parseBashOutput(text: string, isError: boolean): BashOutput {
  const m = BASH_STATUS_RE.exec(text)
  if (!m) {
    return {
      output: text,
      exitCode: isError ? null : 0,
      status: isError ? 'error' : 'ok',
      statusLine: null,
    }
  }
  const output = text.slice(0, m.index).replace(/\n$/, '')
  if (m[2] != null) {
    return { output, exitCode: Number(m[2]), status: 'exit', statusLine: m[1] }
  }
  if (m[3] != null) {
    return { output, exitCode: null, status: 'timeout', statusLine: m[1] }
  }
  return { output, exitCode: null, status: 'aborted', statusLine: m[1] }
}

// ── edit ────────────────────────────────────────────────────────────

export interface PiEdit {
  oldText: string
  newText: string
}

/**
 * `edits[]` of `{ oldText, newText }`. Also folds in the legacy top-level
 * `oldText`/`newText` pair the same way pi's prepareEditArguments does, for
 * inputs recorded before argument preparation.
 */
export function editsOf(input: Payload | undefined): PiEdit[] {
  if (!input) {
    return []
  }
  const out: PiEdit[] = []
  if (Array.isArray(input.edits)) {
    for (const e of input.edits) {
      const edit = obj(e)
      if (edit && typeof edit.oldText === 'string' && typeof edit.newText === 'string') {
        out.push({ oldText: edit.oldText, newText: edit.newText })
      }
    }
  }
  if (typeof input.oldText === 'string' && typeof input.newText === 'string') {
    out.push({ oldText: input.oldText, newText: input.newText })
  }
  return out
}

// ── mcp ─────────────────────────────────────────────────────────────

/** pi-mcp-adapter's `mcp` proxy tool picks its mode from which argument is set. */
export function mcpCallSummary(input: Payload | undefined): string {
  if (!input) {
    return ''
  }
  const server = str(input.server)
  const tool = str(input.tool)
  if (tool) {
    const args = mcpArgs(input)
    const argText = args ? summarizeArgs(args) : ''
    return `${server ? `${server}/` : ''}${tool}${argText ? ` ${argText}` : ''}`
  }
  const search = str(input.search)
  if (search) {
    return `search "${search}"${server ? ` in ${server}` : ''}`
  }
  const describe = str(input.describe)
  if (describe) {
    return `describe ${describe}`
  }
  const connect = str(input.connect)
  if (connect) {
    return `connect ${connect}`
  }
  const instructions = str(input.instructions)
  if (instructions) {
    return `instructions ${instructions}`
  }
  const action = str(input.action)
  if (action) {
    return `${action}${server ? ` ${server}` : ''}`
  }
  return server ? `status ${server}` : 'status'
}

/** `args` may be an object or a JSON string encoding one. */
export function mcpArgs(input: Payload | undefined): Payload | null {
  const raw = input?.args
  if (typeof raw === 'string') {
    try {
      return obj(JSON.parse(raw)) ?? null
    } catch {
      return null
    }
  }
  return obj(raw) ?? null
}

// ── call summary ────────────────────────────────────────────────────

function lineRange(offset: number | undefined, limit: number | undefined): string {
  if (offset != null && limit != null) {
    return `lines ${offset}–${offset + limit - 1}`
  }
  if (offset != null) {
    return `from line ${offset}`
  }
  if (limit != null) {
    return `first ${limit} lines`
  }
  return ''
}

/** One-line description of a pi tool call from its input. */
export function toolCallSummary(
  toolName: string | null,
  input: Payload | undefined,
  cwd: string | undefined,
): string {
  if (!input) {
    return ''
  }
  switch (piToolKind(toolName)) {
    case 'read': {
      const range = lineRange(num(input.offset), num(input.limit))
      const path = relPath(str(input.path), cwd)
      return range ? `${path} · ${range}` : path
    }
    case 'bash': {
      const cmd = str(input.command) ?? ''
      const bin = extractBashBinary(cmd)
      const flat = cmd.replace(/\s*\n\s*/g, ' \\n ').trim()
      return bin ? `[${bin}] ${flat}` : flat
    }
    case 'edit': {
      const n = editsOf(input).length
      const path = relPath(str(input.path), cwd)
      return n > 0 ? `${path} · ${n} edit${n === 1 ? '' : 's'}` : path
    }
    case 'write': {
      const path = relPath(str(input.path), cwd)
      const content = typeof input.content === 'string' ? input.content : null
      if (content == null) {
        return path
      }
      const lines = content === '' ? 0 : content.split('\n').length
      return `${path} · ${lines} line${lines === 1 ? '' : 's'}`
    }
    case 'grep': {
      const pattern = str(input.pattern) ?? ''
      const path = str(input.path)
      const glob = str(input.glob)
      let out = `/${pattern}/${input.ignoreCase === true ? 'i' : ''}`
      if (path) {
        out += ` in ${relPath(path, cwd)}`
      }
      if (glob) {
        out += ` (${glob})`
      }
      return out
    }
    case 'find': {
      const pattern = str(input.pattern) ?? ''
      const path = str(input.path)
      return path ? `${pattern} in ${relPath(path, cwd)}` : pattern
    }
    case 'ls':
      return relPath(str(input.path), cwd) || '.'
    case 'spawn': {
      const agent = str(input.agent) ?? str(input._resolvedAgent)
      const what = str(input.description) ?? oneLine(str(input.prompt) ?? '')
      const bg = input.run_in_background === true ? ' (background)' : ''
      return agent ? `${agent} · ${what}${bg}` : `${what}${bg}`
    }
    case 'stop-agent':
      return `stop ${str(input.agent_id) ?? '?'}`
    case 'agent-status':
      return 'agent status'
    case 'mcp':
      return mcpCallSummary(input)
    case 'mcp-script': {
      const code = str(input.code) ?? ''
      const first = code.split('\n').find((l) => l.trim().length > 0) ?? ''
      return first.trim()
    }
    case 'browser':
    case 'other':
      return summarizeArgs(input)
  }
}
