import { Hono } from 'hono'
import { z } from 'zod'
import { Context } from 'hono'
import { Env } from '../types/env'
import { createDbClient } from '../db/client'
import { validateQuery, validateParams, paginationSchema } from '../middleware/validation'
import { AppError } from '../middleware/error-handler'
import { authMiddleware } from '../middleware/auth'

export const musicRoutes = new Hono<Env>()

musicRoutes.use('*', authMiddleware)

// GET /api/v1/music/search
musicRoutes.get('/search', validateQuery(z.object({
  q: z.string().min(1).max(100),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0),
})), async (c: Context<Env>) => {
  const { q, limit, offset } = c.get('validatedQuery')

  // Check cache first
  const cacheKey = `music:search:${q}:${limit}:${offset}`
  const cached = await c.env.KV_CACHE.get(cacheKey, 'json')
  if (cached) {
    return c.json(cached)
  }

  // Search provider tracks in D1
  const db = createDbClient(c.env)
  const tracks = await db.query<{
    id: string
    provider: string
    provider_id: string
    title: string
    artist: string
    artist_id: string
    duration: number
    artwork_url: string
    audio_url: string
    genre: string
    bpm: number
    release_date: number
    license: string
    attribution: string
    is_downloadable: number
    is_streamable: number
    licensing: string
    metadata: string
  }>(
    `SELECT * FROM provider_tracks 
     WHERE title LIKE ? OR artist LIKE ?
     ORDER BY 
       CASE WHEN title LIKE ? THEN 0 ELSE 1 END,
       CASE WHEN artist LIKE ? THEN 0 ELSE 1 END,
       title
     LIMIT ? OFFSET ?`,
    [`%${q}%`, `%${q}%`, `${q}%`, `${q}%`, limit, offset]
  )

  // If not enough results, search Audius API
  if (tracks.length < limit) {
    try {
      const audiusUrl = `${c.env.AUDIUS_DISCOVERY_PROVIDER}/v1/tracks/search`
      const params = new URLSearchParams({
        query: q,
        limit: String(limit - tracks.length),
        offset: String(offset),
        app_name: c.env.AUDIUS_APP_NAME || 'Loops',
      })

      const response = await fetch(`${audiusUrl}?${params}`)
      if (response.ok) {
        const data = await response.json()
        const audiusTracks = (data.data || []).map((track: any) => ({
          id: `audius:${track.track_id}`,
          provider: 'audius',
          provider_id: track.track_id,
          title: track.title,
          artist: track.user?.name || track.user?.handle || 'Unknown',
          artist_id: track.user?.user_id ? `audius:${track.user.user_id}` : null,
          duration: track.duration || 0,
          artwork_url: track.artwork || track.artwork_150x150 || track.artwork_480x480 || null,
          audio_url: track.stream_url || null,
          genre: track.genre || null,
          bpm: track.bpm || null,
          release_date: track.release_date ? Math.floor(new Date(track.release_date).getTime() / 1000) : null,
          license: track.license || '',
          attribution: track.user ? `${track.title} by ${track.user.name || track.user.handle} on Audius` : null,
          is_downloadable: Boolean(track.downloadable),
          is_streamable: Boolean(track.stream_url),
          licensing: JSON.stringify({
            can_use_in_video: true,
            can_download: Boolean(track.downloadable),
            can_commercial: false,
            requires_attribution: true,
            attribution_text: track.user ? `${track.title} by ${track.user.name || track.user.handle} on Audius` : null,
            license_type: track.license || 'Audius Terms of Service',
            restrictions: track.downloadable ? [] : ['no_download', 'streaming_only'],
          }),
          metadata: JSON.stringify({
            user: track.user,
            tags: track.tags,
            mood: track.mood,
          }),
        }))

        // Cache new tracks
        for (const track of audiusTracks) {
          await c.env.DB.prepare(`
            INSERT OR REPLACE INTO provider_tracks 
            (id, provider, provider_id, title, artist, artist_id, duration, artwork_url, audio_url, genre, bpm, release_date, license, attribution, is_downloadable, is_streamable, licensing, metadata, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())
          `).bind(
            track.id, track.provider, track.provider_id, track.title, track.artist,
            track.artist_id, track.duration, track.artwork_url, track.audio_url,
            track.genre, track.bpm, track.release_date, track.license,
            track.attribution, track.is_downloadable ? 1 : 0, track.is_streamable ? 1 : 0,
            track.licensing, track.metadata
          ).run()
        }

        tracks.push(...audiusTracks)
      }
    } catch (error) {
      console.error('Audius search error:', error)
    }
  }

  const response = {
    tracks: tracks.slice(0, limit).map(t => ({
      id: t.id,
      title: t.title,
      artist: t.artist,
      artist_id: t.artist_id,
      duration: t.duration,
      artwork_url: t.artwork_url,
      audio_url: t.audio_url,
      genre: t.genre,
      bpm: t.bpm,
      release_date: t.release_date ? new Date(t.release_date * 1000).toISOString() : null,
      license: t.license,
      provider: t.provider,
      provider_id: t.provider_id,
      attribution: t.attribution,
      is_downloadable: Boolean(t.is_downloadable),
      is_streamable: Boolean(t.is_streamable),
      licensing: t.licensing ? JSON.parse(t.licensing) : null,
    })),
    meta: {
      total: tracks.length,
      has_more: tracks.length >= (c.get('validatedQuery')?.limit || 20),
      limit,
      offset,
    },
  }

  // Cache for 1 hour
  await c.env.KV_CACHE.put(cacheKey, JSON.stringify(response), { expirationTtl: 3600 })

  return c.json(response)
})

