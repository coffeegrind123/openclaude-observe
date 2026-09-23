// Core logic for the instructions browser/editor: discover pi's instruction
// stores (per pi home, per home's subagent dir, per observe project with a
// cwd), list/read/write/create/delete their files, estimate what each costs
// in context, and build the cross-store link graph. The filesystem is the
// source of truth — these are careful wrappers over fs with frontmatter
// parsing layered on top.

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { config } from '../config'
import type { EventStore } from '../storage/types'
import {
  APPEND_SYSTEM_FILE,
  CONTEXT_FILE_CANDIDATES,
  InstructionsPathError,
  PROJECT_CONFIG_DIR,
  SYSTEM_FILE,
  homeAgentDir,
  homeAgentsStore,
  homeStore,
  isSafeSegment,
  parseProjectStoreId,
  projectStore,
  resolveHomeStore,
  resolveStoreFile,
  type InstructionsFileRole,
  type InstructionsStoreDescriptor,
  type InstructionsStoreKind,
} from './instructions-paths'

// ── DTOs ────────────────────────────────────────────────────────────────

export interface InstructionsStoreDTO {
  id: string
  kind: InstructionsStoreKind
  /** Display label: the home path for home stores, the project name for projects. */
  label: string
  /** Absolute directory the store's relPaths are relative to. */
  dir: string
  homeIndex?: number
  homePath?: string
  projectId?: number
  projectName?: string
  projectSlug?: string
  cwd?: string
  /** False when the store's base dir is missing (unmounted home, stale cwd). */
  available: boolean
  /** Existing files. */
  fileCount: number
  /** Allowlisted files that don't exist yet (creatable placeholders). */
  missingCount: number
  totalBytes: number
  /**
   * Estimated tokens this store puts in front of the model: for home/project
   * stores the context file pi actually loads + SYSTEM.md + APPEND_SYSTEM.md;
   * for agent stores the sum of the definitions' bodies (their system prompts).
   */
  tokens: number
  lastModifiedMs: number | null
}

/** The subagent-definition fields surfaced in list/graph views. */
export interface AgentHeaderFields {
  name?: string
  displayName?: string
  description?: string
  model?: string
  thinking?: string
  hidden?: boolean
}

export interface InstructionsFileHeaderDTO {
  /** Path relative to the store dir, posix-style. */
  relPath: string
  /** Basename. */
  name: string
  role: InstructionsFileRole
  /** False for an allowlisted file that doesn't exist yet. */
  exists: boolean
  bytes: number
  mtimeMs: number
  hasFrontmatter: boolean
  title: string
  snippet: string
  /** chars/4 estimate over the whole file. */
  tokens: number
  /** chars/4 estimate over the body only (the system prompt, for agents). */
  bodyTokens: number
  /** Outgoing [[wikilink]] target stems. */
  links: string[]
  /** Outgoing markdown link targets that point at `.md` files, as written. */
  mdLinks: string[]
  /**
   * For context files: the relPath pi loads instead from the same directory
   * (it loads only the first candidate that exists). Null when this file is
   * the one pi loads, or for non-context files.
   */
  shadowedBy: string | null
  description?: string
  agent?: AgentHeaderFields
}

export interface InstructionsFileDTO {
  storeId: string
  relPath: string
  name: string
  role: InstructionsFileRole
  bytes: number
  mtimeMs: number
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
  tokens: number
  bodyTokens: number
}

/** Coded error mapped to specific HTTP statuses by the route layer. */
export class InstructionsFileError extends Error {
  code: 'file_too_large' | 'already_exists' | 'not_found' | 'store_unavailable'
  constructor(code: InstructionsFileError['code'], message: string) {
    super(message)
    this.name = 'InstructionsFileError'
    this.code = code
  }
}

// ── Token estimate ──────────────────────────────────────────────────────

