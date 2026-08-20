import { Hono } from 'hono'
import { z } from 'zod'
import { Context } from 'hono'
import { Env } from '../types/env'
import { createDbClient } from '../db/client'
import { createR2Client, VIDEO_PATHS, getContentType, getCacheControl } from '../services/r2'
import { createQueueClient, createVideoProcessingJob } from '../queue/client'
import { validateBody, validateQuery, validateParams, paginationSchema, uploadVideoSchema, updateVideoSchema, videoIdSchema } from '../middleware/validation'
import { AppError, requireScope } from '../middleware/error-handler'
import { authMiddleware } from '../middleware/auth'

export const videoRoutes = new Hono<Env>()

// All video routes require auth
videoRoutes.use('*', authMiddleware)

// GET /api/v1/videos/:id - Get video details
videoRoutes.get('/:id', validateParams(videoIdSchema), async (c: Context<Env>) => {
  const db = c.get('db')
  const { id } = c.get('validatedParams')
  const user = c.get('user')

  const video = await db.queryOne<{
    id: string
    profile_id: string
    vid: string
    vid_optimized: string
    thumbnail_path: string
    status: number
    visibility: number
    duration: number
    size_kb: number
    caption: string
    is_local: number
    uri: string
    remote_media_url: string
    remote_thumb_url: string
    remote_hls_url: string
    tags: string
    likes: number
    comments: number
    shares: number
    views: number
    bookmarks: number
    is_sensitive: number
    is_adult: number
    has_audio: number
    has_thumb: number
    has_processed: number
    is_approved: number
    features: string
    media_metadata: string
    comment_state: number
    cw_title: string
    cw_body: string
    sha512_hash: string
    has_hls: number
    can_download: number
    can_duet: number
    is_duet: number
    original_duet_id: string
    duet_path: string
    duet_layout: number
    can_stitch: number
    is_pinned: number
    pinned_order: number
    width: number
    height: number
    category: string
    ap_published_at: number
    last_fetched_at: number
    fetch_failure_count: number
    is_edited: number
    alt_text: string
    lang: string
    contains_ai: number
    contains_ad: number
    audio_allow_reuse: number
    has_hidden_comments: number
    thumbnail_width: number
    thumbnail_height: number
    scheduled_at: number
    publishing_at: number
    ap_published_at: number
    publish_state: number
    sound_id: string
    provider_track_id: string
    music_provider: string
    music_metadata: string
    music_licensing: string
    created_at: number
    updated_at: number
  }>(
    `SELECT * FROM videos WHERE id = ?`,
    [c.get('validatedParams').id]
  )

  if (!video) {
    throw AppError.notFound('Video not found')
  }

  // Check visibility
  if (video.status !== 2) {
    if (video.profile_id !== user.profileId && !user.isAdmin) {
      throw AppError.notFound('Video not found')
    }
  }

  if (video.visibility === 2 && video.profile_id !== user.profileId) {
    // Local only
    throw AppError.notFound('Video not found')
  }

  if (video.visibility === 4 && video.profile_id !== user.profileId) {
    // Followers only - check if following
    const isFollowing = await c.get('db').queryOne(
      'SELECT 1 FROM followers WHERE follower_id = ? AND following_id = ? AND status = 1',
      [user.profileId, video.profile_id]
    )
    if (!isFollowing && video.profile_id !== user.profileId && !user.isAdmin) {
      throw AppError.notFound('Video not found')
    }
  }

  // Get profile info
  const profile = await c.get('db').queryOne(
    'SELECT id, name, username, avatar FROM profiles WHERE id = ?',
    [video.profile_id]
  )

  // Check if user liked/bookmarked
  const hasLiked = await c.get('db').queryOne(
    'SELECT 1 FROM video_likes WHERE profile_id = ? AND video_id = ?',
    [user.profileId, video.id]
  )
  const hasBookmarked = await c.get('db').queryOne(
    'SELECT 1 FROM video_bookmarks WHERE profile_id = ? AND video_id = ?',
    [user.profileId, video.id]
  )

  // Generate media URLs
  const r2 = createR2Client(c.env)
  const mediaUrl = video.vid_optimized 
    ? await r2.signedUrl(video.vid_optimized)
    : (video.vid ? await r2.signedUrl(video.vid) : null)
  
  const thumbnailUrl = video.thumbnail_path 
    ? await r2.signedUrl(video.thumbnail_path)
    : null

  const hlsUrl = video.remote_hls_url || (video.has_hls && video.vid_optimized 
    ? `${mediaUrl.replace('source', 'hls/master.m3u8')}` 
    : null)

  return c.json({
    id: video.id,
    profile: profile || { id: video.profile_id, name: 'Unknown', username: 'unknown', avatar: null },
    caption: video.caption,
    url: `https://yourdomain.com/v/${video.id}`,
    shortcode: video.id,
    is_owner: video.profile_id === user.profileId,
    is_sensitive: Boolean(video.is_sensitive),
    is_local: Boolean(video.is_local),
    media: {
      thumbnail: thumbnailUrl,
      src_url: mediaUrl,
      hls_url: hlsUrl,
      alt_text: video.alt_text,
      duration: video.duration,
      width: video.width,
      height: video.height,
    },
    pinned: Boolean(video.is_pinned),
    likes: video.likes,
    shares: video.shares,
    comments: video.comment_state === 4 ? video.comments : 0,
    bookmarks: video.bookmarks,
    has_liked: Boolean(hasLiked),
    has_bookmarked: Boolean(hasBookmarked),
    is_edited: Boolean(video.is_edited),
    lang: video.lang,
    tags: video.tags ? JSON.parse(video.tags) : [],
    mentions: [],
    permissions: {
      can_comment: Boolean(video.comment_state === 4),
      can_download: Boolean(video.can_download),
      can_duet: Boolean(video.can_duet),
      can_stitch: Boolean(video.can_stitch),
      can_embed: Boolean(video.can_embed && !video.is_sensitive),
    },
    audio: {
      has_audio: Boolean(video.has_audio),
      id: video.sound_id ? `sound:${video.sound_id}` : `at:${video.id}`,
      count: 0,
      key: video.sound_id || crypto.randomUUID(),
      sound_id: video.sound_id || null,
      provider_track_id: video.provider_track_id || null,
      music_provider: video.music_provider || null,
      music_metadata: video.music_metadata ? JSON.parse(video.music_metadata) : null,
      music_licensing: video.music_licensing ? JSON.parse(video.music_licensing) : null,
    },
    meta: {
      contains_ai: Boolean(video.contains_ai),
      contains_ad: Boolean(video.contains_ad),
    },
    created_at: new Date(video.created_at * 1000).toISOString(),
  })
})

