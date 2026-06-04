import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Hono } from 'hono'

describe('changelog route', () => {
  describe('GET /changelog — changelog found', () => {
    let app: Hono

    beforeEach(async () => {
      vi.resetModules()

      vi.doMock('fs', () => ({
        readFileSync: vi.fn().mockReturnValue('# Changelog\n\n## v1.0.0\n\nFirst release'),
      }))
      vi.doMock('url', () => ({
        fileURLToPath: vi.fn().mockReturnValue('/fake/app/server/src/routes/changelog.ts'),
      }))

      const { default: changelogRouter } = await import('./changelog')
      app = new Hono()
      app.route('/api', changelogRouter)
    })

    it('returns 200 with markdown content', async () => {
      const res = await app.request('/api/changelog')
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toEqual({ markdown: '# Changelog\n\n## v1.0.0\n\nFirst release' })
    })
  })

  describe('GET /changelog — changelog not found on any path', () => {
    let app: Hono

    beforeEach(async () => {
      vi.resetModules()

      vi.doMock('fs', () => ({
        readFileSync: vi.fn().mockImplementation(() => {
          throw new Error('ENOENT: no such file or directory')
        }),
      }))
      vi.doMock('url', () => ({
        fileURLToPath: vi.fn().mockReturnValue('/fake/app/server/src/routes/changelog.ts'),
      }))

      const { default: changelogRouter } = await import('./changelog')
      app = new Hono()
      app.route('/api', changelogRouter)
    })

    it('returns 404 when changelog file is not found', async () => {
      const res = await app.request('/api/changelog')
      expect(res.status).toBe(404)
      const body = await res.json()
      expect(body.error).toBeDefined()
      expect(body.error.message).toBe('Changelog not found')
    })
  })

  describe('GET /changelog — some paths fail, last succeeds', () => {
    let app: Hono

    beforeEach(async () => {
      vi.resetModules()

      let callCount = 0
      vi.doMock('fs', () => ({
        readFileSync: vi.fn().mockImplementation(() => {
          callCount++
          if (callCount === 1) throw new Error('ENOENT')
          if (callCount === 2) throw new Error('ENOENT')
          return '# Fallback changelog from /app'
        }),
      }))
      vi.doMock('url', () => ({
        fileURLToPath: vi.fn().mockReturnValue('/fake/app/server/src/routes/changelog.ts'),
      }))

      const { default: changelogRouter } = await import('./changelog')
      app = new Hono()
      app.route('/api', changelogRouter)
    })

    it('falls back through paths until it finds the file', async () => {
      const res = await app.request('/api/changelog')
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.markdown).toBe('# Fallback changelog from /app')
    })
  })

  describe('GET /changelog — does not require env variables', () => {
    it('works with a plain Hono app (no middleware)', async () => {
      vi.resetModules()

      vi.doMock('fs', () => ({
        readFileSync: vi.fn().mockReturnValue('minimal'),
      }))
      vi.doMock('url', () => ({
        fileURLToPath: vi.fn().mockReturnValue('/fake/app/server/src/routes/changelog.ts'),
      }))

      const { default: changelogRouter } = await import('./changelog')
      const plainApp = new Hono()
      plainApp.route('/', changelogRouter)

      const res = await plainApp.request('/changelog')
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.markdown).toBe('minimal')
    })
  })
})
