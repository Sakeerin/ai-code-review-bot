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

/** Preserve the monthly meter so delayed Team usage can still be invoiced after an upgrade. */
export function subscriptionChangeItems(
  subscription: Stripe.Subscription,
  basePrice: string,
  team: boolean,
) {
  const baseIds = [
    process.env.STRIPE_TEAM_PRICE_ID,
    process.env.STRIPE_TEAM_ANNUAL_PRICE_ID,
    process.env.STRIPE_BUSINESS_PRICE_ID,
    process.env.STRIPE_BUSINESS_ANNUAL_PRICE_ID,
  ]
  const bases = subscription.items.data.filter((item) => baseIds.includes(item.price.id))
  if (
    bases.length !== 1 ||
    subscription.items.has_more ||
    subscription.items.data.some(
      (item) =>
        !baseIds.includes(item.price.id) && item.price.id !== process.env.STRIPE_OVERAGE_PRICE_ID,
    )
  )
    throw new Error('Subscription has unsupported items; contact support before changing it')
  const items: Array<{ id?: string; price: string; quantity?: number }> = [
    { id: bases[0].id, price: basePrice, quantity: 1 },
  ]
  if (
    team &&
    !subscription.items.data.some((item) => item.price.id === process.env.STRIPE_OVERAGE_PRICE_ID)
  )
    items.push({ price: process.env.STRIPE_OVERAGE_PRICE_ID! })
  return items
}
