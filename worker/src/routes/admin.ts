import { Hono } from 'hono'
import { z } from 'zod'
import { Context } from 'hono'
import { Env } from '../types/env'
import { createDbClient } from '../db/client'
import { validateBody, validateParams, validateQuery, paginationSchema } from '../middleware/validation'
import { AppError } from '../middleware/error-handler'
import { authMiddleware, requireAdmin } from '../middleware/auth'

export const adminRoutes = new Hono<Env>()

adminRoutes.use('*', authMiddleware, requireAdmin)

// GET /api/v1/admin/stats
adminRoutes.get('/stats', async (c: Context<Env>) => {
  const db = createDbClient(c.env)

  const [
    users,
    profiles,
    videos,
    comments,
    reports,
    dmConversations,
    followers,
    likes,
  ] = await Promise.all([
    c.get('db').queryOne('SELECT COUNT(*) as count FROM users'),
    c.get('db').queryOne('SELECT COUNT(*) as count FROM profiles'),
    c.get('db').queryOne('SELECT COUNT(*) as count FROM videos WHERE status = 2'),
    c.get('db').queryOne('SELECT COUNT(*) as count FROM comments WHERE status = "active"'),
    c.get('db').queryOne('SELECT COUNT(*) as count FROM reports WHERE status = "pending"'),
    c.get('db').queryOne('SELECT COUNT(*) as count FROM conversations'),
    c.get('db').queryOne('SELECT COUNT(*) as count FROM followers WHERE status = 1'),
    c.get('db').queryOne('SELECT COUNT(*) as count FROM video_likes'),
  ])

  return c.json({
    users: users?.count || 0,
    profiles: profiles?.count || 0,
    videos: videos?.count || 0,
    comments: comments?.count || 0,
    pendingReports: reports?.count || 0,
    dmConversations: dmConversations?.count || 0,
    followers: followers?.count || 0,
    likes: likes?.count || 0,
  })
})

// GET /api/v1/admin/users
adminRoutes.get('/users', validateQuery(paginationSchema.extend({
  search: z.string().optional(),
  status: z.enum(['all', 'active', 'suspended', 'deleted']).optional(),
})), async (c: Context<Env>) => {
  const db = createDbClient(c.env)
  const { cursor, limit, search, status } = c.get('validatedQuery')

  let query = `
    SELECT u.*, p.name, p.username, p.avatar
    FROM users u
    LEFT JOIN profiles p ON u.id = p.user_id
    WHERE 1=1
  `
  const params: unknown[] = []

  if (search) {
    query += ' AND (u.email LIKE ? OR p.username LIKE ? OR p.name LIKE ?)'
    params.push(`%${search}%`, `%${search}%`, `%${search}%`)
  }

  if (status === 'active') {
    query += ' AND u.is_active = 1'
  } else if (status === 'suspended') {
    query += ' AND u.is_active = 0'
  }

  if (cursor) {
    query += ' AND u.id < ?'
    params.push(cursor)
  }

  query += ' ORDER BY u.created_at DESC LIMIT ?'
  params.push(limit + 1)

  const users = await c.get('db').query(query, params)
  const hasMore = users.length > limit
  const items = hasMore ? users.slice(0, -1) : users
  const nextCursor = hasMore ? items[items.length - 1]?.id : undefined

  return c.json({ items, meta: { next_cursor: nextCursor, has_more: hasMore } })
})

// GET /api/v1/admin/users/:id
adminRoutes.get('/users/:id', validateParams(z.object({ id: z.string().min(1) })), async (c: Context<Env>) => {
  const user = await c.get('db').queryOne(
    `SELECT u.*, p.name, p.username, p.avatar, p.bio, p.follower_count, p.following_count, p.video_count
     FROM users u
     LEFT JOIN profiles p ON u.id = p.user_id
     WHERE u.id = ?`,
    [c.get('validatedParams').id]
  )

  if (!user) {
    throw AppError.notFound('User not found')
  }

  return c.json({ user })
})

