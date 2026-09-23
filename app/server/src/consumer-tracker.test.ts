import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'

// Each test gets a fresh module instance via vi.resetModules() + dynamic import.
// This avoids shared state between tests (the module-level Map, startedAt, etc).

describe('consumer-tracker', () => {
  let tracker: typeof import('./consumer-tracker')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let exitSpy: any

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.resetModules()

    vi.doMock('./config', () => ({
      config: {
        consumerTtlMs: 30_000,
        sweepIntervalMs: 10_000,
      },
    }))

    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)

    tracker = await import('./consumer-tracker')
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('heartbeat', () => {
    test('registers a consumer and returns count', () => {
      expect(tracker.heartbeat('mcp-1')).toBe(1)
      expect(tracker.getConsumerCount()).toBe(1)
    })

    test('tracks multiple consumers', () => {
      tracker.heartbeat('mcp-1')
      expect(tracker.heartbeat('mcp-2')).toBe(2)
      expect(tracker.getConsumerCount()).toBe(2)
    })

    test('refreshes existing consumer without incrementing count', () => {
      tracker.heartbeat('mcp-1')
      expect(tracker.heartbeat('mcp-1')).toBe(1)
    })
  })

  describe('deregister', () => {
    test('removes a consumer and returns the remaining count', () => {
      tracker.heartbeat('mcp-1')
      tracker.heartbeat('mcp-2')

      const result = tracker.deregister('mcp-1')
      expect(result).toEqual({ activeConsumers: 1 })
      expect(tracker.getConsumerCount()).toBe(1)
    })

    test('deregistering unknown id is a no-op', () => {
      tracker.heartbeat('mcp-1')
      const result = tracker.deregister('mcp-unknown')
      expect(result.activeConsumers).toBe(1)
    })
  })

  describe('sweep', () => {
    test('evicts consumers that exceed TTL', () => {
      tracker.heartbeat('mcp-1')
      expect(tracker.getConsumerCount()).toBe(1)

      // Advance past the 30s TTL
      vi.advanceTimersByTime(31_000)

      // Start sweep — it runs on an interval
      tracker.startConsumerSweep()
      vi.advanceTimersByTime(10_000) // trigger one sweep cycle

      expect(tracker.getConsumerCount()).toBe(0)
    })

    test('does not evict consumers with recent heartbeats', () => {
      tracker.startConsumerSweep()
      tracker.heartbeat('mcp-1')

      // Advance less than TTL
      vi.advanceTimersByTime(15_000)
      tracker.heartbeat('mcp-1') // refresh

      vi.advanceTimersByTime(15_000) // 30s total but heartbeat was refreshed at 15s

      expect(tracker.getConsumerCount()).toBe(1)
    })
  })

  // The server never shuts itself down (see consumer-tracker.ts header); losing
  // the last consumer or client must not exit the process.
  describe('no self-shutdown', () => {
    test('stays up after the last consumer deregisters', () => {
      tracker.startConsumerSweep()
      tracker.heartbeat('mcp-1')
      tracker.deregister('mcp-1')
      vi.advanceTimersByTime(10 * 60_000)
      expect(exitSpy).not.toHaveBeenCalled()
    })

    test('stays up after the last consumer is evicted by the sweep', () => {
      tracker.startConsumerSweep()
      tracker.heartbeat('mcp-1')
      vi.advanceTimersByTime(10 * 60_000)
      expect(tracker.getConsumerCount()).toBe(0)
      expect(exitSpy).not.toHaveBeenCalled()
    })
  })
})
