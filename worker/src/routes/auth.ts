import { Hono } from 'hono'
import { z } from 'zod'
import { Context } from 'hono'
import { Env } from '../types/env'
import { createDbClient } from '../db/client'
import { sign, verify } from 'hono/jwt'
import { validateBody } from '../middleware/validation'
import { AppError } from '../middleware/error-handler'

// OAuth App registration schema
const registerAppSchema = z.object({
  client_name: z.string().min(1).max(100),
  redirect_uris: z.array(z.string().url()).min(1),
  scopes: z.string().optional(),
  website: z.string().url().optional(),
})

// OAuth token exchange schema
const tokenExchangeSchema = z.object({
  grant_type: z.enum(['authorization_code', 'refresh_token']),
  client_id: z.string(),
  client_secret: z.string(),
  redirect_uri: z.string().url().optional(),
  code: z.string().optional(),
  refresh_token: z.string().optional(),
  scope: z.string().optional(),
})

export const authRoutes = new Hono<Env>()

// Request schemas
const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  remember: z.boolean().optional(),
})

const registerSchema = z.object({
  email: z.string().email(),
  username: z.string().min(3).max(30).regex(/^[a-zA-Z0-9_]+$/),
  password: z.string().min(8).max(128),
  full_name: z.string().min(1).max(100).optional(),
})

const appleAuthSchema = z.object({
  identity_token: z.string(),
  user_id: z.string(),
  email: z.string().email().optional(),
  full_name: z.object({
    givenName: z.string().optional(),
    familyName: z.string().optional(),
  }).optional(),
  authorization_code: z.string().optional(),
})

const refreshSchema = z.object({
  refresh_token: z.string(),
})

const forgotPasswordSchema = z.object({
  email: z.string().email(),
})

const resetPasswordSchema = z.object({
  token: z.string(),
  password: z.string().min(8).max(128),
})

// Helper: hash password (using Web Crypto API)
async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(password)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

// Helper: verify password
async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const passwordHash = await hashPassword(password)
  return passwordHash === hash
}

// Helper: generate JWT
async function generateTokens(user: { id: string; email: string; username?: string; profileId?: string; isAdmin: boolean }, env: Env) {
  const payload = {
    sub: user.id,
    email: user.email,
    username: user.username,
    profileId: user.profileId,
    isAdmin: user.isAdmin,
    scopes: ['user:read', 'user:write', 'video:create', 'video:read'],
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30, // 30 days
  }

  const accessToken = await sign(payload, env.JWT_SECRET)
  
  // Refresh token (longer expiry, stored in DB)
  const refreshPayload = {
    ...payload,
    type: 'refresh',
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365, // 1 year
  }
  const refreshToken = await sign(refreshPayload, env.JWT_SECRET)

  return { accessToken, refreshToken }
}

// POST /api/v1/auth/login
authRoutes.post('/login', validateBody(loginSchema), async (c: Context<Env>) => {
  const db = createDbClient(c.env)
  const { email, password, remember } = c.get('validatedBody')

  // Find user
  const user = await db.queryOne<{ id: string; email: string; password_hash: string; is_active: number; is_admin: number; profile_id: string | null }>(
    'SELECT id, email, password_hash, is_active, is_admin, profile_id FROM users WHERE email = ?',
    [email]
  )

  if (!user) {
    throw AppError.unauthorized('Invalid credentials')
  }

  if (!user.is_active) {
    throw AppError.forbidden('Account is deactivated')
  }

  // Verify password
  const isValid = await verifyPassword(password, user.password_hash)
  if (!isValid) {
    throw AppError.unauthorized('Invalid credentials')
  }

  // Generate tokens
  const tokens = await generateTokens({
    id: user.id,
    email: user.email,
    profileId: user.profile_id || undefined,
    isAdmin: Boolean(user.is_admin),
  }, c.env)

  // Update last active
  await db.exec('UPDATE users SET last_active_at = unixepoch() WHERE id = ?', [user.id])

  return c.json({
    user: {
      id: user.id,
      email: user.email,
      profileId: user.profile_id,
    },
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresIn: 60 * 60 * 24 * 30,
  })
})

