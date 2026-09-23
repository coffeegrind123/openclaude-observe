// Shared helpers + visual vocabulary for the instructions browser.

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { Bot, FolderGit2, Home } from 'lucide-react'
import {
  EFFECTIVE_TOKEN_WARN,
  FILE_TOKEN_WARN,
  THINKING_LEVELS,
  type InstructionsFileHeader,
  type InstructionsFileRole,
  type InstructionsGraph,
  type InstructionsGraphEdge,
  type InstructionsGraphNode,
  type InstructionsStore,
  type InstructionsStoreKind,
} from '@/types/instructions'

/** Same estimate as the server: characters / 4. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/** `1234` → `1.2k`; small numbers stay exact. */
export function formatTokens(n: number): string {
  if (n < 1000) {
    return String(n)
  }
  if (n < 10_000) {
    return `${(n / 1000).toFixed(1)}k`
  }
  return `${Math.round(n / 1000)}k`
}

/**
 * What a file costs. Context/system files are sent whole on every request;
 * for a subagent definition only the body is its system prompt (frontmatter
 * is configuration), paid each time that subagent runs.
 */
export function fileCost(file: { role: InstructionsFileRole; tokens: number; bodyTokens: number }) {
  return file.role === 'agent' ? file.bodyTokens : file.tokens
}

export function isOverFileBudget(file: {
  role: InstructionsFileRole
  tokens: number
  bodyTokens: number
}): boolean {
  return fileCost(file) > FILE_TOKEN_WARN
}

export function relativeTime(ts: number | null): string {
  if (!ts) {
    return '—'
  }
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) {
    return 'just now'
  }
  if (mins < 60) {
    return `${mins}m ago`
  }
  const hours = Math.floor(mins / 60)
  if (hours < 24) {
    return `${hours}h ago`
  }
  const days = Math.floor(hours / 24)
  if (days < 30) {
    return `${days}d ago`
  }
  return new Date(ts).toLocaleDateString()
}

export const ROLE_LABEL: Record<InstructionsFileRole, string> = {
  context: 'context',
  system: 'system prompt',
  'append-system': 'appended prompt',
  agent: 'subagent',
}

/** Tailwind classes for a role badge. */
export function roleBadgeClass(role: InstructionsFileRole): string {
  switch (role) {
    case 'context':
      return 'bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/30'
    case 'system':
      return 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30'
    case 'append-system':
      return 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30'
    case 'agent':
      return 'bg-violet-500/15 text-violet-600 dark:text-violet-400 border-violet-500/30'
  }
}

/** Literal colors mirroring roleBadgeClass (Tailwind *-500) for the canvas graph. */
export function roleColorHex(role: InstructionsFileRole): string {
  switch (role) {
    case 'context':
      return '#0ea5e9'
    case 'system':
      return '#f43f5e'
    case 'append-system':
      return '#f59e0b'
    case 'agent':
      return '#8b5cf6'
  }
}

export const EDGE_LABEL: Record<InstructionsGraphEdge['kind'], string> = {
  wikilink: '[[wikilink]]',
  mdlink: 'markdown link',
  agent: 'agent reference',
}

export function edgeColorHex(kind: InstructionsGraphEdge['kind']): string {
  switch (kind) {
    case 'wikilink':
      return '#38bdf8'
    case 'mdlink':
      return '#34d399'
    case 'agent':
      return '#a78bfa'
  }
}

export const STORE_KIND_LABEL: Record<InstructionsStoreKind, string> = {
  home: 'pi home',
  'home-agents': 'subagents',
  project: 'project',
}

export const STORE_KIND_ICON: Record<InstructionsStoreKind, typeof FolderGit2> = {
  home: Home,
  'home-agents': Bot,
  project: FolderGit2,
}

/**
 * Whether a store's standing cost is over budget. Agent definitions are paid
 * per subagent run, not per request, so the agents store is never flagged.
 */
export function storeOverBudget(store: InstructionsStore): boolean {
  return store.kind !== 'home-agents' && store.tokens > EFFECTIVE_TOKEN_WARN
}

/** Secondary label for a store: its directory, relative to the home where that helps. */
export function storeSubtitle(store: InstructionsStore): string {
  if (store.kind === 'home') {
    return '.pi/agent'
  }
  if (store.kind === 'home-agents') {
    return '.pi/agent/agents'
  }
  return store.cwd ?? store.dir
}

/** Relative dirs whose *.md files are subagent definitions, per store kind. */
export function agentDirsFor(kind: InstructionsStoreKind): string[] {
  switch (kind) {
    case 'home':
      return []
    case 'home-agents':
      return ['']
    case 'project':
      return ['.pi/agents', '.agents/agents']
  }
}

/** The stem (basename without .md) used to resolve a wikilink. */
export function fileStem(relPath: string): string {
  const base = relPath.split('/').pop() ?? relPath
  return base.replace(/\.md$/i, '')
}

/** Graph node id for a file — must match the server's nodeId(). */
export function nodeId(storeId: string, relPath: string): string {
  return `${storeId}::${relPath}`
}

