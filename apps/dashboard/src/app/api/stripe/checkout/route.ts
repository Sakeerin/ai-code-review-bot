import { auth } from '@repo/db/auth'
import { db } from '@repo/db/client'
import { organizations } from '@repo/db/schema'
import { eq } from '@repo/db'
import { NextResponse } from 'next/server'
import { getUserOrg } from '@/lib/org'
import { createStripe } from '@/lib/stripe'
import { checkoutLineItems } from '@/lib/billing'
import { headers } from 'next/headers'
import { z } from 'zod'

const RequestSchema = z.object({
  plan: z.enum(['team', 'business']),
  billing: z.enum(['monthly', 'annual']).default('monthly'),
})

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = RequestSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success)
    return NextResponse.json({ error: 'Invalid plan or billing interval' }, { status: 400 })
  const org = await getUserOrg(session.user.id)
  if (!org) return NextResponse.json({ error: 'Install the GitHub App first' }, { status: 400 })
  const { plan, billing } = parsed.data
  const stripe = createStripe()
  let lineItems
  try {
    lineItems = await checkoutLineItems(stripe, plan, billing)
  } catch (error) {
    console.error('Checkout configuration error:', error)
    return NextResponse.json({ error: 'Billing configuration is unavailable' }, { status: 503 })
  }
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const result = await db.transaction(async (tx) => {
    // Serialize checkout creation per organization, including concurrent first purchases.
    const [current] = await tx
      .select()
      .from(organizations)
      .where(eq(organizations.id, org.id))
      .for('update')
    let customerId = current.stripeCustomerId
    if (!customerId) {
      const customer = await stripe.customers.create(
        { email: session.user.email, metadata: { orgId: org.id } },
        { idempotencyKey: `org-customer:${org.id}` },
      )
      customerId = customer.id
      await tx
        .update(organizations)
        .set({ stripeCustomerId: customerId })
        .where(eq(organizations.id, org.id))
    }
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: 'all',
      limit: 100,
    })
    const subscription = subscriptions.data.find(
      (sub) => !['canceled', 'incomplete_expired'].includes(sub.status),
    )
    if (subscription) {
      if (!['active', 'trialing'].includes(subscription.status)) {
        const portal = await stripe.billingPortal.sessions.create({
          customer: customerId,
          return_url: `${appUrl}/dashboard/billing`,
        })
        return { url: portal.url }
      }
      return {
        error: 'Preview and confirm your subscription change',
        changeRequired: true,
        status: 409,
      }
    }
    // Recover an already-created session if its response/DB commit was lost.
    const open = await stripe.checkout.sessions.list({
      customer: customerId,
      status: 'open',
      limit: 100,
    })
    const existing = open.data.find((item) => item.client_reference_id === org.id)
    if (existing) {
      if (existing.metadata?.plan !== plan || existing.metadata?.billing !== billing) {
        return {
          error: 'Finish or cancel the existing checkout before changing plans',
          status: 409,
        }
      }
      return { url: existing.url }
    }
    const checkout = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: lineItems,
      client_reference_id: org.id,
      metadata: { plan, orgId: org.id, billing },
      subscription_data: { metadata: { orgId: org.id }, billing_mode: { type: 'flexible' } },
      success_url: `${appUrl}/dashboard/billing?success=true&billing=${billing}`,
      cancel_url: `${appUrl}/dashboard/billing`,
    })
    return { url: checkout.url }
  })
  return NextResponse.json(result, { status: 'status' in result ? result.status : 200 })
}
