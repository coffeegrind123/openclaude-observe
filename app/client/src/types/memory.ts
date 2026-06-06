// Client mirrors of the server memory DTOs (app/server/src/services/memory-store.ts).

export type MemoryStoreKind = 'project' | 'global' | 'agent'

export interface MemoryStore {
  id: string
  kind: MemoryStoreKind
  label: string
  slug?: string
  agentType?: string
  projectName?: string | null
  projectSlug?: string | null
  projectId?: number | null
  fileCount: number
  totalBytes: number
  lastModifiedMs: number | null
}

export interface MemoryFileHeader {
  relPath: string
  name: string
  bytes: number
  mtimeMs: number
  isIndex: boolean
  hasFrontmatter: boolean
  title: string
  snippet: string
  /** Outgoing [[wikilink]] target stems. */
  links: string[]
  description?: string
  type?: string
  status?: string
  provenance?: string
  /** Files this memory replaces (frontmatter `supersedes:`). */
  supersedes?: string[]
  /** Originating session UUID, if recorded in frontmatter. */
  sessionId?: string
}

export interface MemorySearchHit {
  storeId: string
  storeLabel: string
  storeKind: MemoryStoreKind
  file: MemoryFileHeader
}

/** Statuses considered "archived" — hidden from the default list view. */
export const ARCHIVED_STATUSES: readonly string[] = ['superseded', 'outdated']

export interface MemoryFile {
  storeId: string
  relPath: string
  name: string
  bytes: number
  mtimeMs: number
  isIndex: boolean
  content: string
  frontmatter: Record<string, unknown> | null
  frontmatterRaw: string | null
  body: string
  frontmatterError: boolean
}

/** Known memory taxonomy values from OpenClaude's memdir. */
export const MEMORY_TYPES = [
  'user',
  'feedback',
  'project',
  'reference',
  'structured-claim',
] as const

export const MEMORY_STATUSES = ['seedling', 'current', 'superseded', 'outdated'] as const

export const MEMORY_PROVENANCES = [
  'user-asked',
  'agent-decided',
  'dream-distilled',
  'session-summary',
  'manual',
] as const

/** Structured shape of an evidence entry in frontmatter. */
export interface MemoryEvidence {
  quote?: string
  source?: string
  timestamp?: string
}
