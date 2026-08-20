import { DurableObject } from 'cloudflare:workers'
import { Env, DmRoomState, DmMessage, PresenceStatus } from '../types/env'

export class DmRoom extends DurableObject {
  state: DurableObjectState
  env: Env
  participants: Map<string, { userId: string; socket: WebSocket; joinedAt: number }>
  messages: DmMessage[]

  constructor(state: DurableObjectState, env: Env) {
    this.state = state
    this.env = env
    this.participants = new Map()
    this.messages = []

    // Load persisted state
    this.state.blockConcurrencyWhile(async () => {
      const stored = await this.state.storage.get<DmRoomState>('room_state')
      if (stored) {
        this.messages = stored.messages || []
      }
    })
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname

    if (path === '/websocket') {
      return this.handleWebSocket(request)
    }

    if (path === '/broadcast') {
      return this.handleBroadcast(request)
    }

    if (path === '/state') {
      return this.handleState()
    }

    return new Response('Not Found', { status: 404 })
  }

  private async handleWebSocket(request: Request): Promise<Response> {
    const upgradeHeader = request.headers.get('Upgrade')
    if (!upgradeHeader || upgradeHeader !== 'websocket') {
      return new Response('Expected WebSocket', { status: 400 })
    }

    const [client, server] = Object.values(new WebSocketPair())
    await this.handleSession(server)

    return new Response(null, {
      status: 101,
      headers: { Upgrade: 'websocket' },
    })
  }

  private async handleSession(socket: WebSocket): Promise<void> {
    socket.accept()

    let userId: string | null = null

    socket.addEventListener('message', async (event) => {
      try {
        const message = JSON.parse(event.data as string)

        switch (message.type) {
          case 'auth':
            userId = message.userId
            this.participants.set(userId, { userId, socket, joinedAt: Date.now() })
            
            // Send current state
            socket.send(JSON.stringify({
              type: 'state',
              messages: this.messages.slice(-50),
              participants: Array.from(this.participants.keys()),
            }))
            break

          case 'message':
            if (!userId) return
            await this.handleMessage(userId, message)
            break

          case 'typing':
            if (!userId) return
            this.broadcast({ type: 'typing', userId }, userId)
            break

          case 'read':
            if (!userId) return
            // Mark messages as read
            this.broadcast({ type: 'read', userId, messageId: message.messageId }, userId)
            break

          case 'ping':
            socket.send(JSON.stringify({ type: 'pong' }))
            break
        }
      } catch (error) {
        console.error('WebSocket error:', error)
      }
    })

    socket.addEventListener('close', () => {
      if (userId) {
        this.participants.delete(userId)
        this.broadcast({ type: 'user_left', userId })
      }
    })

    socket.addEventListener('error', (error) => {
      console.error('WebSocket error:', error)
      if (userId) {
        this.participants.delete(userId)
        this.broadcast({ type: 'user_left', userId })
      }
    })
  }

  private async handleMessage(senderId: string, message: { content: string; media?: unknown[] }): Promise<void> {
    const dmMessage: DmMessage = {
      id: crypto.randomUUID(),
      conversation_id: this.state.id.toString(),
      sender_id: senderId,
      type: message.media?.length ? 'media' : 'text',
      content: message.content || '',
      media: message.media || [],
      created_at: Date.now(),
      read_by: new Set([senderId]),
    }

    this.messages.push(dmMessage)

    // Persist to storage
    await this.persistMessages()

    // Broadcast to all participants
    this.broadcast({ type: 'message', message: dmMessage })
  }

  private async handleBroadcast(request: Request): Promise<Response> {
    try {
      const { type, payload, exclude } = await request.json<{ type: string; payload: unknown; exclude?: string }>()
      this.broadcast({ type, payload }, exclude)
      return new Response(JSON.stringify({ success: true }))
    } catch {
      return new Response('Bad Request', { status: 400 })
    }
  }

  private async handleState(): Promise<Response> {
    return new Response(JSON.stringify({
      participants: Array.from(this.participants.keys()),
      messageCount: this.messages.length,
    }))
  }

  private broadcast(message: unknown, exclude?: string): void {
    const data = JSON.stringify(message)
    for (const [userId, participant] of this.participants) {
      if (userId !== exclude && participant.socket.readyState === WebSocket.OPEN) {
        participant.socket.send(data)
      }
    }
  }

  private async persistMessages(): Promise<void> {
    // Keep only last 1000 messages in memory
    if (this.messages.length > 1000) {
      this.messages = this.messages.slice(-1000)
    }
    await this.state.storage.put('room_state', {
      messages: this.messages,
      updatedAt: Date.now(),
    })
  }
}