export interface LinkRef {
  node: InstructionsGraphNode
  kind: InstructionsGraphEdge['kind']
}

/** Outgoing + incoming links for a file, resolved against the cross-store graph. */
export function linksFor(
  graph: InstructionsGraph | undefined,
  id: string,
): { outgoing: LinkRef[]; incoming: LinkRef[]; broken: string[] } {
  if (!graph) {
    return { outgoing: [], incoming: [], broken: [] }
  }
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  const outgoing: LinkRef[] = []
  const incoming: LinkRef[] = []
  for (const e of graph.edges) {
    if (e.source === id) {
      const node = byId.get(e.target)
      if (node) {
        outgoing.push({ node, kind: e.kind })
      }
    } else if (e.target === id) {
      const node = byId.get(e.source)
      if (node) {
        incoming.push({ node, kind: e.kind })
      }
    }
  }
  return { outgoing, incoming, broken: byId.get(id)?.broken ?? [] }
}

/** Split full file content into raw frontmatter text + body (client-side mirror). */
export function splitContent(content: string): { frontmatterRaw: string | null; body: string } {
  const m = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/)
  if (!m) {
    return { frontmatterRaw: null, body: content }
  }
  return { frontmatterRaw: m[1], body: content.slice(m[0].length) }
}

/**
 * Compose raw file text from a frontmatter object + body — must match the
 * server's composeFile() so round-tripping form↔raw is stable. lineWidth 0
 * because pi-subagents-lite can't read folded continuation lines.
 */
export function composeContent(frontmatter: Record<string, unknown> | null, body: string): string {
  const hasKeys = frontmatter && Object.keys(frontmatter).length > 0
  const normalizedBody = body.replace(/^\n+/, '')
  if (!hasKeys) {
    return normalizedBody.endsWith('\n') || normalizedBody === ''
      ? normalizedBody
      : normalizedBody + '\n'
  }
  const yaml = stringifyYaml(frontmatter, { lineWidth: 0 }).trimEnd()
  const out = `---\n${yaml}\n---\n\n${normalizedBody}`
  return out.endsWith('\n') ? out : out + '\n'
}

/**
 * Parse raw file text into { frontmatter, body }. Returns frontmatter=null
 * when absent or unparseable so the caller can keep the user in raw mode.
 */
export function parseContent(content: string): {
  frontmatter: Record<string, unknown> | null
  body: string
  error: boolean
} {
  const { frontmatterRaw, body } = splitContent(content)
  if (frontmatterRaw == null) {
    return { frontmatter: null, body, error: false }
  }
  try {
    const parsed = parseYaml(frontmatterRaw)
    if (parsed == null) {
      return { frontmatter: {}, body, error: false }
    }
    if (typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { frontmatter: parsed as Record<string, unknown>, body, error: false }
    }
    return { frontmatter: null, body, error: true }
  } catch {
    return { frontmatter: null, body, error: true }
  }
}

// ── Subagent frontmatter (pi-subagents-lite parseAgentFile) ──────────────────

/**
 * How pi-subagents-lite reads `tools` / `extensions` / `skills` (and the
 * exclude_* twins): `true|all` → everything, `false|none` → nothing, a list
 * or comma string → exactly those names, absent → inherit the default.
 */
export type ListFieldMode = 'unset' | 'all' | 'none' | 'list'

export function readListField(v: unknown): { mode: ListFieldMode; items: string[] } {
  if (v === undefined || v === null || v === '') {
    return { mode: 'unset', items: [] }
  }
  if (v === true || v === 'true' || v === 'all') {
    return { mode: 'all', items: [] }
  }
  if (v === false || v === 'false' || v === 'none') {
    return { mode: 'none', items: [] }
  }
  if (Array.isArray(v)) {
    return { mode: 'list', items: v.map((x) => String(x)).filter(Boolean) }
  }
  if (typeof v === 'string') {
    const items = v
      .split(',')
      .map((s) =>
        s
          .trim()
          .replace(/^\[|\]$/g, '')
          .trim(),
      )
      .filter(Boolean)
    return { mode: 'list', items }
  }
  return { mode: 'unset', items: [] }
}

/** Frontmatter value for a list field; undefined means "remove the key". */
export function writeListField(mode: ListFieldMode, items: string[]): unknown {
  switch (mode) {
    case 'unset':
      return undefined
    case 'all':
      return true
    case 'none':
      return false
    case 'list':
      return items.length ? items : undefined
  }
}

/** Agent-definition keys pi-subagents-lite reads. */
export const AGENT_KEYS = [
  'name',
  'display_name',
  'description',
  'tools',
  'exclude_tools',
  'extensions',
  'exclude_extensions',
  'skills',
  'preload_skills',
  'model',
  'thinking',
  'max_turns',
  'max_tokens',
  'hidden',
  'output_transcript',
  'include_context_files',
  'include_system_prompt',
  'include_environment',
] as const

