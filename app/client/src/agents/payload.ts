// Small, typed accessors for untyped event payloads. Every agent class reads
// payloads through these so a field of the wrong type reads as absent instead
// of rendering "[object Object]" or NaN.

export type Payload = Record<string, unknown>

export const TOOL_SUBTYPES: ReadonlySet<string> = new Set([
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
])

export function isToolSubtype(subtype: string | null | undefined): boolean {
  return subtype != null && TOOL_SUBTYPES.has(subtype)
}

export function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

export function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

export function bool(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined
}

export function obj(v: unknown): Payload | undefined {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Payload) : undefined
}

/** Collapse whitespace/newlines into one line and strip the lightest markdown. */
export function oneLine(s: string): string {
  return s
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^[-*] /gm, '')
    .replace(/\s*\n\s*/g, ' ')
    .trim()
}

/** Strip the cwd prefix so paths read relative to the project. */
export function relPath(fp: string | undefined, cwd: string | undefined): string {
  if (!fp) {
    return ''
  }
  if (cwd && fp.startsWith(cwd)) {
    const rel = fp.slice(cwd.length)
    return rel.startsWith('/') ? rel.slice(1) : rel
  }
  return fp
}

/** 6652 → "6.7k", 98304 → "98.3k", 247 → "247". */
export function formatTokens(n: number | undefined): string {
  if (n == null) {
    return '—'
  }
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1)}M`
  }
  if (n >= 1000) {
    return `${(n / 1000).toFixed(1)}k`
  }
  return String(n)
}

/** 9312 → "9.3s", 412 → "412ms". */
export function formatMs(ms: number | undefined): string {
  if (ms == null) {
    return '—'
  }
  if (ms < 1000) {
    return `${Math.round(ms)}ms`
  }
  if (ms < 60_000) {
    return `${(ms / 1000).toFixed(1)}s`
  }
  const min = Math.floor(ms / 60_000)
  const sec = Math.round((ms - min * 60_000) / 1000)
  return `${min}m ${sec}s`
}

/** Rough token estimate for display only: ~4 chars per token. */
export function estimateTokens(chars: number): number {
  return Math.max(1, Math.ceil(chars / 4))
}

export function plural(n: number, word: string, pluralWord = `${word}s`): string {
  return `${n} ${n === 1 ? word : pluralWord}`
}

/**
 * Compact `k=v` rendering of a tool's scalar arguments, for tools whose
 * argument shape we don't know (MCP direct tools, third-party extensions).
 */
export function summarizeArgs(input: Payload | undefined, max = 3): string {
  if (!input) {
    return ''
  }
  const parts: string[] = []
  for (const [k, v] of Object.entries(input)) {
    if (k.startsWith('_')) {
      continue
    }
    if (typeof v === 'string' && v.length > 0) {
      parts.push(`${k}=${oneLine(v)}`)
    } else if (typeof v === 'number' || typeof v === 'boolean') {
      parts.push(`${k}=${v}`)
    }
    if (parts.length >= max) {
      break
    }
  }
  return parts.join(' ')
}

/** Stringify a value for a code block: strings as-is, everything else as JSON. */
export function asText(v: unknown): string {
  if (v == null) {
    return ''
  }
  if (typeof v === 'string') {
    return v
  }
  try {
    return JSON.stringify(v, null, 2)
  } catch {
    return String(v)
  }
}
