import { describe, test, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'

const pollerMock = { current: null as null | { view: () => unknown } }

vi.mock('../services/stack-poller', () => ({
  getStackPoller: () => pollerMock.current,
}))

import stackRouter from './stack'

function makeApp() {
  const app = new Hono()
  app.route('/api', stackRouter)
  return app
}

describe('GET /api/stack', () => {
  beforeEach(() => {
    pollerMock.current = null
  })

  test('reports disabled when no poller is running', async () => {
    const res = await makeApp().request('/api/stack')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      status: { state: 'disabled' },
      latest: null,
      totals: null,
      samples: [],
    })
  })

  test("returns the poller's view", async () => {
    const view = { status: { state: 'ok' }, latest: { decodeTps: 60 }, totals: null, samples: [] }
    pollerMock.current = { view: () => view }

    const res = await makeApp().request('/api/stack')
    expect(await res.json()).toEqual(view)
  })
})
