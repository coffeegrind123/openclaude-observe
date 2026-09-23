import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Hono } from 'hono'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { config } from '../config'
import type { EventStore } from '../storage/types'
import router from './instructions'

type Env = { Variables: { store: EventStore } }

let tmp: string
let proj: string
let app: Hono<Env>
let savedHomes: string[]
let savedEnabled: boolean

beforeAll(async () => {
  tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'obs-instr-route-')))
  const home = path.join(tmp, 'home')
  proj = path.join(tmp, 'proj')
  await fs.mkdir(path.join(home, '.pi', 'agent', 'agents'), { recursive: true })
  await fs.writeFile(path.join(home, '.pi', 'agent', 'AGENTS.md'), '# Home\n')
  await fs.mkdir(proj, { recursive: true })
  await fs.writeFile(path.join(proj, 'package.json'), '{}')

  savedHomes = config.pi.homes
  savedEnabled = config.instructions.enabled
  config.pi.homes = [home]
  config.instructions.enabled = true

  const store = {
    getProjects: async () => [{ id: 1, name: 'proj', slug: 'proj' }],
    getProjectById: async (id: number) => (id === 1 ? { id: 1, name: 'proj', cwd: proj } : null),
  } as unknown as EventStore
  app = new Hono<Env>()
  app.use('*', async (c, next) => {
    c.set('store', store)
    await next()
  })
  app.route('/api', router)
})

afterAll(async () => {
  config.pi.homes = savedHomes
  config.instructions.enabled = savedEnabled
  await fs.rm(tmp, { recursive: true, force: true })
})

const fileUrl = (storeId: string, relPath: string) =>
  `/api/instructions/stores/${encodeURIComponent(storeId)}/file?path=${encodeURIComponent(relPath)}`

describe('instructions routes', () => {
  it('lists stores', async () => {
    const res = await app.request('/api/instructions/stores')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.stores.map((s: { id: string }) => s.id)).toEqual([
      'home:0',
      'home-agents:0',
      'project:1',
    ])
  })

  it('lists files and effective context for an encoded store id', async () => {
    const files = await app.request(
      `/api/instructions/stores/${encodeURIComponent('home:0')}/files`,
    )
    expect(files.status).toBe(200)
    expect((await files.json()).files[0].relPath).toBe('AGENTS.md')
    const ctx = await app.request(
      `/api/instructions/stores/${encodeURIComponent('project:1')}/context`,
    )
    expect(ctx.status).toBe(200)
    expect((await ctx.json()).homes[0].parts[0].relPath).toBe('AGENTS.md')
  })

  it('404s an unknown store', async () => {
    const res = await app.request(
      `/api/instructions/stores/${encodeURIComponent('project:9')}/files`,
    )
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('unknown_store')
  })

  it('creates (201), rejects duplicates (409), reads, updates and deletes', async () => {
    const create = await app.request(`/api/instructions/stores/project%3A1/file`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: '.pi/agents/helper.md',
        frontmatter: { name: 'helper' },
        body: 'hi\n',
      }),
    })
    expect(create.status).toBe(201)
    const dupe = await app.request(`/api/instructions/stores/project%3A1/file`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '.pi/agents/helper.md', content: 'x' }),
    })
    expect(dupe.status).toBe(409)

    const put = await app.request(fileUrl('project:1', '.pi/agents/helper.md'), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'raw\n' }),
    })
    expect(put.status).toBe(200)
    const get = await app.request(fileUrl('project:1', '.pi/agents/helper.md'))
    expect((await get.json()).content).toBe('raw\n')

    const del = await app.request(fileUrl('project:1', '.pi/agents/helper.md'), {
      method: 'DELETE',
    })
    expect(del.status).toBe(200)
    const gone = await app.request(fileUrl('project:1', '.pi/agents/helper.md'))
    expect(gone.status).toBe(404)
  })

  it('400s traversal and non-allowlisted paths without touching disk', async () => {
    for (const bad of ['../escape.md', 'package.json', '.pi/agents/../../x.md', '/etc/passwd']) {
      const res = await app.request(fileUrl('project:1', bad), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'pwned' }),
      })
      expect(res.status, bad).toBe(400)
      expect((await res.json()).error).toBe('bad_path')
    }
    expect(await fs.readFile(path.join(proj, 'package.json'), 'utf8')).toBe('{}')
  })

  it('400s a missing path and a non-object body', async () => {
    expect((await app.request(`/api/instructions/stores/home%3A0/file`)).status).toBe(400)
    const res = await app.request(fileUrl('home:0', 'AGENTS.md'), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: '"str"',
    })
    expect(res.status).toBe(400)
  })

  it('serves the graph and search', async () => {
    const graph = await app.request('/api/instructions/graph')
    expect(graph.status).toBe(200)
    expect(Array.isArray((await graph.json()).nodes)).toBe(true)
    const search = await app.request('/api/instructions/search?q=home')
    expect((await search.json()).hits.length).toBeGreaterThan(0)
  })

  it('404s everything when disabled', async () => {
    config.instructions.enabled = false
    try {
      const res = await app.request('/api/instructions/stores')
      expect(res.status).toBe(404)
      expect((await res.json()).error).toBe('disabled')
    } finally {
      config.instructions.enabled = true
    }
  })
})
