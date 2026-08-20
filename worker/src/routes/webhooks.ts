import { Hono } from 'hono'
import { z } from 'zod'
import { Context } from 'hono'
import { Env } from '../types/env'
import { createDbClient } from '../db/client'
import { validateBody } from '../middleware/validation'
import { AppError } from '../middleware/error-handler'

export const webhookRoutes = new Hono<Env>()

// Stripe webhook
webhookRoutes.post('/stripe', async (c: Context<Env>) => {
  const signature = c.req.header('stripe-signature')
  if (!signature) {
    throw AppError.badRequest('Missing stripe-signature header')
  }

  const body = await c.req.text()
  const webhookSecret = c.env.STRIPE_WEBHOOK_SECRET

  // Verify signature (in production, use Stripe's library)
  // const event = stripe.webhooks.constructEvent(body, signature, webhookSecret)

  // For now, parse without verification (add proper verification in production)
  let event
  try {
    event = JSON.parse(body)
  } catch {
    throw AppError.badRequest('Invalid JSON')
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object
      const userId = session.metadata?.user_id
      const planId = session.metadata?.plan_id

      if (userId && planId) {
        // Grant subscription
        await c.get('db').exec(`
          INSERT OR REPLACE INTO subscriptions (id, user_id, plan_id, stripe_customer_id, stripe_subscription_id, status, current_period_start, current_period_end, created_at)
          VALUES (?, ?, ?, ?, ?, 'active', ?, ?, unixepoch())
        `, [
          crypto.randomUUID(),
          userId,
          planId,
          session.customer,
          session.subscription,
          session.current_period_start,
          session.current_period_end,
        ])

        // Grant entitlements
        // In production, look up plan entitlements and grant them
      }
      break
    }

    case 'customer.subscription.updated': {
      const subscription = event.data.object
      const userId = subscription.metadata?.user_id

      if (userId) {
        await c.get('db').exec(`
          UPDATE subscriptions SET
            status = ?,
            current_period_start = ?,
            current_period_end = ?,
            cancel_at_period_end = ?,
            updated_at = unixepoch()
          WHERE stripe_subscription_id = ?
        `, [
          subscription.status,
          subscription.current_period_start,
          subscription.current_period_end,
          subscription.cancel_at_period_end ? 1 : 0,
          subscription.id,
        ])
      }
      break
    }

    case 'customer.subscription.deleted': {
      const subscription = event.data.object
      const userId = subscription.metadata?.user_id

      if (userId) {
        await c.get('db').exec(`
          UPDATE subscriptions SET
            status = 'cancelled',
            cancelled_at = unixepoch(),
            updated_at = unixepoch()
          WHERE stripe_subscription_id = ?
        `, [subscription.id])

        // Revoke entitlements
      }
      break
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object
      const userId = invoice.metadata?.user_id

      if (userId) {
        // Notify user of failed payment
        await c.env.QUEUE_NOTIFICATIONS.send({
          type: 'notification',
          userId,
          notificationId: crypto.randomUUID(),
          type: 'system',
          data: { message: 'Your subscription payment failed. Please update your payment method.' },
          priority: 'high',
          createdAt: Date.now(),
        })
      }
      break
    }
  }

  return c.json({ received: true })
})

// Apple App Store Server Notifications v2
webhookRoutes.post('/apple', async (c: Context<Env>) => {
  const body = await c.req.json()

  // Handle App Store Server Notifications v2
  // https://developer.apple.com/documentation/appstoreservernotifications

  if (body.signedPayload) {
    // Verify JWS signature (in production, use Apple's public keys)
    // const payload = verifyJWS(body.signedPayload)

    const notification = body // or payload

    switch (notification.notificationType) {
      case 'SUBSCRIBED':
      case 'RENEWAL':
      case 'DID_CHANGE_RENEWAL_STATUS':
      case 'EXPIRED':
      case 'GRACE_PERIOD_EXPIRED':
      case 'PRICE_INCREASE':
      case 'REFUND':
      case 'REFUND_DECLINED': {
        const userId = notification.subscriptionInfo?.originalTransactionId // Map to user
        
        if (userId) {
          // Update subscription status
          // In production, maintain a mapping of Apple transaction IDs to user IDs
        }
        break
      }
    }
  }

  return c.json({ success: true })
})

// Google Play Developer Notifications
webhookRoutes.post('/google-play', async (c: Context<Env>) => {
  const body = await c.req.json()

  // Handle Google Play Real-time Developer Notifications
  // https://developer.android.com/google/play/billing/rtdn-reference

  if (body.message && body.subscriptionNotification) {
    const notification = body.subscriptionNotification

    switch (notification.notificationType) {
      case 1: // SUBSCRIPTION_RECOVERED
      case 2: // SUBSCRIPTION_RENEWED
      case 3: // SUBSCRIPTION_CANCELED
      case 4: // SUBSCRIPTION_PURCHASED
      case 5: // SUBSCRIPTION_ON_HOLD
      case 6: // SUBSCRIPTION_IN_GRACE_PERIOD
      case 7: // SUBSCRIPTION_RESTARTED
      case 8: // PRICE_CHANGE_CONFIRMED
      case 9: // SUBSCRIPTION_PAUSED
      case 9: // SUBSCRIPTION_PAUSE_SCHEDULE_CHANGED
      case 10: // SUBSCRIPTION_REVOKED
      case 11: // SUBSCRIPTION_EXPIRED
      case 12: // SUBSCRIPTION_UPGRADED
      case 13: // SUBSCRIPTION_DOWNGRADED
      case 14: // SUBSCRIPTION_RESUMED
      case 15: // SUBSCRIPTION_PENDING_PURCHASE_CANCELED
      case 16: // ONE_TIME_PRODUCT_PURCHASED
      case 17: // ONE_TIME_PRODUCT_CANCELED
      case 18: // VOIDED_PURCHASE
      case 19: // BENEFIT_ENDED
      case 20: // ONE_TIME_PRODUCT_PURCHASE_REVERSED
      case 21: // ONE_TIME_PRODUCT_REFUNDED
      case 22: // BENEFIT_STARTED
        // Update subscription status
        const purchaseToken = notification.purchaseToken
        // Map purchase token to user and update subscription
        break
    }
  }

  return c.json({ success: true })
})

// Generic payment webhook (for other providers)
webhookRoutes.post('/payment/:provider', validateBody(z.object({
  event: z.string(),
  data: z.record(z.unknown()),
  user_id: z.string().optional(),
})), async (c: Context<Env>) => {
  const { provider } = c.req.param()
  const { event, data, user_id } = c.get('validatedBody')

  // Handle generic payment events
  // This is a fallback for providers not explicitly handled

  return c.json({ received: true })
})