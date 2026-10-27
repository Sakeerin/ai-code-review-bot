import type Stripe from 'stripe'

export function subscriptionPlan(
  subscription: Stripe.Subscription,
): 'free' | 'team' | 'business' | null {
  const prices = subscription.items.data.map((item) => item.price.id)
  const team = [process.env.STRIPE_TEAM_PRICE_ID, process.env.STRIPE_TEAM_ANNUAL_PRICE_ID].some(
    (id) => id && prices.includes(id),
  )
  const business = [
    process.env.STRIPE_BUSINESS_PRICE_ID,
    process.env.STRIPE_BUSINESS_ANNUAL_PRICE_ID,
  ].some((id) => id && prices.includes(id))
  if (!team && !business) return null
  // past_due retains access during Stripe's payment retry/grace period.
  if (!['active', 'trialing', 'past_due'].includes(subscription.status)) return 'free'
  return business ? 'business' : 'team'
}

export function stripeObjectId(value: string | { id: string } | null): string | null {
  return typeof value === 'string' ? value : (value?.id ?? null)
}

export async function checkoutLineItems(
  stripe: Stripe,
  plan: 'team' | 'business',
  billing: 'monthly' | 'annual',
): Promise<Array<{ price: string; quantity?: number }>> {
  const baseId =
    plan === 'team'
      ? billing === 'annual'
        ? process.env.STRIPE_TEAM_ANNUAL_PRICE_ID
        : process.env.STRIPE_TEAM_PRICE_ID
      : billing === 'annual'
        ? process.env.STRIPE_BUSINESS_ANNUAL_PRICE_ID
        : process.env.STRIPE_BUSINESS_PRICE_ID
  if (!baseId) throw new Error('Subscription price is not configured')
  const items: Array<{ price: string; quantity?: number }> = [{ price: baseId, quantity: 1 }]
  if (plan === 'team') {
    const overageId = process.env.STRIPE_OVERAGE_PRICE_ID
    if (!overageId || !process.env.STRIPE_METER_EVENT_NAME)
      throw new Error('Overage billing is not configured')
    const price = await stripe.prices.retrieve(overageId)
    if (
      !price.active ||
      price.currency !== 'usd' ||
      price.unit_amount !== 5 ||
      price.billing_scheme !== 'per_unit' ||
      price.recurring?.usage_type !== 'metered' ||
      price.recurring.interval !== 'month' ||
      price.recurring.interval_count !== 1 ||
      !price.recurring.meter
    ) {
      throw new Error('Overage price must be an active USD $0.05 monthly metered price')
    }
    const meter = await stripe.billing.meters.retrieve(price.recurring.meter)
    if (meter.status !== 'active' || meter.event_name !== process.env.STRIPE_METER_EVENT_NAME) {
      throw new Error('Overage price uses an unexpected billing meter')
    }
    items.push({ price: overageId })
  }
  return items
}
