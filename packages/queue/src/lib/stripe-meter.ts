import Stripe from 'stripe'

/** Deliver an already persisted Team overage event. Failures stay in the outbox. */
export async function reportPRReviewToMeter(
  stripeCustomerId: string,
  reviewKey: string,
  timestamp: number,
): Promise<void> {
  const secretKey = process.env.STRIPE_SECRET_KEY
  const eventName = process.env.STRIPE_METER_EVENT_NAME

  if (!secretKey || !eventName) throw new Error('Stripe meter is not configured')
  const stripe = new Stripe(secretKey, {
    apiVersion: '2026-03-25.dahlia',
    httpClient: Stripe.createFetchHttpClient(),
    timeout: 10_000,
    maxNetworkRetries: 0, // Durable outbox owns retries and their attempt count.
  })

  await stripe.billing.meterEvents.create(
    {
      event_name: eventName,
      identifier: reviewKey,
      timestamp,
      payload: {
        stripe_customer_id: stripeCustomerId,
        value: '1',
      },
    },
    { idempotencyKey: reviewKey },
  )
}
