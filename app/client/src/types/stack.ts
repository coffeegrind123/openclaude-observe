// Mirrors app/server/src/services/stack-metrics.ts — the inference stack's
// llama-server /metrics and forge /forge/usage, as polled by the server.

export interface ForgeUsage {
  currentTokens: number
  contextWindow: number
  percent: number
  model: string | null
}

export interface StackSample {
  at: number
  intervalMs: number
  /** Rates over the interval; null when the stack was idle for all of it. */
  decodeTps: number | null
  prefillTps: number | null
  acceptance: number | null
  acceptedPerDraft: number | null
  cacheReuse: number | null
  generatedTokens: number
  prefillTokens: number
  cachedTokens: number
  draftTokens: number
  acceptedTokens: number
  drafts: number
  requestsProcessing: number
  requestsDeferred: number
  context: ForgeUsage | null
}

export interface StackTotals {
  generatedTokens: number
  prefillTokens: number
  cachedTokens: number
  drafts: number
  draftTokens: number
  acceptance: number | null
  acceptedPerDraft: number | null
  cacheReuse: number | null
  decodeTps: number | null
  prefillTps: number | null
  acceptedPerPos: number[]
}

export type StackState = 'disabled' | 'starting' | 'ok' | 'stalled' | 'unreachable'

export interface StackStatus {
  state: StackState
  llamaUrl?: string
  forgeUrl?: string
  pollMs?: number
  lastOkAt?: number | null
  lastError?: string | null
  restarts?: number
}

export interface StackMetricsView {
  status: StackStatus
  latest: StackSample | null
  totals: StackTotals | null
  samples: StackSample[]
}
