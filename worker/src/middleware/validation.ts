import { Context, Next } from 'hono'
import { Env } from '../types/env'
import { z } from 'zod'

export async function validationMiddleware(c: Context<Env>, next: Next) {
  // Only validate mutating requests
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(c.req.method)) {
    return next()
  }

  // Skip validation for multipart/form-data (handled per-route)
  const contentType = c.req.header('Content-Type') || ''
  if (contentType.includes('multipart/form-data')) {
    return next()
  }

  // Parse JSON body for validation
  try {
    const body = await c.req.json()
    // Store parsed body for route handlers
    c.set('parsedBody', body)
  } catch {
    // Not JSON or empty body, skip
  }

  await next()
}

export function validateBody<T extends z.ZodSchema>(schema: T) {
  return async (c: Context<Env>, next: Next) => {
    try {
      const body = c.get('parsedBody') || await c.req.json()
      const result = schema.safeParse(body)
      
      if (!result.success) {
        return c.json({
          error: 'Validation Error',
          message: 'Invalid request body',
          details: result.error.flatten().fieldErrors,
        }, 400)
      }
      
      c.set('validatedBody', result.data)
      await next()
    } catch (error) {
      return c.json({ error: 'Invalid JSON', message: 'Request body must be valid JSON' }, 400)
    }
  }
}

export function validateQuery<T extends z.ZodSchema>(schema: T) {
  return async (c: Context<Env>, next: Next) => {
    try {
      const query = Object.fromEntries(c.req.query())
      const result = schema.safeParse(query)
      
      if (!result.success) {
        return c.json({
          error: 'Validation Error',
          message: 'Invalid query parameters',
          details: result.error.flatten().fieldErrors,
        }, 400)
      }
      
      c.set('validatedQuery', result.data)
      await next()
    } catch (error) {
      return c.json({ error: 'Validation Error', message: 'Invalid query parameters' }, 400)
    }
  }
}

export function validateParams<T extends z.ZodSchema>(schema: T) {
  return async (c: Context<Env>, next: Next) => {
    try {
      const params = c.req.param()
      const result = schema.safeParse(params)
      
      if (!result.success) {
        return c.json({
          error: 'Validation Error',
          message: 'Invalid path parameters',
          details: result.error.flatten().fieldErrors,
        }, 400)
      }
      
      c.set('validatedParams', result.data)
      await next()
    } catch (error) {
      return c.json({ error: 'Validation Error', message: 'Invalid path parameters' }, 400)
    }
  }
}

// Common schemas
export const paginationSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
})

export const videoIdSchema = z.object({
  id: z.string().min(1),
})

export const profileIdSchema = z.object({
  id: z.string().min(1),
})

export const searchQuerySchema = z.object({
  q: z.string().min(1).max(100),
  type: z.enum(['all', 'users', 'videos', 'hashtags', 'sounds']).default('all'),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().optional(),
})

export const uploadVideoSchema = z.object({
  description: z.string().max(2000).optional(),
  alt_text: z.string().max(2000).optional(),
  lang: z.string().optional(),
  is_sensitive: z.boolean().optional(),
  contains_ai: z.boolean().optional(),
  contains_ad: z.boolean().optional(),
  can_download: z.boolean().optional(),
  can_comment: z.boolean().optional(),
  can_duet: z.boolean().optional(),
  can_stitch: z.boolean().optional(),
  can_embed: z.boolean().optional(),
  scheduled_at: z.string().datetime().optional(),
  sound_id: z.string().optional(),
  provider_track_id: z.string().optional(),
  music_provider: z.string().optional(),
  music_metadata: z.record(z.unknown()).optional(),
  music_licensing: z.record(z.unknown()).optional(),
})

export const updateVideoSchema = z.object({
  caption: z.string().max(2000).optional(),
  alt_text: z.string().max(2000).optional(),
  lang: z.string().optional(),
  is_sensitive: z.boolean().optional(),
  contains_ai: z.boolean().optional(),
  contains_ad: z.boolean().optional(),
  can_download: z.boolean().optional(),
  can_comment: z.boolean().optional(),
  can_duet: z.boolean().optional(),
  can_stitch: z.boolean().optional(),
  can_embed: z.boolean().optional(),
  is_pinned: z.boolean().optional(),
})

export const commentSchema = z.object({
  comment: z.string().min(1).max(2000),
  parent_id: z.string().optional(),
})

export const dmMessageSchema = z.object({
  type: z.enum(['text', 'media']),
  body: z.string().optional(),
  media: z.array(z.object({
    type: z.enum(['image', 'video', 'audio', 'file']),
    url: z.string().url(),
    mime_type: z.string(),
    size: z.number(),
    width: z.number().optional(),
    height: z.number().optional(),
    duration: z.number().optional(),
    thumbnail_url: z.string().url().optional(),
  })).optional(),
  conversation_id: z.string().optional(),
  participant_id: z.string().optional(),
})

export const notificationSchema = z.object({
  type: z.enum(['like', 'comment', 'follow', 'mention', 'system', 'dm']),
  data: z.record(z.unknown()),
})