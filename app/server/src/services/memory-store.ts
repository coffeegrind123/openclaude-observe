// Core logic for the memory browser/editor: discover stores, list + read +
// write + create + delete the markdown files that make up OpenClaude's
// file-based memory. The filesystem is the source of truth — these functions
// are thin, careful wrappers over fs with frontmatter parsing layered on top.

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { config } from '../config'
import {
  AGENT_MEM_DIRNAME,
  AUTO_MEM_DIRNAME,
  GLOBAL_INSTRUCTION_FILES,
  MemoryPathError,
  MemoryStoreDescriptor,
  PROJECTS_DIRNAME,
  getMemoryRoot,
  isSafeSegment,
  resolveStore,
  resolveWithin,
  slugFromTranscriptPath,
} from './memory-paths'
import { withMemoryLock } from './memory-lock'

// ── DTOs ────────────────────────────────────────────────────────────────

export interface MemoryStoreDTO {
  id: string
  kind: 'project' | 'global' | 'agent'
  /** Display label (project name when correlated, else slug / type). */
  label: string
  slug?: string
  agentType?: string
  /** Correlated observe project (when a matching project exists in the DB). */
  projectName?: string | null
  projectSlug?: string | null
  projectId?: number | null
  fileCount: number
  totalBytes: number
  lastModifiedMs: number | null
}

/** Frontmatter header fields surfaced in list/card views. */
export interface MemoryHeaderFields {
  name?: string
  description?: string
  type?: string
  status?: string
  provenance?: string
  /** Files this memory replaces (frontmatter `supersedes:`). */
  supersedes?: string[]
  /** Originating session UUID (created_by_session / metadata.originSessionId). */
  sessionId?: string
}

export interface MemoryFileHeaderDTO extends MemoryHeaderFields {
  /** Path relative to the store dir, posix-style. */
  relPath: string
  name: string
  bytes: number
  mtimeMs: number
  isIndex: boolean
  hasFrontmatter: boolean
  title: string
  snippet: string
  /** Outgoing [[wikilink]] target stems found in body + frontmatter. */
  links: string[]
}

export interface MemoryFileDTO {
  storeId: string
  relPath: string
  name: string
  bytes: number
  mtimeMs: number
  isIndex: boolean
  /** Full raw file contents (frontmatter + body). */
  content: string
  /** Parsed frontmatter object, or null when absent/unparseable. */
  frontmatter: Record<string, unknown> | null
  /** Raw frontmatter YAML text (between the --- fences), or null. */
  frontmatterRaw: string | null
  /** Body markdown after the frontmatter block. */
  body: string
  /** True when a frontmatter block exists but failed to parse as YAML. */
  frontmatterError: boolean
}

// ── Frontmatter ─────────────────────────────────────────────────────────

const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*\n?/

interface SplitFile {
  hasFrontmatter: boolean
  frontmatterRaw: string | null
  body: string
}

function splitFrontmatter(content: string): SplitFile {
  const m = content.match(FRONTMATTER_RE)
  if (!m) return { hasFrontmatter: false, frontmatterRaw: null, body: content }
  return {
    hasFrontmatter: true,
    frontmatterRaw: m[1],
    body: content.slice(m[0].length),
  }
}

function parseFrontmatter(raw: string | null): {
  data: Record<string, unknown> | null
  error: boolean
} {
  if (raw == null) return { data: null, error: false }
  try {
    const parsed = parseYaml(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { data: parsed as Record<string, unknown>, error: false }
    }
    // Scalar / list frontmatter is technically valid YAML but not a memory
    // header shape — surface it as a parse error so the raw editor takes over.
    return { data: null, error: true }
  } catch {
    return { data: null, error: true }
  }
}