// PUT /api/v1/admin/users/:id
adminRoutes.put('/users/:id', validateParams(z.object({ id: z.string().min(1) })), validateBody(z.object({
  is_active: z.boolean().optional(),
  is_admin: z.boolean().optional(),
  can_upload: z.boolean().optional(),
  can_comment: z.boolean().optional(),
  enforce_ai_label: z.boolean().optional(),
  enforce_ad_label: z.boolean().optional(),
  enforce_nsfw_label: z.boolean().optional(),
})), async (c: Context<Env>) => {
  const db = createDbClient(c.env)
  const { id } = c.get('validatedParams')
  const body = c.get('validatedBody')

  const updates: string[] = []
  const params: unknown[] = []

  if (body.is_active !== undefined) {
    updates.push('is_active = ?')
    params.push(body.is_active ? 1 : 0)
  }
  if (body.is_admin !== undefined) {
    updates.push('is_admin = ?')
    params.push(body.is_admin ? 1 : 0)
  }
  if (body.can_upload !== undefined) {
    updates.push('can_upload = ?')
    params.push(body.can_upload ? 1 : 0)
  }
  if (body.can_comment !== undefined) {
    updates.push('can_comment = ?')
    params.push(body.can_comment ? 1 : 0)
  }
  if (body.enforce_ai_label !== undefined) {
    updates.push('enforce_ai_label = ?')
    params.push(body.enforce_ai_label ? 1 : 0)
  }
  if (body.enforce_ad_label !== undefined) {
    updates.push('enforce_ad_label = ?')
    params.push(body.enforce_ad_label ? 1 : 0)
  }
  if (body.enforce_nsfw_label !== undefined) {
    updates.push('enforce_nsfw_label = ?')
    params.push(body.enforce_nsfw_label ? 1 : 0)
  }

  if (updates.length > 0) {
    updates.push('updated_at = unixepoch()')
    params.push(id)
    await db.exec(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params)
  }

  return c.json({ success: true })
})

// GET /api/v1/admin/reports
adminRoutes.get('/reports', validateQuery(paginationSchema.extend({
  status: z.enum(['all', 'pending', 'resolved', 'dismissed']).optional(),
  type: z.string().optional(),
})), async (c: Context<Env>) => {
  const db = createDbClient(c.env)
  const { cursor, limit, status, type } = c.get('validatedQuery')

  let query = `
    SELECT r.*, 
      p1.id as reporter_id, p1.name as reporter_name, p1.username as reporter_username,
      p2.id as target_id, p2.name as target_name
    FROM reports r
    JOIN profiles p1 ON r.reporter_id = p1.id
    LEFT JOIN profiles p2 ON r.target_id = p2.id
    WHERE 1=1
  `
  const params: unknown[] = []

  if (status && status !== 'all') {
    query += ' AND r.status = ?'
    params.push(status)
  }

  if (type) {
    query += ' AND r.type = ?'
    params.push(type)
  }

  if (cursor) {
    query += ' AND r.id < ?'
    params.push(cursor)
  }

  query += ' ORDER BY r.created_at DESC LIMIT ?'
  params.push(limit + 1)

  const reports = await c.get('db').query(query, params)
  const hasMore = reports.length > limit
  const items = hasMore ? reports.slice(0, -1) : reports
  const nextCursor = hasMore ? items[items.length - 1]?.id : undefined

  return c.json({ items, meta: { next_cursor: nextCursor, has_more: hasMore } })
})

// PUT /api/v1/admin/reports/:id
adminRoutes.put('/reports/:id', validateParams(z.object({ id: z.string().min(1) })), validateBody(z.object({
  status: z.enum(['pending', 'resolved', 'dismissed']).optional(),
  admin_notes: z.string().optional(),
  action: z.enum(['delete_content', 'suspend_user', 'warn_user', 'none']).optional(),
})), async (c: Context<Env>) => {
  const db = createDbClient(c.env)
  const { id } = c.get('validatedParams')
  const body = c.get('validatedBody')

  const updates: string[] = []
  const params: unknown[] = []

  if (body.status !== undefined) {
    updates.push('status = ?')
    params.push(body.status)
  }
  if (body.admin_notes !== undefined) {
    updates.push('admin_notes = ?')
    params.push(body.admin_notes)
  }

  if (updates.length > 0) {
    params.push(id)
    await db.exec(`UPDATE reports SET ${updates.join(', ')} WHERE id = ?`, params)
  }

  // Handle action
  if (body.action && body.action !== 'none') {
    const report = await db.queryOne('SELECT * FROM reports WHERE id = ?', [id])
    if (report) {
      switch (body.action) {
        case 'delete_content':
          if (report.type === 'video') {
            await c.get('db').exec('DELETE FROM videos WHERE id = ?', [report.target_id])
          } else if (report.type === 'comment') {
            await c.get('db').exec('UPDATE comments SET status = "deleted_by_user" WHERE id = ?', [report.target_id])
          }
          break
        case 'suspend_user':
          await c.get('db').exec('UPDATE users SET is_active = 0 WHERE id = ?', [report.target_id])
          break
        case 'warn_user':
          // Send warning notification
          await c.env.QUEUE_NOTIFICATIONS.send({
            type: 'notification',
            userId: report.target_id,
            notificationId: crypto.randomUUID(),
            type: 'system',
            data: { message: 'You have received a warning from moderation', reportId: id },
            priority: 'high',
            createdAt: Date.now(),
          })
          break
      }
    }
  }

  return c.json({ success: true })
})