// POST /api/v1/videos - Upload video
videoRoutes.post('/', 
  requireScope('video:create'),
  validateBody(uploadVideoSchema),
  async (c: Context<Env>) => {
    const db = c.get('db')
    const r2 = createR2Client(c.env)
    const user = c.get('user')
    const body = c.get('validatedBody')

    // Create video record
    const videoId = crypto.randomUUID()
    const profileId = user.profileId!
    const uploadId = crypto.randomUUID()

    await db.exec(
      `INSERT INTO videos (
        id, profile_id, caption, size_kb, is_sensitive, comment_state,
        can_download, can_embed, can_duet, can_stitch, alt_text,
        contains_ai, contains_ad, lang, media_metadata,
        sound_id, provider_track_id, music_provider, music_metadata, music_licensing,
        scheduled_at, publish_state, created_at, updated_at
      ) VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())`,
      [
        videoId,
        profileId,
        body.description || null,
        body.is_sensitive ? 1 : 0,
        body.comment_state === '4' ? 4 : 0,
        body.can_download ? 1 : 0,
        body.can_embed ? 1 : 0,
        body.can_duet ? 1 : 0,
        body.can_stitch ? 1 : 0,
        body.alt_text || null,
        body.contains_ai ? 1 : 0,
        body.contains_ad ? 1 : 0,
        body.lang || null,
        JSON.stringify({}),
        body.sound_id || null,
        body.provider_track_id || null,
        body.music_provider || null,
        body.music_metadata ? JSON.stringify(body.music_metadata) : null,
        body.music_licensing ? JSON.stringify(body.music_licensing) : null,
        body.scheduled_at ? Math.floor(new Date(body.scheduled_at).getTime() / 1000) : null,
        body.scheduled_at ? 1 : 0,
      ]
    )

    // Generate signed upload URL
    const sourcePath = VIDEO_PATHS.source(profileId, videoId)
    const uploadUrl = await r2.signedUrl(sourcePath, { 
      expiration: 3600, 
      method: 'PUT' 
    })

    // Queue processing job if not scheduled
    if (!body.scheduled_at) {
      await c.env.QUEUE_VIDEO_PROCESSING.send(createVideoProcessingJob(
        videoId,
        user.id,
        sourcePath,
        {
          generateHls: true,
          generateThumbnails: true,
          generatePreview: true,
          hlsRenditions: ['360p', '720p', '1080p'],
          soundId: body.sound_id,
          providerTrackId: body.provider_track_id,
          musicProvider: body.music_provider,
        },
        'normal'
      ))
    }

    // Update profile video count
    await c.env.DB.prepare('UPDATE profiles SET video_count = video_count + 1 WHERE id = ?').bind(profileId).run()

    return c.json({
      videoId,
      uploadUrl,
      uploadId,
      fields: {
        key: sourcePath,
        'Content-Type': 'video/mp4',
      },
      expiresIn: 3600,
    }, 201)
  }
)

