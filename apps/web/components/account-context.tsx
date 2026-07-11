'use client'

import { createContext, useContext, type ReactNode } from 'react'

export type AccountRole = 'CUSTOMER' | 'TAILOR'

export type AccountContextCustomerProfile = {
  userId: string
  displayName: string | null
  avatarUrl: string | null
} | null

export type AccountContextTailorProfile = {
  id: string
  userId: string
  displayName: string | null
  businessName: string | null
  avatarUrl: string | null
} | null

export type AccountContextValue = {
  userId: string
  role: AccountRole
  defaultCurrency: string | null
  customerProfile: AccountContextCustomerProfile
  tailorProfile: AccountContextTailorProfile
}

const AccountContext = createContext<AccountContextValue | null>(null)

export function AccountContextProvider({
  value,
  children,
}: {
  value: AccountContextValue
  children: ReactNode
}) {
  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>
}

export function useAccountContext() {
  const value = useContext(AccountContext)
  if (!value) {
    throw new Error('useAccountContext must be used inside AccountContextProvider')
  }
  return value
}
