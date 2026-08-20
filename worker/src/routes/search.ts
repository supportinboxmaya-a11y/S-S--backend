import { Hono } from 'hono'
import { z } from 'zod'
import { Context } from 'hono'
import { Env } from '../types/env'
import { createDbClient } from '../db/client'
import { validateQuery, validateParams, paginationSchema } from '../middleware/validation'
import { AppError } from '../middleware/error-handler'
import { authMiddleware } from '../middleware/auth'

export const searchRoutes = new Hono<Env>()

searchRoutes.use('*', authMiddleware)

// GET /api/v1/search
searchRoutes.get('/', validateQuery(paginationSchema.extend({
  q: z.string().min(1).max(100),
  type: z.enum(['all', 'users', 'videos', 'hashtags', 'sounds']).default('all'),
})), async (c: Context<Env>) => {
  const db = createDbClient(c.env)
  const { q, type, limit, cursor } = c.get('validatedQuery')
  const user = c.get('user')

  const searchTerm = `%${q}%`
  const exactTerm = `${q}%`

  const results: Record<string, unknown[]> = {}

  // Search users
  if (type === 'all' || type === 'users') {
    const users = await c.get('db').query(`
      SELECT p.id, p.name, p.username, p.avatar, p.bio, p.follower_count,
        CASE WHEN f.follower_id = ? THEN 1 ELSE 0 END as is_following
      FROM profiles p
      LEFT JOIN followers f ON p.id = f.following_id AND f.follower_id = ?
      WHERE p.username LIKE ? OR p.name LIKE ?
      ORDER BY 
        CASE WHEN p.username LIKE ? THEN 0 ELSE 1 END,
        p.follower_count DESC
      LIMIT ?
    `, [c.get('user').profileId, c.get('user').profileId, exactTerm, searchTerm, exactTerm, limit + 1])

    results.users = users.map(u => ({
      id: u.id,
      name: u.name,
      username: u.username,
      avatar: u.avatar,
      bio: u.bio,
      follower_count: u.follower_count,
      is_following: Boolean(u.is_following),
    }))
  }

  // Search videos
  if (type === 'all' || type === 'videos') {
    let query = `
      SELECT v.*, p.id as profile_id, p.name, p.username, p.avatar
      FROM videos v
      JOIN profiles p ON v.profile_id = p.id
      WHERE v.status = 2 AND v.visibility = 1 
      AND (v.caption LIKE ? OR v.tags LIKE ?)
    `
    const params: unknown[] = [searchTerm, searchTerm]

    if (cursor) {
      query += ' AND v.created_at < ?'
      params.push(cursor)
    }

    query += ' ORDER BY v.created_at DESC LIMIT ?'
    params.push(limit + 1)

    const videos = await c.get('db').query(query, params)
    results.videos = videos.map(v => ({
      id: v.id,
      caption: v.caption,
      media: {
        thumbnail: v.thumbnail_path,
        duration: v.duration,
      },
      profile: {
        id: v.profile_id,
        name: v.name,
        username: v.username,
        avatar: v.avatar,
      },
      likes: v.likes,
      comments: v.comments,
      created_at: new Date(v.created_at * 1000).toISOString(),
    }))
  }

  // Search hashtags
  if (type === 'all' || type === 'hashtags') {
    const hashtags = await c.get('db').query(`
      SELECT h.id, h.name, h.count
      FROM hashtags h
      WHERE h.name_normalized LIKE ? OR h.name LIKE ?
      ORDER BY h.count DESC
      LIMIT ?
    `, [exactTerm, searchTerm, limit + 1])

    results.hashtags = hashtags.map(h => ({
      id: h.id,
      name: h.name,
      count: h.count,
    }))
  }

  // Search sounds
  if (type === 'all' || type === 'sounds') {
    const sounds = await c.get('db').query(`
      SELECT s.*, 
        CASE WHEN s.provider = 'local' THEN 'local' ELSE s.provider END as source
      FROM (
        SELECT vs.id, vs.title, vs.artist, vs.duration, vs.artwork_url, 
               'local' as provider, vs.provider_id, vs.provider as provider_track_id
        FROM video_sounds vs
        WHERE vs.title LIKE ? OR vs.artist LIKE ?
        
        UNION ALL
        
        SELECT pt.id, pt.title, pt.artist, pt.duration, pt.artwork_url,
               pt.provider, pt.provider_id, pt.provider_id as provider_track_id
        FROM provider_tracks pt
        WHERE pt.title LIKE ? OR pt.artist LIKE ?
      ) s
      ORDER BY 
        CASE WHEN s.title LIKE ? THEN 0 ELSE 1 END
      LIMIT ?
    `, [exactTerm, searchTerm, exactTerm, searchTerm, exactTerm, limit + 1])

    results.sounds = s.map(s => ({
      id: s.id,
      title: s.title,
      artist: s.artist,
      duration: s.duration,
      artwork_url: s.artwork_url,
      provider: s.provider,
      provider_id: s.provider_id,
      provider_track_id: s.provider_track_id,
    }))
  }

  return c.json({ results, query: q })
})

// GET /api/v1/search/suggestions
searchRoutes.get('/suggestions', validateQuery(z.object({
  q: z.string().min(1).max(100),
  type: z.enum(['users', 'hashtags', 'sounds']).default('users'),
  limit: z.coerce.number().int().min(1).max(20).default(10),
})), async (c: Context<Env>) => {
  const { q, type, limit } = c.get('validatedQuery')
  const exactTerm = `${q}%`
  const searchTerm = `%${q}%`

  let suggestions: unknown[] = []

  switch (type) {
    case 'users':
      suggestions = await c.get('db').query(`
        SELECT p.id, p.name, p.username, p.avatar
        FROM profiles p
        WHERE p.username LIKE ? OR p.name LIKE ?
        ORDER BY p.follower_count DESC
        LIMIT ?
      `, [exactTerm, searchTerm, limit])
      break

    case 'hashtags':
      suggestions = await c.get('db').query(`
        SELECT h.id, h.name, h.count
        FROM hashtags h
        WHERE h.name_normalized LIKE ? OR h.name LIKE ?
        ORDER BY h.count DESC
        LIMIT ?
      `, [exactTerm, searchTerm, limit])
      break

    case 'sounds':
      suggestions = await c.get('db').query(`
        SELECT vs.id, vs.title, vs.artist, vs.duration
        FROM video_sounds vs
        WHERE vs.title LIKE ? OR vs.artist LIKE ?
        LIMIT ?
      `, [exactTerm, searchTerm, limit])
      break
  }

  return c.json({ suggestions })
})