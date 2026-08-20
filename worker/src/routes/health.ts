import { Hono } from 'hono'
import { Env } from '../types/env'

export const healthRoutes = new Hono<Env>()

// Simple ping
healthRoutes.get('/ping', (c) => {
  return c.text('pong!')
})

// Comprehensive health check
healthRoutes.get('/health', async (c) => {
  const start = Date.now()
  const checks: Record<string, { status: 'ok' | 'error' | 'warning'; message?: string; latency?: number }> = {}

  // Check D1
  try {
    const dbStart = Date.now()
    await c.env.DB.prepare('SELECT 1').first()
    checks.database = { status: 'ok', latency: Date.now() - dbStart }
  } catch (e) {
    checks.database = { status: 'error', message: 'Database connection failed' }
  }

  // Check R2
  try {
    const r2Start = Date.now()
    await c.env.R2_BUCKET.head('health-check.txt')
    checks.storage = { status: 'ok', latency: Date.now() - r2Start }
  } catch (e) {
    checks.storage = { status: 'warning', message: 'R2 health check failed (object may not exist)' }
  }

  // Check KV
  try {
    const kvStart = Date.now()
    await c.env.KV_CACHE.put('health-check', 'ok', { expirationTtl: 60 })
    await c.env.KV_CACHE.get('health-check')
    checks.cache = { status: 'ok', latency: Date.now() - kvStart }
  } catch (e) {
    checks.cache = { status: 'error', message: 'KV cache failed' }
  }

  // Check Queues
  try {
    const queueStart = Date.now()
    await c.env.QUEUE_VIDEO_PROCESSING.send({ type: 'health-check', timestamp: Date.now() })
    checks.queues = { status: 'ok', latency: Date.now() - queueStart }
  } catch (e) {
    checks.queues = { status: 'warning', message: 'Queue health check failed' }
  }

  // Overall status
  const allOk = Object.values(checks).every(c => c.status === 'ok')
  const hasWarning = Object.values(checks).some(c => c.status === 'warning')

  const status = allOk ? 'healthy' : hasWarning ? 'degraded' : 'unhealthy'

  return c.json({
    status,
    timestamp: new Date().toISOString(),
    latency: Date.now() - start,
    checks,
  }, status === 'healthy' ? 200 : 503)
})

// Readiness probe (for k8s/load balancers)
healthRoutes.get('/ready', async (c) => {
  try {
    await c.env.DB.prepare('SELECT 1').first()
    return c.json({ ready: true })
  } catch {
    return c.json({ ready: false }, 503)
  }
})

// Liveness probe
healthRoutes.get('/live', (c) => {
  return c.json({ alive: true })
})