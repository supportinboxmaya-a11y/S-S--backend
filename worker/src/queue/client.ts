import { Queue, QueueEntry } from '@cloudflare/workers-types'
import { Env, VideoProcessingJob, NotificationJob, EmailJob, FeedMaintenanceJob, AnalyticsJob } from '../types/env'

export interface QueueClient {
  videoProcessing: Queue<VideoProcessingJob>
  notifications: Queue<NotificationJob>
  emails: Queue<EmailJob>
  feedMaintenance: Queue<FeedMaintenanceJob>
  analytics: Queue<AnalyticsJob>
  send: <T>(queue: Queue<T>, job: T) => Promise<void>
  sendBatch: <T>(queue: Queue<T>, jobs: T[]) => Promise<void>
}

export function createQueueClient(env: Env): QueueClient {
  return {
    videoProcessing: env.QUEUE_VIDEO_PROCESSING,
    notifications: env.QUEUE_NOTIFICATIONS,
    emails: env.QUEUE_EMAILS,
    feedMaintenance: env.QUEUE_FEED_MAINTENANCE,
    analytics: env.QUEUE_ANALYTICS,
    async send<T>(queue: Queue<T>, job: T) {
      await queue.send(job)
    },
    async sendBatch<T>(queue: Queue<T>, jobs: T[]) {
      await queue.sendBatch(jobs)
    },
  }
}

export async function initQueues(env: Env, ctx: ExecutionContext): Promise<void> {
  // Queue handlers are registered via wrangler.toml consumers
  // This function can be used for any initialization
  console.log('Queues initialized')
}

export function createVideoProcessingJob(
  videoId: string,
  userId: string,
  sourcePath: string,
  options: VideoProcessingJob['options'],
  priority: VideoProcessingJob['priority'] = 'normal'
): VideoProcessingJob {
  return {
    type: 'video-processing',
    videoId,
    userId,
    sourcePath,
    options,
    priority,
    createdAt: Date.now(),
    retries: 0,
  }
}

export function createNotificationJob(
  userId: string,
  notificationId: string,
  type: NotificationJob['type'],
  data: Record<string, unknown>,
  priority: NotificationJob['priority'] = 'normal'
): NotificationJob {
  return {
    type: 'notification',
    userId,
    notificationId,
    type,
    data,
    priority,
    createdAt: Date.now(),
  }
}

export function createEmailJob(
  to: string,
  template: string,
  data: Record<string, unknown>,
  priority: EmailJob['priority'] = 'normal'
): EmailJob {
  return {
    type: 'email',
    to,
    template,
    data,
    priority,
    createdAt: Date.now(),
  }
}

export function createFeedMaintenanceJob(
  action: FeedMaintenanceJob['action'],
  userId?: string
): FeedMaintenanceJob {
  return {
    type: 'feed-maintenance',
    action,
    userId,
    createdAt: Date.now(),
  }
}

export function createAnalyticsJob(
  event: string,
  data: Record<string, unknown>,
  userId?: string,
  videoId?: string
): AnalyticsJob {
  return {
    type: 'analytics',
    event,
    userId,
    videoId,
    data,
    createdAt: Date.now(),
  }
}