import { describe, it, expect } from 'vitest'
import { fuzzyScore, fuzzyRank } from './fuzzy'

describe('fuzzyScore', () => {
  it('returns null when not a subsequence', () => {
    expect(fuzzyScore('xyz', 'hello')).toBeNull()
  })
  it('scores subsequence matches, rewarding prefixes', () => {
    const prefix = fuzzyScore('he', 'hello')!
    const mid = fuzzyScore('ll', 'hello')!
    expect(prefix).toBeGreaterThan(mid)
  })
  it('empty query scores 0', () => {
    expect(fuzzyScore('', 'anything')).toBe(0)
  })
})

describe('fuzzyRank', () => {
  it('ranks better matches first', () => {
    const items = ['archived note', 'auth review', 'banana']
    const ranked = fuzzyRank('au', items, (s) => s).map((r) => r.item)
    expect(ranked[0]).toBe('auth review')
    expect(ranked).not.toContain('banana')
  })
})
