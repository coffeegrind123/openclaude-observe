// app/server/src/app.ts
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from '@hono/node-server/serve-static'
import path from 'path'
import fs from 'fs'
import type { EventStore } from './storage/types'
import { config } from './config'

import eventsRouter from './routes/events'
import projectsRouter from './routes/projects'
import sessionsRouter from './routes/sessions'
import agentsRouter from './routes/agents'
import adminRouter from './routes/admin'
import healthRouter from './routes/health'
import consumerRouter from './routes/consumer'
import callbacksRouter from './routes/callbacks'
import notificationsRouter from './routes/notifications'
import changelogRouter from './routes/changelog'
import instancesRouter from './routes/instances'
import transcriptStatsRouter from './routes/transcript-stats'
import filtersRouter from './routes/filters'
import memoryRouter from './routes/memory'

type Env = {
  Variables: {
    store: EventStore
    broadcastToSession: (sessionId: string, msg: object) => void
    broadcastToAll: (msg: object) => void
    broadcastActivity: (sessionId: string, eventId: number) => void
  }
}

export function createApp(
  store: EventStore,
  broadcastToSession: (sessionId: string, msg: object) => void,
  broadcastToAll: (msg: object) => void,
  broadcastActivity: (sessionId: string, eventId: number) => void,
) {
  const app = new Hono<Env>()

  // Body size limiter — must be before CORS and route setup
  app.use('*', async (c, next) => {
    const contentLength = c.req.header('content-length')
    if (contentLength && parseInt(contentLength) > 10_000_000) {
      // 10 MB
      return c.json({ error: 'Request body too large' }, 413)
    }
    await next()
  })

  app.use(
    '*',
    cors({
      origin: (origin) => {
        // Allow requests with no origin (curl, server-to-server)
        if (!origin) return null
        // Allow localhost on any port
        if (origin.match(/^https?:\/\/localhost(:\d+)?$/)) return origin
        // Allow local IPs
        if (origin.match(/^https?:\/\/127\.0\.0\.1(:\d+)?$/)) return origin
        if (origin.match(/^https?:\/\/\[::1\](:\d+)?$/)) return origin
        // Deny everything else
        return null
      },
    }),
  )

  // Inject store and broadcast into all routes
  app.use('*', async (c, next) => {
    c.set('store', store)
    c.set('broadcastToSession', broadcastToSession)
    c.set('broadcastToAll', broadcastToAll)
    c.set('broadcastActivity', broadcastActivity)
    await next()
  })

  app.route('/api', eventsRouter)
  app.route('/api', projectsRouter)
  app.route('/api', sessionsRouter)
  app.route('/api', agentsRouter)
  app.route('/api', adminRouter)
  app.route('/api', healthRouter)
  app.route('/api', consumerRouter)
  app.route('/api', callbacksRouter)
  app.route('/api', notificationsRouter)
  app.route('/api', changelogRouter)
  app.route('/api', instancesRouter)
  app.route('/api', transcriptStatsRouter)
  app.route('/api', filtersRouter)
  app.route('/api', memoryRouter)

  // Global error handler — catches any uncaught exception from a route
  // handler and returns a JSON error response so the UI can surface it
  // via a toast. Always logs the full error server-side for debugging.
  app.onError((err, c) => {
    console.error('[server] Unhandled error:', err)
    const message = err instanceof Error ? err.message : String(err)
    return c.json(
      {
        error: {
          message: 'Internal server error',
          details: message,
          path: c.req.path,
        },
      },
      500,
    )
  })

  // Serve built client static files when clientDistPath is configured
  const clientDistPath = config.clientDistPath
  if (clientDistPath && fs.existsSync(clientDistPath)) {
    app.use('/*', serveStatic({ root: path.relative(process.cwd(), clientDistPath) }))

    // Return 404 for unmatched API routes before SPA fallback
    app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404))

    // SPA fallback: serve index.html for all non-API routes
    const indexHtml = fs.readFileSync(path.join(clientDistPath, 'index.html'), 'utf8')
    app.get('*', (c) => c.html(indexHtml))
  } else if (config.isDev) {
    // Dev mode: redirect unmatched GET requests to the Vite dev client
    const devClientUrl = `http://localhost:${config.devClientPort}`
    app.get('*', (c) => c.redirect(devClientUrl, 302))
  }

  return app
}
