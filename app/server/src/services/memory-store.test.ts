import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Point the memory feature at a temp root BEFORE importing the modules that
// read config at import time. Dynamic import below picks up these env vars.
let tmpRoot: string
let mod: typeof import('./memory-store')
let pathsMod: typeof import('./memory-paths')

beforeAll(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'obs-mem-'))
  process.env.OPENCLAUDE_OBSERVE_MEMORY = '1'
  process.env.OPENCLAUDE_OBSERVE_MEMORY_CLAUDE_HOST_BASE = tmpRoot
  process.env.OPENCLAUDE_OBSERVE_MEMORY_CLAUDE_CONTAINER_BASE = ''
  mod = await import('./memory-store')
  pathsMod = await import('./memory-paths')
})

afterAll(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true })
})

const SLUG = '-home-user-proj'

async function seed() {
  const memDir = path.join(tmpRoot, 'projects', SLUG, 'memory')
  await fs.mkdir(memDir, { recursive: true })
  await fs.writeFile(
    path.join(memDir, 'MEMORY.md'),
    '# Memory Index\n\n- [A fact](a-fact.md) — a hook\n',
  )
  await fs.writeFile(
    path.join(memDir, 'a-fact.md'),
    [
      '---',
      'name: a-fact',
      'description: A test fact',
      'type: project',
      'status: current',
      'created_by_session: 11111111-2222-3333-4444-555555555555',
      'supersedes:',
      '  - old-fact.md',
      'triggers:',
      '  - tool:Bash',
      '---',
      '',
      '# A Fact',
      '',
      'The body references [[b-fact]].',
      '',
    ].join('\n'),
  )
  // auto-memory schema: type nested under metadata:
  await fs.writeFile(
    path.join(memDir, 'meta-fact.md'),
    [
      '---',
      'name: meta-fact',
      'description: nested schema fact',
      'metadata:',
      '  node_type: memory',
      '  type: feedback',
      '---',
      '',
      '# Meta Fact',
      '',
    ].join('\n'),
  )
  // a malformed frontmatter file
  await fs.writeFile(path.join(memDir, 'broken.md'), '---\n: : : not yaml\n---\nbody\n')
  // global instruction file + agent memory
  await fs.writeFile(path.join(tmpRoot, 'CLAUDE.md'), '# Global\n\nbe nice\n')
  const agentDir = path.join(tmpRoot, 'agent-memory', 'Explore')
  await fs.mkdir(agentDir, { recursive: true })
  await fs.writeFile(path.join(agentDir, 'MEMORY.md'), '# Explore agent\n')
  return memDir
}

beforeEach(async () => {
  await fs.rm(path.join(tmpRoot, 'projects'), { recursive: true, force: true })
  await fs.rm(path.join(tmpRoot, 'agent-memory'), { recursive: true, force: true })
  await fs.rm(path.join(tmpRoot, 'CLAUDE.md'), { force: true })
  await seed()
})

describe('path safety', () => {
  it('rejects traversal, absolute, and null-byte paths', () => {
    const base = path.join(tmpRoot, 'projects', SLUG, 'memory')
    expect(() => pathsMod.resolveWithin(base, '../../../etc/passwd')).toThrow()
    expect(() => pathsMod.resolveWithin(base, '/etc/passwd')).toThrow()
    expect(() => pathsMod.resolveWithin(base, 'a\0.md')).toThrow()
    expect(pathsMod.resolveWithin(base, 'a-fact.md')).toBe(path.join(base, 'a-fact.md'))
    expect(pathsMod.resolveWithin(base, 'sub/x.md')).toBe(path.join(base, 'sub/x.md'))
  })

  it('resolves store ids and rejects unsafe slugs', () => {
    expect(pathsMod.resolveStore('project:-home-user-proj', tmpRoot)?.kind).toBe('project')
    expect(pathsMod.resolveStore('global', tmpRoot)?.kind).toBe('global')
    expect(pathsMod.resolveStore('agent:Explore', tmpRoot)?.kind).toBe('agent')
    expect(pathsMod.resolveStore('project:../evil', tmpRoot)).toBeNull()
    expect(pathsMod.resolveStore('nonsense', tmpRoot)).toBeNull()
  })

  it('extracts slug from a transcript path', () => {
    expect(pathsMod.slugFromTranscriptPath('/home/u/.claude/projects/-x-y/abc.jsonl')).toBe('-x-y')
    expect(pathsMod.slugFromTranscriptPath(null)).toBeNull()
  })
})

describe('frontmatter compose round-trip', () => {
  it('serializes frontmatter + body', () => {
    const out = mod.composeFile({ name: 'x', type: 'project' }, '# Title\n\nbody\n')
    expect(out.startsWith('---\n')).toBe(true)
    expect(out).toContain('name: x')
    expect(out).toContain('# Title')
  })
  it('writes body-only when frontmatter is empty', () => {
    expect(mod.composeFile(null, 'just text')).toBe('just text\n')
    expect(mod.composeFile({}, 'just text\n')).toBe('just text\n')
  })
})