const BOOLEAN_KEYS = [
  'hidden',
  'output_transcript',
  'include_context_files',
  'include_system_prompt',
  'include_environment',
] as const

/**
 * Problems pi-subagents-lite would hit reading this definition. Its
 * frontmatter parser is line-based (flat `key: value` and `- item` only), so
 * YAML that is valid but structured differently is silently misread.
 */
export function agentIssues(
  frontmatter: Record<string, unknown> | null,
  frontmatterRaw: string | null,
): string[] {
  const issues: string[] = []
  if (!frontmatter || typeof frontmatter.name !== 'string' || !frontmatter.name.trim()) {
    issues.push('No `name:` — pi-subagents-lite skips definitions without one.')
  }
  if (!frontmatter) {
    return issues
  }
  const thinking = frontmatter.thinking
  if (
    thinking !== undefined &&
    !(typeof thinking === 'string' && (THINKING_LEVELS as readonly string[]).includes(thinking))
  ) {
    issues.push(
      `\`thinking: ${String(thinking)}\` is not one of ${THINKING_LEVELS.join(', ')}; it is ignored.`,
    )
  }
  for (const key of ['max_turns', 'max_tokens']) {
    const v = frontmatter[key]
    if (
      v !== undefined &&
      !(typeof v === 'number' || (typeof v === 'string' && v !== '' && !Number.isNaN(Number(v))))
    ) {
      issues.push(`\`${key}\` must be a number.`)
    }
  }
  for (const key of BOOLEAN_KEYS) {
    const v = frontmatter[key]
    if (v !== undefined && v !== true && v !== false && v !== 'true' && v !== 'false') {
      issues.push(`\`${key}\` must be true or false.`)
    }
  }
  if (frontmatterRaw) {
    if (/:\s*[|>][+-]?\s*$/m.test(frontmatterRaw)) {
      issues.push(
        'Block scalars (`|` / `>`) are not supported by the agent parser — keep values on one line.',
      )
    }
    if (/^[ \t]+[A-Za-z_][\w-]*\s*:/m.test(frontmatterRaw)) {
      issues.push(
        'Nested keys are not supported by the agent parser — only flat `key: value` and `- item` lists.',
      )
    }
  }
  return issues
}

/** File-list order: existing first, then by role, then path. */
export function sortHeaders(files: InstructionsFileHeader[]): InstructionsFileHeader[] {
  const rank: Record<InstructionsFileRole, number> = {
    context: 0,
    system: 1,
    'append-system': 2,
    agent: 3,
  }
  return [...files].sort((a, b) => {
    if (a.exists !== b.exists) {
      return a.exists ? -1 : 1
    }
    return rank[a.role] - rank[b.role] || a.relPath.localeCompare(b.relPath)
  })
}

/** Starter content for a new file of the given role. */
export function templateFor(
  role: InstructionsFileRole,
  agentName?: string,
): { frontmatter: Record<string, unknown>; body: string } | { content: string } {
  switch (role) {
    case 'context':
      return { content: '# Instructions\n\n' }
    case 'system':
      return { content: 'You are an expert coding assistant.\n' }
    case 'append-system':
      return { content: '' }
    case 'agent': {
      const name = agentName || 'agent'
      return {
        frontmatter: { name, description: `What ${name} does, in one line` },
        body: `You are ${name}.\n`,
      }
    }
  }
}

/** Normalise a posix path: collapse `.`/`..`/empty segments. Absolute in, absolute out. */
export function normalizePosix(p: string): string {
  const abs = p.startsWith('/')
  const out: string[] = []
  for (const seg of p.split('/')) {
    if (!seg || seg === '.') {
      continue
    }
    if (seg === '..') {
      out.pop()
      continue
    }
    out.push(seg)
  }
  return (abs ? '/' : '') + out.join('/')
}

/**
 * Resolve a markdown link written in `fromRelPath` (inside `fromStore`) to
 * an existing graph node in any store, the same way the server resolves md
 * links: relative to the linking file's directory, absolute paths as-is.
 */
export function resolveMdHref(
  href: string,
  fromStore: InstructionsStore,
  fromRelPath: string,
  stores: InstructionsStore[],
  nodes: InstructionsGraphNode[],
): InstructionsGraphNode | undefined {
  let target = href.replace(/#.*$/, '').replace(/^<|>$/g, '')
  try {
    target = decodeURI(target)
  } catch {
    // keep as written
  }
  const fromDir = normalizePosix(`${fromStore.dir}/${fromRelPath}`).replace(/\/[^/]*$/, '')
  const abs = target.startsWith('/')
    ? normalizePosix(target)
    : normalizePosix(`${fromDir}/${target}`)
  for (const store of stores) {
    const root = normalizePosix(store.dir)
    if (!abs.startsWith(root + '/')) {
      continue
    }
    const rel = abs.slice(root.length + 1)
    const hit = nodes.find((n) => n.storeId === store.id && n.relPath === rel)
    if (hit) {
      return hit
    }
  }
  return undefined
}
