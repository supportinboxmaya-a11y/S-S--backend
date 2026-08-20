import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { secureHeaders } from 'hono/secure-headers'
import { rateLimiter } from 'hono-rate-limiter'
import { jwt } from 'hono/jwt'
import { etag } from 'hono/etag'
import { compress } from 'hono/compress'
import { requestId } from 'hono/request-id'

import { authRoutes } from './routes/auth'
import { videoRoutes } from './routes/videos'
import { soundRoutes } from './routes/sounds'
import { feedRoutes } from './routes/feed'
import { profileRoutes } from './routes/profiles'
import { searchRoutes } from './routes/search'
import { dmRoutes } from './routes/dm'
import { notificationRoutes } from './routes/notifications'
import { adminRoutes } from './routes/admin'
import { musicRoutes } from './routes/music'
import { healthRoutes } from './routes/health'
import { webhookRoutes } from './routes/webhooks'

import { errorHandler } from './middleware/error-handler'
import { authMiddleware } from './middleware/auth'
import { rateLimitMiddleware } from './middleware/rate-limit'
import { validationMiddleware } from './middleware/validation'

import { Env } from './types/env'
import { initDB } from './db/client'
import { initQueues } from './queue/client'

const app = new Hono<Env>()

// Global middleware
app.use('*', requestId())
app.use('*', logger())
app.use('*', secureHeaders())
app.use('*', etag())
app.use('*', compress())

// CORS
app.use('/api/*', cors({
  origin: (origin, c) => {
    const allowed = c.env.CORS_ALLOWED_ORIGIN?.split(',') || ['http://localhost:3000']
    if (!origin || allowed.includes(origin) || allowed.includes('*')) {
      return origin || allowed[0]
    }
    return allowed[0]
  },
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Request-ID'],
  exposeHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'Retry-After', 'Link'],
  credentials: true,
  maxAge: 3600,
}))

// Rate limiting
app.use('/api/*', rateLimitMiddleware)

// Request validation
app.use('/api/*', validationMiddleware)

// Health & public routes (no auth)
app.route('/api/v1/health', healthRoutes)
app.route('/api/v1/auth', authRoutes)
app.route('/api/v1/webhooks', webhookRoutes)

// Protected routes
const api = app.basePath('/api/v1')

api.use('*', authMiddleware)

api.route('/videos', videoRoutes)
api.route('/sounds', soundRoutes)
api.route('/feed', feedRoutes)
api.route('/profiles', profileRoutes)
api.route('/search', searchRoutes)
api.route('/dm', dmRoutes)
api.route('/notifications', notificationRoutes)
api.route('/music', musicRoutes)
api.route('/admin', adminRoutes)

// 404 handler
app.notFound((c) => c.json({ error: 'Not Found', message: 'Endpoint not found' }, 404))

// Global error handler
app.onError(errorHandler)

// Initialize on startup
export default {
  fetch: app.fetch,
  async scheduled(event, env, ctx) {
    await initQueues(env, ctx)
  },
} satisfies ExportedHandler<Env>