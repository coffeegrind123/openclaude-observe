// app/server/src/routes/models.ts
//
// Model pricing lookup. Serves the same models.dev map the transcript parser
// prices with (getModelsPricing: 24 h memory + disk cache, never throws), so
// the client can cost pi LLMGeneration events when a session has no readable
// transcript.
//
// This is a FALLBACK price. pi records the cost of every request itself
// (LLMGeneration `cost_usd`, transcript `usage.cost.total`) from the
// operator's own model config — the only source that knows a local model costs
// 0 — and that recorded cost always wins (transcript-parser callCostCents, the
// client's pi stats provider). models.dev only prices requests that carry none.

import { Hono } from 'hono'
import { apiError } from '../errors'
import type { ModelPricing } from '../transcript-parser/types'

const router = new Hono()

// One stats modal asks for the handful of models a session used; this only
// stops a crafted request from making the server build a huge response.
const MAX_IDS = 200

/**
 * Normalize a model id for a pricing lookup. models.dev keys are bare, undated
 * ids; pi reports whatever its provider config names the model, which can carry
 * router prefixes and release dates:
 *   "openrouter/openai/gpt-5.5"        → "gpt-5.5"
 *   "claude-sonnet-4-5-20250929"       → "claude-sonnet-4-5"
 *   "claude-sonnet-4-5@20250929"       → "claude-sonnet-4-5" (Vertex style)
 * The raw id is tried first, so exact matches are never shadowed.
 */
export function normalizeModelId(id: string): string {
  const bare = id.includes('/') ? id.slice(id.lastIndexOf('/') + 1) : id
  return bare.replace(/[-@]\d{8}$/, '')
}

router.get('/models/pricing', async (c) => {
  const ids = (c.req.query('ids') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (ids.length > MAX_IDS) {
    return apiError(c, 400, `At most ${MAX_IDS} model ids per request`)
  }

  // Lazy import keeps the pricing module graph out of server startup, like
  // the transcript-stats route.
  const { getModelsPricing } = await import('../transcript-parser/models-pricing')
  const pricing = await getModelsPricing()
  if (ids.length === 0) {
    return c.json({ pricing })
  }

  const out: Record<string, ModelPricing | null> = {}
  for (const id of ids) {
    out[id] = pricing[id] ?? pricing[normalizeModelId(id)] ?? null
  }
  return c.json({ pricing: out })
})

export default router
