import { describe, test, expect } from 'vitest'
import { resolveTranscriptPath } from './transcript-path'

const CLAUDE = { host: '/Users/joe/.claude/projects', container: '/host/.claude/projects' }

describe('resolveTranscriptPath', () => {
  test('returns input unchanged when no base configured (local mode)', () => {
    expect(resolveTranscriptPath('/Users/joe/.claude/projects/foo/bar.jsonl', null)).toBe(
      '/Users/joe/.claude/projects/foo/bar.jsonl',
    )
  })

  test('skips a base with empty host or container (partial config)', () => {
    expect(
      resolveTranscriptPath('/Users/joe/.claude/projects/foo/bar.jsonl', {
        host: '/Users/joe/.claude/projects',
        container: '',
      }),
    ).toBe('/Users/joe/.claude/projects/foo/bar.jsonl')
  })

  test('replaces host base prefix with container base', () => {
    expect(resolveTranscriptPath('/Users/joe/.claude/projects/foo/bar.jsonl', CLAUDE)).toBe(
      '/host/.claude/projects/foo/bar.jsonl',
    )
  })

  test('exact host-base match maps cleanly', () => {
    expect(resolveTranscriptPath('/Users/joe/.claude/projects', CLAUDE)).toBe(
      '/host/.claude/projects',
    )
  })

  test('adjacent-prefix safety: projects-other not translated', () => {
    expect(resolveTranscriptPath('/Users/joe/.claude/projects-other/foo.jsonl', CLAUDE)).toBe(
      '/Users/joe/.claude/projects-other/foo.jsonl',
    )
  })

  test('path that does not match the base is returned unchanged', () => {
    expect(resolveTranscriptPath('/tmp/foo.jsonl', CLAUDE)).toBe('/tmp/foo.jsonl')
  })
})
