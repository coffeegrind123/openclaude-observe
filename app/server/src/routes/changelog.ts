// app/server/src/routes/changelog.ts

import { Hono } from 'hono'
import { resolve, dirname } from 'path'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { apiError } from '../errors'

const router = new Hono()

function readChangelog(): string | null {
  const dir = dirname(fileURLToPath(import.meta.url))
  const paths = [
    resolve(dir, '../../../../CHANGELOG.md'), // dev: app/server/src/routes -> root
    resolve(dir, '../../../CHANGELOG.md'), // Docker: /app/server/src/routes -> /app
    '/app/CHANGELOG.md', // Docker fallback
  ]
  for (const p of paths) {
    try {
      return readFileSync(p, 'utf8')
    } catch {
      continue
    }
  }
  return null
}

router.get('/changelog', (c) => {
  const markdown = readChangelog()
  if (!markdown) {
    return apiError(c, 404, 'Changelog not found')
  }
  return c.json({ markdown })
})

export default router
