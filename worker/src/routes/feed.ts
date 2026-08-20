import { Hono } from 'hono'
import { z } from 'zod'
import { Context } from 'hono'
import { Env } from '../types/env'
import { createDbClient } from '../db/client'
import { validateQuery, paginationSchema } from '../middleware/validation'
import { AppError } from '../middleware/error-handler'
import { authMiddleware } from '../middleware/auth'

export const feedRoutes = new Hono<Env>()

feedRoutes.use('*', authMiddleware)

const feedTypeSchema = z.enum(['for-you', 'following', 'local', 'trending'])
const feedQuerySchema = paginationSchema.extend({
  type: feedTypeSchema.default('for-you'),
})

// GET /api/v1/feed
feedRoutes.get('/', validateQuery(feedQuerySchema), async (c: Context<Env>) => {
  const db = createDbClient(c.env)
  const { cursor, limit, type } = c.get('validatedQuery')
  const user = c.get('user')
  const profileId = user.profileId!

  let query = ''
  const params: unknown[] = []

  switch (type) {
    case 'following':
      query = `
        SELECT v.*, p.id as profile_id, p.name, p.username, p.avatar
        FROM videos v
        JOIN profiles p ON v.profile_id = p.id
        JOIN followers f ON v.profile_id = f.following_id
        WHERE f.follower_id = ? AND v.status = 2
      `
      params.push(profileId)
      break

    case 'local':
      query = `
        SELECT v.*, p.id as profile_id, p.name, p.username, p.avatar
        FROM videos v
        JOIN profiles p ON v.profile_id = p.id
        WHERE v.status = 2 AND v.visibility IN (1, 2)
      `
      break

    case 'trending':
      query = `
        SELECT v.*, p.id as profile_id, p.name, p.username, p.avatar
        FROM videos v
        JOIN profiles p ON v.profile_id = p.id
        WHERE v.status = 2 AND v.visibility = 1
        ORDER BY (v.likes + v.comments + v.shares) / (unixepoch() - v.created_at + 1) DESC
      `
      break

    case 'for-you':
    default:
      // Personalized feed - mix of following, trending, and discovery
      query = `
        SELECT v.*, p.id as profile_id, p.name, p.username, p.avatar,
          CASE 
            WHEN f.follower_id IS NOT NULL THEN 1000
            WHEN v.likes > 100 THEN 100
            ELSE 1
          END as rank_score
        FROM videos v
        JOIN profiles p ON v.profile_id = p.id
        LEFT JOIN followers f ON v.profile_id = f.following_id AND f.follower_id = ?
        WHERE v.status = 2 AND v.visibility = 1
        ORDER BY rank_score DESC, v.created_at DESC
      `
      params.push(profileId)
      break
  }

  // Add cursor pagination
  if (cursor) {
    query += ' AND v.created_at < ?'
    params.push(cursor)
  }

  query += ' LIMIT ?'
  params.push(limit + 1)

  const videos = await db.query(query, params)
  const hasMore = videos.length > limit
  const items = hasMore ? videos.slice(0, -1) : videos
  const nextCursor = hasMore ? items[items.length - 1]?.created_at : undefined

  // Get profile info and check likes/bookmarks for each video
  const user = c.get('user')
  for (const video of items) {
    const profile = await db.queryOne(
      'SELECT id, name, username, avatar FROM profiles WHERE id = ?',
      [video.profile_id]
    )
    video.profile = profile

    const hasLiked = await db.queryOne(
      'SELECT 1 FROM video_likes WHERE profile_id = ? AND video_id = ?',
      [user.profileId, video.id]
    )
    const hasBookmarked = await db.queryOne(
      'SELECT 1 FROM video_bookmarks WHERE profile_id = ? AND video_id = ?',
      [user.profileId, video.id]
    )
    video.has_liked = Boolean(hasLiked)
    video.has_bookmarked = Boolean(hasBookmarked)

    // Audio info
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

    // Media URLs (signed)
    // In production, these would be generated via R2 signed URLs
    video.media = {
      thumbnail: video.thumbnail_path ? `/api/v1/media/thumbnail/${video.id}` : null,
      src_url: video.vid ? `/api/v1/media/video/${video.id}` : null,
      hls_url: video.remote_hls_url || (video.has_hls ? `/api/v1/media/hls/${video.id}/master.m3u8` : null),
      alt_text: video.alt_text,
      duration: video.duration,
      width: video.width,
      height: video.height,
    }
  }

  return c.json({
    items,
    meta: {
      next_cursor: nextCursor,
      has_more: hasMore,
      type,
    },
  })
})

// GET /api/v1/feed/account/:id
feedRoutes.get('/account/:id', validateParams(z.object({ id: z.string().min(1) })), validateQuery(paginationSchema), async (c: Context<Env>) => {
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

  // Add profile info and like/bookmark status
  for (const video of items) {
    video.profile = profile
    const hasLiked = await db.queryOne(
      'SELECT 1 FROM video_likes WHERE profile_id = ? AND video_id = ?',
      [user.profileId, video.id]
    )
    const hasBookmarked = await db.queryOne(
      'SELECT 1 FROM video_bookmarks WHERE profile_id = ? AND video_id = ?',
      [user.profileId, video.id]
    )
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
    meta: {
      next_cursor: nextCursor,
      has_more: hasMore,
      profile,
    },
  })
})

// GET /api/v1/feed/tag/:tag
feedRoutes.get('/tag/:tag', validateParams(z.object({ tag: z.string().min(1) })), validateQuery(paginationSchema), async (c: Context<Env>) => {
  const db = createDbClient(c.env)
  const { tag } = c.get('validatedParams')
  const { cursor, limit } = c.get('validatedQuery')
  const user = c.get('user')

  const hashtag = await db.queryOne('SELECT * FROM hashtags WHERE name_normalized = ?', [tag.toLowerCase()])
  if (!hashtag) {
    throw AppError.notFound('Hashtag not found')
  }

  let query = `
    SELECT v.*, p.id as profile_id, p.name, p.username, p.avatar
    FROM videos v
    JOIN profiles p ON v.profile_id = p.id
    JOIN video_hashtags vh ON v.id = vh.video_id
    WHERE vh.hashtag_id = ? AND v.status = 2 AND v.visibility = 1
  `
  const params: unknown[] = [hashtag.id]

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

  const user = c.get('user')
  for (const video of items) {
    video.profile = { id: hashtag.id, name: `#${tag}`, username: tag, avatar: null }
    const hasLiked = await db.queryOne(
      'SELECT 1 FROM video_likes WHERE profile_id = ? AND video_id = ?',
      [user.profileId, video.id]
    )
    const hasBookmarked = await db.queryOne(
      'SELECT 1 FROM video_bookmarks WHERE profile_id = ? AND video_id = ?',
      [user.profileId, video.id]
    )
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
    meta: {
      next_cursor: nextCursor,
      has_more: hasMore,
      hashtag: { id: hashtag.id, name: tag, count: hashtag.count },
    },
  })
})