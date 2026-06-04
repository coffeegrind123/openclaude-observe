import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// The module maintains mutable module-level state. We must reset it between tests.
beforeEach(async () => {
  vi.resetModules()
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((cb: FrameRequestCallback) => {
      // Execute the callback immediately in tests (not deferred to next frame).
      // This matches the behavior we want to test: the lock is cleared by the
      // callback, and we can assert on its effects synchronously.
      cb(0)
      return 1
    }),
  )
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function importFresh() {
  return import('./scroll-sync')
}

describe('registerTimelineScroll', () => {
  it('should store a scroll function', async () => {
    const { registerTimelineScroll, getTimelineScrollTo } = await importFresh()
    const fn = vi.fn()
    registerTimelineScroll(fn)
    expect(getTimelineScrollTo()).toBe(fn)
  })

  it('should allow unregistering by passing null', async () => {
    const { registerTimelineScroll, getTimelineScrollTo } = await importFresh()
    const fn = vi.fn()
    registerTimelineScroll(fn)
    expect(getTimelineScrollTo()).toBe(fn)

    registerTimelineScroll(null)
    expect(getTimelineScrollTo()).toBeNull()
  })

  it('should replace a previously stored function', async () => {
    const { registerTimelineScroll, getTimelineScrollTo } = await importFresh()
    const fn1 = vi.fn()
    const fn2 = vi.fn()

    registerTimelineScroll(fn1)
    expect(getTimelineScrollTo()).toBe(fn1)

    registerTimelineScroll(fn2)
    expect(getTimelineScrollTo()).toBe(fn2)
  })
})

describe('registerEventStreamScroll', () => {
  it('should store a scroll function', async () => {
    const { registerEventStreamScroll, getEventStreamScrollTo } = await importFresh()
    const fn = vi.fn()
    registerEventStreamScroll(fn)
    expect(getEventStreamScrollTo()).toBe(fn)
  })

  it('should allow unregistering by passing null', async () => {
    const { registerEventStreamScroll, getEventStreamScrollTo } = await importFresh()
    const fn = vi.fn()
    registerEventStreamScroll(fn)
    expect(getEventStreamScrollTo()).toBe(fn)

    registerEventStreamScroll(null)
    expect(getEventStreamScrollTo()).toBeNull()
  })

  it('should replace a previously stored function', async () => {
    const { registerEventStreamScroll, getEventStreamScrollTo } = await importFresh()
    const fn1 = vi.fn()
    const fn2 = vi.fn()

    registerEventStreamScroll(fn1)
    expect(getEventStreamScrollTo()).toBe(fn1)

    registerEventStreamScroll(fn2)
    expect(getEventStreamScrollTo()).toBe(fn2)
  })
})

describe('getTimelineScrollTo', () => {
  it('should return null when nothing registered', async () => {
    const { getTimelineScrollTo } = await importFresh()
    expect(getTimelineScrollTo()).toBeNull()
  })
})

describe('getEventStreamScrollTo', () => {
  it('should return null when nothing registered', async () => {
    const { getEventStreamScrollTo } = await importFresh()
    expect(getEventStreamScrollTo()).toBeNull()
  })
})

describe('withSyncLock', () => {
  describe('lock acquisition', () => {
    it('should execute the given function when no lock is held', async () => {
      const { withSyncLock } = await importFresh()
      const fn = vi.fn()
      withSyncLock('timeline', fn)
      expect(fn).toHaveBeenCalledTimes(1)
    })

    it('should execute the function when lock is held by the same source', async () => {
      // Since requestAnimationFrame is mocked to execute immediately, the lock
      // is cleared synchronously inside withSyncLock. So each call starts fresh.
      // This test verifies that the same source doesn't block itself across
      // immediate calls.
      const { withSyncLock } = await importFresh()
      const fn1 = vi.fn()
      const fn2 = vi.fn()

      withSyncLock('timeline', fn1)
      withSyncLock('timeline', fn2)

      expect(fn1).toHaveBeenCalledTimes(1)
      expect(fn2).toHaveBeenCalledTimes(1)
    })
  })

  describe('feedback prevention', () => {
    it('should skip the function when the other source holds the lock', async () => {
      // To test this properly, we need the lock NOT to clear inside withSyncLock.
      // We override requestAnimationFrame to defer the callback (never call it),
      // so the lock persists between the two withSyncLock calls.
      vi.resetModules()

      vi.stubGlobal(
        'requestAnimationFrame',
        vi.fn(() => {
          return 1 // Return a RAF ID but never invoke the callback
        }),
      )
      vi.stubGlobal('cancelAnimationFrame', vi.fn())

      const { withSyncLock } = await import('./scroll-sync')

      const fnTimeline = vi.fn()
      const fnEventStream = vi.fn()

      // First call: timeline gets the lock
      withSyncLock('timeline', fnTimeline)
      expect(fnTimeline).toHaveBeenCalledTimes(1)

      // Second call: event-stream tries while timeline holds the lock → skipped
      withSyncLock('event-stream', fnEventStream)
      expect(fnEventStream).not.toHaveBeenCalled()
    })

    it('should skip when ANY lock is held by a different source', async () => {
      vi.resetModules()

      vi.stubGlobal(
        'requestAnimationFrame',
        vi.fn(() => 1),
      )
      vi.stubGlobal('cancelAnimationFrame', vi.fn())

      const { withSyncLock } = await import('./scroll-sync')

      const fn1 = vi.fn()
      const fn2 = vi.fn()

      // Event stream gets the lock
      withSyncLock('event-stream', fn1)
      expect(fn1).toHaveBeenCalledTimes(1)

      // Timeline tries while event-stream holds the lock → skipped
      withSyncLock('timeline', fn2)
      expect(fn2).not.toHaveBeenCalled()
    })
  })

  describe('lock lifecycle', () => {
    it('should schedule an animation frame to clear the lock', async () => {
      const rafSpy = vi.fn(() => 42)
      vi.resetModules()
      vi.stubGlobal('requestAnimationFrame', rafSpy)
      vi.stubGlobal('cancelAnimationFrame', vi.fn())

      const { withSyncLock } = await import('./scroll-sync')

      withSyncLock('timeline', vi.fn())

      expect(rafSpy).toHaveBeenCalledTimes(1)
    })

    it('should cancel the previous RAF if withSyncLock is called again before frame fires', async () => {
      // Mock RAF to never invoke callbacks — the lock persists across calls
      vi.resetModules()
      vi.stubGlobal(
        'requestAnimationFrame',
        vi.fn(() => 1),
      )
      const cafSpy = vi.fn()
      vi.stubGlobal('cancelAnimationFrame', cafSpy)

      const { withSyncLock } = await import('./scroll-sync')

      // First call acquires the lock, schedules RAF (ID 1), callback not called
      withSyncLock('timeline', vi.fn())
      expect(cafSpy).not.toHaveBeenCalled()

      // Second call: same source, sees pending RAF, cancels it
      withSyncLock('timeline', vi.fn())

      expect(cafSpy).toHaveBeenCalledWith(1)
    })
  })

  describe('registration + sync lock integration', () => {
    it('should support the full register-sync-unregister lifecycle', async () => {
      const { registerTimelineScroll, registerEventStreamScroll, withSyncLock } =
        await importFresh()

      const scrollTimeline = vi.fn()
      const scrollEvents = vi.fn()

      registerTimelineScroll(scrollTimeline)
      registerEventStreamScroll(scrollEvents)

      // Simulate timeline scroll triggering sync
      withSyncLock('timeline', () => {
        // In real code, this would call eventStreamScrollTo
        scrollTimeline(Date.now())
      })

      expect(scrollTimeline).toHaveBeenCalledTimes(1)
      // event stream wasn't called because withSyncLock doesn't know
      // about the registered callbacks — it just runs the fn
      expect(scrollEvents).not.toHaveBeenCalled()

      // Clean up
      registerTimelineScroll(null)
      registerEventStreamScroll(null)
    })
  })
})