// PUT /api/v1/videos/:id - Update video
videoRoutes.put('/:id', validateParams(videoIdSchema), validateBody(updateVideoSchema), async (c: Context<Env>) => {
  const db = c.get('db')
  const { id } = c.get('validatedParams')
  const body = c.get('validatedBody')
  const user = c.get('user')

  const video = await db.queryOne('SELECT * FROM videos WHERE id = ?', [id])
  if (!video) {
    throw AppError.notFound('Video not found')
  }

  // Check ownership
  if (video.profile_id !== user.profileId && !user.isAdmin) {
    throw AppError.forbidden('Not authorized to update this video')
  }

  // Build update query
  const updates: string[] = []
  const params: unknown[] = []

  if (body.caption !== undefined) {
    updates.push('caption = ?')
    params.push(body.caption)
  }
  if (body.alt_text !== undefined) {
    updates.push('alt_text = ?')
    params.push(body.alt_text)
  }
  if (body.lang !== undefined) {
    updates.push('lang = ?')
    params.push(body.lang)
  }
  if (body.is_sensitive !== undefined) {
    updates.push('is_sensitive = ?')
    params.push(body.is_sensitive ? 1 : 0)
  }
  if (body.contains_ai !== undefined) {
    updates.push('contains_ai = ?')
    params.push(body.contains_ai ? 1 : 0)
  }
  if (body.contains_ad !== undefined) {
    updates.push('contains_ad = ?')
    params.push(body.contains_ad ? 1 : 0)
  }
  if (body.can_download !== undefined) {
    updates.push('can_download = ?')
    params.push(body.can_download ? 1 : 0)
  }
  if (body.can_comment !== undefined) {
    updates.push('comment_state = ?')
    params.push(body.can_comment ? 4 : 0)
  }
  if (body.can_duet !== undefined) {
    updates.push('can_duet = ?')
    params.push(body.can_duet ? 1 : 0)
  }
  if (body.can_stitch !== undefined) {
    updates.push('can_stitch = ?')
    params.push(body.can_stitch ? 1 : 0)
  }
  if (body.can_embed !== undefined) {
    updates.push('can_embed = ?')
    params.push(body.can_embed ? 1 : 0)
  }
  if (body.is_pinned !== undefined) {
    updates.push('is_pinned = ?')
    params.push(body.is_pinned ? 1 : 0)
  }

  if (updates.length > 0) {
    updates.push('updated_at = unixepoch()')
    params.push(id)
    
    await db.exec(
      `UPDATE videos SET ${updates.join(', ')} WHERE id = ?`,
      params
    )
  }

  // Return updated video
  const updated = await db.queryOne('SELECT * FROM videos WHERE id = ?', [id])
  return c.json({ success: true, video: updated })
})

