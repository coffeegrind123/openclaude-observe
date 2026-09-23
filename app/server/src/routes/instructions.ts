import { Hono, type Context } from 'hono'
import type { EventStore } from '../storage/types'
import { config } from '../config'
import {
  InstructionsFileError,
  InstructionsPathError,
  buildGraph,
  createFile,
  deleteFile,
  effectiveContext,
  listFiles,
  listStores,
  readFile,
  resolveStore,
  searchAll,
  writeFile,
  type InstructionsStoreDescriptor,
  type WritePayload,
} from '../services/instructions-store'

type Env = { Variables: { store: EventStore } }
type Ctx = Context<Env>

const router = new Hono<Env>()

function disabled(c: Ctx) {
  return c.json(
    {
      error: 'disabled',
      message:
        'The instructions browser is disabled. Unset INSTANTCOFFEE_OBSERVE_INSTRUCTIONS (or set it to 1) on the server to enable it.',
    },
    404,
  )
}

/** Resolve the :storeId param to its descriptor or an error response. */
async function requireStore(
  c: Ctx,
): Promise<{ store: InstructionsStoreDescriptor } | { error: Response }> {
  const storeId = c.req.param('storeId') ?? ''
  const store = await resolveStore(storeId, c.get('store'))
  if (!store) {
    return {
      error: c.json(
        { error: 'unknown_store', message: `Unknown instruction store: ${storeId}` },
        404,
      ),
    }
  }
  return { store }
}

function mapError(c: Ctx, err: unknown) {
  if (err instanceof InstructionsPathError) {
    return c.json({ error: 'bad_path', message: err.message }, 400)
  }
  if (err instanceof InstructionsFileError) {
    const status =
      err.code === 'already_exists'
        ? 409
        : err.code === 'file_too_large'
          ? 413
          : err.code === 'store_unavailable'
            ? 409
            : 404
    return c.json({ error: err.code, message: err.message }, status)
  }
  const e = err as NodeJS.ErrnoException
  if (e?.code === 'ENOENT') {
    return c.json({ error: 'not_found', message: 'File not found.' }, 404)
  }
  if (e?.code === 'EACCES' || e?.code === 'EPERM' || e?.code === 'EROFS') {
    return c.json({ error: 'unwritable', message: `Permission denied: ${e.message}` }, 403)
  }
  throw err
}

async function readJson<T>(c: Ctx): Promise<T | null> {
  try {
    const body = await c.req.json()
    return body && typeof body === 'object' ? (body as T) : null
  } catch {
    return null
  }
}

// GET /instructions/stores — every pi home, its agents dir, and each project with a cwd.
router.get('/instructions/stores', async (c) => {
  if (!config.instructions.enabled) {
    return disabled(c)
  }
  const stores = await listStores(c.get('store'))
  return c.json({ enabled: true, homes: config.pi.homes, stores })
})

// GET /instructions/search?q=&limit= — cross-store search (command palette).
router.get('/instructions/search', async (c) => {
  if (!config.instructions.enabled) {
    return disabled(c)
  }
  const q = c.req.query('q') ?? ''
  const limit = Math.min(parseInt(c.req.query('limit') ?? '100', 10) || 100, 500)
  const hits = await searchAll(c.get('store'), q, limit)
  return c.json({ hits })
})

// GET /instructions/graph — cross-store link graph (wikilinks, md links, agent refs).
router.get('/instructions/graph', async (c) => {
  if (!config.instructions.enabled) {
    return disabled(c)
  }
  return c.json(await buildGraph(c.get('store')))
})

// GET /instructions/stores/:storeId/files — file headers incl. missing placeholders.
router.get('/instructions/stores/:storeId/files', async (c) => {
  if (!config.instructions.enabled) {
    return disabled(c)
  }
  const resolved = await requireStore(c)
  if ('error' in resolved) {
    return resolved.error
  }
  try {
    const files = await listFiles(resolved.store)
    return c.json({ storeId: resolved.store.id, files })
  } catch (err) {
    return mapError(c, err)
  }
})

// GET /instructions/stores/:storeId/context — effective per-request context, per pi home.
router.get('/instructions/stores/:storeId/context', async (c) => {
  if (!config.instructions.enabled) {
    return disabled(c)
  }
  const resolved = await requireStore(c)
  if ('error' in resolved) {
    return resolved.error
  }
  try {
    return c.json(await effectiveContext(resolved.store, c.get('store')))
  } catch (err) {
    return mapError(c, err)
  }
})

// GET /instructions/stores/:storeId/file?path=<relPath> — full file contents.
router.get('/instructions/stores/:storeId/file', async (c) => {
  if (!config.instructions.enabled) {
    return disabled(c)
  }
  const resolved = await requireStore(c)
  if ('error' in resolved) {
    return resolved.error
  }
  const relPath = c.req.query('path')
  if (!relPath) {
    return c.json({ error: 'bad_path', message: 'A ?path= is required.' }, 400)
  }
  try {
    return c.json(await readFile(resolved.store, relPath))
  } catch (err) {
    return mapError(c, err)
  }
})

// PUT /instructions/stores/:storeId/file?path=<relPath> — overwrite (or create) a file.
router.put('/instructions/stores/:storeId/file', async (c) => {
  if (!config.instructions.enabled) {
    return disabled(c)
  }
  const resolved = await requireStore(c)
  if ('error' in resolved) {
    return resolved.error
  }
  const relPath = c.req.query('path')
  if (!relPath) {
    return c.json({ error: 'bad_path', message: 'A ?path= is required.' }, 400)
  }
  const payload = await readJson<WritePayload>(c)
  if (!payload) {
    return c.json({ error: 'bad_body', message: 'Request body must be a JSON object.' }, 400)
  }
  try {
    return c.json(await writeFile(resolved.store, relPath, payload))
  } catch (err) {
    return mapError(c, err)
  }
})

// POST /instructions/stores/:storeId/file — create { path, content? | frontmatter+body }.
router.post('/instructions/stores/:storeId/file', async (c) => {
  if (!config.instructions.enabled) {
    return disabled(c)
  }
  const resolved = await requireStore(c)
  if ('error' in resolved) {
    return resolved.error
  }
  const body = await readJson<WritePayload & { path?: string }>(c)
  if (!body) {
    return c.json({ error: 'bad_body', message: 'Request body must be a JSON object.' }, 400)
  }
  if (!body.path) {
    return c.json({ error: 'bad_body', message: 'A file path is required.' }, 400)
  }
  try {
    return c.json(await createFile(resolved.store, body.path, body), 201)
  } catch (err) {
    return mapError(c, err)
  }
})

// DELETE /instructions/stores/:storeId/file?path=<relPath> — delete a file.
router.delete('/instructions/stores/:storeId/file', async (c) => {
  if (!config.instructions.enabled) {
    return disabled(c)
  }
  const resolved = await requireStore(c)
  if ('error' in resolved) {
    return resolved.error
  }
  const relPath = c.req.query('path')
  if (!relPath) {
    return c.json({ error: 'bad_path', message: 'A ?path= is required.' }, 400)
  }
  try {
    await deleteFile(resolved.store, relPath)
    return c.json({ ok: true })
  } catch (err) {
    return mapError(c, err)
  }
})

export default router
