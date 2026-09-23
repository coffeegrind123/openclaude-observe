// Strips base64 image payloads out of an incoming event before it is parsed,
// hashed and stored.
//
// Why at ingestion rather than in the client renderer: a renderer-side redaction
// leaves every blob in SQLite, where it bloats the DB, every /events response,
// every WebSocket broadcast and every search. Doing it here also runs before
// parseRawEvent's 1 MB guard, so an event carrying a screenshot is kept (with
// the image redacted) instead of being rejected as oversized.
//
// pi's observe extension already flattens tool-result images to
// "[image <mime>]", so these are the paths that can still carry image bytes:
//   - data URIs inside any string (prompts, tool_input, assistant text,
//     custom messages, tool details), e.g. `data:image/png;base64,iVBOR…`
//   - pi-ai image blocks `{ type: 'image', data, mimeType }` in object fields
//     the extension forwards as-is (tool `details`)
//   - Anthropic-style blocks `{ type: 'image', source: { type: 'base64', data } }`
//
// Only base64 runs longer than `maxChars` are replaced; short inline icons pass
// through. The extension clips free-text fields at 64 000 chars, so a large
// image usually arrives already cut mid-stream and could not be decoded
// anyway.

export const REDACTED_PREFIX = '[REDACTED base64'

// `data:[<mime>][;param]*;base64,<payload>`. The payload class includes the
// URL-safe alphabet; the run stops at the first non-base64 char, e.g. the
// extension's "…[truncated N of M chars]" marker.
const DATA_URI_RE =
  /data:([\w.+-]+\/[\w.+-]+)?((?:;[\w.+-]+=[\w.+-]+)*);base64,([A-Za-z0-9+/_=-]+)/gi

// Recursion guard. Real payloads are a few levels deep; this only stops a
// pathological document from blowing the stack.
const MAX_DEPTH = 64

function sentinel(chars: number): string {
  return `${REDACTED_PREFIX} ${chars} chars]`
}

interface Counter {
  count: number
}

function redactString(s: string, maxChars: number, counter: Counter): string {
  // Cheap pre-check: most strings contain no data URI at all.
  if (s.length <= maxChars || !s.includes(';base64,')) {
    return s
  }
  return s.replace(DATA_URI_RE, (match, mime: string | undefined, params: string, data: string) => {
    if (data.length <= maxChars) {
      return match
    }
    counter.count++
    return `data:${mime ?? ''}${params};base64,${sentinel(data.length)}`
  })
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function redactImageBlock(block: Record<string, unknown>, maxChars: number, counter: Counter) {
  // pi-ai ImageContent: { type: 'image', data: <base64>, mimeType }
  if (typeof block.data === 'string' && block.data.length > maxChars) {
    counter.count++
    block.data = sentinel(block.data.length)
  }
  // Anthropic: { type: 'image', source: { type: 'base64', media_type, data } }
  const source = block.source
  if (
    isRecord(source) &&
    source.type === 'base64' &&
    typeof source.data === 'string' &&
    source.data.length > maxChars
  ) {
    counter.count++
    source.data = sentinel(source.data.length)
  }
}

function walk(value: unknown, maxChars: number, counter: Counter, depth: number): unknown {
  if (typeof value === 'string') {
    return redactString(value, maxChars, counter)
  }
  if (depth >= MAX_DEPTH || typeof value !== 'object' || value === null) {
    return value
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      value[i] = walk(value[i], maxChars, counter, depth + 1)
    }
    return value
  }
  const obj = value as Record<string, unknown>
  if (obj.type === 'image') {
    redactImageBlock(obj, maxChars, counter)
  }
  for (const key of Object.keys(obj)) {
    obj[key] = walk(obj[key], maxChars, counter, depth + 1)
  }
  return obj
}

/**
 * Redacts base64 image data longer than `maxChars` in place and returns how
 * many blobs were replaced. `maxChars <= 0` disables redaction.
 */
export function redactImageData(payload: Record<string, unknown>, maxChars: number): number {
  if (maxChars <= 0) {
    return 0
  }
  const counter: Counter = { count: 0 }
  walk(payload, maxChars, counter, 0)
  return counter.count
}
