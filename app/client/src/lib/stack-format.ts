import type { StackSample } from '@/types/stack'

/** "63.9 t/s", "1,982 t/s", or an em dash for an idle/unknown rate. */
export function formatTps(tps: number | null | undefined): string {
  if (tps === null || tps === undefined || !Number.isFinite(tps)) {
    return '—'
  }
  return tps >= 100 ? `${Math.round(tps).toLocaleString()} t/s` : `${tps.toFixed(1)} t/s`
}

/** A 0..1 ratio as a whole percent. */
export function formatRatio(ratio: number | null | undefined): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) {
    return '—'
  }
  return `${Math.round(ratio * 100)}%`
}

/** 1284 → "1.3K", 98304 → "98.3K", 1_200_000 → "1.2M". */
export function compactTokens(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) {
    return '—'
  }
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1)}M`
  }
  if (n >= 1_000) {
    return `${(n / 1_000).toFixed(1)}K`
  }
  return String(Math.round(n))
}

export type ContextLevel = 'ok' | 'warn' | 'critical'

// pi compacts at the window minus its reserve (16K of 96K on this stack),
// so ~80% is where a compaction becomes imminent.
export const CONTEXT_WARN_PERCENT = 65
export const CONTEXT_CRITICAL_PERCENT = 80

export function contextLevel(percent: number): ContextLevel {
  if (percent >= CONTEXT_CRITICAL_PERCENT) {
    return 'critical'
  }
  if (percent >= CONTEXT_WARN_PERCENT) {
    return 'warn'
  }
  return 'ok'
}

/**
 * Token-weighted mean of a rate over samples: Σtokens / Σbusy-seconds, not the
 * mean of per-sample rates, which would let a 3-token interval count as much
 * as a 3,000-token one.
 */
export function weightedDecodeTps(samples: StackSample[]): number | null {
  let tokens = 0
  let seconds = 0
  for (const s of samples) {
    if (s.decodeTps && s.decodeTps > 0) {
      tokens += s.generatedTokens
      seconds += s.generatedTokens / s.decodeTps
    }
  }
  return seconds > 0 ? tokens / seconds : null
}

/** Draft acceptance over samples, weighted by drafted tokens. */
export function weightedAcceptance(samples: StackSample[]): number | null {
  let drafted = 0
  let accepted = 0
  for (const s of samples) {
    drafted += s.draftTokens
    accepted += s.acceptedTokens
  }
  return drafted > 0 ? accepted / drafted : null
}

/** Latest known context reading, walking back past samples forge didn't answer. */
export function latestContext(samples: StackSample[]) {
  for (let i = samples.length - 1; i >= 0; i--) {
    if (samples[i].context) {
      return samples[i].context
    }
  }
  return null
}