function headerFields(data: Record<string, unknown> | null): MemoryHeaderFields {
  if (!data) return {}
  const str = (v: unknown) => (typeof v === 'string' ? v : undefined)
  // OpenClaude's auto-memory nests type/status/provenance under a `metadata:`
  // object; the flat memdir schema puts them top-level. Read either — prefer
  // top-level, fall back to metadata.*.
  const meta =
    data.metadata && typeof data.metadata === 'object' && !Array.isArray(data.metadata)
      ? (data.metadata as Record<string, unknown>)
      : null
  const pick = (key: string) => str(data[key]) ?? (meta ? str(meta[key]) : undefined)
  const asList = (v: unknown): string[] | undefined => {
    if (Array.isArray(v)) {
      const out = v.map(str).filter((s): s is string => !!s)
      return out.length ? out : undefined
    }
    const s = str(v)
    return s ? [s] : undefined
  }
  const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
  const sessionRaw = pick('created_by_session') ?? (meta ? str(meta.originSessionId) : undefined)
  const sessionMatch = sessionRaw?.match(UUID)
  return {
    name: str(data.name),
    description: str(data.description),
    type: pick('type'),
    status: pick('status'),
    provenance: pick('provenance'),
    supersedes: asList(data.supersedes ?? (meta ? meta.supersedes : undefined)),
    sessionId: sessionMatch ? sessionMatch[0] : undefined,
  }
}

