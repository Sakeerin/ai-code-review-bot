import { NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { db } from '@repo/db/client'
import { organizations, stripeWebhookEvents } from '@repo/db/schema'
import { eq } from '@repo/db'
import { createStripe } from '@/lib/stripe'
import { stripeObjectId, subscriptionPlan } from '@/lib/billing'
import { enforceFreeRepositoryLimit } from '@repo/db/repository-policy'

export async function POST(req: Request) {
  const stripe = createStripe()
  const signature = req.headers.get('stripe-signature')
  let event: Stripe.Event
  try {
    if (!signature || !process.env.STRIPE_WEBHOOK_SECRET)
      throw new Error('Missing signature configuration')
    event = await stripe.webhooks.constructEventAsync(
      await req.text(),
      signature,
      process.env.STRIPE_WEBHOOK_SECRET,
    )
  } catch {
    return new NextResponse('Invalid webhook signature', { status: 400 })
  }
  try {
    await db.transaction(async (tx) => {
      const receipt = await tx
        .insert(stripeWebhookEvents)
        .values({ eventId: event.id })
        .onConflictDoNothing()
        .returning()
      if (!receipt.length) return
      let subscriptionId: string | null
      let customerId: string | null
      let orgId: string | undefined
      if (event.type === 'checkout.session.completed') {
        const checkout = event.data.object as Stripe.Checkout.Session
        subscriptionId = stripeObjectId(checkout.subscription)
        customerId = stripeObjectId(checkout.customer)
        orgId = checkout.client_reference_id ?? undefined
      } else if (
        [
          'customer.subscription.created',
          'customer.subscription.updated',
          'customer.subscription.deleted',
          'customer.subscription.paused',
          'customer.subscription.resumed',
        ].includes(event.type)
      ) {
        const subscription = event.data.object as Stripe.Subscription
        subscriptionId = subscription.id
        customerId = stripeObjectId(subscription.customer)
        orgId = subscription.metadata.orgId
      } else return
      if (!subscriptionId || !customerId) return
      const [org] = await tx
        .select()
        .from(organizations)
        .where(orgId ? eq(organizations.id, orgId) : eq(organizations.stripeCustomerId, customerId))
        .for('update')
      if (!org || (org.stripeCustomerId && org.stripeCustomerId !== customerId)) return
      // Fetch current state after taking the org lock: old/out-of-order events cannot restore stale access.
      const subscription = await stripe.subscriptions.retrieve(subscriptionId)
      if (stripeObjectId(subscription.customer) !== customerId)
        throw new Error('Subscription customer mismatch')
      if (org.stripeSubscriptionId && org.stripeSubscriptionId !== subscription.id) {
        const existing = await stripe.subscriptions.retrieve(org.stripeSubscriptionId)
        if (!['canceled', 'incomplete_expired'].includes(existing.status)) return
      }
      let plan = subscriptionPlan(subscription)
      if (
        !plan &&
        org.stripeSubscriptionId === subscription.id &&
        ['canceled', 'unpaid', 'paused', 'incomplete_expired'].includes(subscription.status)
      )
        plan = 'free'
      if (!plan) return
      await tx
        .update(organizations)
        .set({
          stripeCustomerId: customerId,
          stripeSubscriptionId: subscription.id,
          subscriptionStatus: subscription.status,
          plan,
          updatedAt: new Date(),
        })
        .where(eq(organizations.id, org.id))
      if (plan === 'free') await enforceFreeRepositoryLimit(tx, org.id)
    })
  } catch (error) {
    console.error('Stripe event processing failed:', error)
    return new NextResponse('Internal Server Error', { status: 500 })
  }
  return NextResponse.json({ received: true })
}
