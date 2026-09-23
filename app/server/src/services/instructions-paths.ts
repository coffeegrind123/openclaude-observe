// Store resolution + path guards for the instructions browser/editor.
//
// pi reads a small, fixed set of files: context files (AGENTS.md and
// friends), SYSTEM.md / APPEND_SYSTEM.md, and subagent definitions under a
// few `agents/` directories. The editor may touch exactly those paths and
// nothing else — so every relPath is classified against the store's
// allowlist/patterns FIRST (`classifyRelPath`), and only then resolved with
// `resolveWithin` as a second, independent traversal guard. Being inside the
// store root is necessary but never sufficient.
//
// Paths are used as-is: in docker each pi home and project cwd is
// bind-mounted at the same absolute path pi sees, so no translation.

import path from 'node:path'
import { config } from '../config'

/**
 * Context-file candidates in pi's precedence order. Per directory pi loads
 * ONLY the first one that exists (resource-loader.ts loadContextFileFromDir);
 * the rest are shadowed. The upper-case `.MD` spellings matter on
 * case-sensitive filesystems.
 */
export const CONTEXT_FILE_CANDIDATES = [
  'AGENTS.override.md',
  'AGENTS.md',
  'AGENTS.MD',
  'CLAUDE.md',
  'CLAUDE.MD',
] as const

/** Context files offered as creatable placeholders when missing. */
export const CANONICAL_CONTEXT_FILES = ['AGENTS.md', 'CLAUDE.md', 'AGENTS.override.md'] as const

export const SYSTEM_FILE = 'SYSTEM.md'
export const APPEND_SYSTEM_FILE = 'APPEND_SYSTEM.md'

/** pi's per-project config dir (CONFIG_DIR_NAME in pi). */
export const PROJECT_CONFIG_DIR = '.pi'

/** `<home>/.pi/agent` — pi's global agent dir. */
export const HOME_AGENT_SUBDIR = path.join('.pi', 'agent')

/** Subagent definition dirs inside a project (pi-subagents-lite discovery). */
export const PROJECT_AGENT_DIRS = ['.pi/agents', '.agents/agents'] as const

export type InstructionsStoreKind = 'home' | 'home-agents' | 'project'

/** What a file is to pi — drives schema, cost accounting and the UI. */
export type InstructionsFileRole = 'context' | 'system' | 'append-system' | 'agent'

export interface InstructionsStoreDescriptor {
  id: string
  kind: InstructionsStoreKind
  /** Absolute directory every relPath in this store is relative to. */
  root: string
  /**
   * Directory that must already exist before anything is written. Writes may
   * create subdirectories below it (.pi/agents) but never the base itself —
   * a missing base means an unmounted home or a stale project cwd, and
   * creating it would scatter files into the container.
   */
  mustExist: string
  /** Fixed relPaths this store exposes (placeholders when missing). */
  fixedFiles: readonly string[]
  /** Fixed relPaths that are readable when present but never offered as placeholders. */
  optionalFiles: readonly string[]
  /** Relative dirs whose `*.md` files are subagent definitions ('' = root). */
  agentDirs: readonly string[]
  homeIndex?: number
  homePath?: string
  projectId?: number
}

/** A single path segment: letters, digits, dash, dot, underscore. No slashes. */
const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/

export function isSafeSegment(seg: string): boolean {
  return SAFE_SEGMENT.test(seg) && seg !== '.' && seg !== '..'
}

/** Thrown for invalid, escaping or non-allowlisted paths; routes map this to a 400. */
export class InstructionsPathError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InstructionsPathError'
  }
}

export function homeAgentDir(home: string): string {
  return path.join(path.resolve(home), HOME_AGENT_SUBDIR)
}

const HOME_FIXED = [...CANONICAL_CONTEXT_FILES, SYSTEM_FILE, APPEND_SYSTEM_FILE]
const HOME_OPTIONAL = CONTEXT_FILE_CANDIDATES.filter(
  (f) => !(CANONICAL_CONTEXT_FILES as readonly string[]).includes(f),
)
const PROJECT_FIXED = [
  ...CANONICAL_CONTEXT_FILES,
  `${PROJECT_CONFIG_DIR}/${SYSTEM_FILE}`,
  `${PROJECT_CONFIG_DIR}/${APPEND_SYSTEM_FILE}`,
]

export function homeStore(index: number, home: string): InstructionsStoreDescriptor {
  const dir = homeAgentDir(home)
  return {
    id: `home:${index}`,
    kind: 'home',
    root: dir,
    mustExist: dir,
    fixedFiles: HOME_FIXED,
    optionalFiles: HOME_OPTIONAL,
    agentDirs: [],
    homeIndex: index,
    homePath: path.resolve(home),
  }
}

export function homeAgentsStore(index: number, home: string): InstructionsStoreDescriptor {
  const dir = homeAgentDir(home)
  return {
    id: `home-agents:${index}`,
    kind: 'home-agents',
    root: path.join(dir, 'agents'),
    mustExist: dir,
    fixedFiles: [],
    optionalFiles: [],
    agentDirs: [''],
    homeIndex: index,
    homePath: path.resolve(home),
  }
}