// DELETE /api/v1/videos/:id - Delete video
videoRoutes.delete('/:id', validateParams(videoIdSchema), async (c: Context<Env>) => {
  const db = c.get('db')
  const { id } = c.get('validatedParams')
  const user = c.get('user')

  const video = await db.queryOne('SELECT * FROM videos WHERE id = ?', [id])
  if (!video) {
    throw AppError.notFound('Video not found')
  }

  // Check ownership
  if (video.profile_id !== user.profileId && !user.isAdmin) {
    throw AppError.forbidden('Not authorized to delete this video')
  }

  // Delete from R2
  const r2 = createR2Client(c.env)
  const paths = [
    video.vid,
    video.vid_optimized,
    video.thumbnail_path,
    `videos/${video.profile_id}/${id}/`,
  ].filter(Boolean)

  await Promise.all(paths.map(p => r2.delete(p)))

  // Delete from DB (cascades to likes, bookmarks, comments, etc.)
  await db.exec('DELETE FROM videos WHERE id = ?', [id])

  // Update profile video count
  await c.env.DB.prepare('UPDATE profiles SET video_count = video_count - 1 WHERE id = ?').bind(video.profile_id).run()

  return c.json({ success: true })
})

// POST /api/v1/videos/:id/like
videoRoutes.post('/:id/like', validateParams(videoIdSchema), async (c: Context<Env>) => {
  const db = c.get('db')
  const { id } = c.get('validatedParams')
  const user = c.get('user')

  const video = await db.queryOne('SELECT * FROM videos WHERE id = ? AND status = 2', [id])
  if (!video) {
    throw AppError.notFound('Video not found')
  }

  const existing = await db.queryOne(
    'SELECT 1 FROM video_likes WHERE profile_id = ? AND video_id = ?',
    [user.profileId, id]
  )

  if (existing) {
    throw AppError.conflict('Already liked')
  }

  await db.exec(
    'INSERT INTO video_likes (id, profile_id, video_id, created_at) VALUES (?, ?, ?, unixepoch())',
    [crypto.randomUUID(), user.profileId, id]
  )

  await db.exec('UPDATE videos SET likes = likes + 1 WHERE id = ?', [id])

  // Queue notification
  await c.env.QUEUE_NOTIFICATIONS.send({
    type: 'notification',
    userId: video.profile_id,
    notificationId: crypto.randomUUID(),
    type: 'like',
    data: { videoId: id, actorId: user.profileId },
    priority: 'normal',
    createdAt: Date.now(),
  })

  return c.json({ success: true, has_liked: true, likes: video.likes + 1 })
})

// POST /api/v1/videos/:id/unlike
videoRoutes.post('/:id/unlike', validateParams(videoIdSchema), async (c: Context<Env>) => {
  const db = c.get('db')
  const { id } = c.get('validatedParams')
  const user = c.get('user')

  const video = await db.queryOne('SELECT * FROM videos WHERE id = ?', [id])
  if (!video) {
    throw AppError.notFound('Video not found')
  }

  const deleted = await db.exec(
    'DELETE FROM video_likes WHERE profile_id = ? AND video_id = ?',
    [user.profileId, id]
  )

  if (deleted) {
    await db.exec('UPDATE videos SET likes = likes - 1 WHERE id = ?', [id])
  }

  return c.json({ success: true, has_liked: false, likes: Math.max(0, video.likes - (deleted ? 1 : 0)) })
})

// POST /api/v1/videos/:id/bookmark
videoRoutes.post('/:id/bookmark', validateParams(videoIdSchema), async (c: Context<Env>) => {
  const db = c.get('db')
  const { id } = c.get('validatedParams')
  const user = c.get('user')

  const video = await db.queryOne('SELECT * FROM videos WHERE id = ?', [id])
  if (!video) {
    throw AppError.notFound('Video not found')
  }

  const existing = await db.queryOne(
    'SELECT 1 FROM video_bookmarks WHERE profile_id = ? AND video_id = ?',
    [user.profileId, id]
  )

  if (existing) {
    throw AppError.conflict('Already bookmarked')
  }

  await db.exec(
    'INSERT INTO video_bookmarks (id, profile_id, video_id, created_at) VALUES (?, ?, ?, unixepoch())',
    [crypto.randomUUID(), user.profileId, id]
  )

  await db.exec('UPDATE videos SET bookmarks = bookmarks + 1 WHERE id = ?', [id])

  return c.json({ success: true, has_bookmarked: true, bookmarks: video.bookmarks + 1 })
})

