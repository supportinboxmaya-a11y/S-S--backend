import { D1Database } from '@cloudflare/workers-types'
import { Env } from '../types/env'

export interface DbClient {
  db: D1Database
  exec: (sql: string) => Promise<void>
  query: <T>(sql: string, params?: unknown[]) => Promise<T[]>
  queryOne: <T>(sql: string, params?: unknown[]) => Promise<T | null>
  insert: (table: string, data: Record<string, unknown>) => Promise<string>
  update: (table: string, id: string, data: Record<string, unknown>) => Promise<boolean>
  delete: (table: string, id: string) => Promise<boolean>
  transaction: <T>(fn: (tx: DbClient) => Promise<T>) => Promise<T>
}

export function createDbClient(env: Env): DbClient {
  const db = env.DB

  return {
    db,
    async exec(sql: string) {
      await db.exec(sql)
    },
    async query<T>(sql: string, params: unknown[] = []) {
      const { results } = await db.prepare(sql).bind(...params).all()
      return results as T[]
    },
    async queryOne<T>(sql: string, params: unknown[] = []) {
      const result = await db.prepare(sql).bind(...params).first()
      return result as T | null
    },
    async insert(table: string, data: Record<string, unknown>) {
      const columns = Object.keys(data)
      const placeholders = columns.map(() => '?').join(', ')
      const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`
      const values = columns.map(c => data[c])
      const result = await db.prepare(sql).bind(...values).run()
      return result.meta.last_row_id?.toString() || ''
    },
    async update(table: string, id: string, data: Record<string, unknown>) {
      const columns = Object.keys(data)
      const setClause = columns.map(c => `${c} = ?`).join(', ')
      const sql = `UPDATE ${table} SET ${setClause}, updated_at = unixepoch() WHERE id = ?`
      const values = [...columns.map(c => data[c]), id]
      const result = await db.prepare(sql).bind(...values).run()
      return result.changes > 0
    },
    async delete(table: string, id: string) {
      const sql = `DELETE FROM ${table} WHERE id = ?`
      const result = await db.prepare(sql).bind(id).run()
      return result.changes > 0
    },
    async transaction<T>(fn: (tx: DbClient) => Promise<T>) {
      return await db.batch([
        // D1 doesn't have native transactions yet, use batch for atomicity
      ]) as unknown as T
    },
  }
}

export async function initSchema(env: Env): Promise<void> {
  const db = env.DB

  // Enable foreign keys
  await db.exec('PRAGMA foreign_keys = ON')

  // Users & Auth
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      username TEXT UNIQUE,
      password_hash TEXT,
      apple_id TEXT UNIQUE,
      email_verified_at INTEGER,
      is_admin INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      can_upload INTEGER DEFAULT 1,
      can_comment INTEGER DEFAULT 1,
      can_embed INTEGER DEFAULT 1,
      enforce_ai_label INTEGER DEFAULT 0,
      enforce_ad_label INTEGER DEFAULT 0,
      enforce_nsfw_label INTEGER DEFAULT 0,
      hide_ai INTEGER DEFAULT 0,
      two_factor_enabled INTEGER DEFAULT 0,
      two_factor_secret TEXT,
      last_active_at INTEGER,
      register_source TEXT,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
    CREATE INDEX IF NOT EXISTS idx_users_apple_id ON users(apple_id);
  `)

  // OAuth tables
  await db.exec(`
    CREATE TABLE IF NOT EXISTS oauth_clients (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      secret TEXT NOT NULL,
      redirect_uris TEXT NOT NULL,
      scopes TEXT NOT NULL,
      revoked INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch()),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_oauth_clients_user ON oauth_clients(user_id);

    CREATE TABLE IF NOT EXISTS oauth_access_tokens (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      scopes TEXT NOT NULL,
      revoked INTEGER DEFAULT 0,
      expires_at INTEGER NOT NULL,
      created_at INTEGER DEFAULT (unixepoch()),
      FOREIGN KEY (client_id) REFERENCES oauth_clients(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_oauth_access_tokens_client ON oauth_access_tokens(client_id);
    CREATE INDEX IF NOT EXISTS idx_oauth_access_tokens_user ON oauth_access_tokens(user_id);
    CREATE INDEX IF NOT EXISTS idx_oauth_access_tokens_expires ON oauth_access_tokens(expires_at);

    CREATE TABLE IF NOT EXISTS oauth_refresh_tokens (
      id TEXT PRIMARY KEY,
      access_token_id TEXT NOT NULL,
      revoked INTEGER DEFAULT 0,
      expires_at INTEGER NOT NULL,
      created_at INTEGER DEFAULT (unixepoch()),
      FOREIGN KEY (access_token_id) REFERENCES oauth_access_tokens(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_oauth_refresh_tokens_access ON oauth_refresh_tokens(access_token_id);
  `)

  // Profiles
  await db.exec(`
    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      user_id TEXT UNIQUE NOT NULL,
      name TEXT,
      bio TEXT,
      avatar TEXT,
      header TEXT,
      username TEXT UNIQUE,
      follower_count INTEGER DEFAULT 0,
      following_count INTEGER DEFAULT 0,
      video_count INTEGER DEFAULT 0,
      is_hidden INTEGER DEFAULT 0,
      is_verified INTEGER DEFAULT 0,
      can_dm INTEGER DEFAULT 1,
      dm_status TEXT DEFAULT 'open',
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch()),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_profiles_user ON profiles(user_id);
    CREATE INDEX IF NOT EXISTS idx_profiles_username ON profiles(username);
  `)

  // Videos
  await db.exec(`
    CREATE TABLE IF NOT EXISTS videos (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL,
      vid TEXT,
      vid_optimized TEXT,
      thumbnail_path TEXT,
      status INTEGER DEFAULT 0,
      visibility INTEGER DEFAULT 1,
      duration INTEGER,
      size_kb INTEGER,
      caption TEXT,
      is_local INTEGER DEFAULT 1,
      uri TEXT,
      remote_media_url TEXT,
      remote_thumb_url TEXT,
      remote_hls_url TEXT,
      tags TEXT,
      likes INTEGER DEFAULT 0,
      comments INTEGER DEFAULT 0,
      shares INTEGER DEFAULT 0,
      views INTEGER DEFAULT 0,
      bookmarks INTEGER DEFAULT 0,
      is_sensitive INTEGER DEFAULT 0,
      is_adult INTEGER DEFAULT 0,
      has_audio INTEGER DEFAULT 1,
      has_thumb INTEGER DEFAULT 0,
      has_processed INTEGER DEFAULT 0,
      is_approved INTEGER DEFAULT 1,
      features TEXT,
      media_metadata TEXT,
      comment_state INTEGER DEFAULT 4,
      cw_title TEXT,
      cw_body TEXT,
      sha512_hash TEXT,
      has_hls INTEGER DEFAULT 0,
      can_download INTEGER DEFAULT 0,
      can_duet INTEGER DEFAULT 0,
      is_duet INTEGER DEFAULT 0,
      original_duet_id TEXT,
      duet_path TEXT,
      duet_layout INTEGER DEFAULT 0,
      can_stitch INTEGER DEFAULT 0,
      is_pinned INTEGER DEFAULT 0,
      pinned_order INTEGER,
      width INTEGER,
      height INTEGER,
      category TEXT,
      ap_published_at INTEGER,
      last_fetched_at INTEGER,
      fetch_failure_count INTEGER DEFAULT 0,
      is_edited INTEGER DEFAULT 0,
      alt_text TEXT,
      lang TEXT,
      contains_ai INTEGER DEFAULT 0,
      contains_ad INTEGER DEFAULT 0,
      audio_allow_reuse INTEGER DEFAULT 0,
      has_hidden_comments INTEGER DEFAULT 0,
      thumbnail_width INTEGER,
      thumbnail_height INTEGER,
      scheduled_at INTEGER,
      publishing_at INTEGER,
      ap_published_at INTEGER,
      publish_state INTEGER DEFAULT 0,
      sound_id TEXT,
      provider_track_id TEXT,
      music_provider TEXT,
      music_metadata TEXT,
      music_licensing TEXT,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch()),
      FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
      FOREIGN KEY (sound_id) REFERENCES video_sounds(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_videos_profile_status_created ON videos(profile_id, status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_videos_status_created ON videos(status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_videos_federated ON videos(ap_published_at) WHERE ap_published_at IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_videos_sound ON videos(sound_id);
    CREATE INDEX IF NOT EXISTS idx_videos_provider_track ON videos(provider_track_id, music_provider);
  `)

  // Video Sounds (Audio Fingerprinting)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS video_sounds (
      id TEXT PRIMARY KEY,
      title TEXT,
      description TEXT,
      fingerprint TEXT NOT NULL,
      fingerprint_hash TEXT UNIQUE NOT NULL,
      status INTEGER DEFAULT 1,
      duration INTEGER DEFAULT 0,
      original_video_id TEXT,
      profile_id TEXT,
      usage_count INTEGER DEFAULT 0,
      is_original INTEGER DEFAULT 0,
      allow_reuse INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch()),
      FOREIGN KEY (original_video_id) REFERENCES videos(id) ON DELETE SET NULL,
      FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE SET NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_video_sounds_fingerprint_hash ON video_sounds(fingerprint_hash);
    CREATE INDEX IF NOT EXISTS idx_video_sounds_original_video ON video_sounds(original_video_id);
    CREATE INDEX IF NOT EXISTS idx_video_sounds_profile ON video_sounds(profile_id);
  `)

  // Social
  await db.exec(`
    CREATE TABLE IF NOT EXISTS followers (
      id TEXT PRIMARY KEY,
      follower_id TEXT NOT NULL,
      following_id TEXT NOT NULL,
      status INTEGER DEFAULT 1,
      created_at INTEGER DEFAULT (unixepoch()),
      FOREIGN KEY (follower_id) REFERENCES profiles(id) ON DELETE CASCADE,
      FOREIGN KEY (following_id) REFERENCES profiles(id) ON DELETE CASCADE,
      UNIQUE(follower_id, following_id)
    );

    CREATE INDEX IF NOT EXISTS idx_followers_following ON followers(following_id, follower_id);
    CREATE INDEX IF NOT EXISTS idx_followers_follower ON followers(follower_id, following_id);

    CREATE TABLE IF NOT EXISTS follow_requests (
      id TEXT PRIMARY KEY,
      requester_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      status INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (unixepoch()),
      FOREIGN KEY (requester_id) REFERENCES profiles(id) ON DELETE CASCADE,
      FOREIGN KEY (target_id) REFERENCES profiles(id) ON DELETE CASCADE,
      UNIQUE(requester_id, target_id)
    );

    CREATE INDEX IF NOT EXISTS idx_follow_requests_target ON follow_requests(target_id);
  `)

  // Engagement
  await db.exec(`
    CREATE TABLE IF NOT EXISTS video_likes (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL,
      video_id TEXT NOT NULL,
      created_at INTEGER DEFAULT (unixepoch()),
      FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
      FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE,
      UNIQUE(profile_id, video_id)
    );

    CREATE INDEX IF NOT EXISTS idx_video_likes_video ON video_likes(video_id);
    CREATE INDEX IF NOT EXISTS idx_video_likes_profile ON video_likes(profile_id);

    CREATE TABLE IF NOT EXISTS video_reposts (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL,
      video_id TEXT NOT NULL,
      created_at INTEGER DEFAULT (unixepoch()),
      FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
      FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE,
      UNIQUE(profile_id, video_id)
    );

    CREATE INDEX IF NOT EXISTS idx_video_reposts_video ON video_reposts(video_id);
    CREATE INDEX IF NOT EXISTS idx_video_reposts_profile ON video_reposts(profile_id);

    CREATE TABLE IF NOT EXISTS video_bookmarks (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL,
      video_id TEXT NOT NULL,
      created_at INTEGER DEFAULT (unixepoch()),
      FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
      FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE,
      UNIQUE(profile_id, video_id)
    );

    CREATE INDEX IF NOT EXISTS idx_video_bookmarks_video ON video_bookmarks(video_id);
    CREATE INDEX IF NOT EXISTS idx_video_bookmarks_profile ON video_bookmarks(profile_id);
  `)

  // Comments
  await db.exec(`
    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL,
      profile_id TEXT NOT NULL,
      parent_id TEXT,
      caption TEXT,
      status TEXT DEFAULT 'active',
      is_hidden INTEGER DEFAULT 0,
      likes INTEGER DEFAULT 0,
      replies_count INTEGER DEFAULT 0,
      is_edited INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch()),
      deleted_at INTEGER,
      FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE,
      FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
      FOREIGN KEY (parent_id) REFERENCES comments(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_comments_video ON comments(video_id);
    CREATE INDEX IF NOT EXISTS idx_comments_profile ON comments(profile_id);
    CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments(parent_id);
    CREATE INDEX IF NOT EXISTS idx_comments_video_created ON comments(video_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS comment_replies (
      id TEXT PRIMARY KEY,
      comment_id TEXT NOT NULL,
      video_id TEXT NOT NULL,
      profile_id TEXT NOT NULL,
      caption TEXT,
      status TEXT DEFAULT 'active',
      is_hidden INTEGER DEFAULT 0,
      likes INTEGER DEFAULT 0,
      is_edited INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch()),
      deleted_at INTEGER,
      FOREIGN KEY (comment_id) REFERENCES comments(id) ON DELETE CASCADE,
      FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE,
      FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_comment_replies_comment ON comment_replies(comment_id);
    CREATE INDEX IF NOT EXISTS idx_comment_replies_video ON comment_replies(video_id);
  `)

  // Hashtags
  await db.exec(`
    CREATE TABLE IF NOT EXISTS hashtags (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      name_normalized TEXT UNIQUE NOT NULL,
      count INTEGER DEFAULT 0,
      can_search INTEGER DEFAULT 1,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_hashtags_name ON hashtags(name_normalized);

    CREATE TABLE IF NOT EXISTS video_hashtags (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL,
      hashtag_id TEXT NOT NULL,
      created_at INTEGER DEFAULT (unixepoch()),
      FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE,
      FOREIGN KEY (hashtag_id) REFERENCES hashtags(id) ON DELETE CASCADE,
      UNIQUE(video_id, hashtag_id)
    );

    CREATE INDEX IF NOT EXISTS idx_video_hashtags_video ON video_hashtags(video_id);
    CREATE INDEX IF NOT EXISTS idx_video_hashtags_hashtag ON video_hashtags(hashtag_id);
  `)

  // DM
  await db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      type TEXT DEFAULT 'direct',
      name TEXT,
      avatar TEXT,
      created_by TEXT NOT NULL,
      is_group INTEGER DEFAULT 0,
      max_participants INTEGER DEFAULT 12,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch()),
      FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS conversation_participants (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT DEFAULT 'member',
      joined_at INTEGER DEFAULT (unixepoch()),
      left_at INTEGER,
      muted_until INTEGER,
      is_admin INTEGER DEFAULT 0,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE,
      UNIQUE(conversation_id, user_id)
    );

    CREATE INDEX IF NOT EXISTS idx_conversation_participants_user ON conversation_participants(user_id);
    CREATE INDEX IF NOT EXISTS idx_conversation_participants_conv ON conversation_participants(conversation_id);

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      type TEXT DEFAULT 'text',
      content TEXT,
      media TEXT,
      is_edited INTEGER DEFAULT 0,
      edited_at INTEGER,
      deleted_at INTEGER,
      created_at INTEGER DEFAULT (unixepoch()),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (sender_id) REFERENCES profiles(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conversation_created ON messages(conversation_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id);

    CREATE TABLE IF NOT EXISTS dm_media (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      type TEXT NOT NULL,
      url TEXT NOT NULL,
      mime_type TEXT,
      size INTEGER,
      width INTEGER,
      height INTEGER,
      duration INTEGER,
      thumbnail_url TEXT,
      created_at INTEGER DEFAULT (unixepoch()),
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
    );
  `)

  // Notifications
  await db.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      actor_id TEXT,
      video_id TEXT,
      comment_id TEXT,
      conversation_id TEXT,
      data TEXT,
      is_read INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (unixepoch()),
      FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_notifications_user_read_created ON notifications(user_id, is_read, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, is_read) WHERE is_read = 0;
  `)

  // Music/Video Sounds
  await db.exec(`
    CREATE TABLE IF NOT EXISTS video_sounds (
      id TEXT PRIMARY KEY,
      title TEXT,
      description TEXT,
      fingerprint TEXT NOT NULL,
      fingerprint_hash TEXT UNIQUE NOT NULL,
      status INTEGER DEFAULT 1,
      duration INTEGER DEFAULT 0,
      original_video_id TEXT,
      profile_id TEXT,
      usage_count INTEGER DEFAULT 0,
      is_original INTEGER DEFAULT 0,
      allow_reuse INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch()),
      FOREIGN KEY (original_video_id) REFERENCES videos(id) ON DELETE SET NULL,
      FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE SET NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_video_sounds_fingerprint_hash ON video_sounds(fingerprint_hash);
    CREATE INDEX IF NOT EXISTS idx_video_sounds_original_video ON video_sounds(original_video_id);
    CREATE INDEX IF NOT EXISTS idx_video_sounds_profile ON video_sounds(profile_id);

    CREATE TABLE IF NOT EXISTS provider_tracks (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      title TEXT NOT NULL,
      artist TEXT NOT NULL,
      artist_id TEXT,
      duration INTEGER NOT NULL,
      artwork_url TEXT,
      audio_url TEXT,
      genre TEXT,
      bpm INTEGER,
      release_date INTEGER,
      license TEXT,
      attribution TEXT,
      is_downloadable INTEGER DEFAULT 0,
      is_streamable INTEGER DEFAULT 1,
      licensing TEXT,
      metadata TEXT,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch()),
      UNIQUE(provider, provider_id)
    );

    CREATE INDEX IF NOT EXISTS idx_provider_tracks_provider ON provider_tracks(provider);
    CREATE INDEX IF NOT EXISTS idx_provider_tracks_title ON provider_tracks(title);
    CREATE INDEX IF NOT EXISTS idx_provider_tracks_artist ON provider_tracks(artist);
  `)

  // Playlists
  await db.exec(`
    CREATE TABLE IF NOT EXISTS playlists (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      thumbnail TEXT,
      is_public INTEGER DEFAULT 1,
      order_column INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch()),
      FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_playlists_profile ON playlists(profile_id);

    CREATE TABLE IF NOT EXISTS playlist_videos (
      id TEXT PRIMARY KEY,
      playlist_id TEXT NOT NULL,
      video_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      created_at INTEGER DEFAULT (unixepoch()),
      FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
      FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE,
      UNIQUE(playlist_id, video_id)
    );

    CREATE INDEX IF NOT EXISTS idx_playlist_videos_playlist ON playlist_videos(playlist_id);
  `)

  // Notifications
  await db.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      actor_id TEXT,
      video_id TEXT,
      comment_id TEXT,
      conversation_id TEXT,
      data TEXT,
      is_read INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (unixepoch()),
      FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_notifications_user_read_created ON notifications(user_id, is_read, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, is_read) WHERE is_read = 0;
  `)

  // Reports & Moderation
  await db.exec(`
    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      reporter_id TEXT NOT NULL,
      type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      reason TEXT,
      comment TEXT,
      status TEXT DEFAULT 'pending',
      admin_notes TEXT,
      resolved_by TEXT,
      resolved_at INTEGER,
      created_at INTEGER DEFAULT (unixepoch()),
      FOREIGN KEY (reporter_id) REFERENCES profiles(id) ON DELETE CASCADE,
      FOREIGN KEY (resolved_by) REFERENCES profiles(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
    CREATE INDEX IF NOT EXISTS idx_reports_target ON reports(target_id);
  `)

  // Admin Settings
  await db.exec(`
    CREATE TABLE IF NOT EXISTS admin_settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      type TEXT DEFAULT 'string',
      is_public INTEGER DEFAULT 0,
      description TEXT,
      version INTEGER DEFAULT 1,
      updated_at INTEGER DEFAULT (unixepoch())
    );
  `)

  // Feed Feedback (for ML)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS feed_feedback (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      video_id TEXT NOT NULL,
      feedback_type TEXT NOT NULL,
      created_at INTEGER DEFAULT (unixepoch()),
      FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE,
      FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE,
      UNIQUE(user_id, video_id)
    );
  `)

  // Starter Kits
  await db.exec(`
    CREATE TABLE IF NOT EXISTS starter_kits (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      creator_id TEXT NOT NULL,
      icon TEXT,
      header TEXT,
      visibility TEXT DEFAULT 'public',
      status INTEGER DEFAULT 1,
      uses_count INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch()),
      FOREIGN KEY (creator_id) REFERENCES profiles(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS starter_kit_accounts (
      id TEXT PRIMARY KEY,
      kit_id TEXT NOT NULL,
      profile_id TEXT NOT NULL,
      order_column INTEGER DEFAULT 0,
      added_by TEXT,
      created_at INTEGER DEFAULT (unixepoch()),
      FOREIGN KEY (kit_id) REFERENCES starter_kits(id) ON DELETE CASCADE,
      FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
      UNIQUE(kit_id, profile_id)
    );

    CREATE INDEX IF NOT EXISTS idx_starter_kit_accounts_kit ON starter_kit_accounts(kit_id);
    CREATE INDEX IF NOT EXISTS idx_starter_kit_accounts_profile ON starter_kit_accounts(profile_id);
  `)

  // Provider tracks cache
  await db.exec(`
    CREATE TABLE IF NOT EXISTS provider_tracks (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      title TEXT NOT NULL,
      artist TEXT NOT NULL,
      artist_id TEXT,
      duration INTEGER NOT NULL,
      artwork_url TEXT,
      audio_url TEXT,
      genre TEXT,
      bpm INTEGER,
      release_date INTEGER,
      license TEXT,
      attribution TEXT,
      is_downloadable INTEGER DEFAULT 0,
      is_streamable INTEGER DEFAULT 1,
      licensing TEXT,
      metadata TEXT,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch()),
      UNIQUE(provider, provider_id)
    );

    CREATE INDEX IF NOT EXISTS idx_provider_tracks_provider ON provider_tracks(provider);
    CREATE INDEX IF NOT EXISTS idx_provider_tracks_title ON provider_tracks(title);
    CREATE INDEX IF NOT EXISTS idx_provider_tracks_artist ON provider_tracks(artist);
  `)

  // Trigger for updated_at
  await db.exec(`
    CREATE TRIGGER IF NOT EXISTS users_updated_at
    AFTER UPDATE ON users
    BEGIN
      UPDATE users SET updated_at = unixepoch() WHERE id = NEW.id;
    END;

    CREATE TRIGGER IF NOT EXISTS profiles_updated_at
    AFTER UPDATE ON profiles
    BEGIN
      UPDATE profiles SET updated_at = unixepoch() WHERE id = NEW.id;
    END;

    CREATE TRIGGER IF NOT EXISTS videos_updated_at
    AFTER UPDATE ON videos
    BEGIN
      UPDATE videos SET updated_at = unixepoch() WHERE id = NEW.id;
    END;
  `)

  console.log('D1 schema initialized')
}

export { Env } from '../types/env'