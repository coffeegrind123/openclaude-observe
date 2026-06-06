import { describe, it, expect } from 'vitest'
import {
  composeContent,
  parseContent,
  fileStem,
  resolveLink,
  backlinksFor,
  relativeTime,
  isArchivedStatus,
  statusRank,
  isStale,
  supersededBy,
  resolveSupersedes,
  readField,
  usesMetadataSchema,
} from './memory-lib'
import { validateTrigger } from './memory-frontmatter-form'
import type { MemoryFileHeader } from '@/types/memory'

function header(partial: Partial<MemoryFileHeader> & { relPath: string }): MemoryFileHeader {
  return {
    name: partial.relPath.split('/').pop()!,
    bytes: 0,
    mtimeMs: 0,
    isIndex: false,
    hasFrontmatter: false,
    title: partial.relPath,
    snippet: '',
    links: [],
    ...partial,
  }
}

describe('compose/parse round-trip', () => {
  it('composes frontmatter + body matching the server shape', () => {
    const out = composeContent({ name: 'x', type: 'project' }, '# Title\n\nbody\n')
    expect(out.startsWith('---\n')).toBe(true)
    expect(out).toContain('name: x')
    const parsed = parseContent(out)
    expect(parsed.frontmatter).toMatchObject({ name: 'x', type: 'project' })
    expect(parsed.body).toContain('# Title')
    expect(parsed.error).toBe(false)
  })

  it('round-trips through compose → parse → compose unchanged', () => {
    const fm = { name: 'a', type: 'feedback', triggers: ['tool:Bash'] }
    const body = '# A\n\nsome text\n'
    const once = composeContent(fm, body)
    const parsed = parseContent(once)
    const twice = composeContent(parsed.frontmatter, parsed.body)
    expect(twice).toBe(once)
  })

  it('writes body-only when frontmatter is empty', () => {
    expect(composeContent(null, 'plain text')).toBe('plain text\n')
    expect(composeContent({}, 'plain text\n')).toBe('plain text\n')
  })

  it('flags malformed frontmatter', () => {
    const parsed = parseContent('---\n: : bad\n---\nbody\n')
    expect(parsed.error).toBe(true)
    expect(parsed.frontmatter).toBeNull()
  })
})

describe('wikilink resolution', () => {
  const files = [
    header({ relPath: 'a-fact.md', links: ['b-fact'] }),
    header({ relPath: 'b-fact.md', links: [] }),
    header({ relPath: 'sub/c-fact.md', links: ['a-fact'] }),
  ]

  it('derives stems', () => {
    expect(fileStem('a-fact.md')).toBe('a-fact')
    expect(fileStem('sub/c-fact.md')).toBe('c-fact')
  })

  it('resolves a stem to a file case-insensitively', () => {
    expect(resolveLink('B-Fact', files)?.relPath).toBe('b-fact.md')
    expect(resolveLink('missing', files)).toBeUndefined()
  })

  it('computes backlinks', () => {
    const aBacklinks = backlinksFor(files[0], files)
    expect(aBacklinks.map((f) => f.relPath)).toEqual(['sub/c-fact.md'])
  })
})

describe('relativeTime', () => {
  it('handles null and recent times', () => {
    expect(relativeTime(null)).toBe('—')
    expect(relativeTime(Date.now())).toBe('just now')
    expect(relativeTime(Date.now() - 5 * 60_000)).toBe('5m ago')
  })
})

describe('status helpers', () => {
  it('classifies archived statuses', () => {
    expect(isArchivedStatus('superseded')).toBe(true)
    expect(isArchivedStatus('outdated')).toBe(true)
    expect(isArchivedStatus('current')).toBe(false)
    expect(isArchivedStatus(undefined)).toBe(false)
  })
  it('ranks active before archived', () => {
    expect(statusRank('current')).toBeLessThan(statusRank('superseded'))
    expect(statusRank('seedling')).toBeLessThan(statusRank('outdated'))
  })
  it('flags stale (90d+) but not archived files', () => {
    const old = Date.now() - 100 * 86_400_000
    expect(isStale(old)).toBe(true)
    expect(isStale(old, 'superseded')).toBe(false)
    expect(isStale(Date.now())).toBe(false)
  })
})

describe('supersedes', () => {
  const files = [
    header({ relPath: 'new.md', supersedes: ['old.md'] }),
    header({ relPath: 'old.md' }),
  ]
  it('computes reverse supersededBy', () => {
    expect(supersededBy(files[1], files).map((f) => f.relPath)).toEqual(['new.md'])
    expect(supersededBy(files[0], files)).toEqual([])
  })
  it('resolves a supersedes entry to a file', () => {
    expect(resolveSupersedes('old.md', files)?.relPath).toBe('old.md')
    expect(resolveSupersedes('old', files)?.relPath).toBe('old.md')
    expect(resolveSupersedes('missing', files)).toBeUndefined()
  })
})

describe('schema-adaptive field reads', () => {
  it('reads flat and metadata-wrapped fields', () => {
    expect(readField({ type: 'project' }, 'type')).toBe('project')
    expect(readField({ metadata: { type: 'feedback' } }, 'type')).toBe('feedback')
    expect(usesMetadataSchema({ metadata: { type: 'x' } })).toBe(true)
    expect(usesMetadataSchema({ type: 'x' })).toBe(false)
  })
})

describe('validateTrigger', () => {
  it('accepts valid kinds', () => {
    expect(validateTrigger('tool:Bash')).toBeNull()
    expect(validateTrigger('file:src/**/*.ts')).toBeNull()
  })
  it('rejects unknown kinds and empty patterns', () => {
    expect(validateTrigger('nope:x')).toMatch(/Unknown kind/)
    expect(validateTrigger('bash:')).toMatch(/empty/)
    expect(validateTrigger('noseparator')).toMatch(/kind:pattern/)
  })
})