// POST /api/v1/auth/register
authRoutes.post('/register', validateBody(registerSchema), async (c: Context<Env>) => {
  const db = createDbClient(c.env)
  const { email, username, password, full_name } = c.get('validatedBody')

  // Check if email exists
  const existingEmail = await db.queryOne('SELECT id FROM users WHERE email = ?', [email])
  if (existingEmail) {
    throw AppError.conflict('Email already registered')
  }

  // Check if username exists
  const existingUsername = await db.queryOne('SELECT id FROM users WHERE username = ?', [username])
  if (existingUsername) {
    throw AppError.conflict('Username already taken')
  }

  // Hash password
  const passwordHash = await hashPassword(password)

  // Create user
  const userId = crypto.randomUUID()
  await db.exec(
    `INSERT INTO users (id, email, username, password_hash, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, unixepoch(), unixepoch())`,
    [userId, email, username, passwordHash]
  )

  // Create profile
  const profileId = crypto.randomUUID()
  const displayName = full_name || username
  await db.exec(
    `INSERT INTO profiles (id, user_id, name, username, created_at, updated_at)
     VALUES (?, ?, ?, ?, unixepoch(), unixepoch())`,
    [profileId, userId, displayName, username]
  )

  // Link profile to user
  await db.exec('UPDATE users SET profile_id = ? WHERE id = ?', [profileId, userId])

  // Generate tokens
  const tokens = await generateTokens({
    id: userId,
    email,
    username,
    profileId,
    isAdmin: false,
  }, c.env)

  return c.json({
    user: {
      id: userId,
      email,
      username,
      profileId,
    },
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresIn: 60 * 60 * 24 * 30,
  }, 201)
})

// POST /api/v1/auth/apple
authRoutes.post('/apple', validateBody(appleAuthSchema), async (c: Context<Env>) => {
  const db = createDbClient(c.env)
  const { identity_token, user_id: appleUserId, email, full_name } = c.get('validatedBody')

  // TODO: Verify Apple identity token with Apple's public keys
  // For now, we'll trust the token (in production, verify with Apple)

  // Check if Apple user exists
  let user = await db.queryOne<{ id: string; email: string; is_active: number; is_admin: number; profile_id: string | null }>(
    'SELECT id, email, is_active, is_admin, profile_id FROM users WHERE apple_id = ?',
    [appleUserId]
  )

  if (!user && email) {
    // Check if email exists
    user = await db.queryOne<{ id: string; email: string; is_active: number; is_admin: number; profile_id: string | null }>(
      'SELECT id, email, is_active, is_admin, profile_id FROM users WHERE email = ?',
      [email]
    )
    
    if (user) {
      // Link Apple ID
      await db.exec('UPDATE users SET apple_id = ? WHERE id = ?', [appleUserId, user.id])
    }
  }

  if (!user) {
    // Create new user
    const userId = crypto.randomUUID()
    await db.exec(
      `INSERT INTO users (id, email, apple_id, is_active, created_at, updated_at)
       VALUES (?, ?, ?, 1, unixepoch(), unixepoch())`,
      [userId, email || `${appleUserId}@apple.appleid`, appleUserId]
    )

    // Create profile
    const profileId = crypto.randomUUID()
    const displayName = full_name ? `${full_name.givenName || ''} ${full_name.familyName || ''}`.trim() : 'Apple User'
    const username = `apple_${appleUserId.slice(0, 8)}`
    
    await db.exec(
      `INSERT INTO profiles (id, user_id, name, username, created_at, updated_at)
       VALUES (?, ?, ?, ?, unixepoch(), unixepoch())`,
      [profileId, userId, displayName, username]
    )

    await db.exec('UPDATE users SET profile_id = ? WHERE id = ?', [profileId, userId])

    user = { id: userId, email: email || '', is_active: 1, is_admin: 0, profile_id: profileId }
  }

  if (!user.is_active) {
    throw AppError.forbidden('Account is deactivated')
  }

  // Generate tokens
  const tokens = await generateTokens({
    id: user.id,
    email: user.email,
    profileId: user.profile_id || undefined,
    isAdmin: Boolean(user.is_admin),
  }, c.env)

  // Update last active
  await db.exec('UPDATE users SET last_active_at = unixepoch() WHERE id = ?', [user.id])

  return c.json({
    user: {
      id: user.id,
      email: user.email,
      profileId: user.profile_id,
    },
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresIn: 60 * 60 * 24 * 30,
  })
})

// POST /api/v1/auth/refresh
authRoutes.post('/refresh', validateBody(refreshSchema), async (c: Context<Env>) => {
  const { refresh_token } = c.get('validatedBody')

  try {
    const payload = await verify(refresh_token, c.env.JWT_SECRET)
    
    if (!payload || payload.type !== 'refresh') {
      throw new Error('Invalid refresh token')
    }

    // Check if user still exists and is active
    const db = createDbClient(c.env)
    const user = await db.queryOne<{ id: string; email: string; is_active: number; is_admin: number; profile_id: string | null; username: string | null }>(
      'SELECT id, email, is_active, is_admin, profile_id, username FROM users WHERE id = ?',
      [payload.sub]
    )

    if (!user || !user.is_active) {
      throw new Error('User not found or inactive')
    }

    // Generate new tokens
    const tokens = await generateTokens({
      id: user.id,
      email: user.email,
      username: user.username || undefined,
      profileId: user.profile_id || undefined,
      isAdmin: Boolean(user.is_admin),
    }, c.env)

    return c.json({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: 60 * 60 * 24 * 30,
    })
  } catch {
    throw AppError.unauthorized('Invalid refresh token')
  }
})