function deriveTitle(fileName: string, header: MemoryHeaderFields, body: string): string {
  const h1 = body.match(/^#\s+(.+)$/m)
  if (h1) return h1[1].trim()
  if (header.name) return header.name
  return fileName.replace(/\.md$/, '')
}

const WIKILINK_RE = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g

/** Extract unique [[wikilink]] target stems from arbitrary text. */
export function extractWikilinks(text: string): string[] {
  const out = new Set<string>()
  for (const m of text.matchAll(WIKILINK_RE)) {
    const target = m[1].trim().replace(/\.md$/i, '')
    if (target) out.add(target)
  }
  return [...out]
}

function deriveSnippet(body: string): string {
  const text = body
    .replace(/^#.*$/gm, '')
    .replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, '$1')
    .replace(/[*_`>#-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text.slice(0, 200)
}

/**
 * Serialize a structured frontmatter object + body back into a memory file.
 * An empty/null frontmatter writes a body-only file (no `---` fences) — this
 * is how plain indexes like MEMORY.md round-trip.
 */
export function composeFile(
  frontmatter: Record<string, unknown> | null | undefined,
  body: string,
): string {
  const hasKeys = frontmatter && Object.keys(frontmatter).length > 0
  const normalizedBody = body.replace(/^\n+/, '')
  if (!hasKeys) {
    return normalizedBody.endsWith('\n') || normalizedBody === ''
      ? normalizedBody
      : normalizedBody + '\n'
  }
  const yaml = stringifyYaml(frontmatter).trimEnd()
  const out = `---\n${yaml}\n---\n\n${normalizedBody}`
  return out.endsWith('\n') ? out : out + '\n'
}

// ── FS helpers ──────────────────────────────────────────────────────────

async function dirExists(p: string): Promise<boolean> {
  try {
    const st = await fs.stat(p)
    return st.isDirectory()
  } catch {
    return false
  }
}

async function fileExists(p: string): Promise<boolean> {
  try {
    const st = await fs.stat(p)
    return st.isFile()
  } catch {
    return false
  }
}

/** Recursively collect *.md files under dir, returning posix relPaths. */
async function walkMarkdown(dir: string, maxFiles = 2000): Promise<string[]> {
  const out: string[] = []
  async function walk(current: string, prefix: string) {
    if (out.length >= maxFiles) return
    let entries: Awaited<ReturnType<typeof fs.readdir>>
    try {
      entries = await fs.readdir(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (out.length >= maxFiles) return
      // Skip OpenClaude bookkeeping dirs that aren't user-facing memory.
      if (entry.isDirectory()) {
        if (entry.name === '.locks' || entry.name === '.git' || entry.name === '.quarantine')
          continue
        await walk(path.join(current, entry.name), prefix ? `${prefix}/${entry.name}` : entry.name)
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        out.push(prefix ? `${prefix}/${entry.name}` : entry.name)
      }
    }
  }
  await walk(dir, '')
  return out
}

// ── Store discovery ───────────────────────────────────────────────────────

interface ProjectCorrelation {
  name: string
  slug: string | null
  id: number | null
}

/**
 * Build a slug → observe-project map from DB rows. The slug is the on-disk
 * `projects/<slug>` dir name, extracted from each project's transcript_path.
 */
export function buildProjectCorrelation(
  rows: Array<{ id?: number; name?: string; slug?: string; transcript_path?: string | null }>,
): Map<string, ProjectCorrelation> {
  const map = new Map<string, ProjectCorrelation>()
  for (const r of rows) {
    const slug = slugFromTranscriptPath(r.transcript_path)
    if (!slug) continue
    map.set(slug, { name: r.name ?? slug, slug: r.slug ?? null, id: r.id ?? null })
  }
  return map
}

async function summarizeStore(
  dir: string,
  allowlist?: string[],
): Promise<{ fileCount: number; totalBytes: number; lastModifiedMs: number | null }> {
  let relPaths = await walkMarkdown(dir)
  if (allowlist) relPaths = relPaths.filter((rp) => allowlist.includes(path.basename(rp)))
  let totalBytes = 0
  let lastModifiedMs: number | null = null
  for (const rp of relPaths) {
    try {
      const st = await fs.stat(path.join(dir, rp))
      totalBytes += st.size
      if (lastModifiedMs == null || st.mtimeMs > lastModifiedMs) lastModifiedMs = st.mtimeMs
    } catch {
      // ignore races
    }
  }
  return { fileCount: relPaths.length, totalBytes, lastModifiedMs }
}

/**
 * Discover every memory store available under the Claude config root:
 * per-project auto-memory dirs, the global instruction file, and per-type
 * agent memory. `projectRows` (from EventStore.getProjects) is used purely to
 * decorate project stores with friendly names + cross-links.
 */
export async function listStores(
  projectRows: Array<{
    id?: number
    name?: string
    slug?: string
    transcript_path?: string | null
  }> = [],
): Promise<MemoryStoreDTO[]> {
  const root = getMemoryRoot()
  if (!root) return []
  const correlation = buildProjectCorrelation(projectRows)
  const stores: MemoryStoreDTO[] = []

  // 1. Per-project auto-memory: projects/<slug>/memory
  const projectsDir = path.join(root, PROJECTS_DIRNAME)
  let projectSlugs: string[] = []
  try {
    const entries = await fs.readdir(projectsDir, { withFileTypes: true })
    projectSlugs = entries.filter((e) => e.isDirectory()).map((e) => e.name)
  } catch {
    projectSlugs = []
  }
  for (const slug of projectSlugs) {
    if (!isSafeSegment(slug)) continue
    const dir = path.join(projectsDir, slug, AUTO_MEM_DIRNAME)
    if (!(await dirExists(dir))) continue
    const summary = await summarizeStore(dir)
    const corr = correlation.get(slug)
    stores.push({
      id: `project:${slug}`,
      kind: 'project',
      label: corr?.name ?? prettifySlug(slug),
      slug,
      projectName: corr?.name ?? null,
      projectSlug: corr?.slug ?? null,
      projectId: corr?.id ?? null,
      ...summary,
    })
  }

  // 2. Global instruction file(s): ~/.claude/CLAUDE.md
  const presentGlobal: string[] = []
  for (const name of GLOBAL_INSTRUCTION_FILES) {
    if (await fileExists(path.join(root, name))) presentGlobal.push(name)
  }
  if (presentGlobal.length) {
    const summary = await summarizeStore(root, GLOBAL_INSTRUCTION_FILES)
    stores.push({
      id: 'global',
      kind: 'global',
      label: 'Global instructions',
      ...summary,
    })
  }

  // 3. Per-type agent memory: agent-memory/<type>
  const agentDir = path.join(root, AGENT_MEM_DIRNAME)
  let agentTypes: string[] = []
  try {
    const entries = await fs.readdir(agentDir, { withFileTypes: true })
    agentTypes = entries.filter((e) => e.isDirectory()).map((e) => e.name)
  } catch {
    agentTypes = []
  }
  for (const agentType of agentTypes) {
    if (!isSafeSegment(agentType)) continue
    const dir = path.join(agentDir, agentType)
    const summary = await summarizeStore(dir)
    if (summary.fileCount === 0) continue
    stores.push({
      id: `agent:${agentType}`,
      kind: 'agent',
      label: agentType,
      agentType,
      ...summary,
    })
  }

  // Stable ordering: projects (by label), then global, then agents.
  const order = { project: 0, global: 1, agent: 2 } as const
  stores.sort((a, b) => order[a.kind] - order[b.kind] || a.label.localeCompare(b.label))
  return stores
}

// ── Global cross-store search ───────────────────────────────────────────────

export interface MemorySearchHit {
  storeId: string
  storeLabel: string
  storeKind: 'project' | 'global' | 'agent'
  file: MemoryFileHeaderDTO
}

/**
 * Search file headers across every store. With an empty query, returns the
 * most-recently-modified files (for the command palette's initial list).
 */
export async function searchAll(
  query: string,
  projectRows: Array<{
    id?: number
    name?: string
    slug?: string
    transcript_path?: string | null
  }> = [],
  limit = 100,
): Promise<MemorySearchHit[]> {
  const root = getMemoryRoot()
  if (!root) return []
  const stores = await listStores(projectRows)
  const q = query.trim().toLowerCase()
  const hits: MemorySearchHit[] = []
  for (const s of stores) {
    const desc = resolveStore(s.id, root)
    if (!desc) continue
    const files = await listFiles(desc)
    for (const file of files) {
      const hay =
        `${file.title} ${file.name} ${file.description ?? ''} ${file.type ?? ''} ${file.snippet}`.toLowerCase()
      if (!q || hay.includes(q)) {
        hits.push({ storeId: s.id, storeLabel: s.label, storeKind: s.kind, file })
      }
    }
  }
  hits.sort((a, b) => b.file.mtimeMs - a.file.mtimeMs)
  return hits.slice(0, limit)
}

function prettifySlug(slug: string): string {
  // `-home-claudeuser-my-project` → `~/my-project`-ish. Best-effort display
  // only; the canonical id is always the raw slug.
  const cleaned = slug.replace(/^-+/, '')
  const parts = cleaned.split('-')
  return parts.length > 2 ? `…/${parts.slice(-2).join('-')}` : cleaned
}

// ── File listing + reading ─────────────────────────────────────────────────

export async function listFiles(store: MemoryStoreDescriptor): Promise<MemoryFileHeaderDTO[]> {
  let relPaths = await walkMarkdown(store.dir)
  if (store.allowlist) {
    relPaths = relPaths.filter((rp) => store.allowlist!.includes(path.basename(rp)))
  }
  const headers: MemoryFileHeaderDTO[] = []
  for (const relPath of relPaths) {
    const full = path.join(store.dir, relPath)
    let st
    try {
      st = await fs.stat(full)
    } catch {
      continue
    }
    let content = ''
    if (st.size <= config.memory.maxFileBytes) {
      try {
        content = await fs.readFile(full, 'utf8')
      } catch {
        content = ''
      }
    }
    const { hasFrontmatter, frontmatterRaw, body } = splitFrontmatter(content)
    const { data } = parseFrontmatter(frontmatterRaw)
    const header = headerFields(data)
    const baseName = path.basename(relPath)
    headers.push({
      // header (description/type/status/provenance) first so the explicit DTO
      // fields below win — notably `name`, which must stay the basename and not
      // be clobbered by a frontmatter `name:` field.
      ...header,
      relPath,
      name: baseName,
      bytes: st.size,
      mtimeMs: st.mtimeMs,
      isIndex: baseName === 'MEMORY.md',
      hasFrontmatter,
      title: deriveTitle(baseName, header, body),
      snippet: deriveSnippet(body),
      links: extractWikilinks(content),
    })
  }
  headers.sort((a, b) => {
    if (a.isIndex !== b.isIndex) return a.isIndex ? -1 : 1
    return b.mtimeMs - a.mtimeMs
  })
  return headers
}

export async function readFile(
  store: MemoryStoreDescriptor,
  relPath: string,
): Promise<MemoryFileDTO> {
  const full = resolveWithin(store.dir, relPath)
  const baseName = path.basename(full)
  if (store.allowlist && !store.allowlist.includes(baseName)) {
    throw new MemoryPathError('This file is not part of the store.')
  }
  const st = await fs.stat(full)
  if (st.size > config.memory.maxFileBytes) {
    throw new MemoryFileError('file_too_large', 'File exceeds the size cap.')
  }
  const content = await fs.readFile(full, 'utf8')
  const { hasFrontmatter, frontmatterRaw, body } = splitFrontmatter(content)
  const { data, error } = parseFrontmatter(frontmatterRaw)
  return {
    storeId: store.id,
    relPath,
    name: baseName,
    bytes: st.size,
    mtimeMs: st.mtimeMs,
    isIndex: baseName === 'MEMORY.md',
    content,
    frontmatter: data,
    frontmatterRaw: hasFrontmatter ? frontmatterRaw : null,
    body,
    frontmatterError: hasFrontmatter && error,
  }
}

// ── Writing ────────────────────────────────────────────────────────────────

function assertMarkdownName(name: string) {
  if (!isSafeSegment(name)) {
    throw new MemoryPathError('File names may only contain letters, digits, dot, dash, underscore.')
  }
  if (!name.toLowerCase().endsWith('.md')) {
    throw new MemoryPathError('File name must end in .md')
  }
}

export interface WritePayload {
  /** Raw full-file content (raw-editor save). Takes precedence when present. */
  content?: string
  /** Structured frontmatter object (structured-editor save). */
  frontmatter?: Record<string, unknown> | null
  /** Body markdown (structured-editor save). */
  body?: string
}

async function writeAtomic(full: string, text: string): Promise<void> {
  const dir = path.dirname(full)
  await fs.mkdir(dir, { recursive: true })
  const tmp = `${full}.tmp-${process.pid}-${Date.now()}`
  await fs.writeFile(tmp, text, 'utf8')
  await fs.rename(tmp, full)
}

/** Overwrite an existing file (or one being created via createFile). */
export async function writeFile(
  store: MemoryStoreDescriptor,
  relPath: string,
  payload: WritePayload,
): Promise<MemoryFileDTO> {
  const full = resolveWithin(store.dir, relPath)
  const baseName = path.basename(full)
  if (store.allowlist && !store.allowlist.includes(baseName)) {
    throw new MemoryPathError('This file is not writable in this store.')
  }
  assertMarkdownName(baseName)
  const text =
    typeof payload.content === 'string'
      ? payload.content
      : composeFile(payload.frontmatter, payload.body ?? '')
  if (Buffer.byteLength(text, 'utf8') > config.memory.maxFileBytes) {
    throw new MemoryFileError('file_too_large', 'Content exceeds the size cap.')
  }
  // Hold the memdir lock so a concurrent OpenClaude write to the same file
  // serializes against ours (advisory; the write itself is atomic regardless).
  await withMemoryLock(store.dir, relPath, () => writeAtomic(full, text))
  return readFile(store, relPath)
}

export async function createFile(
  store: MemoryStoreDescriptor,
  name: string,
  payload: WritePayload,
): Promise<MemoryFileDTO> {
  assertMarkdownName(name)
  if (store.allowlist && !store.allowlist.includes(name)) {
    throw new MemoryPathError('New files are not allowed in this store.')
  }
  // Agent/global stores are flat; project stores allow a relative subdir via
  // the optional payload, but createFile keeps it simple: top-level of dir.
  const full = resolveWithin(store.dir, name)
  if (await fileExists(full)) {
    throw new MemoryFileError('already_exists', 'A file with that name already exists.')
  }
  return writeFile(store, name, payload)
}

export async function deleteFile(store: MemoryStoreDescriptor, relPath: string): Promise<void> {
  const full = resolveWithin(store.dir, relPath)
  const baseName = path.basename(full)
  if (store.allowlist && !store.allowlist.includes(baseName)) {
    throw new MemoryPathError('This file cannot be deleted from this store.')
  }
  await withMemoryLock(store.dir, relPath, () => fs.unlink(full))
}

/** Coded error mapped to specific HTTP statuses by the route layer. */
export class MemoryFileError extends Error {
  code: 'file_too_large' | 'already_exists' | 'not_found'
  constructor(code: MemoryFileError['code'], message: string) {
    super(message)
    this.name = 'MemoryFileError'
    this.code = code
  }
}

export { resolveStore, getMemoryRoot, MemoryPathError }
export type { MemoryStoreDescriptor }
