import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createStripe } from '../src/lib/stripe'
import { checkoutLineItems } from '../src/lib/billing'
import { reportPRReviewToMeter } from '../../../packages/queue/src/lib/stripe-meter'

// This command deliberately refuses live credentials before making any API call.
if (!/^(sk|rk)_test_/.test(process.env.STRIPE_SECRET_KEY ?? '')) {
  throw new Error(
    'Set STRIPE_SECRET_KEY to a Stripe sandbox/test key before running billing:verify',
  )
}

const stripe = createStripe()
const runId = randomUUID()
for (const plan of ['team', 'business'] as const) {
  for (const billing of ['monthly', 'annual'] as const) {
    const lineItems = await checkoutLineItems(stripe, plan, billing)
    const customer = await stripe.customers.create({
      name: `Reviewbot billing verification ${runId}`,
      metadata: { verificationRun: runId },
    })
    try {
      const subscription = await stripe.subscriptions.create({
        customer: customer.id,
        collection_method: 'send_invoice',
        days_until_due: 30,
        billing_mode: { type: 'flexible' },
        items: lineItems.map((item) => ({
          price: item.price!,
          ...(item.quantity ? { quantity: item.quantity } : {}),
        })),
        metadata: { verificationRun: runId },
      })
      assert.equal(subscription.livemode, false)
      const metered = subscription.items.data.filter(
        (item) => item.price.recurring?.usage_type === 'metered',
      )
      assert.equal(metered.length, plan === 'team' ? 1 : 0)
      const base = subscription.items.data.find(
        (item) => item.price.recurring?.usage_type !== 'metered',
      )
      assert.equal(base?.price.recurring?.interval, billing === 'annual' ? 'year' : 'month')
      if (plan === 'team') {
        // Local regression tests check 499/500/501 completed reviews. Deliver the one billable
        // event twice here to also check Stripe deduplication and the actual invoice line.
        const reviewKey = `billing-verification:${runId}:${billing}`
        const timestamp = Math.floor(Date.now() / 1000)
        await reportPRReviewToMeter(customer.id, reviewKey, timestamp)
        await reportPRReviewToMeter(customer.id, reviewKey, timestamp)
      }
      let amount = -1
      const deadline = Date.now() + 120_000
      do {
        const preview = await stripe.invoices.createPreview({
          customer: customer.id,
          subscription: subscription.id,
        })
        assert.equal(preview.livemode, false)
        amount = preview.lines.data
          .filter((line) => {
            const price = line.pricing?.price_details?.price
            return (
              (typeof price === 'string' ? price : price?.id) ===
              process.env.STRIPE_OVERAGE_PRICE_ID
            )
          })
          .reduce((total, line) => total + line.amount, 0)
        if (amount === (plan === 'team' ? 5 : 0)) break
        await Bun.sleep(5000) // Meter events aggregate asynchronously.
      } while (Date.now() < deadline)
      assert.equal(amount, plan === 'team' ? 5 : 0, `${plan}/${billing} invoice overage in cents`)
      console.log(`PASS ${plan}/${billing}: invoice overage $${(amount / 100).toFixed(2)}`)
    } finally {
      // No payment methods or email addresses are added. Remove the isolated test customer
      // and its subscriptions, even if an invoice assertion fails.
      await stripe.customers.del(customer.id)
    }
  }
}