// GET /api/v1/admin/videos
adminRoutes.get('/videos', validateQuery(paginationSchema.extend({
  status: z.string().optional(),
  profile_id: z.string().optional(),
})), async (c: Context<Env>) => {
  const db = createDbClient(c.env)
  const { cursor, limit, status, profile_id } = c.get('validatedQuery')

  let query = `
    SELECT v.*, p.name, p.username, p.avatar
    FROM videos v
    JOIN profiles p ON v.profile_id = p.id
    WHERE 1=1
  `
  const params: unknown[] = []

  if (status) {
    query += ' AND v.status = ?'
    params.push(status)
  }

  if (profile_id) {
    query += ' AND v.profile_id = ?'
    params.push(profile_id)
  }

  if (cursor) {
    query += ' AND v.id < ?'
    params.push(cursor)
  }

  query += ' ORDER BY v.created_at DESC LIMIT ?'
  params.push(limit + 1)

  const videos = await c.get('db').query(query, params)
  const hasMore = videos.length > limit
  const items = hasMore ? videos.slice(0, -1) : videos
  const nextCursor = hasMore ? items[items.length - 1]?.id : undefined

  return c.json({ items, meta: { next_cursor: nextCursor, has_more: hasMore } })
})

// GET /api/v1/admin/settings
adminRoutes.get('/settings', async (c: Context<Env>) => {
  const settings = await c.get('db').query('SELECT * FROM admin_settings')
  return c.json({ settings: settings.reduce((acc, s) => ({ ...acc, [s.key]: s.value }), {}) })
})

// PUT /api/v1/admin/settings
adminRoutes.put('/settings', validateBody(z.record(z.unknown())), async (c: Context<Env>) => {
  const db = createDbClient(c.env)
  const body = c.get('validatedBody')

  for (const [key, value] of Object.entries(body)) {
    await db.exec(
      `INSERT INTO admin_settings (key, value, type, updated_at) 
       VALUES (?, ?, ?, unixepoch())
       ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = unixepoch()`,
      [key, JSON.stringify(value), typeof value, JSON.stringify(value)]
    )
  }

  return c.json({ success: true })
})

// GET /api/v1/admin/dashboard
adminRoutes.get('/dashboard', async (c: Context<Env>) => {
  const db = createDbClient(c.env)

  const [
    dailyActiveUsers,
    dailyNewUsers,
    dailyVideos,
    dailyReports,
    storageUsed,
  ] = await Promise.all([
    c.get('db').queryOne('SELECT COUNT(DISTINCT user_id) as count FROM user_daily_actives WHERE date = date("now")'),
    c.get('db').queryOne('SELECT COUNT(*) as count FROM users WHERE date(created_at, "unixepoch") = date("now")'),
    c.get('db').queryOne('SELECT COUNT(*) as count FROM videos WHERE date(created_at, "unixepoch") = date("now")'),
    c.get('db').queryOne('SELECT COUNT(*) as count FROM reports WHERE date(created_at, "unixepoch") = date("now")'),
    c.get('db').queryOne('SELECT SUM(size_kb) as total FROM videos WHERE status = 2'),
  ])

  return c.json({
    dailyActiveUsers: dailyActiveUsers?.count || 0,
    dailyNewUsers: dailyNewUsers?.count || 0,
    dailyVideos: dailyVideos?.count || 0,
    dailyReports: dailyReports?.count || 0,
    storageUsedKB: storageUsed?.total || 0,
    timestamp: new Date().toISOString(),
  })
})