import { createHmac, timingSafeEqual } from 'node:crypto'
import { auth } from '@repo/db/auth'
import { db } from '@repo/db/client'
import { organizations } from '@repo/db/schema'
import { eq } from '@repo/db'
import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import type Stripe from 'stripe'
import { getUserOrg } from '@/lib/org'
import { createStripe } from '@/lib/stripe'
import { checkoutLineItems, stripeObjectId, subscriptionChangeItems } from '@/lib/billing'

const Input = z.object({
  plan: z.enum(['team', 'business']),
  billing: z.enum(['monthly', 'annual']),
  quote: z.string().max(4000).optional(),
})
const Quote = z.object({
  orgId: z.string(),
  subscriptionId: z.string(),
  fingerprint: z.string(),
  plan: z.enum(['team', 'business']),
  billing: z.enum(['monthly', 'annual']),
  date: z.number().int(),
})
const fingerprint = (subscription: Stripe.Subscription) =>
  JSON.stringify(
    subscription.items.data
      .map((item) => [item.id, item.price.id, item.quantity, item.current_period_end])
      .sort(),
  )

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const input = Input.safeParse(await request.json().catch(() => null))
  if (!input.success)
    return NextResponse.json({ error: 'Invalid subscription change' }, { status: 400 })
  const org = await getUserOrg(session.user.id)
  if (!org?.stripeCustomerId)
    return NextResponse.json({ error: 'No subscription found' }, { status: 404 })
  const secret = process.env.BETTER_AUTH_SECRET
  if (!secret)
    return NextResponse.json({ error: 'Billing configuration is unavailable' }, { status: 503 })
  const sign = (value: string) => createHmac('sha256', secret).update(value).digest('hex')
  const stripe = createStripe()
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  try {
    const desired = await checkoutLineItems(stripe, input.data.plan, input.data.billing)
    const result = await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(organizations)
        .where(eq(organizations.id, org.id))
        .for('update')
      const subscriptions = await stripe.subscriptions.list({
        customer: current.stripeCustomerId!,
        status: 'all',
        limit: 100,
      })
      const live = subscriptions.data.filter(
        (sub) => !['canceled', 'incomplete_expired'].includes(sub.status),
      )
      if (live.length !== 1) return { error: 'Expected one existing subscription', status: 409 }
      const subscription = await stripe.subscriptions.retrieve(live[0].id, {
        expand: ['latest_invoice'],
      })
      if (stripeObjectId(subscription.customer) !== current.stripeCustomerId)
        throw new Error('Customer mismatch')
      const invoice =
        typeof subscription.latest_invoice === 'object' ? subscription.latest_invoice : null
      if (subscription.pending_update) {
        return invoice?.hosted_invoice_url
          ? { url: invoice.hosted_invoice_url }
          : { error: 'A subscription change is awaiting payment', status: 409 }
      }
      if (
        !['active', 'trialing'].includes(subscription.status) ||
        subscription.collection_method !== 'charge_automatically'
      ) {
        const portal = await stripe.billingPortal.sessions.create({
          customer: current.stripeCustomerId!,
          return_url: `${appUrl}/dashboard/billing`,
        })
        return { url: portal.url }
      }
      const items = subscriptionChangeItems(
        subscription,
        desired[0].price,
        input.data.plan === 'team',
      )
      if (
        subscription.items.data.some((item) => item.price.id === desired[0].price) &&
        (input.data.plan !== 'team' ||
          subscription.items.data.some(
            (item) => item.price.id === process.env.STRIPE_OVERAGE_PRICE_ID,
          ))
      )
        return { url: `${appUrl}/dashboard/billing?success=true` }
      const date = Math.floor(Date.now() / 1000)
      if (!input.data.quote) {
        const preview = await stripe.invoices.createPreview({
          customer: current.stripeCustomerId!,
          subscription: subscription.id,
          subscription_details: {
            items,
            proration_behavior: 'always_invoice',
            proration_date: date,
          },
        })
        const encoded = Buffer.from(
          JSON.stringify({
            orgId: org.id,
            subscriptionId: subscription.id,
            fingerprint: fingerprint(subscription),
            plan: input.data.plan,
            billing: input.data.billing,
            date,
          }),
        ).toString('base64url')
        return {
          quote: `${encoded}.${sign(encoded)}`,
          amountDue: preview.amount_due,
          currency: preview.currency,
        }
      }
      const [encoded, signature, extra] = input.data.quote.split('.')
      const expected = sign(encoded)
      if (
        extra ||
        !signature ||
        !/^[a-f0-9]{64}$/.test(signature) ||
        !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
      )
        return { error: 'Invalid quote', status: 400 }
      const quote = Quote.parse(JSON.parse(Buffer.from(encoded, 'base64url').toString()))
      if (
        quote.orgId !== org.id ||
        quote.subscriptionId !== subscription.id ||
        quote.plan !== input.data.plan ||
        quote.billing !== input.data.billing ||
        quote.fingerprint !== fingerprint(subscription) ||
        quote.date > date ||
        date - quote.date > 600
      )
        return { error: 'Quote expired or subscription changed. Preview again.', status: 409 }
      const updated = await stripe.subscriptions.update(
        subscription.id,
        {
          items,
          proration_behavior: 'always_invoice',
          proration_date: quote.date,
          payment_behavior: 'pending_if_incomplete',
          expand: ['latest_invoice'],
        },
        { idempotencyKey: `subscription-change:${sign(input.data.quote)}` },
      )
      const payment = typeof updated.latest_invoice === 'object' ? updated.latest_invoice : null
      return {
        url:
          updated.pending_update && payment?.hosted_invoice_url
            ? payment.hosted_invoice_url
            : `${appUrl}/dashboard/billing?success=true`,
      }
      // Entitlements are synchronized by the authenticated Stripe webhook after payment.
    })
    return NextResponse.json(result, { status: 'status' in result ? result.status : 200 })
  } catch (error) {
    console.error(
      'Subscription change failed:',
      error instanceof Error ? error.name : 'Unknown error',
    )
    return NextResponse.json(
      { error: 'Unable to change subscription. Retry or manage your payment method.' },
      { status: 502 },
    )
  }
}
