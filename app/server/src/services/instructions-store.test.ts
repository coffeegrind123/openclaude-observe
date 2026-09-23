import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { config } from '../config'
import type { EventStore } from '../storage/types'
import {
  classifyRelPath,
  parseProjectStoreId,
  resolveHomeStore,
  resolveWithin,
  projectStore,
} from './instructions-paths'
import {
  agentReferenceRe,
  buildGraph,
  composeFile,
  createFile,
  deleteFile,
  effectiveContext,
  estimateTokens,
  extractMdLinks,
  extractWikilinks,
  listFiles,
  listStores,
  readFile,
  resolveStore,
  searchAll,
  writeFile,
} from './instructions-store'

// Real directories under a temp root:
//   <tmp>/home-a/.pi/agent/{AGENTS.md,CLAUDE.md,SYSTEM.md,agents/explorer.md}
//   <tmp>/home-b                      (no .pi/agent — an unmounted home)
//   <tmp>/work/proj/{AGENTS.md,.pi/APPEND_SYSTEM.md,.pi/agents/reviewer.md,
//                    .agents/agents/shared.md,package.json,src/notes.md}
//   <tmp>/work/AGENTS.md              (ancestor context file)
let tmp: string
let homeA: string
let homeB: string
let proj: string
let savedHomes: string[]
let savedEnabled: boolean

function fakeEventStore(projects: Array<{ id: number; name: string; cwd: string | null }>) {
  return {
    // Mirrors the real adapter: getProjects() doesn't select cwd.
    getProjects: async () => projects.map(({ id, name }) => ({ id, name, slug: name })),
    getProjectById: async (id: number) => projects.find((p) => p.id === id) ?? null,
  } as unknown as EventStore
}

const AGENT_EXPLORER = [
  '---',
  'name: explorer',
  'description: Answers one investigation question',
  'tools: [read, grep, find]',
  'thinking: high',
  '---',
  '',
  'You are an explorer.',
  '',
].join('\n')

async function write(file: string, content: string) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, content)
}

async function exists(p: string) {
  try {
    await fs.lstat(p)
    return true
  } catch {
    return false
  }
}

beforeAll(async () => {
  tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'obs-instr-')))
  homeA = path.join(tmp, 'home-a')
  homeB = path.join(tmp, 'home-b')
  proj = path.join(tmp, 'work', 'proj')
  savedHomes = config.pi.homes
  savedEnabled = config.instructions.enabled
  config.pi.homes = [homeA, homeB]
  config.instructions.enabled = true
})

afterAll(async () => {
  config.pi.homes = savedHomes
  config.instructions.enabled = savedEnabled
  await fs.rm(tmp, { recursive: true, force: true })
})

beforeEach(async () => {
  await fs.rm(path.join(tmp, 'home-a'), { recursive: true, force: true })
  await fs.rm(path.join(tmp, 'home-b'), { recursive: true, force: true })
  await fs.rm(path.join(tmp, 'work'), { recursive: true, force: true })
  await fs.rm(path.join(tmp, 'outside'), { recursive: true, force: true })

  const agentDir = path.join(homeA, '.pi', 'agent')
  await write(path.join(agentDir, 'AGENTS.md'), '# Home rules\n\nDelegate lookups to `explorer`.\n')
  await write(path.join(agentDir, 'CLAUDE.md'), '# Shadowed\n')
  await write(path.join(agentDir, 'SYSTEM.md'), 'x'.repeat(400))
  await write(path.join(agentDir, 'agents', 'explorer.md'), AGENT_EXPLORER)
  await write(path.join(agentDir, 'agents', 'notes.txt'), 'not an agent')
  await fs.mkdir(homeB, { recursive: true })

  await write(path.join(tmp, 'work', 'AGENTS.md'), 'y'.repeat(80))
  await write(
    path.join(proj, 'AGENTS.md'),
    '# Project\n\nSee [the reviewer](.pi/agents/reviewer.md) and [[shared]] and [[nowhere]].\n',
  )
  await write(path.join(proj, '.pi', 'APPEND_SYSTEM.md'), 'Always run tests.\n')
  await write(
    path.join(proj, '.pi', 'agents', 'reviewer.md'),
    '---\nname: reviewer\ndescription: Reviews diffs\n---\n\nUse agent: "explorer" for lookups.\n',
  )
  await write(path.join(proj, '.agents', 'agents', 'shared.md'), '---\nname: shared\n---\n\nbody\n')
  await write(path.join(proj, 'package.json'), '{}')
  await write(path.join(proj, 'src', 'notes.md'), '# not an instruction file\n')
})

