import { Hono } from 'hono'
import { z } from 'zod'
import { Context } from 'hono'
import { Env } from '../types/env'
import { createDbClient } from '../db/client'
import { createR2Client, VIDEO_PATHS } from '../services/r2'
import { validateBody, validateParams, validateQuery, paginationSchema } from '../middleware/validation'
import { AppError } from '../middleware/error-handler'
import { authMiddleware } from '../middleware/auth'

export const dmRoutes = new Hono<Env>()

dmRoutes.use('*', authMiddleware)

// GET /api/v1/dm/conversations
dmRoutes.get('/conversations', validateQuery(paginationSchema), async (c: Context<Env>) => {
  const db = createDbClient(c.env)
  const { cursor, limit } = c.get('validatedQuery')
  const user = c.get('user')

  let query = `
    SELECT c.*, 
      CASE WHEN cp.user_id = ? THEN 'self' ELSE 'other' END as participant_type,
      p.id as participant_id, p.name as participant_name, p.username as participant_username, p.avatar as participant_avatar
    FROM conversations c
    JOIN conversation_participants cp ON c.id = cp.conversation_id
    JOIN profiles p ON cp.user_id = p.id
    WHERE cp.user_id = ? AND c.type = 'direct'
  `
  const params: unknown[] = [user.profileId, user.profileId]

  // For group chats, we'd need a different query
  // This is simplified for direct messages

  if (cursor) {
    query += ' AND c.updated_at < ?'
    params.push(cursor)
  }

  query += ' ORDER BY c.updated_at DESC LIMIT ?'
  params.push(limit + 1)

  const conversations = await db.query(query, params)
  const hasMore = conversations.length > limit
  const items = hasMore ? conversations.slice(0, -1) : conversations
  const nextCursor = hasMore ? items[items.length - 1]?.updated_at : undefined

  // Get last message for each conversation
  for (const conv of items) {
    const lastMessage = await db.queryOne(
      'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 1',
      [conv.id]
    )
    conv.last_message = lastMessage

    // Count unread
    const unreadCount = await db.queryOne(
      'SELECT COUNT(*) as count FROM messages WHERE conversation_id = ? AND sender_id != ? AND created_at > (SELECT COALESCE(MAX(read_at), 0) FROM conversation_reads WHERE conversation_id = ? AND user_id = ?)',
      [conv.id, user.profileId, conv.id, user.profileId]
    )
    conv.unread_count = unreadCount?.count || 0
  }

  return c.json({
    items,
    meta: { next_cursor: nextCursor, has_more: hasMore },
  })
})

// POST /api/v1/dm/conversations
dmRoutes.post('/conversations', validateBody(z.object({
  participant_id: z.string().min(1),
})), async (c: Context<Env>) => {
  const db = createDbClient(c.env)
  const { participant_id } = c.get('validatedBody')
  const user = c.get('user')

  if (participant_id === user.profileId) {
    throw AppError.badRequest('Cannot start conversation with yourself')
  }

  const participant = await db.queryOne('SELECT * FROM profiles WHERE id = ?', [participant_id])
  if (!participant) {
    throw AppError.notFound('User not found')
  }

  // Check if conversation already exists
  const existing = await db.queryOne(`
    SELECT c.id FROM conversations c
    JOIN conversation_participants cp1 ON c.id = cp1.conversation_id
    JOIN conversation_participants cp2 ON c.id = cp2.conversation_id
    WHERE c.type = 'direct' AND cp1.user_id = ? AND cp2.user_id = ?
  `, [user.profileId, participant_id])

  if (existing) {
    return c.json({ conversationId: existing.id })
  }

  // Create new conversation
  const conversationId = crypto.randomUUID()
  await db.exec(
    `INSERT INTO conversations (id, type, created_by, created_at, updated_at)
     VALUES (?, 'direct', ?, unixepoch(), unixepoch())`,
    [conversationId, user.profileId]
  )

  await db.exec(
    `INSERT INTO conversation_participants (id, conversation_id, user_id, role, joined_at)
     VALUES (?, ?, ?, 'member', unixepoch())`,
    [crypto.randomUUID(), conversationId, user.profileId]
  )
  await db.exec(
    `INSERT INTO conversation_participants (id, conversation_id, user_id, role, joined_at)
     VALUES (?, ?, ?, 'member', unixepoch())`,
    [crypto.randomUUID(), conversationId, participant_id]
  )

  // Create Durable Object for this conversation
  // This would be done via DO stub in production

  return c.json({ conversationId }, 201)
})

// GET /api/v1/dm/conversations/:id/messages
dmRoutes.get('/conversations/:id/messages', 
  validateParams(z.object({ id: z.string().min(1) })),
  validateQuery(paginationSchema),
  async (c: Context<Env>) => {
  const db = createDbClient(c.env)
  const { id } = c.get('validatedParams')
  const { cursor, limit } = c.get('validatedQuery')
  const user = c.get('user')

  // Verify participant
  const participant = await db.queryOne(
    'SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?',
    [id, user.profileId]
  )
  if (!participant) {
    throw AppError.notFound('Conversation not found')
  }

  let query = `
    SELECT m.*, p.id as sender_id, p.name as sender_name, p.username as sender_username, p.avatar as sender_avatar
    FROM messages m
    JOIN profiles p ON m.sender_id = p.id
    WHERE m.conversation_id = ?
  `
  const params: unknown[] = [id]

  if (cursor) {
    query += ' AND m.created_at < ?'
    params.push(cursor)
  }

  query += ' ORDER BY m.created_at DESC LIMIT ?'
  params.push(limit + 1)

  const messages = await db.query(query, params)
  const hasMore = messages.length > limit
  const items = hasMore ? messages.slice(0, -1) : messages
  const nextCursor = hasMore ? items[items.length - 1]?.created_at : undefined

  return c.json({
    items: items.reverse(), // Return in chronological order
    meta: { next_cursor: nextCursor, has_more: hasMore },
  })
})

