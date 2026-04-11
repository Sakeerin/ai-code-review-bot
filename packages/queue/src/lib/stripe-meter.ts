import Stripe from 'stripe'

/**
 * Reports a completed PR review as a usage event to Stripe Billing Meter.
 *
 * Only fires when the org has a stripeCustomerId and the required env vars are set.
 * Safe to call for free-plan orgs — will silently skip if no customer exists.
 *
 * Stripe Meter setup in dashboard:
 *   - Create a Meter with event_name matching STRIPE_METER_EVENT_NAME
 *   - Attach the meter to an overage price on Team/Business plans
 */
export async function reportPRReviewToMeter(stripeCustomerId: string | null): Promise<void> {
  const secretKey = process.env.STRIPE_SECRET_KEY
  const eventName = process.env.STRIPE_METER_EVENT_NAME

  // Skip if not configured or no paying customer
  if (!secretKey || !eventName || !stripeCustomerId) return

  try {
    const stripe = new Stripe(secretKey, { apiVersion: '2026-03-25.dahlia' })

    await stripe.billing.meterEvents.create({
      event_name: eventName,
      payload: {
        stripe_customer_id: stripeCustomerId,
        value: '1',
      },
    })

    console.log(`📊 Stripe Billing Meter: reported 1 PR review for customer ${stripeCustomerId}`)
  } catch (err) {
    // Non-fatal — log and continue. We never want meter reporting to fail a review.
    console.error('⚠️  Stripe Billing Meter report failed (non-fatal):', err)
  }
}