export function projectStore(projectId: number, cwd: string): InstructionsStoreDescriptor {
  const root = path.resolve(cwd)
  return {
    id: `project:${projectId}`,
    kind: 'project',
    root,
    mustExist: root,
    fixedFiles: PROJECT_FIXED,
    optionalFiles: HOME_OPTIONAL,
    agentDirs: PROJECT_AGENT_DIRS,
    projectId,
  }
}

/** Parse the numeric index out of `home:<i>` / `home-agents:<i>`, or null. */
function parseIndex(raw: string): number | null {
  if (!/^\d{1,4}$/.test(raw)) return null
  return parseInt(raw, 10)
}

/**
 * Resolve a home-backed store id synchronously from config. Project stores
 * need the DB and go through `resolveStore` in instructions-store.ts.
 */
export function resolveHomeStore(storeId: string): InstructionsStoreDescriptor | null {
  const homes = config.pi.homes
  if (storeId.startsWith('home:')) {
    const i = parseIndex(storeId.slice('home:'.length))
    if (i == null || i >= homes.length) {
      return null
    }
    return homeStore(i, homes[i])
  }
  if (storeId.startsWith('home-agents:')) {
    const i = parseIndex(storeId.slice('home-agents:'.length))
    if (i == null || i >= homes.length) {
      return null
    }
    return homeAgentsStore(i, homes[i])
  }
  return null
}

/** Parse `project:<id>` into the numeric project id, or null. */
export function parseProjectStoreId(storeId: string): number | null {
  if (!storeId.startsWith('project:')) {
    return null
  }
  const raw = storeId.slice('project:'.length)
  if (!/^\d{1,12}$/.test(raw)) {
    return null
  }
  const id = parseInt(raw, 10)
  return id > 0 ? id : null
}

/**
 * Validate `relPath` against the store's allowlist/patterns and return what
 * the file is to pi. Throws InstructionsPathError for anything else.
 *
 * relPaths must already be canonical (posix, no `.`/`..`/empty segments, no
 * backslashes) — they are compared literally rather than normalised, so a
 * sneaky `.pi/agents/../../x.md` can never normalise its way into a match.
 */
export function classifyRelPath(
  store: InstructionsStoreDescriptor,
  relPath: unknown,
): InstructionsFileRole {
  if (typeof relPath !== 'string' || relPath === '') {
    throw new InstructionsPathError('A file path is required.')
  }
  if (relPath.includes('\0')) {
    throw new InstructionsPathError('Path contains a null byte.')
  }
  if (relPath.includes('\\')) {
    throw new InstructionsPathError('Backslashes are not allowed in paths.')
  }
  if (relPath.startsWith('/') || path.isAbsolute(relPath)) {
    throw new InstructionsPathError('Absolute paths are not allowed.')
  }
  const segments = relPath.split('/')
  if (segments.some((s) => !isSafeSegment(s))) {
    throw new InstructionsPathError('Path contains an invalid segment.')
  }

  if (store.fixedFiles.includes(relPath) || store.optionalFiles.includes(relPath)) {
    return roleOfFixed(relPath)
  }

  const dir = segments.slice(0, -1).join('/')
  const base = segments[segments.length - 1]
  if (store.agentDirs.includes(dir) && base.toLowerCase().endsWith('.md') && base.length > 3) {
    return 'agent'
  }

  throw new InstructionsPathError(
    `"${relPath}" is not an instruction file pi reads from this store.`,
  )
}

function roleOfFixed(relPath: string): InstructionsFileRole {
  const base = relPath.split('/').pop()
  if (base === SYSTEM_FILE) {
    return 'system'
  }
  if (base === APPEND_SYSTEM_FILE) {
    return 'append-system'
  }
  return 'context'
}

/**
 * Resolve a relative path against a base directory, guaranteeing the result
 * stays inside the base. Rejects absolute paths, null bytes and any `..`
 * escape. Independent of the allowlist check — defence in depth.
 */
export function resolveWithin(baseDir: string, relPath: string): string {
  if (!relPath || typeof relPath !== 'string') {
    throw new InstructionsPathError('A file path is required.')
  }
  if (relPath.includes('\0')) {
    throw new InstructionsPathError('Path contains a null byte.')
  }
  if (path.isAbsolute(relPath)) {
    throw new InstructionsPathError('Absolute paths are not allowed.')
  }
  const base = path.resolve(baseDir)
  const full = path.resolve(base, relPath)
  if (full === base || !full.startsWith(base + path.sep)) {
    throw new InstructionsPathError('Path escapes the store directory.')
  }
  return full
}

/** Classify + resolve in one step — the only way store code turns a relPath into a file path. */
export function resolveStoreFile(
  store: InstructionsStoreDescriptor,
  relPath: unknown,
): { full: string; role: InstructionsFileRole; relPath: string } {
  const role = classifyRelPath(store, relPath)
  const rel = relPath as string
  return { full: resolveWithin(store.root, rel), role, relPath: rel }
}