// POST /api/v1/dm/conversations/:id/messages
dmRoutes.post('/conversations/:id/messages',
  validateParams(z.object({ id: z.string().min(1) })),
  validateBody(z.object({
    type: z.enum(['text', 'media']),
    content: z.string().optional(),
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
  })),
  async (c: Context<Env>) => {
  const db = createDbClient(c.env)
  const { id } = c.get('validatedParams')
  const { type, content, media } = c.get('validatedBody')
  const user = c.get('user')

  // Verify participant
  const participant = await db.queryOne(
    'SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?',
    [id, user.profileId]
  )
  if (!participant) {
    throw AppError.notFound('Conversation not found')
  }

  if (type === 'text' && !content) {
    throw AppError.badRequest('Content required for text messages')
  }

  const messageId = crypto.randomUUID()
  await db.exec(
    `INSERT INTO messages (id, conversation_id, sender_id, type, content, media, created_at)
     VALUES (?, ?, ?, ?, ?, ?, unixepoch())`,
    [messageId, id, user.profileId, type, content || null, media ? JSON.stringify(media) : null]
  )

  // Update conversation timestamp
  await db.exec('UPDATE conversations SET updated_at = unixepoch() WHERE id = ?', [id])

  // Get other participants for notification
  const otherParticipants = await db.query(
    'SELECT user_id FROM conversation_participants WHERE conversation_id = ? AND user_id != ?',
    [id, user.profileId]
  )

  for (const p of otherParticipants) {
    await c.env.QUEUE_NOTIFICATIONS.send({
      type: 'notification',
      userId: p.user_id,
      notificationId: crypto.randomUUID(),
      type: 'dm',
      data: { conversationId: id, messageId, senderId: user.profileId },
      priority: 'high',
      createdAt: Date.now(),
    })
  }

  // Broadcast via Durable Object (in production)
  // const doStub = c.env.DM_Room.idFromName(id)
  // doStub.fetch(new Request('...'))

  return c.json({ success: true, messageId })
})

// POST /api/v1/dm/conversations/:id/read
dmRoutes.post('/conversations/:id/read', validateParams(z.object({ id: z.string().min(1) })), async (c: Context<Env>) => {
  const db = createDbClient(c.env)
  const { id } = c.get('validatedParams')
  const user = c.get('user')

  // Verify participant
  const participant = await db.queryOne(
    'SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?',
    [id, user.profileId]
  )
  if (!participant) {
    throw AppError.notFound('Conversation not found')
  }

  // Mark as read (upsert read marker)
  await db.exec(`
    INSERT OR REPLACE INTO conversation_reads (id, conversation_id, user_id, read_at, created_at)
    VALUES (?, ?, ?, unixepoch(), unixepoch())
  `, [crypto.randomUUID(), id, user.profileId])

  return c.json({ success: true })
})

// POST /api/v1/dm/conversations/:id/typing
dmRoutes.post('/conversations/:id/typing', validateParams(z.object({ id: z.string().min(1) })), async (c: Context<Env>) => {
  // Broadcast typing indicator via Durable Object
  // In production: const doStub = c.env.DM_Room.idFromName(id)
  // await doStub.fetch(new Request('...', { method: 'POST', body: JSON.stringify({ userId: user.profileId }) }))
  
  return c.json({ success: true })
})

// POST /api/v1/dm/conversations (group)
dmRoutes.post('/conversations/group', validateBody(z.object({
  name: z.string().min(1).max(100),
  participant_ids: z.array(z.string().min(1)).min(1).max(11),
  avatar: z.string().url().optional(),
})), async (c: Context<Env>) => {
  const db = createDbClient(c.env)
  const { name, participant_ids, avatar } = c.get('validatedBody')
  const user = c.get('user')

  if (participant_ids.includes(user.profileId)) {
    throw AppError.badRequest('Cannot include yourself in participants')
  }

  if (participant_ids.length > 11) {
    throw AppError.badRequest('Maximum 12 participants (including yourself)')
  }

  // Verify all participants exist
  for (const pid of participant_ids) {
    const p = await db.queryOne('SELECT id FROM profiles WHERE id = ?', [pid])
    if (!p) {
      throw AppError.notFound(`User ${pid} not found`)
    }
  }

  const conversationId = crypto.randomUUID()
  await db.exec(
    `INSERT INTO conversations (id, type, name, avatar, created_by, created_at, updated_at)
     VALUES (?, 'group', ?, ?, ?, unixepoch(), unixepoch())`,
    [conversationId, name, avatar || null, user.profileId]
  )

  // Add creator as admin
  await db.exec(
    `INSERT INTO conversation_participants (id, conversation_id, user_id, role, joined_at, is_admin)
     VALUES (?, ?, ?, 'admin', unixepoch(), 1)`,
    [crypto.randomUUID(), conversationId, user.profileId]
  )

  // Add other participants
  for (const pid of participant_ids) {
    await db.exec(
      `INSERT INTO conversation_participants (id, conversation_id, user_id, role, joined_at)
       VALUES (?, ?, ?, 'member', unixepoch())`,
      [crypto.randomUUID(), conversationId, pid]
    )
  }

  // Queue notifications
  for (const pid of participant_ids) {
    await c.env.QUEUE_NOTIFICATIONS.send({
      type: 'notification',
      userId: pid,
      notificationId: crypto.randomUUID(),
      type: 'dm',
      data: { conversationId, type: 'group_invite', inviterId: user.profileId },
      priority: 'normal',
      createdAt: Date.now(),
    })
  }

  return c.json({ conversationId }, 201)
})