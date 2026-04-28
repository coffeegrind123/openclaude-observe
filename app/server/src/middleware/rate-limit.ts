import type { Context, Next } from 'hono'

const windowMs = 60_000
const maxRequests = 1000
const store = new Map<string, { count: number; resetAt: number }>()

// Cleanup stale entries every 5 minutes
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of store) {
    if (entry.resetAt < now) store.delete(key)
  }
}, 300_000).unref()

export async function rateLimit(c: Context, next: Next) {
  const key = c.req.header('x-forwarded-for') || 'local'
  const now = Date.now()
  let entry = store.get(key)
  if (!entry || entry.resetAt < now) {
    entry = { count: 0, resetAt: now + windowMs }
    store.set(key, entry)
  }
  entry.count++
  if (entry.count > maxRequests) {
    return c.json({ error: 'Too many requests' }, 429)
  }
  await next()
}