const projects = () => [
  { id: 1, name: 'proj', cwd: proj },
  { id: 2, name: 'proj-dupe', cwd: proj },
  { id: 3, name: 'no-cwd', cwd: null },
]

describe('path guards', () => {
  const home = () => resolveHomeStore('home:0')!
  const agents = () => resolveHomeStore('home-agents:0')!
  const project = () => projectStore(1, proj)

  it('classifies allowlisted files by role', () => {
    expect(classifyRelPath(home(), 'AGENTS.md')).toBe('context')
    expect(classifyRelPath(home(), 'AGENTS.MD')).toBe('context')
    expect(classifyRelPath(home(), 'SYSTEM.md')).toBe('system')
    expect(classifyRelPath(home(), 'APPEND_SYSTEM.md')).toBe('append-system')
    expect(classifyRelPath(agents(), 'explorer.md')).toBe('agent')
    expect(classifyRelPath(project(), 'AGENTS.override.md')).toBe('context')
    expect(classifyRelPath(project(), '.pi/SYSTEM.md')).toBe('system')
    expect(classifyRelPath(project(), '.pi/APPEND_SYSTEM.md')).toBe('append-system')
    expect(classifyRelPath(project(), '.pi/agents/x.md')).toBe('agent')
    expect(classifyRelPath(project(), '.agents/agents/x.md')).toBe('agent')
  })

  it('rejects traversal, absolute, null-byte and non-canonical paths', () => {
    for (const bad of [
      '../AGENTS.md',
      '.pi/agents/../../AGENTS.md',
      '.pi/agents/../SYSTEM.md',
      './AGENTS.md',
      '.pi//agents/x.md',
      '/etc/passwd',
      'AGENTS.md\0',
      '.pi\\agents\\x.md',
      '',
    ]) {
      expect(() => classifyRelPath(project(), bad), bad).toThrow()
    }
    expect(() => classifyRelPath(project(), 42)).toThrow()
  })

  it('rejects in-root paths that are not on the allowlist', () => {
    expect(() => classifyRelPath(project(), 'package.json')).toThrow(/not an instruction file/)
    expect(() => classifyRelPath(project(), 'src/notes.md')).toThrow()
    expect(() => classifyRelPath(project(), 'notes.md')).toThrow()
    expect(() => classifyRelPath(project(), 'SYSTEM.md')).toThrow()
    expect(() => classifyRelPath(project(), '.pi/settings.json')).toThrow()
    expect(() => classifyRelPath(project(), '.pi/agents/x.txt')).toThrow()
    expect(() => classifyRelPath(project(), '.pi/agents/sub/x.md')).toThrow()
    expect(() => classifyRelPath(home(), 'agents/explorer.md')).toThrow()
    expect(() => classifyRelPath(home(), 'settings.json')).toThrow()
    expect(() => classifyRelPath(agents(), 'sub/x.md')).toThrow()
    expect(() => classifyRelPath(agents(), '.md')).toThrow()
  })

  it('resolveWithin keeps paths inside the base', () => {
    expect(() => resolveWithin(proj, '../x')).toThrow()
    expect(() => resolveWithin(proj, '/etc/passwd')).toThrow()
    expect(() => resolveWithin(proj, 'a\0b')).toThrow()
    expect(() => resolveWithin(proj, '.')).toThrow()
    expect(resolveWithin(proj, '.pi/SYSTEM.md')).toBe(path.join(proj, '.pi', 'SYSTEM.md'))
  })

  it('parses store ids', () => {
    expect(resolveHomeStore('home:0')?.root).toBe(path.join(homeA, '.pi', 'agent'))
    expect(resolveHomeStore('home-agents:1')?.root).toBe(path.join(homeB, '.pi', 'agent', 'agents'))
    expect(resolveHomeStore('home:2')).toBeNull()
    expect(resolveHomeStore('home:-1')).toBeNull()
    expect(resolveHomeStore('home:../x')).toBeNull()
    expect(parseProjectStoreId('project:7')).toBe(7)
    expect(parseProjectStoreId('project:0')).toBeNull()
    expect(parseProjectStoreId('project:abc')).toBeNull()
    expect(parseProjectStoreId('global')).toBeNull()
  })

  it('resolves project stores from the DB cwd, and only with an absolute cwd', async () => {
    const es = fakeEventStore([...projects(), { id: 4, name: 'rel', cwd: 'relative/dir' }])
    expect((await resolveStore('project:1', es))?.root).toBe(proj)
    expect(await resolveStore('project:3', es)).toBeNull()
    expect(await resolveStore('project:4', es)).toBeNull()
    expect(await resolveStore('project:99', es)).toBeNull()
    expect(await resolveStore('nonsense', es)).toBeNull()
  })
})