// POST /api/v1/auth/logout
authRoutes.post('/logout', async (c: Context<Env>) => {
  // In a real implementation, you'd invalidate the refresh token in DB
  // For now, just return success
  return c.json({ success: true, message: 'Logged out successfully' })
})

// POST /api/v1/auth/forgot-password
authRoutes.post('/forgot-password', validateBody(forgotPasswordSchema), async (c: Context<Env>) => {
  const db = createDbClient(c.env)
  const { email } = c.get('validatedBody')

  const user = await db.queryOne<{ id: string }>('SELECT id FROM users WHERE email = ?', [email])
  
  // Always return success to prevent email enumeration
  // In production, send reset email via queue
  if (user) {
    // Generate reset token (store in DB with expiry)
    const resetToken = crypto.randomUUID()
    await db.exec(
      `INSERT INTO password_resets (id, user_id, token, expires_at, created_at)
       VALUES (?, ?, ?, unixepoch() + 3600, unixepoch())`,
      [crypto.randomUUID(), user.id, resetToken]
    )
    
    // Queue email job
    await c.env.QUEUE_EMAILS.send({
      type: 'email',
      to: email,
      template: 'password-reset',
      data: { token: resetToken },
      priority: 'high',
      createdAt: Date.now(),
    })
  }

  return c.json({ success: true, message: 'If the email exists, a reset link has been sent' })
})

// POST /api/v1/auth/reset-password
authRoutes.post('/reset-password', validateBody(resetPasswordSchema), async (c: Context<Env>) => {
  const db = createDbClient(c.env)
  const { token, password } = c.get('validatedBody')

  // Verify token
  const reset = await db.queryOne<{ user_id: string; expires_at: number }>(
    'SELECT user_id, expires_at FROM password_resets WHERE token = ? AND expires_at > unixepoch()',
    [token]
  )

  if (!reset) {
    throw AppError.badRequest('Invalid or expired reset token')
  }

  // Hash new password
  const passwordHash = await hashPassword(password)

  // Update password
  await db.exec('UPDATE users SET password_hash = ?, updated_at = unixepoch() WHERE id = ?', [passwordHash, reset.user_id])

  // Invalidate token
  await db.exec('DELETE FROM password_resets WHERE token = ?', [token])

  // Invalidate all refresh tokens for user (force re-login)
  // In production, you'd have a refresh_tokens table

  return c.json({ success: true, message: 'Password reset successfully' })
})

// GET /api/v1/auth/me
authRoutes.get('/me', async (c: Context<Env>) => {
  const user = c.get('user')
  const db = c.get('db')

  const profile = await db.queryOne<{ id: string; name: string; username: string; avatar: string; bio: string }>(
    'SELECT id, name, username, avatar, bio FROM profiles WHERE id = ?',
    [user.profileId]
  )

  return c.json({
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      profileId: user.profileId,
      isAdmin: user.isAdmin,
      profile: profile || null,
    },
  })
})

// POST /api/v1/apps - Register OAuth application
authRoutes.post('/apps', validateBody(registerAppSchema), async (c: Context<Env>) => {
  const db = createDbClient(c.env)
  const { client_name, redirect_uris, scopes, website } = c.get('validatedBody')

  const clientId = crypto.randomUUID()
  const clientSecret = crypto.randomUUID()

  await db.exec(
    `INSERT INTO oauth_clients (id, client_id, client_secret, client_name, redirect_uris, scopes, website, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())`,
    [crypto.randomUUID(), clientId, clientSecret, client_name, JSON.stringify(redirect_uris), scopes || 'user:read user:write video:create video:read', website || null]
  )

  return c.json({
    id: clientId,
    client_id: clientId,
    client_secret: clientSecret,
    client_name,
    redirect_uris,
    scopes: scopes || 'user:read user:write video:create video:read',
    website,
    created_at: new Date().toISOString(),
  }, 201)
})