/**
 * Rough token count: characters / 4. Deliberately model-agnostic — it's for
 * spotting which files dominate the standing context cost, not for billing.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

// ── Frontmatter ─────────────────────────────────────────────────────────

const FRONTMATTER_RE = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/

interface SplitFile {
  hasFrontmatter: boolean
  frontmatterRaw: string | null
  body: string
}

function splitFrontmatter(content: string): SplitFile {
  const m = content.match(FRONTMATTER_RE)
  if (!m) {
    return { hasFrontmatter: false, frontmatterRaw: null, body: content }
  }
  return { hasFrontmatter: true, frontmatterRaw: m[1], body: content.slice(m[0].length) }
}

function parseFrontmatter(raw: string | null): {
  data: Record<string, unknown> | null
  error: boolean
} {
  if (raw == null) {
    return { data: null, error: false }
  }
  try {
    const parsed = parseYaml(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { data: parsed as Record<string, unknown>, error: false }
    }
    // An empty block parses to null — that's "no fields", not an error.
    if (parsed == null) {
      return { data: {}, error: false }
    }
    return { data: null, error: true }
  } catch {
    return { data: null, error: true }
  }
}

function agentFields(data: Record<string, unknown> | null): AgentHeaderFields {
  if (!data) {
    return {}
  }
  const str = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : undefined)
  const hidden = data.hidden === true || data.hidden === 'true' ? true : undefined
  return {
    name: str(data.name),
    displayName: str(data.display_name),
    description: str(data.description),
    model: str(data.model),
    thinking: str(data.thinking),
    hidden,
  }
}

function deriveTitle(fileName: string, agent: AgentHeaderFields | undefined, body: string): string {
  if (agent?.displayName) {
    return agent.displayName
  }
  if (agent?.name) {
    return agent.name
  }
  const h1 = body.match(/^#\s+(.+)$/m)
  if (h1) {
    return h1[1].trim()
  }
  return fileName.replace(/\.md$/i, '')
}

const WIKILINK_RE = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g

/** Extract unique [[wikilink]] target stems from arbitrary text. */
export function extractWikilinks(text: string): string[] {
  const out = new Set<string>()
  for (const m of text.matchAll(WIKILINK_RE)) {
    const target = m[1].trim().replace(/\.md$/i, '')
    if (target) {
      out.add(target)
    }
  }
  return [...out]
}

// `[label](target.md)`, `[label](../x/AGENTS.md#anchor)`, `[label](<target.md>)`
const MD_LINK_RE = /\]\(\s*<?([^)\s>]+?\.md)(?:#[^)\s>]*)?>?(?:\s+"[^"]*")?\s*\)/gi

/** Extract unique markdown-link targets that point at local `.md` files. */
export function extractMdLinks(text: string): string[] {
  const out = new Set<string>()
  for (const m of text.matchAll(MD_LINK_RE)) {
    const target = m[1].trim()
    // Skip URLs (http:, https:, file:, mailto:) — only filesystem paths link files.
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) {
      continue
    }
    out.add(target)
  }
  return [...out]
}

