// Shared helpers + visual vocabulary for the memory browser.

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { ARCHIVED_STATUSES, type MemoryFileHeader } from '@/types/memory'

/** Whether a status means the memory is archived (hidden from default recall). */
export function isArchivedStatus(status?: string): boolean {
  return !!status && ARCHIVED_STATUSES.includes(status)
}

/** Sort rank for status: active first, archived last. */
export function statusRank(status?: string): number {
  switch (status) {
    case 'current':
      return 0
    case 'seedling':
      return 1
    case 'superseded':
      return 3
    case 'outdated':
      return 4
    default:
      return 2
  }
}

const STALE_DAYS = 90

export function daysSince(ts: number | null): number | null {
  if (!ts) return null
  return Math.floor((Date.now() - ts) / 86_400_000)
}

/** A memory is "stale" if untouched for 90+ days (and not already archived). */
export function isStale(ts: number | null, status?: string): boolean {
  if (isArchivedStatus(status)) return false
  const d = daysSince(ts)
  return d != null && d >= STALE_DAYS
}

/** Files that supersede the given file (reverse of its `supersedes:`). */
export function supersededBy(
  file: MemoryFileHeader,
  files: MemoryFileHeader[],
): MemoryFileHeader[] {
  const me = file.name.toLowerCase()
  const meStem = fileStem(file.relPath).toLowerCase()
  return files.filter(
    (f) =>
      f.relPath !== file.relPath &&
      (f.supersedes ?? []).some((s) => {
        const t = s.toLowerCase().replace(/\.md$/, '')
        return t === meStem || `${t}.md` === me || t === me
      }),
  )
}

/** Resolve a `supersedes:` entry (filename or stem) to a file in the store. */
export function resolveSupersedes(
  entry: string,
  files: MemoryFileHeader[],
): MemoryFileHeader | undefined {
  const stem = entry.toLowerCase().replace(/\.md$/, '')
  return files.find((f) => fileStem(f.relPath).toLowerCase() === stem)
}

export function relativeTime(ts: number | null): string {
  if (!ts) return '—'
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(ts).toLocaleDateString()
}

/** Tailwind classes for a memory `type` badge. */
export function typeBadgeClass(type?: string): string {
  switch (type) {
    case 'user':
      return 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30'
    case 'feedback':
      return 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30'
    case 'project':
      return 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
    case 'reference':
      return 'bg-violet-500/15 text-violet-600 dark:text-violet-400 border-violet-500/30'
    case 'structured-claim':
      return 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30'
    default:
      return 'bg-muted text-muted-foreground border-border'
  }
}

/**
 * Raw hex color for a memory `type`, mirroring `typeBadgeClass`'s palette
 * (Tailwind *-500). Used where a literal color is needed instead of a class —
 * notably the Cytoscape graph, which can't consume Tailwind utilities.
 */
export function typeColorHex(type?: string): string {
  switch (type) {
    case 'user':
      return '#3b82f6' // blue-500
    case 'feedback':
      return '#f59e0b' // amber-500
    case 'project':
      return '#10b981' // emerald-500
    case 'reference':
      return '#8b5cf6' // violet-500
    case 'structured-claim':
      return '#f43f5e' // rose-500
    default:
      return '#94a3b8' // slate-400
  }
}

/** Tailwind classes for a memory `status` badge. */
export function statusBadgeClass(status?: string): string {
  switch (status) {
    case 'seedling':
      return 'bg-lime-500/15 text-lime-600 dark:text-lime-400 border-lime-500/30'
    case 'current':
      return 'bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/30'
    case 'superseded':
      return 'bg-muted text-muted-foreground border-border line-through'
    case 'outdated':
      return 'bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30'
    default:
      return 'bg-muted text-muted-foreground border-border'
  }
}

/**
 * Read a logical frontmatter field that may live top-level (flat memdir schema)
 * or nested under `metadata:` (OpenClaude auto-memory schema). Top-level wins.
 */
export function readField(
  fm: Record<string, unknown> | null | undefined,
  key: string,
): string | undefined {
  if (!fm) return undefined
  const top = fm[key]
  if (typeof top === 'string') return top
  const meta = fm.metadata
  if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
    const v = (meta as Record<string, unknown>)[key]
    if (typeof v === 'string') return v
  }
  return undefined
}

/** True when the frontmatter uses the `metadata:` wrapper schema. */
export function usesMetadataSchema(fm: Record<string, unknown> | null | undefined): boolean {
  return !!(fm && fm.metadata && typeof fm.metadata === 'object' && !Array.isArray(fm.metadata))
}

/** The stem (basename without .md) used to resolve a wikilink. */
export function fileStem(relPath: string): string {
  const base = relPath.split('/').pop() ?? relPath
  return base.replace(/\.md$/i, '')
}

/** Resolve a wikilink stem to a file in the same store, if one exists. */
export function resolveLink(stem: string, files: MemoryFileHeader[]): MemoryFileHeader | undefined {
  const lower = stem.toLowerCase()
  return files.find((f) => fileStem(f.relPath).toLowerCase() === lower)
}

/** Files in the store that link TO the given file (incoming backlinks). */
export function backlinksFor(
  file: MemoryFileHeader,
  files: MemoryFileHeader[],
): MemoryFileHeader[] {
  const stem = fileStem(file.relPath).toLowerCase()
  return files.filter(
    (f) => f.relPath !== file.relPath && f.links.some((l) => l.toLowerCase() === stem),
  )
}

/** Split full file content into raw frontmatter text + body (client-side mirror). */
export function splitContent(content: string): { frontmatterRaw: string | null; body: string } {
  const m = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/)
  if (!m) return { frontmatterRaw: null, body: content }
  return { frontmatterRaw: m[1], body: content.slice(m[0].length) }
}

/**
 * Compose raw file text from a frontmatter object + body — must match the
 * server's composeFile() so round-tripping form↔raw is stable.
 */
export function composeContent(frontmatter: Record<string, unknown> | null, body: string): string {
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

/**
 * Parse raw file text into { frontmatter, body }. Returns frontmatter=null when
 * absent or unparseable so the caller can keep the user in raw mode.
 */
export function parseContent(content: string): {
  frontmatter: Record<string, unknown> | null
  body: string
  error: boolean
} {
  const { frontmatterRaw, body } = splitContent(content)
  if (frontmatterRaw == null) return { frontmatter: null, body, error: false }
  try {
    const parsed = parseYaml(frontmatterRaw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { frontmatter: parsed as Record<string, unknown>, body, error: false }
    }
    return { frontmatter: null, body, error: true }
  } catch {
    return { frontmatter: null, body, error: true }
  }
}
