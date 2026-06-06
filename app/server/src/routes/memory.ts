import { Hono } from 'hono'
import type { EventStore } from '../storage/types'
import { config } from '../config'
import {
  MemoryFileError,
  MemoryPathError,
  createFile,
  deleteFile,
  getMemoryRoot,
  listFiles,
  listStores,
  readFile,
  resolveStore,
  searchAll,
  writeFile,
  type WritePayload,
} from '../services/memory-store'

type Env = { Variables: { store: EventStore } }

const router = new Hono<Env>()

function disabled(c: Parameters<Parameters<typeof router.get>[1]>[0]) {
  return c.json(
    {
      error: 'disabled',
      message:
        'The memory browser is disabled. Set OPENCLAUDE_OBSERVE_MEMORY=1 (and mount ~/.claude) on the server to enable it.',
    },
    404,
  )
}

function notConfigured(c: Parameters<Parameters<typeof router.get>[1]>[0]) {
  return c.json(
    {
      error: 'not_configured',
      message:
        'No Claude config directory is configured. Set OPENCLAUDE_OBSERVE_MEMORY_CLAUDE_HOST_BASE (and the container mount in docker).',
    },
    404,
  )
}

/** Resolve a store id to its descriptor or send the appropriate error. */
function requireStore(c: any) {
  const root = getMemoryRoot()
  if (!root) return { error: notConfigured(c) as Response }
  const storeId = decodeURIComponent(c.req.param('storeId'))
  const store = resolveStore(storeId, root)
  if (!store) {
    return { error: c.json({ error: 'unknown_store', message: 'Unknown memory store.' }, 404) }
  }
  return { store }
}

function mapError(c: any, err: unknown) {
  if (err instanceof MemoryPathError) {
    return c.json({ error: 'bad_path', message: err.message }, 400)
  }
  if (err instanceof MemoryFileError) {
    const status = err.code === 'already_exists' ? 409 : err.code === 'file_too_large' ? 413 : 404
    return c.json({ error: err.code, message: err.message }, status)
  }
  const e = err as NodeJS.ErrnoException
  if (e?.code === 'ENOENT') {
    return c.json({ error: 'not_found', message: 'File not found.' }, 404)
  }
  if (e?.code === 'EACCES') {
    return c.json({ error: 'unreadable', message: `Permission denied: ${e.message}` }, 403)
  }
  throw err
}

// GET /memory/stores — every memory store under the Claude config root.
router.get('/memory/stores', async (c) => {
  if (!config.memory.enabled) return disabled(c)
  if (!getMemoryRoot()) return notConfigured(c)
  const store = c.get('store')
  let projectRows: any[] = []
  try {
    projectRows = await store.getProjects()
  } catch {
    projectRows = []
  }
  const stores = await listStores(projectRows)
  return c.json({ enabled: true, stores })
})

// GET /memory/search?q=&limit= — cross-store fuzzy file search (command palette).
router.get('/memory/search', async (c) => {
  if (!config.memory.enabled) return disabled(c)
  if (!getMemoryRoot()) return notConfigured(c)
  const store = c.get('store')
  let projectRows: any[] = []
  try {
    projectRows = await store.getProjects()
  } catch {
    projectRows = []
  }
  const q = c.req.query('q') ?? ''
  const limit = Math.min(parseInt(c.req.query('limit') ?? '100', 10) || 100, 500)
  const hits = await searchAll(q, projectRows, limit)
  return c.json({ hits })
})

// GET /memory/stores/:storeId/files — file headers for a store.
router.get('/memory/stores/:storeId/files', async (c) => {
  if (!config.memory.enabled) return disabled(c)
  const resolved = requireStore(c)
  if ('error' in resolved) return resolved.error
  try {
    const files = await listFiles(resolved.store)
    return c.json({ storeId: resolved.store.id, files })
  } catch (err) {
    return mapError(c, err)
  }
})

// GET /memory/stores/:storeId/file?path=<relPath> — full file contents.
router.get('/memory/stores/:storeId/file', async (c) => {
  if (!config.memory.enabled) return disabled(c)
  const resolved = requireStore(c)
  if ('error' in resolved) return resolved.error
  const relPath = c.req.query('path')
  if (!relPath) return c.json({ error: 'bad_path', message: 'A ?path= is required.' }, 400)
  try {
    const file = await readFile(resolved.store, relPath)
    return c.json(file)
  } catch (err) {
    return mapError(c, err)
  }
})

// PUT /memory/stores/:storeId/file?path=<relPath> — overwrite a file.
router.put('/memory/stores/:storeId/file', async (c) => {
  if (!config.memory.enabled) return disabled(c)
  const resolved = requireStore(c)
  if ('error' in resolved) return resolved.error
  const relPath = c.req.query('path')
  if (!relPath) return c.json({ error: 'bad_path', message: 'A ?path= is required.' }, 400)
  let payload: WritePayload
  try {
    payload = (await c.req.json()) as WritePayload
  } catch {
    return c.json({ error: 'bad_body', message: 'Request body must be JSON.' }, 400)
  }
  try {
    const file = await writeFile(resolved.store, relPath, payload)
    return c.json(file)
  } catch (err) {
    return mapError(c, err)
  }
})

// POST /memory/stores/:storeId/file — create a new file { name, content? | frontmatter+body }.
router.post('/memory/stores/:storeId/file', async (c) => {
  if (!config.memory.enabled) return disabled(c)
  const resolved = requireStore(c)
  if ('error' in resolved) return resolved.error
  let body: WritePayload & { name?: string }
  try {
    body = (await c.req.json()) as WritePayload & { name?: string }
  } catch {
    return c.json({ error: 'bad_body', message: 'Request body must be JSON.' }, 400)
  }
  if (!body.name) return c.json({ error: 'bad_body', message: 'A file name is required.' }, 400)
  try {
    const file = await createFile(resolved.store, body.name, body)
    return c.json(file, 201)
  } catch (err) {
    return mapError(c, err)
  }
})

// DELETE /memory/stores/:storeId/file?path=<relPath> — delete a file.
router.delete('/memory/stores/:storeId/file', async (c) => {
  if (!config.memory.enabled) return disabled(c)
  const resolved = requireStore(c)
  if ('error' in resolved) return resolved.error
  const relPath = c.req.query('path')
  if (!relPath) return c.json({ error: 'bad_path', message: 'A ?path= is required.' }, 400)
  try {
    await deleteFile(resolved.store, relPath)
    return c.json({ ok: true })
  } catch (err) {
    return mapError(c, err)
  }
})

export default router