function deriveSnippet(body: string): string {
  return body
    .replace(/^#.*$/gm, '')
    .replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, '$1')
    .replace(/[*_`>#-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200)
}

/**
 * Serialize a structured frontmatter object + body back into a file. Empty or
 * null frontmatter writes a body-only file (no `---` fences) — context files
 * are plain markdown and must stay that way.
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
  // lineWidth 0: never fold long values onto continuation lines.
  // pi-subagents-lite parses frontmatter line by line (flat `key: value` and
  // `- item` only), so a folded description would be silently mangled.
  const yaml = stringifyYaml(frontmatter, { lineWidth: 0 }).trimEnd()
  const out = `---\n${yaml}\n---\n\n${normalizedBody}`
  return out.endsWith('\n') ? out : out + '\n'
}

// ── FS helpers ──────────────────────────────────────────────────────────

async function dirExists(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isDirectory()
  } catch {
    return false
  }
}

async function statFile(p: string) {
  try {
    const st = await fs.stat(p)
    return st.isFile() ? st : null
  } catch {
    return null
  }
}

/** Names in a directory (empty when it doesn't exist or can't be read). */
async function listDirNames(dir: string): Promise<Set<string>> {
  try {
    return new Set(await fs.readdir(dir))
  } catch {
    return new Set()
  }
}

/**
 * The context file pi loads from `dir`: the first candidate, in pi's
 * precedence order, that exists as a regular file. Matching is against the
 * directory listing rather than stat, so a case-insensitive filesystem
 * doesn't report AGENTS.md and AGENTS.MD as two different files.
 */
async function contextWinner(dir: string): Promise<string | null> {
  const names = await listDirNames(dir)
  for (const candidate of CONTEXT_FILE_CANDIDATES) {
    if (!names.has(candidate)) {
      continue
    }
    if (await statFile(path.join(dir, candidate))) {
      return candidate
    }
  }
  return null
}

async function readCapped(full: string, size: number): Promise<string> {
  if (size > config.instructions.maxFileBytes) {
    return ''
  }
  try {
    return await fs.readFile(full, 'utf8')
  } catch {
    return ''
  }
}

/**
 * Write via temp file + rename so pi never reads a half-written file. When
 * the target is a symlink (e.g. AGENTS.md linked from a dotfiles repo) the
 * write goes to the link's target so the link itself survives.
 */
async function writeAtomic(full: string, text: string): Promise<void> {
  let target = full
  try {
    const lst = await fs.lstat(full)
    if (lst.isSymbolicLink()) {
      target = await fs.realpath(full)
    }
  } catch {
    // doesn't exist yet — plain create
  }
  await fs.mkdir(path.dirname(target), { recursive: true })
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`
  try {
    await fs.writeFile(tmp, text, 'utf8')
    await fs.rename(tmp, target)
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => {})
    throw err
  }
}

// ── Store scanning ─────────────────────────────────────────────────────────

interface ScannedFile {
  header: InstructionsFileHeaderDTO
  /** Absolute path (as addressed, before symlink resolution). */
  full: string
  content: string
}

function buildHeader(
  relPath: string,
  role: InstructionsFileRole,
  st: { size: number; mtimeMs: number } | null,
  content: string,
): InstructionsFileHeaderDTO {
  const name = path.posix.basename(relPath)
  if (!st) {
    return {
      relPath,
      name,
      role,
      exists: false,
      bytes: 0,
      mtimeMs: 0,
      hasFrontmatter: false,
      title: name,
      snippet: '',
      tokens: 0,
      bodyTokens: 0,
      links: [],
      mdLinks: [],
      shadowedBy: null,
    }
  }
  const { hasFrontmatter, frontmatterRaw, body } = splitFrontmatter(content)
  const { data } = parseFrontmatter(frontmatterRaw)
  const agent = role === 'agent' ? agentFields(data) : undefined
  const description =
    agent?.description ??
    (data && typeof data.description === 'string' ? data.description : undefined)
  return {
    relPath,
    name,
    role,
    exists: true,
    bytes: st.size,
    mtimeMs: st.mtimeMs,
    hasFrontmatter,
    title: deriveTitle(name, agent, body),
    snippet: deriveSnippet(body),
    tokens: estimateTokens(content),
    bodyTokens: estimateTokens(body),
    links: extractWikilinks(content),
    mdLinks: extractMdLinks(content),
    shadowedBy: null,
    ...(description ? { description } : {}),
    ...(agent ? { agent } : {}),
  }
}

/** Every file the store exposes (existing + missing placeholders), with contents. */
async function scanStore(store: InstructionsStoreDescriptor): Promise<ScannedFile[]> {
  const out: ScannedFile[] = []

  // Fixed files. Optional spellings (AGENTS.MD, CLAUDE.MD) only appear when
  // they exist; canonical ones appear either way so they can be created.
  const fixed = [...store.fixedFiles, ...store.optionalFiles]
  const listings = new Map<string, Set<string>>()
  for (const relPath of fixed) {
    const { full, role } = resolveStoreFile(store, relPath)
    const dir = path.dirname(full)
    if (!listings.has(dir)) {
      listings.set(dir, await listDirNames(dir))
    }
    const present = listings.get(dir)!.has(path.basename(full))
    const st = present ? await statFile(full) : null
    if (!st && store.optionalFiles.includes(relPath)) {
      continue
    }
    const content = st ? await readCapped(full, st.size) : ''
    out.push({ header: buildHeader(relPath, role, st, content), full, content })
  }

  // Subagent definitions: flat `*.md` in each agent dir, like pi-subagents-lite.
  for (const agentDir of store.agentDirs) {
    const absDir = agentDir ? path.join(store.root, agentDir) : store.root
    let names: string[]
    try {
      names = await fs.readdir(absDir)
    } catch {
      continue
    }
    for (const name of names.sort()) {
      // Unsafe names can't be addressed through the API, so don't list them.
      if (!name.toLowerCase().endsWith('.md') || !isSafeSegment(name)) {
        continue
      }
      const relPath = agentDir ? `${agentDir}/${name}` : name
      const { full, role } = resolveStoreFile(store, relPath)
      const st = await statFile(full)
      if (!st) {
        continue
      }
      const content = await readCapped(full, st.size)
      out.push({ header: buildHeader(relPath, role, st, content), full, content })
    }
  }

  markShadowed(out)
  return out
}

/** Flag context files that pi skips because an earlier candidate in the same dir exists. */
function markShadowed(files: ScannedFile[]) {
  const byDir = new Map<string, ScannedFile[]>()
  for (const f of files) {
    if (f.header.role !== 'context' || !f.header.exists) {
      continue
    }
    const dir = path.posix.dirname(f.header.relPath)
    if (!byDir.has(dir)) {
      byDir.set(dir, [])
    }
    byDir.get(dir)!.push(f)
  }
  const rank = (name: string) => (CONTEXT_FILE_CANDIDATES as readonly string[]).indexOf(name)
  for (const group of byDir.values()) {
    group.sort((a, b) => rank(a.header.name) - rank(b.header.name))
    const winner = group[0]
    for (const f of group.slice(1)) {
      f.header.shadowedBy = winner.header.relPath
    }
  }
}

/** Tokens a store puts in front of the model (see InstructionsStoreDTO.tokens). */
function storeTokens(store: InstructionsStoreDescriptor, files: ScannedFile[]): number {
  let total = 0
  for (const { header } of files) {
    if (!header.exists) {
      continue
    }
    if (store.kind === 'home-agents') {
      total += header.bodyTokens
      continue
    }
    // Project agent definitions cost only when a subagent runs, and a
    // shadowed context file is never loaded at all.
    if (header.role === 'agent' || header.shadowedBy) {
      continue
    }
    total += header.tokens
  }
  return total
}

// ── Store discovery ───────────────────────────────────────────────────────

export interface ProjectWithCwd {
  id: number
  name: string
  slug: string
  cwd: string
}

/**
 * Observe projects that have an absolute cwd. getProjects() doesn't select
 * cwd, so fall back to getProjectById (SELECT *) per project. Projects that
 * share a cwd collapse to the first one — they'd be the same files.
 */
export async function projectsWithCwd(eventStore: EventStore): Promise<ProjectWithCwd[]> {
  let rows: any[] = []
  try {
    rows = await eventStore.getProjects()
  } catch {
    return []
  }
  const out: ProjectWithCwd[] = []
  const seenCwd = new Set<string>()
  for (const row of rows) {
    if (typeof row?.id !== 'number') {
      continue
    }
    let cwd: unknown = row.cwd
    if (cwd === undefined) {
      try {
        cwd = (await eventStore.getProjectById(row.id))?.cwd
      } catch {
        cwd = undefined
      }
    }
    if (typeof cwd !== 'string' || !path.isAbsolute(cwd)) {
      continue
    }
    const resolved = path.resolve(cwd)
    if (seenCwd.has(resolved)) {
      continue
    }
    seenCwd.add(resolved)
    out.push({
      id: row.id,
      name: typeof row.name === 'string' ? row.name : resolved,
      slug: typeof row.slug === 'string' ? row.slug : '',
      cwd: resolved,
    })
  }
  return out
}

/** Resolve a store id to its descriptor, or null for unknown/invalid ids. */
export async function resolveStore(
  storeId: string,
  eventStore: EventStore,
): Promise<InstructionsStoreDescriptor | null> {
  const home = resolveHomeStore(storeId)
  if (home) {
    return home
  }
  const projectId = parseProjectStoreId(storeId)
  if (projectId == null) {
    return null
  }
  let row: any
  try {
    row = await eventStore.getProjectById(projectId)
  } catch {
    return null
  }
  const cwd = row?.cwd
  if (typeof cwd !== 'string' || !path.isAbsolute(cwd)) {
    return null
  }
  return projectStore(projectId, cwd)
}

async function summarize(
  store: InstructionsStoreDescriptor,
): Promise<
  Pick<
    InstructionsStoreDTO,
    'available' | 'fileCount' | 'missingCount' | 'totalBytes' | 'tokens' | 'lastModifiedMs'
  >
> {
  const available = await dirExists(store.mustExist)
  const files = available ? await scanStore(store) : []
  let fileCount = 0
  let missingCount = 0
  let totalBytes = 0
  let lastModifiedMs: number | null = null
  for (const { header } of files) {
    if (!header.exists) {
      missingCount++
      continue
    }
    fileCount++
    totalBytes += header.bytes
    if (lastModifiedMs == null || header.mtimeMs > lastModifiedMs) {
      lastModifiedMs = header.mtimeMs
    }
  }
  return {
    available,
    fileCount,
    missingCount,
    totalBytes,
    tokens: storeTokens(store, files),
    lastModifiedMs,
  }
}

/** Every instruction store: each pi home, its agents dir, and each project with a cwd. */
export async function listStores(eventStore: EventStore): Promise<InstructionsStoreDTO[]> {
  const stores: InstructionsStoreDTO[] = []

  const homes = config.pi.homes
  for (let i = 0; i < homes.length; i++) {
    for (const desc of [homeStore(i, homes[i]), homeAgentsStore(i, homes[i])]) {
      stores.push({
        id: desc.id,
        kind: desc.kind,
        label: desc.homePath!,
        dir: desc.root,
        homeIndex: i,
        homePath: desc.homePath,
        ...(await summarize(desc)),
      })
    }
  }

  const projects = await projectsWithCwd(eventStore)
  const projectStores: InstructionsStoreDTO[] = []
  for (const p of projects) {
    const desc = projectStore(p.id, p.cwd)
    projectStores.push({
      id: desc.id,
      kind: 'project',
      label: p.name,
      dir: desc.root,
      projectId: p.id,
      projectName: p.name,
      projectSlug: p.slug,
      cwd: p.cwd,
      ...(await summarize(desc)),
    })
  }
  projectStores.sort((a, b) => a.label.localeCompare(b.label))
  return [...stores, ...projectStores]
}

// ── File listing + reading ─────────────────────────────────────────────────

export async function listFiles(
  store: InstructionsStoreDescriptor,
): Promise<InstructionsFileHeaderDTO[]> {
  if (!(await dirExists(store.mustExist))) {
    throw new InstructionsFileError(
      'store_unavailable',
      `${store.mustExist} does not exist (is it mounted?).`,
    )
  }
  const files = (await scanStore(store)).map((f) => f.header)
  // Existing files first (context → system → append → agents), placeholders last.
  const roleRank: Record<InstructionsFileRole, number> = {
    context: 0,
    system: 1,
    'append-system': 2,
    agent: 3,
  }
  files.sort((a, b) => {
    if (a.exists !== b.exists) {
      return a.exists ? -1 : 1
    }
    return roleRank[a.role] - roleRank[b.role] || a.relPath.localeCompare(b.relPath)
  })
  return files
}

export async function readFile(
  store: InstructionsStoreDescriptor,
  relPath: unknown,
): Promise<InstructionsFileDTO> {
  const { full, role, relPath: rel } = resolveStoreFile(store, relPath)
  const st = await fs.stat(full)
  if (!st.isFile()) {
    throw new InstructionsFileError('not_found', 'Not a regular file.')
  }
  if (st.size > config.instructions.maxFileBytes) {
    throw new InstructionsFileError('file_too_large', 'File exceeds the size cap.')
  }
  const content = await fs.readFile(full, 'utf8')
  const { hasFrontmatter, frontmatterRaw, body } = splitFrontmatter(content)
  const { data, error } = parseFrontmatter(frontmatterRaw)
  return {
    storeId: store.id,
    relPath: rel,
    name: path.posix.basename(rel),
    role,
    bytes: st.size,
    mtimeMs: st.mtimeMs,
    content,
    frontmatter: data,
    frontmatterRaw: hasFrontmatter ? frontmatterRaw : null,
    body,
    frontmatterError: hasFrontmatter && error,
    tokens: estimateTokens(content),
    bodyTokens: estimateTokens(body),
  }
}

// ── Writing ────────────────────────────────────────────────────────────────

export interface WritePayload {
  /** Raw full-file content (raw-editor save). Takes precedence when present. */
  content?: string
  /** Structured frontmatter object (form-editor save). */
  frontmatter?: Record<string, unknown> | null
  /** Body markdown (form-editor save). */
  body?: string
}

async function assertStoreAvailable(store: InstructionsStoreDescriptor) {
  if (!(await dirExists(store.mustExist))) {
    throw new InstructionsFileError(
      'store_unavailable',
      `${store.mustExist} does not exist (is it mounted?). Refusing to create it.`,
    )
  }
}

function payloadText(payload: WritePayload): string {
  if (typeof payload.content === 'string') {
    return payload.content
  }
  const fm =
    payload.frontmatter && typeof payload.frontmatter === 'object' ? payload.frontmatter : null
  return composeFile(fm, typeof payload.body === 'string' ? payload.body : '')
}

/** Overwrite (or create) an allowlisted file. */
export async function writeFile(
  store: InstructionsStoreDescriptor,
  relPath: unknown,
  payload: WritePayload,
): Promise<InstructionsFileDTO> {
  const { full, relPath: rel } = resolveStoreFile(store, relPath)
  await assertStoreAvailable(store)
  const text = payloadText(payload ?? {})
  if (Buffer.byteLength(text, 'utf8') > config.instructions.maxFileBytes) {
    throw new InstructionsFileError('file_too_large', 'Content exceeds the size cap.')
  }
  await writeAtomic(full, text)
  return readFile(store, rel)
}

/** Create a new allowlisted file; fails if it already exists. */
export async function createFile(
  store: InstructionsStoreDescriptor,
  relPath: unknown,
  payload: WritePayload,
): Promise<InstructionsFileDTO> {
  const { full } = resolveStoreFile(store, relPath)
  let exists = false
  try {
    await fs.lstat(full)
    exists = true
  } catch {
    exists = false
  }
  if (exists) {
    throw new InstructionsFileError('already_exists', 'A file with that name already exists.')
  }
  return writeFile(store, relPath, payload)
}

export async function deleteFile(
  store: InstructionsStoreDescriptor,
  relPath: unknown,
): Promise<void> {
  const { full } = resolveStoreFile(store, relPath)
  // unlink removes a symlink itself, never the file it points at.
  await fs.unlink(full)
}

// ── Cross-store search ─────────────────────────────────────────────────────

export interface InstructionsSearchHit {
  storeId: string
  storeLabel: string
  storeKind: InstructionsStoreKind
  file: InstructionsFileHeaderDTO
}

interface LoadedStore {
  dto: InstructionsStoreDTO
  desc: InstructionsStoreDescriptor
  files: ScannedFile[]
}

async function loadAll(eventStore: EventStore): Promise<LoadedStore[]> {
  const dtos = await listStores(eventStore)
  const out: LoadedStore[] = []
  for (const dto of dtos) {
    if (!dto.available) {
      continue
    }
    const desc = await resolveStore(dto.id, eventStore)
    if (!desc) {
      continue
    }
    out.push({ dto, desc, files: await scanStore(desc) })
  }
  return out
}

/**
 * Search existing files across every store. With an empty query, returns the
 * most recently modified files (the command palette's initial list).
 */
export async function searchAll(
  eventStore: EventStore,
  query: string,
  limit = 100,
): Promise<InstructionsSearchHit[]> {
  const q = query.trim().toLowerCase()
  const hits: InstructionsSearchHit[] = []
  for (const { dto, files } of await loadAll(eventStore)) {
    for (const { header, content } of files) {
      if (!header.exists) {
        continue
      }
      const hay = `${header.title} ${header.relPath} ${header.description ?? ''} ${
        header.agent?.name ?? ''
      } ${content}`.toLowerCase()
      if (!q || hay.includes(q)) {
        hits.push({ storeId: dto.id, storeLabel: dto.label, storeKind: dto.kind, file: header })
      }
    }
  }
  hits.sort((a, b) => b.file.mtimeMs - a.file.mtimeMs)
  return hits.slice(0, limit)
}

// ── Link graph ─────────────────────────────────────────────────────────────

export type InstructionsEdgeKind = 'wikilink' | 'mdlink' | 'agent'

export interface InstructionsGraphNode {
  /** `<storeId>::<relPath>` */
  id: string
  storeId: string
  storeLabel: string
  storeKind: InstructionsStoreKind
  relPath: string
  name: string
  title: string
  role: InstructionsFileRole
  tokens: number
  bodyTokens: number
  /** Subagent name (frontmatter `name`, else file stem) for agent definitions. */
  agentName?: string
  /** True when pi skips this context file in favour of another in its dir. */
  shadowed: boolean
  /** Wikilinks / markdown links that resolve to no instruction file. */
  broken: string[]
}

export interface InstructionsGraphEdge {
  source: string
  target: string
  kind: InstructionsEdgeKind
}

export interface InstructionsGraphDTO {
  nodes: InstructionsGraphNode[]
  edges: InstructionsGraphEdge[]
}

export function nodeId(storeId: string, relPath: string): string {
  return `${storeId}::${relPath}`
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Regex that matches a deliberate reference to subagent `name` — code-quoted,
 * quoted, `agent: name`, `@name`, or "the name agent" — rather than any bare
 * occurrence of the word, which for names like `worker` would link every
 * file that uses the word in prose.
 */
export function agentReferenceRe(name: string): RegExp {
  const n = escapeRegExp(name)
  const b = '(?![A-Za-z0-9_-])'
  const a = '(?<![A-Za-z0-9_-])'
  return new RegExp(
    [
      `\`${n}\``,
      `"${n}"`,
      `'${n}'`,
      `${a}@${n}${b}`,
      `\\b(?:sub)?agents?\\s*[:=]\\s*["'\`]?${n}${b}`,
      `\\b(?:sub)?agent\\s+["'\`]?${n}${b}`,
      `${a}${n}\\s+(?:sub)?agent\\b`,
    ].join('|'),
    'i',
  )
}

function stemOf(relPath: string): string {
  return path.posix.basename(relPath).replace(/\.md$/i, '').toLowerCase()
}

/**
 * Pick the best candidates for a link: same store first, then same pi home
 * (a home's context files and its agents dir belong together), then all.
 */
function preferLocal(
  candidates: InstructionsGraphNode[],
  from: InstructionsGraphNode,
  homeOf: Map<string, number | undefined>,
): InstructionsGraphNode[] {
  const same = candidates.filter((c) => c.storeId === from.storeId)
  if (same.length) {
    return same
  }
  const fromHome = homeOf.get(from.storeId)
  if (fromHome != null) {
    const sameHome = candidates.filter((c) => homeOf.get(c.storeId) === fromHome)
    if (sameHome.length) {
      return sameHome
    }
  }
  return candidates
}

/**
 * Build the cross-store link graph. Edges come from [[wikilinks]] (matched by
 * file stem or subagent name), relative/absolute markdown links to `.md`
 * files (resolved on disk), and deliberate mentions of a subagent's name.
 */
export async function buildGraph(eventStore: EventStore): Promise<InstructionsGraphDTO> {
  const loaded = await loadAll(eventStore)
  const nodes: InstructionsGraphNode[] = []
  const contentOf = new Map<string, ScannedFile>()
  const byAbs = new Map<string, InstructionsGraphNode>()
  const byStem = new Map<string, InstructionsGraphNode[]>()
  const byAgentName = new Map<string, InstructionsGraphNode[]>()
  const homeOf = new Map<string, number | undefined>()

  const push = <T>(map: Map<string, T[]>, key: string, v: T) => {
    if (!map.has(key)) {
      map.set(key, [])
    }
    map.get(key)!.push(v)
  }

  for (const { dto, files } of loaded) {
    homeOf.set(dto.id, dto.homeIndex)
    for (const f of files) {
      if (!f.header.exists) {
        continue
      }
      const h = f.header
      const agentName =
        h.role === 'agent' ? (h.agent?.name ?? h.name.replace(/\.md$/i, '')) : undefined
      const node: InstructionsGraphNode = {
        id: nodeId(dto.id, h.relPath),
        storeId: dto.id,
        storeLabel: dto.label,
        storeKind: dto.kind,
        relPath: h.relPath,
        name: h.name,
        title: h.title,
        role: h.role,
        tokens: h.tokens,
        bodyTokens: h.bodyTokens,
        shadowed: !!h.shadowedBy,
        broken: [],
        ...(agentName ? { agentName } : {}),
      }
      nodes.push(node)
      contentOf.set(node.id, f)
      byAbs.set(path.resolve(f.full), node)
      push(byStem, stemOf(h.relPath), node)
      if (agentName) {
        push(byAgentName, agentName.toLowerCase(), node)
      }
    }
  }

  const edges: InstructionsGraphEdge[] = []
  const seen = new Set<string>()
  const addEdge = (source: string, target: string, kind: InstructionsEdgeKind) => {
    if (source === target) {
      return
    }
    const key = `${source}\n${target}`
    if (seen.has(key)) {
      return
    }
    seen.add(key)
    edges.push({ source, target, kind })
  }

  const agentRes = [...byAgentName.entries()].map(([name, targets]) => ({
    re: agentReferenceRe(targets[0].agentName ?? name),
    targets,
  }))

  for (const node of nodes) {
    const f = contentOf.get(node.id)!
    const h = f.header

    for (const target of h.mdLinks) {
      let decoded = target
      try {
        decoded = decodeURI(target)
      } catch {
        decoded = target
      }
      const abs = path.isAbsolute(decoded)
        ? path.resolve(decoded)
        : path.resolve(path.dirname(f.full), decoded)
      const hit = byAbs.get(abs)
      if (hit) {
        addEdge(node.id, hit.id, 'mdlink')
      } else {
        node.broken.push(target)
      }
    }

    for (const stem of h.links) {
      const key = stem.toLowerCase()
      const candidates = [...(byStem.get(key) ?? []), ...(byAgentName.get(key) ?? [])]
      if (candidates.length === 0) {
        node.broken.push(`[[${stem}]]`)
        continue
      }
      for (const t of preferLocal(candidates, node, homeOf)) {
        addEdge(node.id, t.id, 'wikilink')
      }
    }

    for (const { re, targets } of agentRes) {
      if (!re.test(f.content)) {
        continue
      }
      const others = targets.filter((t) => t.id !== node.id)
      if (others.length === 0) {
        continue
      }
      for (const t of preferLocal(others, node, homeOf)) {
        addEdge(node.id, t.id, 'agent')
      }
    }
  }

  return { nodes, edges }
}

// ── Effective context ──────────────────────────────────────────────────────

export type ContextPartKind = 'context' | 'system' | 'append-system'
export type ContextPartOrigin = 'home' | 'ancestor' | 'project'

export interface ContextPart {
  kind: ContextPartKind
  origin: ContextPartOrigin
  absPath: string
  tokens: number
  /** Set when the file is editable through a store. */
  storeId: string | null
  relPath: string | null
  /** Project SYSTEM/APPEND_SYSTEM files only apply when pi trusts the project. */
  requiresTrust?: boolean
}

export interface EffectiveContextForHome {
  homeIndex: number
  homePath: string
  /** True when the project's cwd lives under this home — probably the pi that runs it. */
  likely: boolean
  parts: ContextPart[]
  totalTokens: number
}

export interface EffectiveContextDTO {
  storeId: string
  homes: EffectiveContextForHome[]
}

async function tokensOf(full: string): Promise<number | null> {
  const st = await statFile(full)
  if (!st) {
    return null
  }
  return estimateTokens(await readCapped(full, st.size))
}

/**
 * What pi puts in front of the model for this store, per pi home. Mirrors
 * pi's resource loader: the home agent dir's context file, then one context
 * file per directory from `/` down to cwd; project `.pi/SYSTEM.md` and
 * `.pi/APPEND_SYSTEM.md` REPLACE the home ones rather than adding to them.
 */
export async function effectiveContext(
  store: InstructionsStoreDescriptor,
  eventStore: EventStore,
): Promise<EffectiveContextDTO> {
  const homes = config.pi.homes
  const indices = store.homeIndex != null ? [store.homeIndex] : homes.map((_, i) => i)
  const projectStoreId = store.kind === 'project' ? store.id : null
  const projectRoot = store.kind === 'project' ? store.root : null

  // Map absolute dirs → editable project stores so ancestor files that are
  // themselves some other project's AGENTS.md link back to that store.
  const projectRoots = new Map<string, string>()
  for (const p of await projectsWithCwd(eventStore)) {
    projectRoots.set(p.cwd, `project:${p.id}`)
  }

  const result: EffectiveContextForHome[] = []
  for (const i of indices) {
    const homePath = path.resolve(homes[i])
    const agentDir = homeAgentDir(homePath)
    const parts: ContextPart[] = []

    const globalWinner = await contextWinner(agentDir)
    if (globalWinner) {
      const abs = path.join(agentDir, globalWinner)
      const tokens = await tokensOf(abs)
      if (tokens != null) {
        parts.push({
          kind: 'context',
          origin: 'home',
          absPath: abs,
          tokens,
          storeId: `home:${i}`,
          relPath: globalWinner,
        })
      }
    }

    if (projectRoot) {
      const chain: string[] = []
      let dir = projectRoot
      while (true) {
        chain.unshift(dir)
        const parent = path.dirname(dir)
        if (parent === dir) {
          break
        }
        dir = parent
      }
      for (const d of chain) {
        const winner = await contextWinner(d)
        if (!winner) {
          continue
        }
        const abs = path.join(d, winner)
        if (parts.some((p) => p.absPath === abs)) {
          continue
        }
        const tokens = await tokensOf(abs)
        if (tokens == null) {
          continue
        }
        const owner = d === projectRoot ? projectStoreId : (projectRoots.get(d) ?? null)
        parts.push({
          kind: 'context',
          origin: d === projectRoot ? 'project' : 'ancestor',
          absPath: abs,
          tokens,
          storeId: owner,
          relPath: owner ? winner : null,
        })
      }
    }

    for (const [kind, file] of [
      ['system', SYSTEM_FILE],
      ['append-system', APPEND_SYSTEM_FILE],
    ] as const) {
      if (projectRoot) {
        const abs = path.join(projectRoot, PROJECT_CONFIG_DIR, file)
        const tokens = await tokensOf(abs)
        if (tokens != null) {
          parts.push({
            kind,
            origin: 'project',
            absPath: abs,
            tokens,
            storeId: projectStoreId,
            relPath: `${PROJECT_CONFIG_DIR}/${file}`,
            requiresTrust: true,
          })
          continue
        }
      }
      const abs = path.join(agentDir, file)
      const tokens = await tokensOf(abs)
      if (tokens != null) {
        parts.push({
          kind,
          origin: 'home',
          absPath: abs,
          tokens,
          storeId: `home:${i}`,
          relPath: file,
        })
      }
    }

    const likely =
      projectRoot != null &&
      (projectRoot === homePath || projectRoot.startsWith(homePath + path.sep))
    result.push({
      homeIndex: i,
      homePath,
      likely,
      parts,
      totalTokens: parts.reduce((n, p) => n + p.tokens, 0),
    })
  }

  // The likely home first so the UI can lead with it.
  result.sort((a, b) => Number(b.likely) - Number(a.likely) || a.homeIndex - b.homeIndex)
  return { storeId: store.id, homes: result }
}

export { InstructionsPathError }
export type { InstructionsStoreDescriptor }