describe('listStores', () => {
  it('discovers project, global, and agent stores', async () => {
    const stores = await mod.listStores([
      {
        id: 7,
        name: 'My Project',
        slug: 'my-project',
        transcript_path: `/home/user/.claude/projects/${SLUG}/sess.jsonl`,
      },
    ])
    const proj = stores.find((s) => s.id === `project:${SLUG}`)
    expect(proj).toBeTruthy()
    expect(proj?.projectName).toBe('My Project')
    expect(proj?.fileCount).toBeGreaterThanOrEqual(3)
    expect(stores.find((s) => s.id === 'global')).toBeTruthy()
    expect(stores.find((s) => s.id === 'agent:Explore')).toBeTruthy()
  })
})

describe('searchAll', () => {
  it('finds files across stores by query', async () => {
    const hits = await mod.searchAll('fact', [])
    const names = hits.map((h) => h.file.name)
    expect(names).toContain('a-fact.md')
    expect(names).toContain('meta-fact.md')
    expect(hits.every((h) => h.storeId && h.storeLabel)).toBe(true)
  })
  it('returns recent files for an empty query', async () => {
    const hits = await mod.searchAll('', [])
    expect(hits.length).toBeGreaterThan(0)
  })
})

describe('file CRUD', () => {
  const store = () => pathsMod.resolveStore(`project:${SLUG}`, tmpRoot)!

  it('lists files with parsed headers, index first', async () => {
    const files = await mod.listFiles(store())
    expect(files[0].isIndex).toBe(true)
    const fact = files.find((f) => f.name === 'a-fact.md')!
    expect(fact.type).toBe('project')
    expect(fact.status).toBe('current')
    expect(fact.title).toBe('A Fact')
    expect(fact.links).toContain('b-fact')
  })

  it('reads type nested under metadata: (auto-memory schema)', async () => {
    const files = await mod.listFiles(store())
    const meta = files.find((f) => f.name === 'meta-fact.md')!
    expect(meta.type).toBe('feedback')
  })

  it('extracts supersedes + originating session id', async () => {
    const files = await mod.listFiles(store())
    const fact = files.find((f) => f.name === 'a-fact.md')!
    expect(fact.supersedes).toEqual(['old-fact.md'])
    expect(fact.sessionId).toBe('11111111-2222-3333-4444-555555555555')
  })

  it('extracts wikilink stems', () => {
    expect(mod.extractWikilinks('see [[foo]] and [[bar|Bar]] and [[baz#sec]]')).toEqual([
      'foo',
      'bar',
      'baz',
    ])
  })

  it('reads a file with parsed frontmatter and body', async () => {
    const file = await mod.readFile(store(), 'a-fact.md')
    expect(file.frontmatter?.name).toBe('a-fact')
    expect(file.frontmatterError).toBe(false)
    expect(file.body).toContain('[[b-fact]]')
  })

  it('flags malformed frontmatter without throwing', async () => {
    const file = await mod.readFile(store(), 'broken.md')
    expect(file.frontmatterError).toBe(true)
    expect(file.content).toContain('not yaml')
  })

  it('writes structured frontmatter + body', async () => {
    const updated = await mod.writeFile(store(), 'a-fact.md', {
      frontmatter: { name: 'a-fact', type: 'feedback', description: 'edited' },
      body: '# A Fact\n\nnew body\n',
    })
    expect(updated.frontmatter?.type).toBe('feedback')
    const reread = await mod.readFile(store(), 'a-fact.md')
    expect(reread.body).toContain('new body')
  })

  it('writes raw content verbatim', async () => {
    const raw = '---\nname: raw\n---\n\nraw body\n'
    const updated = await mod.writeFile(store(), 'a-fact.md', { content: raw })
    expect(updated.content).toBe(raw)
  })

  it('creates and deletes files; rejects duplicates', async () => {
    const created = await mod.createFile(store(), 'new-fact.md', {
      frontmatter: { name: 'new-fact', type: 'reference' },
      body: 'hello\n',
    })
    expect(created.name).toBe('new-fact.md')
    await expect(mod.createFile(store(), 'new-fact.md', { content: 'x' })).rejects.toThrow()
    await mod.deleteFile(store(), 'new-fact.md')
    await expect(mod.readFile(store(), 'new-fact.md')).rejects.toThrow()
  })

  it('rejects bad file names and escaping paths on write', async () => {
    await expect(mod.createFile(store(), 'no-ext', { content: 'x' })).rejects.toThrow()
    await expect(mod.writeFile(store(), '../escape.md', { content: 'x' })).rejects.toThrow()
  })

  it('global store only exposes instruction files', async () => {
    const g = pathsMod.resolveStore('global', tmpRoot)!
    const files = await mod.listFiles(g)
    expect(files.every((f) => f.name === 'CLAUDE.md' || f.name === 'CLAUDE.local.md')).toBe(true)
    await expect(mod.createFile(g, 'evil.md', { content: 'x' })).rejects.toThrow()
  })
})