// GET /oauth/authorize - OAuth authorization page
authRoutes.get('/oauth/authorize', async (c: Context<Env>) => {
  const { client_id, redirect_uri, scope, response_type, state } = c.req.query()

  if (!client_id || !redirect_uri || response_type !== 'code') {
    return c.json({ error: 'Invalid request' }, 400)
  }

  // Verify client exists
  const client = await createDbClient(c.env).queryOne(
    'SELECT * FROM oauth_clients WHERE client_id = ? AND revoked = 0',
    [client_id]
  )

  if (!client) {
    return c.json({ error: 'Invalid client' }, 400)
  }

  // Verify redirect_uri is allowed
  const allowedUris = JSON.parse(client.redirect_uris)
  if (!allowedUris.includes(redirect_uri)) {
    return c.json({ error: 'Invalid redirect_uri' }, 400)
  }

  // In a real implementation, you'd show a consent page here
  // For now, we'll auto-approve and redirect with code
  // In production, you'd show a consent page and get user approval

  const authCode = crypto.randomUUID()
  const expiresAt = Date.now() + 10 * 60 * 1000 // 10 minutes

  await createDbClient(c.env).exec(
    `INSERT INTO oauth_auth_codes (id, client_id, user_id, redirect_uri, scopes, code, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch())`,
    [crypto.randomUUID(), client.client_id, 'TODO_USER_ID', redirect_uri, scope || 'user:read user:write video:create video:read', authCode, Math.floor(expiresAt / 1000)]
  )

  const redirectUrl = new URL(redirect_uri)
  redirectUrl.searchParams.set('code', authCode)
  if (state) redirectUrl.searchParams.set('state', state)

  return c.redirect(redirectUrl.toString())
})

// POST /oauth/token - Exchange code for token
authRoutes.post('/oauth/token', validateBody(tokenExchangeSchema), async (c: Context<Env>) => {
  const { grant_type, client_id, client_secret, redirect_uri, code, refresh_token, scope } = c.get('validatedBody')

  const db = createDbClient(c.env)

  // Verify client
  const client = await db.queryOne(
    'SELECT * FROM oauth_clients WHERE client_id = ? AND client_secret = ? AND revoked = 0',
    [client_id, client_secret]
  )

  if (!client) {
    return c.json({ error: 'Invalid client credentials' }, 401)
  }

  if (grant_type === 'authorization_code') {
    if (!code || !redirect_uri) {
      return c.json({ error: 'Missing code or redirect_uri' }, 400)
    }

    // Verify auth code
    const authCode = await db.queryOne(
      'SELECT * FROM oauth_auth_codes WHERE code = ? AND client_id = ? AND expires_at > unixepoch()',
      [code, client_id]
    )

    if (!authCode) {
      return c.json({ error: 'Invalid or expired authorization code' }, 400)
    }

    // Verify redirect_uri matches
    if (authCode.redirect_uri !== redirect_uri) {
      return c.json({ error: 'Invalid redirect_uri' }, 400)
    }

    // Get user (from authCode.user_id)
    const user = await db.queryOne(
      'SELECT id, email, profile_id, is_admin, username FROM users WHERE id = ?',
      [authCode.user_id]
    )

    if (!user) {
      return c.json({ error: 'User not found' }, 404)
    }

    // Delete used auth code
    await db.exec('DELETE FROM oauth_auth_codes WHERE id = ?', [authCode.id])

    // Generate tokens
    const tokens = await generateTokens({
      id: user.id,
      email: user.email,
      username: user.username,
      profileId: user.profile_id,
      isAdmin: Boolean(user.is_admin),
    }, c.env)

    // Store refresh token
    await db.exec(
      `INSERT INTO oauth_refresh_tokens (id, access_token_id, revoked, expires_at, created_at)
       VALUES (?, ?, 0, unixepoch() + 31536000, unixepoch())`,
      [crypto.randomUUID(), tokens.refreshToken] // This is a placeholder - need proper token ID linking
    )

    return c.json({
      access_token: tokens.accessToken,
      token_type: 'Bearer',
      expires_in: 2592000, // 30 days
      refresh_token: tokens.refreshToken,
      scope: scope || 'user:read user:write video:create video:read',
    })
  }

  if (grant_type === 'refresh_token') {
    if (!refresh_token) {
      return c.json({ error: 'Missing refresh_token' }, 400)
    }

    try {
      const payload = await verify(refresh_token, c.env.JWT_SECRET)

      if (!payload || payload.type !== 'refresh') {
        throw new Error('Invalid refresh token')
      }

      const user = await db.queryOne(
        'SELECT id, email, profile_id, is_admin, username FROM users WHERE id = ?',
        [payload.sub]
      )

      if (!user) {
        throw new Error('User not found')
      }

      const tokens = await generateTokens({
        id: user.id,
        email: user.email,
        username: user.username,
        profileId: user.profile_id,
        isAdmin: Boolean(user.is_admin),
      }, c.env)

      return c.json({
        access_token: tokens.accessToken,
        token_type: 'Bearer',
        expires_in: 2592000,
        refresh_token: tokens.refreshToken,
        scope: scope || 'user:read user:write video:create video:read',
      })
    } catch {
      return c.json({ error: 'Invalid refresh token' }, 401)
    }
  }

  return c.json({ error: 'Unsupported grant_type' }, 400)
})