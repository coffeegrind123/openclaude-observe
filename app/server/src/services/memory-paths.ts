// Path resolution + traversal guards for the memory browser/editor.
//
// Everything the feature touches lives under the OpenClaude config dir
// (~/.claude). In docker that tree is bind-mounted read-write at
// /host-rw/.claude; in local mode the server reads the real ~/.claude. The
// `root` here is whichever of those applies. Every file operation is funnelled
// through `resolveWithin` so a malicious or buggy relative path can never
// escape the store directory it belongs to.

import path from 'node:path'
import { config } from '../config'

/**
 * Absolute path to the Claude config dir the server should operate on, or
 * null when the memory feature can't resolve a base (neither container nor
 * host configured). Container mount wins when set (docker); otherwise the
 * host path is used directly (local runtime).
 */
export function getMemoryRoot(): string | null {
  const { container, host } = config.memory.base
  const root = container || host
  return root ? path.resolve(root) : null
}

export const PROJECTS_DIRNAME = 'projects'
export const AUTO_MEM_DIRNAME = 'memory'
export const AGENT_MEM_DIRNAME = 'agent-memory'

/** Instruction files exposed by the singleton `global` store. */
export const GLOBAL_INSTRUCTION_FILES = ['CLAUDE.md', 'CLAUDE.local.md']

/** A single path segment: letters, digits, dash, dot, underscore. No slashes. */
const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/

export function isSafeSegment(seg: string): boolean {
  return SAFE_SEGMENT.test(seg) && seg !== '.' && seg !== '..'
}

export interface MemoryStoreDescriptor {
  id: string
  kind: 'project' | 'global' | 'agent'
  /** Directory the store's files live under (absolute, inside root). */
  dir: string
  /** Project slug (the on-disk dir name) for project stores. */
  slug?: string
  /** Agent type for agent stores. */
  agentType?: string
  /** When set, the store only exposes these basenames (global instructions). */
  allowlist?: string[]
  /** Whether files are discovered recursively (project/agent) or flat (global). */
  recursive: boolean
}

/**
 * Resolve a store id to its on-disk descriptor. Returns null for unknown ids
 * or ids with unsafe segments. Does NOT check that the directory exists —
 * callers decide whether a missing dir is an error (read) or fine (create).
 *
 *   project:<slug>  → <root>/projects/<slug>/memory
 *   global          → <root> (CLAUDE.md / CLAUDE.local.md only)
 *   agent:<type>    → <root>/agent-memory/<type>
 */
export function resolveStore(storeId: string, root: string): MemoryStoreDescriptor | null {
  if (storeId === 'global') {
    return {
      id: 'global',
      kind: 'global',
      dir: root,
      allowlist: GLOBAL_INSTRUCTION_FILES,
      recursive: false,
    }
  }
  if (storeId.startsWith('project:')) {
    const slug = storeId.slice('project:'.length)
    if (!isSafeSegment(slug)) return null
    return {
      id: storeId,
      kind: 'project',
      slug,
      dir: path.join(root, PROJECTS_DIRNAME, slug, AUTO_MEM_DIRNAME),
      recursive: true,
    }
  }
  if (storeId.startsWith('agent:')) {
    const agentType = storeId.slice('agent:'.length)
    if (!isSafeSegment(agentType)) return null
    return {
      id: storeId,
      kind: 'agent',
      agentType,
      dir: path.join(root, AGENT_MEM_DIRNAME, agentType),
      recursive: true,
    }
  }
  return null
}

/**
 * Resolve a relative path against a base directory, guaranteeing the result
 * stays inside the base. Rejects absolute paths, null bytes, and any `..`
 * escape. Returns the absolute path on success, or throws a MemoryPathError.
 */
export function resolveWithin(baseDir: string, relPath: string): string {
  if (!relPath || typeof relPath !== 'string') {
    throw new MemoryPathError('A file path is required.')
  }
  if (relPath.includes('\0')) {
    throw new MemoryPathError('Path contains a null byte.')
  }
  if (path.isAbsolute(relPath)) {
    throw new MemoryPathError('Absolute paths are not allowed.')
  }
  const base = path.resolve(baseDir)
  const full = path.resolve(base, relPath)
  if (full !== base && !full.startsWith(base + path.sep)) {
    throw new MemoryPathError('Path escapes the memory store directory.')
  }
  return full
}

/** Thrown for invalid/escaping paths; routes map this to a 400. */
export class MemoryPathError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MemoryPathError'
  }
}

/**
 * Extract the project slug (the `projects/<slug>` directory name) embedded in
 * a host-side transcript path. Works for both file and directory paths.
 * Returns null when the path isn't under a projects dir.
 */
export function slugFromTranscriptPath(transcriptPath: string | null | undefined): string | null {
  if (!transcriptPath) return null
  const m = transcriptPath.replace(/\\/g, '/').match(/\/projects\/([^/]+)/)
  return m ? m[1] : null
}
