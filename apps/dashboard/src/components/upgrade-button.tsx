'use client'

import { useState, useEffect } from 'react'
import { cn } from '@/lib/utils'
import type { BillingInterval } from '@/lib/plans'
import { useOrganizationId } from './organization-context'

interface UpgradeButtonProps {
  plan: 'team' | 'business'
  billing?: BillingInterval
  className?: string
  children?: React.ReactNode
}

export function UpgradeButton({
  plan,
  billing = 'monthly',
  className,
  children,
}: UpgradeButtonProps) {
  const orgId = useOrganizationId()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<{
    quote: string
    amountDue: number
    currency: string
  } | null>(null)
  useEffect(() => {
    setPreview(null)
    setError(null)
  }, [plan, billing, orgId])

  const handleClick = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(preview ? '/api/stripe/change' : '/api/stripe/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(orgId ? { 'X-Organization-Id': orgId } : {}),
        },
        body: JSON.stringify({ plan, billing, ...(preview ? { quote: preview.quote } : {}) }),
      })
      const data = await res.json()
      if (res.status === 409 && data.changeRequired) {
        const response = await fetch('/api/stripe/change', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(orgId ? { 'X-Organization-Id': orgId } : {}),
          },
          body: JSON.stringify({ plan, billing }),
        })
        const change = await response.json()
        if (!response.ok) throw new Error(change.error ?? 'Unable to preview subscription')
        if (change.url) {
          window.location.href = change.url
          return
        }
        setPreview(change)
        setLoading(false)
        return
      }
      if (!res.ok) throw new Error(data.error ?? 'Something went wrong')
      window.location.href = data.url
    } catch (err) {
      setPreview(null)
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setLoading(false)
    }
  }

  const label = children ?? `Get ${plan.charAt(0).toUpperCase() + plan.slice(1)}`

  return (
    <div>
      <button
        onClick={handleClick}
        disabled={loading}
        className={cn(
          'inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50 disabled:pointer-events-none',
          className,
        )}
      >
        {loading ? 'Contacting Stripe…' : preview ? 'Confirm subscription change' : label}
      </button>
      {preview && (
        <div className="mt-2 text-sm space-y-1">
          <p>
            Due now:{' '}
            {new Intl.NumberFormat('en-US', {
              style: 'currency',
              currency: preview.currency,
            }).format(preview.amountDue / 100)}
            . Includes prorations; future renewals use the selected plan.
          </p>
          <button
            type="button"
            onClick={() => setPreview(null)}
            disabled={loading}
            className="underline"
          >
            Cancel
          </button>
        </div>
      )}
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </div>
  )
}