// GET /api/v1/music/trending
musicRoutes.get('/trending', validateQuery(paginationSchema), async (c: Context<Env>) => {
  const { limit, offset } = c.get('validatedQuery')

  const cacheKey = `music:trending:${limit}:${offset}`
  const cached = await c.env.KV_CACHE.get(cacheKey, 'json')
  if (cached) {
    return c.json(cached)
  }

  const db = createDbClient(c.env)
  let tracks = await db.query<{
    id: string
    provider: string
    provider_id: string
    title: string
    artist: string
    artist_id: string
    duration: number
    artwork_url: string
    audio_url: string
    genre: string
    bpm: number
    release_date: number
    license: string
    attribution: string
    is_downloadable: number
    is_streamable: number
    licensing: string
    metadata: string
  }>(
    `SELECT * FROM provider_tracks 
     WHERE is_streamable = 1
     ORDER BY 
       CASE provider WHEN 'audius' THEN 0 ELSE 1 END,
       duration DESC
     LIMIT ? OFFSET ?`,
    [limit, offset]
  )

  // If not enough, fetch from Audius
  if (tracks.length < limit) {
    try {
      const audiusUrl = `${c.env.AUDIUS_DISCOVERY_PROVIDER}/v1/tracks/trending`
      const params = new URLSearchParams({
        limit: String(limit - tracks.length),
        offset: String(offset),
        time: 'week',
        app_name: c.env.AUDIUS_APP_NAME || 'Loops',
      })

      const response = await fetch(`${audiusUrl}?${params}`)
      if (response.ok) {
        const data = await response.json()
        const audiusTracks = (data.data || []).map((track: any) => ({
          id: `audius:${track.track_id}`,
          provider: 'audius',
          provider_id: track.track_id,
          title: track.title,
          artist: track.user?.name || track.user?.handle || 'Unknown',
          artist_id: track.user?.user_id ? `audius:${track.user.user_id}` : null,
          duration: track.duration || 0,
          artwork_url: track.artwork || track.artwork_150x150 || track.artwork_480x480 || null,
          audio_url: track.stream_url || null,
          genre: track.genre || null,
          bpm: track.bpm || null,
          release_date: track.release_date ? Math.floor(new Date(track.release_date).getTime() / 1000) : null,
          license: track.license || '',
          attribution: track.user ? `${track.title} by ${track.user.name || track.user.handle} on Audius` : null,
          is_downloadable: Boolean(track.downloadable),
          is_streamable: Boolean(track.stream_url),
          licensing: JSON.stringify({
            can_use_in_video: true,
            can_download: Boolean(track.downloadable),
            can_commercial: false,
            requires_attribution: true,
            attribution_text: track.user ? `${track.title} by ${track.user.name || track.user.handle} on Audius` : null,
            license_type: track.license || 'Audius Terms of Service',
            restrictions: track.downloadable ? [] : ['no_download', 'streaming_only'],
          }),
          metadata: JSON.stringify({ user: track.user, tags: track.tags, mood: track.mood }),
        }))

        for (const track of audiusTracks) {
          await c.env.DB.prepare(`
            INSERT OR REPLACE INTO provider_tracks 
            (id, provider, provider_id, title, artist, artist_id, duration, artwork_url, audio_url, genre, bpm, release_date, license, attribution, is_downloadable, is_streamable, licensing, metadata, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())
          `).bind(
            track.id, track.provider, track.provider_id, track.title, track.artist,
            track.artist_id, track.duration, track.artwork_url, track.audio_url,
            track.genre, track.bpm, track.release_date, track.license,
            track.attribution, track.is_downloadable ? 1 : 0, track.is_streamable ? 1 : 0,
            track.licensing, track.metadata
          ).run()
        }

        tracks.push(...audiusTracks)
      }
    } catch (error) {
      console.error('Audius trending error:', error)
    }
  }

  const response = {
    tracks: tracks.slice(0, limit).map(t => ({
      id: t.id,
      title: t.title,
      artist: t.artist,
      artist_id: t.artist_id,
      duration: t.duration,
      artwork_url: t.artwork_url,
      audio_url: t.audio_url,
      genre: t.genre,
      bpm: t.bpm,
      release_date: t.release_date ? new Date(t.release_date * 1000).toISOString() : null,
      license: t.license,
      provider: t.provider,
      provider_id: t.provider_id,
      attribution: t.attribution,
      is_downloadable: Boolean(t.is_downloadable),
      is_streamable: Boolean(t.is_streamable),
      licensing: t.licensing ? JSON.parse(t.licensing) : null,
    })),
    meta: {
      total: tracks.length,
      has_more: tracks.length >= (c.get('validatedQuery')?.limit || 20),
      limit,
      offset,
    },
  }

  await c.env.KV_CACHE.put(`music:trending:${limit}:${offset}`, JSON.stringify(response), { expirationTtl: 3600 })

  return c.json(response)
})

