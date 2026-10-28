'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function OrganizationSwitcher({
  organizations,
  selected,
}: {
  organizations: Array<{ id: string; name: string }>
  selected?: string
}) {
  const router = useRouter()
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  if (!organizations.length) return null
  return (
    <div className="px-4 py-3 space-y-2">
      <label htmlFor="active-organization" className="text-sm font-medium">
        Organization
      </label>
      <select
        id="active-organization"
        value={selected ?? ''}
        disabled={pending}
        className="w-full rounded-md border bg-background p-2 text-sm"
        onChange={async (event) => {
          setPending(true)
          setError('')
          try {
            const response = await fetch('/api/organizations/active', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ orgId: event.target.value }),
            })
            if (!response.ok) throw new Error('Unable to switch organization. Check your access.')
            router.push('/dashboard')
            router.refresh()
          } catch (error) {
            setError((error as Error).message)
          } finally {
            setPending(false)
          }
        }}
      >
        <option value="" disabled>
          Select an organization
        </option>
        {organizations.map((org) => (
          <option key={org.id} value={org.id}>
            {org.name}
          </option>
        ))}
      </select>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
