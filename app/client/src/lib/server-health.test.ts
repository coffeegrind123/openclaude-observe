import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getServerHealth } from './server-health'
import type { ServerHealth } from './server-health'

// The module caches its pending promise. We need to reload the module between
// tests to reset that state, OR we can test the memoization by not resetting.
// For isolation, we'll use vi.resetModules() in beforeEach.

const API_BASE = '/api'

beforeEach(async () => {
  vi.resetModules()
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function importFresh() {
  return import('./server-health')
}

describe('getServerHealth', () => {
  describe('successful response', () => {
    it('should return the parsed health JSON on ok response', async () => {
      const health: ServerHealth = {
        ok: true,
        id: 'server-1',
        version: '0.1.0',
        logLevel: 'info',
        runtime: 'node',
        dbPath: '/data/observe.db',
        activeConsumers: 3,
        activeClients: 2,
      }

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(health),
      } as Response)

      const { getServerHealth } = await importFresh()
      const result = await getServerHealth()

      expect(result).toEqual(health)
      expect(fetch).toHaveBeenCalledWith(`${API_BASE}/health`)
    })

    it('should return partial health objects (server may omit fields)', async () => {
      const health: ServerHealth = {
        ok: true,
        version: '0.1.0',
      }

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(health),
      } as Response)

      const { getServerHealth } = await importFresh()
      const result = await getServerHealth()

      expect(result).toEqual(health)
      expect(result?.ok).toBe(true)
      expect(result?.version).toBe('0.1.0')
      expect(result?.id).toBeUndefined()
    })

    it('should return an empty object if server returns empty JSON', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      } as Response)

      const { getServerHealth } = await importFresh()
      const result = await getServerHealth()

      expect(result).toEqual({})
    })
  })

  describe('non-ok response', () => {
    it('should return null when response is not ok', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      } as Response)

      const { getServerHealth } = await importFresh()
      const result = await getServerHealth()

      expect(result).toBeNull()
    })

    it('should return null on 404', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      } as Response)

      const { getServerHealth } = await importFresh()
      const result = await getServerHealth()

      expect(result).toBeNull()
    })

    it('should return null on 503', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
      } as Response)

      const { getServerHealth } = await importFresh()
      const result = await getServerHealth()

      expect(result).toBeNull()
    })
  })

  describe('network error', () => {
    it('should return null when fetch rejects (network failure)', async () => {
      vi.mocked(fetch).mockRejectedValue(new Error('Connection refused'))

      const { getServerHealth } = await importFresh()
      const result = await getServerHealth()

      expect(result).toBeNull()
    })

    it('should return null for non-Error rejections', async () => {
      vi.mocked(fetch).mockRejectedValue('unknown error')

      const { getServerHealth } = await importFresh()
      const result = await getServerHealth()

      expect(result).toBeNull()
    })
  })

  describe('memoization', () => {
    it('should reuse the same in-flight promise for multiple callers', async () => {
      const health: ServerHealth = { ok: true }

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(health),
      } as Response)

      const { getServerHealth } = await importFresh()

      // Call multiple times
      const p1 = getServerHealth()
      const p2 = getServerHealth()
      const p3 = getServerHealth()

      const [r1, r2, r3] = await Promise.all([p1, p2, p3])

      // All calls should resolve to the same value
      expect(r1).toEqual(health)
      expect(r2).toEqual(health)
      expect(r3).toEqual(health)

      // fetch should only have been called once (memoized)
      expect(fetch).toHaveBeenCalledTimes(1)
    })

    it('should return the same resolved value on subsequent calls after promise settles', async () => {
      const health: ServerHealth = { ok: true, version: '1.0.0' }

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(health),
      } as Response)

      const { getServerHealth } = await importFresh()

      // First call settles the promise
      await getServerHealth()

      // Second call uses the memoized (settled) promise
      const result = await getServerHealth()

      expect(result).toEqual(health)
      expect(fetch).toHaveBeenCalledTimes(1)
    })

    it('should memoize null results too', async () => {
      vi.mocked(fetch).mockRejectedValue(new Error('down'))

      const { getServerHealth } = await importFresh()

      await getServerHealth()
      const result = await getServerHealth()

      expect(result).toBeNull()
      expect(fetch).toHaveBeenCalledTimes(1)
    })
  })

  describe('request details', () => {
    it('should call the /health endpoint on the API base', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ok: true }),
      } as Response)

      const { getServerHealth } = await importFresh()
      await getServerHealth()

      expect(fetch).toHaveBeenCalledWith(`${API_BASE}/health`)
    })

    it('should not pass any request init options', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ok: true }),
      } as Response)

      const { getServerHealth } = await importFresh()
      await getServerHealth()

      // fetch called with exactly one argument (just the URL)
      expect(fetch).toHaveBeenCalledWith(`${API_BASE}/health`)
    })
  })
})
