// Client mirrors of the server instructions DTOs
// (app/server/src/services/instructions-store.ts).

export type InstructionsStoreKind = 'home' | 'home-agents' | 'project'

/** What a file is to pi. */
export type InstructionsFileRole = 'context' | 'system' | 'append-system' | 'agent'

export interface InstructionsStore {
  id: string
  kind: InstructionsStoreKind
  /** Home path for home stores, project name for projects. */
  label: string
  /** Absolute directory the store's relPaths are relative to. */
  dir: string
  homeIndex?: number
  homePath?: string
  projectId?: number
  projectName?: string
  projectSlug?: string
  cwd?: string
  /** False when the base dir is missing (unmounted home, stale cwd). */
  available: boolean
  fileCount: number
  missingCount: number
  totalBytes: number
  /** Estimated tokens the store puts in front of the model (chars/4). */
  tokens: number
  lastModifiedMs: number | null
}

export interface AgentHeaderFields {
  name?: string
  displayName?: string
  description?: string
  model?: string
  thinking?: string
  hidden?: boolean
}

export interface InstructionsFileHeader {
  relPath: string
  name: string
  role: InstructionsFileRole
  /** False for an allowlisted file that doesn't exist yet (creatable). */
  exists: boolean
  bytes: number
  mtimeMs: number
  hasFrontmatter: boolean
  title: string
  snippet: string
  tokens: number
  bodyTokens: number
  links: string[]
  mdLinks: string[]
  /** relPath of the context file pi loads instead of this one, if shadowed. */
  shadowedBy: string | null
  description?: string
  agent?: AgentHeaderFields
}

export interface InstructionsFile {
  storeId: string
  relPath: string
  name: string
  role: InstructionsFileRole
  bytes: number
  mtimeMs: number
  content: string
  frontmatter: Record<string, unknown> | null
  frontmatterRaw: string | null
  body: string
  frontmatterError: boolean
  tokens: number
  bodyTokens: number
}

export interface InstructionsSearchHit {
  storeId: string
  storeLabel: string
  storeKind: InstructionsStoreKind
  file: InstructionsFileHeader
}

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
  agentName?: string
  shadowed: boolean
  broken: string[]
}

export interface InstructionsGraphEdge {
  source: string
  target: string
  kind: InstructionsEdgeKind
}

export interface InstructionsGraph {
  nodes: InstructionsGraphNode[]
  edges: InstructionsGraphEdge[]
}

export type ContextPartKind = 'context' | 'system' | 'append-system'
export type ContextPartOrigin = 'home' | 'ancestor' | 'project'

export interface ContextPart {
  kind: ContextPartKind
  origin: ContextPartOrigin
  absPath: string
  tokens: number
  storeId: string | null
  relPath: string | null
  requiresTrust?: boolean
}

export interface EffectiveContextForHome {
  homeIndex: number
  homePath: string
  likely: boolean
  parts: ContextPart[]
  totalTokens: number
}

export interface EffectiveContext {
  storeId: string
  homes: EffectiveContextForHome[]
}

/** pi-subagents-lite's accepted `thinking:` values (VALID_THINKING_LEVELS). */
export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

/** Per-file context-cost warning threshold (estimated tokens). */
export const FILE_TOKEN_WARN = 2_000

/** Warning threshold for a project's whole per-request context (estimated tokens). */
export const EFFECTIVE_TOKEN_WARN = 4_000
