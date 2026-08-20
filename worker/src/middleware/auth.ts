import { Context, Next } from 'hono'
import { Env } from '../types/env'
import { createDbClient } from '../db/client'
import { verify } from 'hono/jwt'

export interface AuthUser {
  id: string
  email: string
  username?: string
  profileId?: string
  isAdmin: boolean
  scopes: string[]
}

declare module 'hono' {
  interface ContextVariableMap {
    user: AuthUser
    db: ReturnType<typeof createDbClient>
  }
}

export async function authMiddleware(c: Context<Env>, next: Next) {
  const authHeader = c.req.header('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized', message: 'Missing or invalid Authorization header' }, 401)
  }

  const token = authHeader.slice(7)

  try {
    // Verify JWT
    const payload = await verify(token, c.env.JWT_SECRET)
    
    if (!payload || !payload.sub) {
      return c.json({ error: 'Unauthorized', message: 'Invalid token' }, 401)
    }

    // Check expiration
    if (payload.exp && payload.exp * 1000 < Date.now()) {
      return c.json({ error: 'Unauthorized', message: 'Token expired' }, 401)
    }

    // Create DB client
    const db = createDbClient(c.env)
    c.set('db', db)

    // Attach user
    const user: AuthUser = {
      id: payload.sub as string,
      email: payload.email as string,
      username: payload.username as string,
      profileId: payload.profileId as string,
      isAdmin: payload.isAdmin as boolean,
      scopes: (payload.scopes as string[]) || [],
    }
    c.set('user', user)

    await next()
  } catch (error) {
    console.error('Auth error:', error)
    return c.json({ error: 'Unauthorized', message: 'Invalid or expired token' }, 401)
  }
}

export function optionalAuthMiddleware(c: Context<Env>, next: Next) {
  const authHeader = c.req.header('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next()
  }

  const token = authHeader.slice(7)

  try {
    const payload = await verify(token, c.env.JWT_SECRET)
    
    if (payload && payload.sub && (!payload.exp || payload.exp * 1000 > Date.now())) {
      const db = createDbClient(c.env)
      c.set('db', db)
      
      const user: AuthUser = {
        id: payload.sub as string,
        email: payload.email as string,
        username: payload.username as string,
        profileId: payload.profileId as string,
        isAdmin: payload.isAdmin as boolean,
        scopes: (payload.scopes as string[]) || [],
      }
      c.set('user', user)
    }
  } catch {
    // Ignore auth errors for optional auth
  }

  return next()
}

export function requireScope(...scopes: string[]) {
  return async (c: Context<Env>, next: Next) => {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const hasScope = scopes.some(scope => user.scopes.includes(scope) || user.isAdmin)
    if (!hasScope) {
      return c.json({ error: 'Forbidden', message: `Requires one of scopes: ${scopes.join(', ')}` }, 403)
    }

    await next()
  }
}

export function requireAdmin(c: Context<Env>, next: Next) {
  const user = c.get('user')
  if (!user || !user.isAdmin) {
    return c.json({ error: 'Forbidden', message: 'Admin access required' }, 403)
  }
  await next()
}

export function generateToken(user: AuthUser, env: Env): string {
  const payload = {
    sub: user.id,
    email: user.email,
    username: user.username,
    profileId: user.profileId,
    isAdmin: user.isAdmin,
    scopes: user.scopes,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30, // 30 days
  }
  return new TextEncoder().encode(JSON.stringify(payload)) // Placeholder - use hono/jwt sign
}