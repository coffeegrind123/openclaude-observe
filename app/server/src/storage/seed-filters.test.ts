import { describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { RE2JS } from 're2js'
import { SEED_FILTERS } from './seed-filters'

const ENVELOPES: Record<string, unknown>[] = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    'routes',
    '__fixtures__',
    'pi-envelopes.jsonl',
  ),
  'utf8',
)
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l))

function envelope(hook: string): Record<string, unknown> {
  const e = ENVELOPES.find((x) => x.hook_event_name === hook)
  if (!e) {
    throw new Error(`fixture has no ${hook}`)
  }
  return e
}

// Mirrors the client matcher (lib/filters/matcher.ts): hook targets test the
// row's hook name; payload targets test JSON.stringify({ hookName, payload }).
function matches(filterId: string, hookName: string, payload: Record<string, unknown>): boolean {
  const f = SEED_FILTERS.find((s) => s.id === filterId)!
  const hits = f.patterns.map((p) => {
    const target = p.target === 'hook' ? hookName : JSON.stringify({ hookName, payload })
    const hit = RE2JS.compile(p.regex).matcher(target).find()
    return p.negate ? !hit : hit
  })
  return f.combinator === 'and' ? hits.every(Boolean) : hits.some(Boolean)
}

describe('default-errors seed', () => {
  test('tags a failed pi tool call when merged onto its PreToolUse row', () => {
    // With mergeToolEvents on, the row keeps the PreToolUse hook name and
    // takes the PostToolUseFailure payload.
    expect(matches('default-errors', 'PreToolUse', envelope('PostToolUseFailure'))).toBe(true)
  })

  test('tags the unmerged PostToolUseFailure row', () => {
    expect(matches('default-errors', 'PostToolUseFailure', envelope('PostToolUseFailure'))).toBe(
      true,
    )
  })

  test('leaves a successful tool call alone', () => {
    expect(matches('default-errors', 'PreToolUse', envelope('PostToolUse'))).toBe(false)
  })
})
