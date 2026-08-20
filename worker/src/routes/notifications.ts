import { Hono } from 'hono'
import { z } from 'zod'
import { Context } from 'hono'
import { Env } from '../types/env'
import { createDbClient } from '../db/client'
import { validateQuery, validateParams, paginationSchema } from '../middleware/validation'
import { AppError } from '../middleware/error-handler'
import { authMiddleware } from '../middleware/auth'

export const notificationRoutes = new Hono<Env>()

notificationRoutes.use('*', authMiddleware)

// GET /api/v1/notifications
notificationRoutes.get('/', validateQuery(paginationSchema.extend({
  type: z.enum(['all', 'like', 'comment', 'follow', 'mention', 'system', 'dm']).optional(),
  unread_only: z.boolean().optional(),
})), async (c: Context<Env>) => {
  const db = createDbClient(c.env)
  const { cursor, limit, type, unread_only } = c.get('validatedQuery')
  const user = c.get('user')

  let query = `
    SELECT n.*, 
      p.id as actor_id, p.name as actor_name, p.username as actor_username, p.avatar as actor_avatar
    FROM notifications n
    LEFT JOIN profiles p ON n.actor_id = p.id
    WHERE n.user_id = ?
  `
  const params: unknown[] = [user.profileId]

  if (type && type !== 'all') {
    query += ' AND n.type = ?'
    params.push(type)
  }

  if (unread_only) {
    query += ' AND n.is_read = 0'
  }

  if (cursor) {
    query += ' AND n.created_at < ?'
    params.push(cursor)
  }

  query += ' ORDER BY n.created_at DESC LIMIT ?'
  params.push(limit + 1)

  const notifications = await db.query(query, params)
  const hasMore = notifications.length > limit
  const items = hasMore ? notifications.slice(0, -1) : notifications
  const nextCursor = hasMore ? items[items.length - 1]?.created_at : undefined

  return c.json({
    items,
    meta: { next_cursor: nextCursor, has_more: hasMore },
  })
})

// GET /api/v1/notifications/unread-count
notificationRoutes.get('/unread-count', async (c: Context<Env>) => {
  const db = createDbClient(c.env)
  const user = c.get('user')

  const result = await c.get('db').queryOne(
    'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0',
    [c.get('user').profileId]
  )

  return c.json({ count: result?.count || 0 })
})

// POST /api/v1/notifications/:id/read
notificationRoutes.post('/:id/read', validateParams(z.object({ id: z.string().min(1) })), async (c: Context<Env>) => {
  const db = createDbClient(c.env)
  const { id } = c.get('validatedParams')
  const user = c.get('user')

  await db.exec(
    'UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?',
    [id, user.profileId]
  )

  return c.json({ success: true })
})

// POST /api/v1/notifications/mark-all-read
notificationRoutes.post('/mark-all-read', async (c: Context<Env>) => {
  const user = c.get('user')

  await c.get('db').exec(
    'UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0',
    [c.get('user').profileId]
  )

  return c.json({ success: true })
})

// POST /api/v1/notifications/type/read
notificationRoutes.post('/type/read', async (c: Context<Env>) => {
  const user = c.get('user')
  const { type } = await c.req.json<{ type: string }>()

  await c.get('db').exec(
    'UPDATE notifications SET is_read = 1 WHERE user_id = ? AND type = ? AND is_read = 0',
    [user.profileId, type]
  )

  return c.json({ success: true })
})

// DELETE /api/v1/notifications/:id
notificationRoutes.delete('/:id', validateParams(z.object({ id: z.string().min(1) })), async (c: Context<Env>) => {
  const user = c.get('user')

  await c.get('db').exec(
    'DELETE FROM notifications WHERE id = ? AND user_id = ?',
    [c.get('validatedParams').id, user.profileId]
  )

  return c.json({ success: true })
})

// GET /api/v1/notifications/settings
notificationRoutes.get('/settings', async (c: Context<Env>) => {
  const db = createDbClient(c.env)
  const user = c.get('user')

  // In a real implementation, this would be stored in user_app_preferences
  // For now, return defaults
  return c.json({
    push_enabled: true,
    email_enabled: true,
    types: {
      like: { push: true, email: false },
      comment: { push: true, email: false },
      follow: { push: true, email: true },
      mention: { push: true, email: true },
      system: { push: true, email: true },
      dm: { push: true, email: false },
    },
    quiet_hours: { enabled: false, start: '22:00', end: '08:00' },
  })
})

// PUT /api/v1/notifications/settings
notificationRoutes.put('/settings', validateBody(z.object({
  push_enabled: z.boolean().optional(),
  email_enabled: z.boolean().optional(),
  types: z.record(z.object({
    push: z.boolean(),
    email: z.boolean(),
  })).optional(),
  quiet_hours: z.object({
    enabled: z.boolean(),
    start: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
    end: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
  }).optional(),
}), async (c: Context<Env>) => {
  const user = c.get('user')
  const body = c.get('validatedBody')

  // In production, store in user_app_preferences table
  // For now, just return success
  return c.json({ success: true, settings: body })
})