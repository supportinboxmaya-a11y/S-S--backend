import { Context, Next } from 'hono'
import { Env } from '../types/env'

interface RateLimitEntry {
  count: number
  resetAt: number
}

export async function rateLimitMiddleware(c: Context<Env>, next: Next) {
  const kv = c.env.KV_RATE_LIMIT
  const ip = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown'
  const path = c.req.path
  const key = `ratelimit:${ip}:${path}`

  const now = Date.now()
  const windowMs = 60 * 1000 // 1 minute

  // Different limits for different endpoints
  let limit = 120 // default per minute
  
  if (path.startsWith('/api/v1/auth/')) {
    limit = 10
  } else if (path.startsWith('/api/v1/search')) {
    limit = 30
  } else if (path.startsWith('/api/v1/music')) {
    limit = 30
  } else if (path.startsWith('/api/v1/videos') && c.req.method === 'POST') {
    limit = 20
  }

  const entry = await kv.get<RateLimitEntry>(key, 'json')
  
  if (!entry || entry.resetAt < now) {
    await kv.put(key, JSON.stringify({ count: 1, resetAt: now + windowMs }), { expirationTtl: 120 })
  } else if (entry.count >= limit) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000)
    return c.json(
      { error: 'Too Many Requests', message: 'Rate limit exceeded', retryAfter },
      429,
      {
        'X-RateLimit-Limit': limit.toString(),
        'X-RateLimit-Remaining': '0',
        'Retry-After': retryAfter.toString(),
      }
    )
  } else {
    entry.count++
    await kv.put(key, JSON.stringify(entry), { expirationTtl: 120 })
  }

  const remaining = Math.max(0, limit - (entry?.count || 0))
  c.header('X-RateLimit-Limit', limit.toString())
  c.header('X-RateLimit-Remaining', remaining.toString())

  await next()
}

export async function strictRateLimitMiddleware(limit: number, windowMs: number) {
  return async (c: Context<Env>, next: Next) => {
    const kv = c.env.KV_RATE_LIMIT
    const ip = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown'
    const path = c.req.path
    const key = `strictratelimit:${ip}:${path}`

    const now = Date.now()
    const entry = await c.env.KV_RATE_LIMIT.get<RateLimitEntry>(key, 'json')
    
    if (!entry || entry.resetAt < now) {
      await c.env.KV_RATE_LIMIT.put(key, JSON.stringify({ count: 1, resetAt: now + windowMs }), { expirationTtl: Math.ceil(windowMs / 1000) + 60 })
    } else if (entry.count >= limit) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000)
      return c.json(
        { error: 'Too Many Requests', message: 'Rate limit exceeded', retryAfter },
        429,
        {
          'X-RateLimit-Limit': limit.toString(),
          'X-RateLimit-Remaining': '0',
          'Retry-After': retryAfter.toString(),
        }
      )
    } else {
      entry.count++
      await c.env.KV_RATE_LIMIT.put(key, JSON.stringify(entry), { expirationTtl: Math.ceil(windowMs / 1000) + 60 })
    }

    await next()
  }
}