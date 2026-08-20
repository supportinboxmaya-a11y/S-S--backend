import { Hono } from 'hono'
import { z } from 'zod'
import { Context } from 'hono'
import { Env } from '../types/env'
import { createDbClient } from '../db/client'
import { createR2Client, AVATAR_PATH, getCacheControl } from '../services/r2'
import { validateBody, validateParams, validateQuery, paginationSchema } from '../middleware/validation'
import { AppError } from '../middleware/error-handler'
import { authMiddleware } from '../middleware/auth'

export const profileRoutes = new Hono<Env>()

profileRoutes.use('*', authMiddleware)

// GET /api/v1/profiles/:id
profileRoutes.get('/:id', validateParams(z.object({ id: z.string().min(1) })), async (c: Context<Env>) => {
  const db = createDbClient(c.env)
  const { id } = c.get('validatedParams')
  const user = c.get('user')

  const profile = await db.queryOne(
    `SELECT p.*, u.email, u.is_admin, u.is_active
     FROM profiles p
     JOIN users u ON p.user_id = u.id
     WHERE p.id = ?`,
    [id]
  )

  if (!profile) {
    throw AppError.notFound('Profile not found')
  }

  // Check if current user is following
  const isFollowing = await db.queryOne(
    'SELECT 1 FROM followers WHERE follower_id = ? AND following_id = ? AND status = 1',
    [user.profileId, id]
  )

  // Check if current user has requested to follow
  const isRequested = await db.queryOne(
    'SELECT 1 FROM follow_requests WHERE requester_id = ? AND target_id = ? AND status = 0',
    [user.profileId, id]
  )

  // Get counts
  const [videoCount, followerCount, followingCount] = await Promise.all([
    db.queryOne('SELECT COUNT(*) as count FROM videos WHERE profile_id = ? AND status = 2', [id]),
    db.queryOne('SELECT COUNT(*) as count FROM followers WHERE following_id = ? AND status = 1', [id]),
    db.queryOne('SELECT COUNT(*) as count FROM followers WHERE follower_id = ? AND status = 1', [id]),
  ]

  return c.json({
    id: profile.id,
    user_id: profile.user_id,
    name: profile.name,
    username: profile.username,
    bio: profile.bio,
    avatar: profile.avatar,
    header: profile.header,
    is_verified: Boolean(profile.is_verified),
    is_hidden: Boolean(profile.is_hidden),
    follower_count: followerCount?.count || 0,
    following_count: followingCount?.count || 0,
    video_count: videoCount?.count || 0,
    is_following: Boolean(isFollowing),
    is_requested: Boolean(isRequested),
    is_own: profile.id === user.profileId,
    created_at: new Date(profile.created_at * 1000).toISOString(),
  })
})

// PUT /api/v1/profiles/:id
profileRoutes.put('/:id', 
  validateParams(z.object({ id: z.string().min(1) })),
  validateBody(z.object({
    name: z.string().min(1).max(100).optional(),
    bio: z.string().max(500).optional(),
    username: z.string().min(3).max(30).regex(/^[a-zA-Z0-9_]+$/).optional(),
    avatar: z.string().url().optional(),
    header: z.string().url().optional(),
  })),
  async (c: Context<Env>) => {
    const db = createDbClient(c.env)
    const { id } = c.get('validatedParams')
    const body = c.get('validatedBody')
    const user = c.get('user')

    if (id !== user.profileId && !user.isAdmin) {
      throw AppError.forbidden('Not authorized to update this profile')
    }

    const updates: string[] = []
    const params: unknown[] = []

    if (body.name !== undefined) {
      updates.push('name = ?')
      params.push(body.name)
    }
    if (body.bio !== undefined) {
      updates.push('bio = ?')
      params.push(body.bio)
    }
    if (body.username !== undefined) {
      // Check username availability
      const existing = await c.get('db').queryOne('SELECT id FROM profiles WHERE username = ? AND id != ?', [body.username, id])
      if (existing) {
        throw AppError.conflict('Username already taken')
      }
      updates.push('username = ?')
      params.push(body.username)
    }
    if (body.avatar !== undefined) {
      updates.push('avatar = ?')
      params.push(body.avatar)
    }
    if (body.header !== undefined) {
      updates.push('header = ?')
      params.push(body.header)
    }

    if (updates.length > 0) {
      updates.push('updated_at = unixepoch()')
      params.push(id)
      await c.get('db').exec(`UPDATE profiles SET ${updates.join(', ')} WHERE id = ?`, params)
    }

    const updated = await c.get('db').queryOne('SELECT * FROM profiles WHERE id = ?', [id])
    return c.json({ success: true, profile: updated })
  }
)

// POST /api/v1/profiles/:id/avatar
profileRoutes.post('/:id/avatar',
  validateParams(z.object({ id: z.string().min(1) })),
  async (c: Context<Env>) => {
    const user = c.get('user')
    const { id } = c.req.param()

    if (id !== user.profileId && !user.isAdmin) {
      throw AppError.forbidden('Not authorized')
    }

    const body = await c.req.parseBody()
    const file = body.avatar as File
    if (!file) {
      throw AppError.badRequest('No avatar file provided')
    }

    // Validate file
    if (!file.type.startsWith('image/')) {
      throw AppError.badRequest('File must be an image')
    }
    if (file.size > 5 * 1024 * 1024) {
      throw AppError.badRequest('File size must be less than 5MB')
    }

    const r2 = createR2Client(c.env)
    const avatarPath = AVATAR_PATH(user.profileId!)
    const arrayBuffer = await file.arrayBuffer()
    
    await r2.put(avatarPath, arrayBuffer, {
      httpMetadata: { contentType: file.type },
      customMetadata: { cacheControl: getCacheControl(avatarPath) },
    })

    const avatarUrl = await r2.signedUrl(avatarPath)
    await c.get('db').exec('UPDATE profiles SET avatar = ?, updated_at = unixepoch() WHERE id = ?', [avatarUrl, user.profileId])

    return c.json({ success: true, avatar: avatarUrl })
  }
)

// GET /api/v1/profiles/:id/videos
profileRoutes.get('/:id/videos', validateParams(z.object({ id: z.string().min(1) })), validateQuery(paginationSchema), async (c: Context<Env>) => {
  const db = createDbClient(c.env)
  const { id } = c.get('validatedParams')
  const { cursor, limit } = c.get('validatedQuery')
  const user = c.get('user')

  const profile = await db.queryOne('SELECT * FROM profiles WHERE id = ?', [id])
  if (!profile) {
    throw AppError.notFound('Profile not found')
  }

  let query = `
    SELECT v.*, p.id as profile_id, p.name, p.username, p.avatar
    FROM videos v
    JOIN profiles p ON v.profile_id = p.id
    WHERE v.profile_id = ? AND v.status = 2
  `
  const params: unknown[] = [id]

  // Check visibility
  if (profile.id !== user.profileId) {
    query += ' AND v.visibility = 1'
  }

  if (cursor) {
    query += ' AND v.created_at < ?'
    params.push(cursor)
  }

  query += ' ORDER BY v.created_at DESC LIMIT ?'
  params.push(limit + 1)

  const videos = await db.query(query, params)
  const hasMore = videos.length > limit
  const items = hasMore ? videos.slice(0, -1) : videos
  const nextCursor = hasMore ? items[items.length - 1]?.created_at : undefined

  for (const video of items) {
    video.profile = { id: profile.id, name: profile.name, username: profile.username, avatar: profile.avatar }
    const hasLiked = await db.queryOne('SELECT 1 FROM video_likes WHERE profile_id = ? AND video_id = ?', [user.profileId, video.id])
    const hasBookmarked = await db.queryOne('SELECT 1 FROM video_bookmarks WHERE profile_id = ? AND video_id = ?', [user.profileId, video.id])
    video.has_liked = Boolean(hasLiked)
    video.has_bookmarked = Boolean(hasBookmarked)
    video.audio = {
      has_audio: Boolean(video.has_audio),
      id: video.sound_id ? `sound:${video.sound_id}` : `at:${video.id}`,
      count: 0,
      key: video.sound_id || crypto.randomUUID(),
      sound_id: video.sound_id || null,
      provider_track_id: video.provider_track_id || null,
      music_provider: video.music_provider || null,
      music_metadata: video.music_metadata ? JSON.parse(video.music_metadata) : null,
      music_licensing: video.music_licensing ? JSON.parse(video.music_licensing) : null,
    }
  }

  return c.json({
    items,
    meta: { next_cursor: nextCursor, has_more: hasMore, profile },
  })
})

// POST /api/v1/profiles/:id/follow
profileRoutes.post('/:id/follow', validateParams(z.object({ id: z.string().min(1) })), async (c: Context<Env>) => {
  const db = createDbClient(c.env)
  const { id } = c.get('validatedParams')
  const user = c.get('user')

  if (id === user.profileId) {
    throw AppError.badRequest('Cannot follow yourself')
  }

  const target = await db.queryOne('SELECT * FROM profiles WHERE id = ?', [id])
  if (!target) {
    throw AppError.notFound('Profile not found')
  }

  // Check if already following
  const existing = await db.queryOne(
    'SELECT 1 FROM followers WHERE follower_id = ? AND following_id = ?',
    [user.profileId, id]
  )

  if (existing) {
    throw AppError.conflict('Already following')
  }

  // Check if target requires approval
  const needsApproval = target.is_hidden || true // Simplified

  if (needsApproval) {
    // Create follow request
    await db.exec(
      `INSERT INTO follow_requests (id, requester_id, target_id, status, created_at)
       VALUES (?, ?, ?, 0, unixepoch())`,
      [crypto.randomUUID(), user.profileId, id]
    )

    // Queue notification
    await c.env.QUEUE_NOTIFICATIONS.send({
      type: 'notification',
      userId: id,
      notificationId: crypto.randomUUID(),
      type: 'follow',
      data: { requesterId: user.profileId },
      priority: 'normal',
      createdAt: Date.now(),
    })

    return c.json({ success: true, status: 'requested' })
  } else {
    // Direct follow
    await db.exec(
      `INSERT INTO followers (id, follower_id, following_id, status, created_at)
       VALUES (?, ?, ?, 1, unixepoch())`,
      [crypto.randomUUID(), user.profileId, id]
    )

    // Update counts
    await db.exec('UPDATE profiles SET follower_count = follower_count + 1 WHERE id = ?', [id])
    await db.exec('UPDATE profiles SET following_count = following_count + 1 WHERE id = ?', [user.profileId])

    // Queue notification
    await c.env.QUEUE_NOTIFICATIONS.send({
      type: 'notification',
      userId: id,
      notificationId: crypto.randomUUID(),
      type: 'follow',
      data: { followerId: user.profileId },
      priority: 'normal',
      createdAt: Date.now(),
    })

    return c.json({ success: true, status: 'following' })
  }
})

// POST /api/v1/profiles/:id/unfollow
profileRoutes.post('/:id/unfollow', validateParams(z.object({ id: z.string().min(1) })), async (c: Context<Env>) => {
  const db = createDbClient(c.env)
  const { id } = c.get('validatedParams')
  const user = c.get('user')

  const deleted = await db.exec(
    'DELETE FROM followers WHERE follower_id = ? AND following_id = ?',
    [user.profileId, id]
  )

  if (deleted) {
    await db.exec('UPDATE profiles SET follower_count = follower_count - 1 WHERE id = ?', [id])
    await db.exec('UPDATE profiles SET following_count = following_count - 1 WHERE id = ?', [user.profileId])

    // Also delete any pending request
    await db.exec('DELETE FROM follow_requests WHERE requester_id = ? AND target_id = ?', [user.profileId, id])
  }

  return c.json({ success: true })
})

// POST /api/v1/profiles/:id/accept-follow
profileRoutes.post('/:id/accept-follow', validateParams(z.object({ id: z.string().min(1) })), async (c: Context<Env>) => {
  const db = createDbClient(c.env)
  const { id } = c.get('validatedParams')
  const user = c.get('user')

  const request = await db.queryOne(
    'SELECT * FROM follow_requests WHERE requester_id = ? AND target_id = ? AND status = 0',
    [id, user.profileId]
  )

  if (!request) {
    throw AppError.notFound('Follow request not found')
  }

  // Accept request
  await db.exec('UPDATE follow_requests SET status = 1 WHERE id = ?', [request.id])

  // Create follow relationship
  await db.exec(
    `INSERT INTO followers (id, follower_id, following_id, status, created_at)
     VALUES (?, ?, ?, 1, unixepoch())`,
    [crypto.randomUUID(), id, user.profileId]
  )

  // Update counts
  await db.exec('UPDATE profiles SET follower_count = follower_count + 1 WHERE id = ?', [user.profileId])
  await db.exec('UPDATE profiles SET following_count = following_count + 1 WHERE id = ?', [id])

  // Queue notification
  await c.env.QUEUE_NOTIFICATIONS.send({
    type: 'notification',
    userId: id,
    notificationId: crypto.randomUUID(),
    type: 'follow',
    data: { followerId: user.profileId },
    priority: 'normal',
    createdAt: Date.now(),
  })

  return c.json({ success: true })
})