describe('text helpers', () => {
  it('estimates tokens as chars/4', () => {
    expect(estimateTokens('')).toBe(0)
    expect(estimateTokens('abcd')).toBe(1)
    expect(estimateTokens('abcde')).toBe(2)
  })

  it('extracts wikilinks and local markdown links', () => {
    expect(extractWikilinks('see [[foo]] and [[bar|Bar]] and [[baz#sec]] [[q.md]]')).toEqual([
      'foo',
      'bar',
      'baz',
      'q',
    ])
    expect(
      extractMdLinks(
        '[a](x.md) [b](../y/AGENTS.md#top) [c](https://e.com/z.md) [d](<w.md>) [e](pic.png)',
      ),
    ).toEqual(['x.md', '../y/AGENTS.md', 'w.md'])
  })

  it('matches deliberate agent references but not prose', () => {
    const re = agentReferenceRe('worker')
    expect(re.test('use `worker` for it')).toBe(true)
    expect(re.test('agent: "worker"')).toBe(true)
    expect(re.test('spawn the worker agent')).toBe(true)
    expect(re.test('ask @worker')).toBe(true)
    expect(re.test('every worker thread in the pool')).toBe(false)
    expect(re.test('`workers`')).toBe(false)
  })

  it('composes body-only files without fences', () => {
    expect(composeFile(null, 'plain')).toBe('plain\n')
    expect(composeFile({}, 'plain\n')).toBe('plain\n')
    const out = composeFile({ name: 'x', tools: ['read'] }, 'body\n')
    expect(out.startsWith('---\nname: x\n')).toBe(true)
    expect(out).toContain('tools:\n  - read')
  })

  it('never folds long values (pi-subagents-lite reads frontmatter line by line)', () => {
    const long = 'word '.repeat(40).trim()
    const out = composeFile({ description: long }, 'b\n')
    expect(out.split('\n')[1]).toBe(`description: ${long}`)
  })
})

describe('listStores', () => {
  it('lists each home, its agents dir, and projects with a cwd (deduped)', async () => {
    const stores = await listStores(fakeEventStore(projects()))
    expect(stores.map((s) => s.id)).toEqual([
      'home:0',
      'home-agents:0',
      'home:1',
      'home-agents:1',
      'project:1',
    ])
    const home = stores[0]
    expect(home.label).toBe(homeA)
    expect(home.available).toBe(true)
    expect(home.fileCount).toBe(3)
    // AGENTS.override.md + APPEND_SYSTEM.md are creatable placeholders.
    expect(home.missingCount).toBe(2)
    // AGENTS.md + SYSTEM.md count; CLAUDE.md is shadowed by AGENTS.md.
    expect(home.tokens).toBe(
      estimateTokens('# Home rules\n\nDelegate lookups to `explorer`.\n') + 100,
    )
    expect(stores[1].fileCount).toBe(1)
    expect(stores[1].tokens).toBe(estimateTokens('You are an explorer.\n'))
    expect(stores[2].available).toBe(false)
    const p = stores[4]
    expect(p.label).toBe('proj')
    expect(p.cwd).toBe(proj)
    expect(p.fileCount).toBe(4)
  })
})