export class PresenceManager extends DurableObject {
  state: DurableObjectState
  env: Env
  presence: Map<string, PresenceStatus>

  constructor(state: DurableObjectState, env: Env) {
    this.state = state
    this.env = env
    this.presence = new Map()

    this.state.blockConcurrencyWhile(async () => {
      const stored = await this.state.storage.get<Map<string, PresenceStatus>>('presence')
      if (stored) {
        this.presence = stored
      }
    })
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname

    if (path === '/set') {
      return this.handleSet(request)
    }

    if (path === '/get') {
      return this.handleGet(request)
    }

    if (path === '/subscribe') {
      return this.handleSubscribe(request)
    }

    if (path === '/online') {
      return this.handleOnline(request)
    }

    return new Response('Not Found', { status: 404 })
  }

  private async handleSet(request: Request): Promise<Response> {
    const { userId, status } = await request.json<{ userId: string; status: PresenceStatus }>()
    this.presence.set(userId, status)
    await this.state.storage.put('presence', this.presence)
    return new Response(JSON.stringify({ success: true }))
  }

  private async handleGet(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const userId = url.searchParams.get('userId')

    if (userId) {
      const status = this.presence.get(userId)
      return new Response(JSON.stringify({ status }))
    }

    return new Response(JSON.stringify({ presence: Object.fromEntries(this.presence) }))
  }

  private async handleOnline(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const userIds = url.searchParams.get('userIds')?.split(',') || []
    const result: Record<string, PresenceStatus | null> = {}

    for (const userId of userIds) {
      result[userId] = this.presence.get(userId) || null
    }

    return new Response(JSON.stringify({ online: result }))
  }

  private async handleSubscribe(request: Request): Promise<Response> {
    // WebSocket subscription for presence updates
    const upgradeHeader = request.headers.get('Upgrade')
    if (!upgradeHeader || upgradeHeader !== 'websocket') {
      return new Response('Expected WebSocket', { status: 400 })
    }

    const [client, server] = Object.values(new WebSocketPair())
    server.accept()

    server.addEventListener('message', (event) => {
      try {
        const message = JSON.parse(event.data as string)
        if (message.type === 'subscribe') {
          // Store subscription
        }
      } catch {}
    })

    server.addEventListener('close', () => {
      // Clean up subscription
    })

    return new Response(null, {
      status: 101,
      headers: { Upgrade: 'websocket' },
    })
  }
}

export class RealtimeCounter extends DurableObject {
  state: DurableObjectState
  env: Env
  counters: Map<string, number>

  constructor(state: DurableObjectState, env: Env) {
    this.state = state
    this.env = env
    this.counters = new Map()

    this.state.blockConcurrencyWhile(async () => {
      const stored = await this.state.storage.get<Map<string, number>>('counters')
      if (stored) {
        this.counters = stored
      }
    })
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname

    if (path === '/increment') {
      return this.handleIncrement(request)
    }

    if (path === '/decrement') {
      return this.handleDecrement(request)
    }

    if (path === '/get') {
      return this.handleGet(request)
    }

    if (path === '/reset') {
      return this.handleReset(request)
    }

    return new Response('Not Found', { status: 404 })
  }

  private async handleIncrement(request: Request): Promise<Response> {
    const { key, amount = 1 } = await request.json<{ key: string; amount?: number }>()
    const current = this.counters.get(key) || 0
    const next = current + amount
    this.counters.set(key, next)
    await this.state.storage.put('counters', this.counters)
    return new Response(JSON.stringify({ value: next }))
  }

  private async handleDecrement(request: Request): Promise<Response> {
    const { key, amount = 1 } = await request.json<{ key: string; amount?: number }>()
    const current = this.counters.get(key) || 0
    const next = current - amount
    this.counters.set(key, next)
    await this.state.storage.put('counters', this.counters)
    return new Response(JSON.stringify({ value: next }))
  }

  private async handleGet(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const key = url.searchParams.get('key')

    if (key) {
      return new Response(JSON.stringify({ value: this.counters.get(key) || 0 }))
    }

    return new Response(JSON.stringify(Object.fromEntries(this.counters)))
  }

  private async handleReset(request: Request): Promise<Response> {
    const { key } = await request.json<{ key: string }>()
    this.counters.delete(key)
    await this.state.storage.put('counters', this.counters)
    return new Response(JSON.stringify({ success: true }))
  }
}