// POST /api/v1/videos/:id/unbookmark
videoRoutes.post('/:id/unbookmark', validateParams(videoIdSchema), async (c: Context<Env>) => {
  const db = c.get('db')
  const { id } = c.get('validatedParams')
  const user = c.get('user')

  const video = await db.queryOne('SELECT * FROM videos WHERE id = ?', [id])
  if (!video) {
    throw AppError.notFound('Video not found')
  }

  const deleted = await db.exec(
    'DELETE FROM video_bookmarks WHERE profile_id = ? AND video_id = ?',
    [user.profileId, id]
  )

  if (deleted) {
    await db.exec('UPDATE videos SET bookmarks = bookmarks - 1 WHERE id = ?', [id])
  }

  return c.json({ success: true, has_bookmarked: false, bookmarks: Math.max(0, video.bookmarks - (deleted ? 1 : 0)) })
})

// GET /api/v1/videos/:id/comments
videoRoutes.get('/:id/comments', validateParams(videoIdSchema), validateQuery(paginationSchema), async (c: Context<Env>) => {
  const db = c.get('db')
  const { id } = c.get('validatedParams')
  const { cursor, limit } = c.get('validatedQuery')

  const video = await db.queryOne('SELECT * FROM videos WHERE id = ? AND comment_state = 4', [id])
  if (!video) {
    throw AppError.notFound('Video not found or comments disabled')
  }

  let query = `
    SELECT c.*, p.id as profile_id, p.name, p.username, p.avatar
    FROM comments c
    JOIN profiles p ON c.profile_id = p.id
    WHERE c.video_id = ? AND c.status = 'active' AND c.parent_id IS NULL AND c.is_hidden = 0
  `
  const params: unknown[] = [c.get('validatedParams').id]

  if (cursor) {
    query += ' AND c.created_at < ?'
    params.push(cursor)
  }

  query += ' ORDER BY c.created_at DESC LIMIT ?'
  params.push(limit + 1)

  const comments = await db.query(query, params)
  const hasMore = comments.length > limit
  const items = hasMore ? comments.slice(0, -1) : comments
  const nextCursor = hasMore ? items[items.length - 1]?.created_at : undefined

  // Get like status for each comment
  const profileId = c.get('user').profileId
  for (const comment of items) {
    const liked = await db.queryOne(
      'SELECT 1 FROM comment_likes WHERE profile_id = ? AND comment_id = ?',
      [c.get('user').profileId, comment.id]
    )
    comment.has_liked = Boolean(liked)
  }

  return c.json({
    items,
    meta: {
      next_cursor: nextCursor,
      has_more: hasMore,
    },
  })
})

// POST /api/v1/videos/:id/comments
videoRoutes.post('/:id/comments', validateParams(videoIdSchema), validateBody(z.object({
  comment: z.string().min(1).max(2000),
  parent_id: z.string().optional(),
})), async (c: Context<Env>) => {
  const db = c.get('db')
  const { id } = c.get('validatedParams')
  const { comment, parent_id } = c.get('validatedBody')
  const user = c.get('user')

  const video = await db.queryOne('SELECT * FROM videos WHERE id = ? AND comment_state = 4', [id])
  if (!video) {
    throw AppError.notFound('Video not found or comments disabled')
  }

  const commentId = crypto.randomUUID()
  const profileId = user.profileId

  if (parent_id) {
    // Reply
    const parent = await db.queryOne('SELECT * FROM comments WHERE id = ? AND video_id = ?', [parent_id, id])
    if (!parent) {
      throw AppError.notFound('Parent comment not found')
    }

    await db.exec(
      `INSERT INTO comment_replies (id, comment_id, video_id, profile_id, caption, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'active', unixepoch())`,
      [crypto.randomUUID(), parent_id, id, user.profileId, comment]
    )

    await db.exec('UPDATE comments SET replies_count = replies_count + 1 WHERE id = ?', [parent_id])
  } else {
    // Top-level comment
    await db.exec(
      `INSERT INTO comments (id, video_id, profile_id, caption, status, created_at)
       VALUES (?, ?, ?, ?, 'active', unixepoch())`,
      [commentId, id, profileId, comment]
    )
  }

  await db.exec('UPDATE videos SET comments = comments + 1 WHERE id = ?', [id])

  // Queue notification
  await c.env.QUEUE_NOTIFICATIONS.send({
    type: 'notification',
    userId: video.profile_id,
    notificationId: crypto.randomUUID(),
    type: parent_id ? 'comment' : 'comment',
    data: { videoId: id, commentId: parent_id || commentId, actorId: user.profileId },
    priority: 'normal',
    createdAt: Date.now(),
  })

  return c.json({ success: true, commentId })
})