describe('listFiles', () => {
  it('lists home files with placeholders and shadowing', async () => {
    const files = await listFiles(resolveHomeStore('home:0')!)
    const by = Object.fromEntries(files.map((f) => [f.relPath, f]))
    expect(by['AGENTS.md'].exists).toBe(true)
    expect(by['AGENTS.md'].shadowedBy).toBeNull()
    expect(by['CLAUDE.md'].shadowedBy).toBe('AGENTS.md')
    expect(by['SYSTEM.md'].role).toBe('system')
    expect(by['SYSTEM.md'].tokens).toBe(100)
    expect(by['APPEND_SYSTEM.md'].exists).toBe(false)
    expect(by['AGENTS.override.md'].exists).toBe(false)
    // Optional spellings only appear when present.
    expect(by['AGENTS.MD']).toBeUndefined()
    // Existing files sort before placeholders.
    expect(files.findIndex((f) => !f.exists)).toBe(3)
  })

  it('an override file shadows AGENTS.md', async () => {
    await write(path.join(homeA, '.pi', 'agent', 'AGENTS.override.md'), 'override\n')
    const files = await listFiles(resolveHomeStore('home:0')!)
    const by = Object.fromEntries(files.map((f) => [f.relPath, f]))
    expect(by['AGENTS.override.md'].shadowedBy).toBeNull()
    expect(by['AGENTS.md'].shadowedBy).toBe('AGENTS.override.md')
    expect(by['CLAUDE.md'].shadowedBy).toBe('AGENTS.override.md')
  })

  it('parses subagent definitions and skips non-md files', async () => {
    const files = await listFiles(resolveHomeStore('home-agents:0')!)
    expect(files.map((f) => f.relPath)).toEqual(['explorer.md'])
    const f = files[0]
    expect(f.role).toBe('agent')
    expect(f.agent).toMatchObject({ name: 'explorer', thinking: 'high' })
    expect(f.title).toBe('explorer')
    expect(f.description).toBe('Answers one investigation question')
    expect(f.bodyTokens).toBe(estimateTokens('You are an explorer.\n'))
  })

  it('lists only allowlisted project files', async () => {
    const files = await listFiles(projectStore(1, proj))
    const paths = files.map((f) => f.relPath)
    expect(paths).toContain('AGENTS.md')
    expect(paths).toContain('.pi/APPEND_SYSTEM.md')
    expect(paths).toContain('.pi/agents/reviewer.md')
    expect(paths).toContain('.agents/agents/shared.md')
    expect(paths).not.toContain('package.json')
    expect(paths).not.toContain('src/notes.md')
    const sys = files.find((f) => f.relPath === '.pi/SYSTEM.md')!
    expect(sys.exists).toBe(false)
    const ctx = files.find((f) => f.relPath === 'AGENTS.md')!
    expect(ctx.links).toEqual(['shared', 'nowhere'])
    expect(ctx.mdLinks).toEqual(['.pi/agents/reviewer.md'])
  })

  it('throws store_unavailable for a missing base', async () => {
    await expect(listFiles(resolveHomeStore('home:1')!)).rejects.toMatchObject({
      code: 'store_unavailable',
    })
  })
})