// GET /api/v1/music/:id
musicRoutes.get('/:id', validateParams(z.object({ id: z.string().min(1) })), async (c: Context<Env>) => {
  const { id } = c.get('validatedParams')
  const db = createDbClient(c.env)

  // Check cache
  const cacheKey = `music:track:${id}`
  const cached = await c.env.KV_CACHE.get(cacheKey, 'json')
  if (cached) {
    return c.json(cached)
  }

  // Check local cache
  const track = await db.queryOne<{
    id: string
    provider: string
    provider_id: string
    title: string
    artist: string
    artist_id: string
    duration: number
    artwork_url: string
    audio_url: string
    genre: string
    bpm: number
    release_date: number
    license: string
    attribution: string
    is_downloadable: number
    is_streamable: number
    licensing: string
    metadata: string
  }>('SELECT * FROM provider_tracks WHERE id = ?', [id])

  if (!track) {
    // Try to fetch from provider
    if (id.startsWith('audius:')) {
      const providerId = id.replace('audius:', '')
      try {
        const response = await fetch(`${c.env.AUDIUS_DISCOVERY_PROVIDER}/v1/tracks/${providerId}?app_name=${encodeURIComponent(c.env.AUDIUS_APP_NAME || 'Loops')}`)
        if (response.ok) {
          const data = await response.json()
          const t = data.data
          const newTrack = {
            id: `audius:${t.track_id}`,
            provider: 'audius',
            provider_id: t.track_id,
            title: t.title,
            artist: t.user?.name || t.user?.handle || 'Unknown',
            artist_id: t.user?.user_id ? `audius:${t.user.user_id}` : null,
            duration: t.duration || 0,
            artwork_url: t.artwork || t.artwork_150x150 || t.artwork_480x480 || null,
            audio_url: t.stream_url || null,
            genre: t.genre || null,
            bpm: t.bpm || null,
            release_date: t.release_date ? Math.floor(new Date(t.release_date).getTime() / 1000) : null,
            license: t.license || '',
            attribution: t.user ? `${t.title} by ${t.user.name || t.user.handle} on Audius` : null,
            is_downloadable: Boolean(t.downloadable),
            is_streamable: Boolean(t.stream_url),
            licensing: JSON.stringify({
              can_use_in_video: true,
              can_download: Boolean(t.downloadable),
              can_commercial: false,
              requires_attribution: true,
              attribution_text: t.user ? `${t.title} by ${t.user.name || t.user.handle} on Audius` : null,
              license_type: t.license || 'Audius Terms of Service',
              restrictions: t.downloadable ? [] : ['no_download', 'streaming_only'],
            }),
            metadata: JSON.stringify({ user: t.user, tags: t.tags, mood: t.mood }),
          }
          
          await c.env.DB.prepare(`
            INSERT OR REPLACE INTO provider_tracks 
            (id, provider, provider_id, title, artist, artist_id, duration, artwork_url, audio_url, genre, bpm, release_date, license, attribution, is_downloadable, is_streamable, licensing, metadata, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())
          `).bind(
            newTrack.id, newTrack.provider, newTrack.provider_id, newTrack.title, newTrack.artist,
            newTrack.artist_id, newTrack.duration, newTrack.artwork_url, newTrack.audio_url,
            newTrack.genre, newTrack.bpm, newTrack.release_date, newTrack.license,
            newTrack.attribution, newTrack.is_downloadable ? 1 : 0, newTrack.is_streamable ? 1 : 0,
            newTrack.licensing, newTrack.metadata
          ).run()

          return c.json({
            id: newTrack.id,
            title: newTrack.title,
            artist: newTrack.artist,
            artist_id: newTrack.artist_id,
            duration: newTrack.duration,
            artwork_url: newTrack.artwork_url,
            audio_url: newTrack.audio_url,
            genre: newTrack.genre,
            bpm: newTrack.bpm,
            release_date: newTrack.release_date ? new Date(newTrack.release_date * 1000).toISOString() : null,
            license: newTrack.license,
            provider: newTrack.provider,
            provider_id: newTrack.provider_id,
            attribution: newTrack.attribution,
            is_downloadable: Boolean(newTrack.is_downloadable),
            is_streamable: Boolean(newTrack.is_streamable),
            licensing: JSON.parse(newTrack.licensing),
          })
        }
      } catch (error) {
        console.error('Audius track fetch error:', error)
      }
    }
    throw AppError.notFound('Track not found')
  }

  const response = {
    id: track.id,
    title: track.title,
    artist: track.artist,
    artist_id: track.artist_id,
    duration: track.duration,
    artwork_url: track.artwork_url,
    audio_url: track.audio_url,
    genre: track.genre,
    bpm: track.bpm,
    release_date: track.release_date ? new Date(track.release_date * 1000).toISOString() : null,
    license: track.license,
    provider: track.provider,
    provider_id: track.provider_id,
    attribution: track.attribution,
    is_downloadable: Boolean(track.is_downloadable),
    is_streamable: Boolean(track.is_streamable),
    licensing: track.licensing ? JSON.parse(track.licensing) : null,
  }

  await c.env.KV_CACHE.put(`music:track:${id}`, JSON.stringify(response), { expirationTtl: 3600 })
  return c.json(response)
})

// GET /api/v1/music/:id/licensing
musicRoutes.get('/:id/licensing', validateParams(z.object({ id: z.string().min(1) })), async (c: Context<Env>) => {
  const { id } = c.get('validatedParams')
  const db = createDbClient(c.env)

  const track = await db.queryOne<{
    id: string
    title: string
    artist: string
    licensing: string
  }>('SELECT id, title, artist, licensing FROM provider_tracks WHERE id = ?', [id])

  if (!track) {
    throw AppError.notFound('Track not found')
  }

  const licensing = track.licensing ? JSON.parse(track.licensing) : {
    can_use_in_video: true,
    can_download: false,
    can_commercial: false,
    requires_attribution: true,
    attribution_text: track.attribution || `${track.title} by ${track.artist}`,
    license_type: 'Unknown',
    restrictions: ['no_download', 'streaming_only'],
  }

  return c.json({
    track_id: id,
    track_title: track.title,
    track_artist: track.artist,
    ...licensing,
  })
})