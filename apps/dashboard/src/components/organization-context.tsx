'use client'

import { createContext, useContext } from 'react'

const OrganizationContext = createContext<string | undefined>(undefined)

export function OrganizationProvider({
  orgId,
  children,
}: {
  orgId?: string
  children: React.ReactNode
}) {
  return <OrganizationContext.Provider value={orgId}>{children}</OrganizationContext.Provider>
}

export function useOrganizationId() {
  return useContext(OrganizationContext)
}