describe('file CRUD', () => {
  const project = () => projectStore(1, proj)

  it('reads with parsed frontmatter and token estimates', async () => {
    const file = await readFile(project(), '.pi/agents/reviewer.md')
    expect(file.role).toBe('agent')
    expect(file.frontmatter).toMatchObject({ name: 'reviewer' })
    expect(file.body).toContain('Use agent')
    expect(file.frontmatterError).toBe(false)
    expect(file.bodyTokens).toBe(estimateTokens(file.body))
    const ctx = await readFile(project(), 'AGENTS.md')
    expect(ctx.frontmatter).toBeNull()
    expect(ctx.tokens).toBe(estimateTokens(ctx.content))
  })

  it('flags malformed frontmatter without throwing', async () => {
    await write(path.join(proj, '.pi', 'agents', 'bad.md'), '---\n: : : nope\n---\nbody\n')
    const file = await readFile(project(), '.pi/agents/bad.md')
    expect(file.frontmatterError).toBe(true)
  })

  it('writes raw content and structured frontmatter', async () => {
    const raw = await writeFile(project(), 'AGENTS.md', { content: '# New\n' })
    expect(raw.content).toBe('# New\n')
    const structured = await writeFile(project(), '.pi/agents/reviewer.md', {
      frontmatter: { name: 'reviewer', thinking: 'low' },
      body: 'Review.\n',
    })
    expect(structured.frontmatter).toMatchObject({ thinking: 'low' })
    expect(await fs.readFile(path.join(proj, '.pi', 'agents', 'reviewer.md'), 'utf8')).toContain(
      'thinking: low',
    )
    // No temp files left behind.
    const left = await fs.readdir(path.join(proj, '.pi', 'agents'))
    expect(left.filter((n) => n.includes('.tmp-'))).toEqual([])
  })

  it('creates missing allowlisted files, including new subdirs', async () => {
    const sys = await createFile(project(), '.pi/SYSTEM.md', { content: 'You are pi.\n' })
    expect(sys.role).toBe('system')
    const agent = await createFile(project(), '.agents/agents/new-one.md', {
      frontmatter: { name: 'new-one', description: 'd' },
      body: 'prompt\n',
    })
    expect(agent.frontmatter).toMatchObject({ name: 'new-one' })
    await fs.rm(path.join(proj, '.agents'), { recursive: true })
    await createFile(project(), '.agents/agents/again.md', { content: 'x\n' })
    expect(await exists(path.join(proj, '.agents', 'agents', 'again.md'))).toBe(true)
  })

  it('rejects duplicates on create', async () => {
    await expect(createFile(project(), 'AGENTS.md', { content: 'x' })).rejects.toMatchObject({
      code: 'already_exists',
    })
  })

  it('refuses to write outside the allowlist, even inside cwd', async () => {
    await expect(writeFile(project(), 'package.json', { content: 'pwned' })).rejects.toThrow()
    await expect(writeFile(project(), 'src/notes.md', { content: 'pwned' })).rejects.toThrow()
    await expect(createFile(project(), 'evil.md', { content: 'x' })).rejects.toThrow()
    await expect(
      writeFile(project(), '.pi/agents/../../../outside/AGENTS.md', { content: 'x' }),
    ).rejects.toThrow()
    await expect(deleteFile(project(), 'package.json')).rejects.toThrow()
    expect(await fs.readFile(path.join(proj, 'package.json'), 'utf8')).toBe('{}')
    expect(await exists(path.join(proj, 'evil.md'))).toBe(false)
    expect(await exists(path.join(tmp, 'outside'))).toBe(false)
  })

  it('never creates a missing store base', async () => {
    const gone = projectStore(9, path.join(tmp, 'work', 'gone'))
    await expect(writeFile(gone, 'AGENTS.md', { content: 'x' })).rejects.toMatchObject({
      code: 'store_unavailable',
    })
    expect(await exists(path.join(tmp, 'work', 'gone'))).toBe(false)
    const homeB0 = resolveHomeStore('home-agents:1')!
    await expect(createFile(homeB0, 'x.md', { content: 'x' })).rejects.toMatchObject({
      code: 'store_unavailable',
    })
    expect(await exists(path.join(homeB, '.pi'))).toBe(false)
  })

  it('enforces the size cap', async () => {
    const big = 'x'.repeat(config.instructions.maxFileBytes + 1)
    await expect(writeFile(project(), 'AGENTS.md', { content: big })).rejects.toMatchObject({
      code: 'file_too_large',
    })
  })

  it('writes through a symlinked file and keeps the link', async () => {
    const target = path.join(tmp, 'work', 'dotfiles-AGENTS.md')
    await write(target, 'linked\n')
    await fs.rm(path.join(proj, 'AGENTS.md'))
    await fs.symlink(target, path.join(proj, 'AGENTS.md'))
    await writeFile(project(), 'AGENTS.md', { content: 'edited\n' })
    expect((await fs.lstat(path.join(proj, 'AGENTS.md'))).isSymbolicLink()).toBe(true)
    expect(await fs.readFile(target, 'utf8')).toBe('edited\n')
    await deleteFile(project(), 'AGENTS.md')
    expect(await exists(path.join(proj, 'AGENTS.md'))).toBe(false)
    expect(await exists(target)).toBe(true)
  })

  it('deletes files', async () => {
    await deleteFile(project(), '.agents/agents/shared.md')
    await expect(readFile(project(), '.agents/agents/shared.md')).rejects.toThrow()
  })
})

