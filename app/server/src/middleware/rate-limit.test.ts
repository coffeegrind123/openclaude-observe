import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Context, Next } from 'hono'

const createMockContext = (ip?: string): Context => {
  return {
    req: {
      header: (name: string) => (name === 'x-forwarded-for' ? (ip ?? null) : undefined),
    },
    json: (body: unknown, status: number) =>
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  } as unknown as Context
}

describe('rateLimit', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  describe('basic behavior', () => {
    let rateLimit: (c: Context, next: Next) => Promise<void | Response>
    let next: ReturnType<typeof vi.fn>

    beforeEach(async () => {
      vi.resetModules()
      next = vi.fn()
      const mod = await import('./rate-limit')
      rateLimit = mod.rateLimit
    })

    test('first request passes through and calls next', async () => {
      const c = createMockContext('1.2.3.4')
      await rateLimit(c, next)
      expect(next).toHaveBeenCalledTimes(1)
    })

    test('max requests (1000) within window all pass through', async () => {
      const ip = '10.0.0.1'
      for (let i = 0; i < 1000; i++) {
        await rateLimit(createMockContext(ip), next)
      }
      expect(next).toHaveBeenCalledTimes(1000)
    })

    test('request 1001 returns 429 status', async () => {
      const ip = '10.0.0.2'
      // Fill the bucket to capacity
      for (let i = 0; i < 1000; i++) {
        await rateLimit(createMockContext(ip), vi.fn())
      }

      const result = await rateLimit(createMockContext(ip), vi.fn())
      expect(result).toBeInstanceOf(Response)
      const res = result as Response
      expect(res.status).toBe(429)

      const body = await res.json()
      expect(body).toEqual({ error: 'Too many requests' })
    })

    test('different IPs get their own independent counters', async () => {
      // Nearly fill one IP's quota
      for (let i = 0; i < 999; i++) {
        await rateLimit(createMockContext('192.168.0.1'), vi.fn())
      }

      // A different IP should still pass through
      await rateLimit(createMockContext('192.168.0.2'), next)
      expect(next).toHaveBeenCalledTimes(1)
    })

    test('falls back to "local" when no x-forwarded-for header is present', async () => {
      // First request with no IP header should pass
      await rateLimit(createMockContext(undefined), next)
      expect(next).toHaveBeenCalledTimes(1)

      // Fill the "local" bucket
      for (let i = 0; i < 999; i++) {
        await rateLimit(createMockContext(undefined), vi.fn())
      }

      // 1001st request for "local" should be rate limited
      const result = await rateLimit(createMockContext(undefined), vi.fn())
      expect((result as Response).status).toBe(429)
    })
  })

  describe('window expiry', () => {
    test('window resets after 60 seconds', async () => {
      vi.useFakeTimers()
      vi.resetModules()

      const mod = await import('./rate-limit')
      const rl = mod.rateLimit
      const ip = '10.0.0.99'

      // Fill the bucket to capacity
      for (let i = 0; i < 1000; i++) {
        await rl(createMockContext(ip), vi.fn())
      }

      // 1001st request should be rejected
      const failResult = await rl(createMockContext(ip), vi.fn())
      expect((failResult as Response).status).toBe(429)

      // Advance time past the 60-second window
      vi.advanceTimersByTime(61_000)

      // Now the window has reset — should pass again
      const passNext = vi.fn()
      await rl(createMockContext(ip), passNext)
      expect(passNext).toHaveBeenCalledTimes(1)
    })
  })
})