describe('searchAll', () => {
  it('finds files across stores by title, path and content', async () => {
    const es = fakeEventStore(projects())
    const hits = await searchAll(es, 'explorer')
    const ids = hits.map((h) => `${h.storeId}::${h.file.relPath}`)
    expect(ids).toContain('home-agents:0::explorer.md')
    expect(ids).toContain('home:0::AGENTS.md')
    expect(ids).toContain('project:1::.pi/agents/reviewer.md')
    expect((await searchAll(es, '')).length).toBeGreaterThan(0)
    expect(await searchAll(es, 'zzz-no-match')).toEqual([])
  })
})

describe('buildGraph', () => {
  it('links wikilinks, markdown links and agent references across stores', async () => {
    const g = await buildGraph(fakeEventStore(projects()))
    const has = (s: string, t: string, kind: string) =>
      g.edges.some((e) => e.source === s && e.target === t && e.kind === kind)
    expect(has('project:1::AGENTS.md', 'project:1::.pi/agents/reviewer.md', 'mdlink')).toBe(true)
    expect(has('project:1::AGENTS.md', 'project:1::.agents/agents/shared.md', 'wikilink')).toBe(
      true,
    )
    // Home context file mentions `explorer` → the home's agent definition.
    expect(has('home:0::AGENTS.md', 'home-agents:0::explorer.md', 'agent')).toBe(true)
    // Project agent references the home agent across stores.
    expect(has('project:1::.pi/agents/reviewer.md', 'home-agents:0::explorer.md', 'agent')).toBe(
      true,
    )
    const ctx = g.nodes.find((n) => n.id === 'project:1::AGENTS.md')!
    expect(ctx.broken).toEqual(['[[nowhere]]'])
    const explorer = g.nodes.find((n) => n.id === 'home-agents:0::explorer.md')!
    expect(explorer.agentName).toBe('explorer')
    expect(g.nodes.find((n) => n.id === 'home:0::CLAUDE.md')?.shadowed).toBe(true)
    // Placeholders are not graph nodes.
    expect(g.nodes.some((n) => n.relPath === '.pi/SYSTEM.md')).toBe(false)
  })
})

describe('effectiveContext', () => {
  it('sums home + ancestor + project context; project files override home system files', async () => {
    const es = fakeEventStore(projects())
    await write(path.join(homeA, '.pi', 'agent', 'APPEND_SYSTEM.md'), 'z'.repeat(40))
    const ctx = await effectiveContext(projectStore(1, proj), es)
    expect(ctx.homes).toHaveLength(2)
    const a = ctx.homes.find((h) => h.homeIndex === 0)!
    const kinds = a.parts.map((p) => `${p.kind}:${p.origin}`)
    expect(kinds).toEqual([
      'context:home',
      'context:ancestor',
      'context:project',
      'system:home',
      'append-system:project',
    ])
    const append = a.parts.find((p) => p.kind === 'append-system')!
    expect(append.requiresTrust).toBe(true)
    expect(append.relPath).toBe('.pi/APPEND_SYSTEM.md')
    const ancestor = a.parts.find((p) => p.origin === 'ancestor')!
    expect(ancestor.absPath).toBe(path.join(tmp, 'work', 'AGENTS.md'))
    expect(ancestor.storeId).toBeNull()
    expect(a.totalTokens).toBe(a.parts.reduce((n, p) => n + p.tokens, 0))
    // home-b has no .pi/agent, so only the project-side files remain.
    const b = ctx.homes.find((h) => h.homeIndex === 1)!
    expect(b.parts.map((p) => p.origin)).toEqual(['ancestor', 'project', 'project'])
  })

  it('marks the home that contains the cwd as likely', async () => {
    const inHome = path.join(homeA, 'code')
    await fs.mkdir(inHome, { recursive: true })
    const ctx = await effectiveContext(projectStore(5, inHome), fakeEventStore([]))
    expect(ctx.homes[0].homeIndex).toBe(0)
    expect(ctx.homes[0].likely).toBe(true)
    expect(ctx.homes[1].likely).toBe(false)
  })

  it('home stores report only their own files', async () => {
    const ctx = await effectiveContext(resolveHomeStore('home:0')!, fakeEventStore([]))
    expect(ctx.homes).toHaveLength(1)
    expect(ctx.homes[0].parts.map((p) => p.kind)).toEqual(['context', 'system'])
  })
})
