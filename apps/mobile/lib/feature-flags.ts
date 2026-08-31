import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'

export const MOBILE_FEATURE_FLAGS = Object.freeze({
  interactionSystemV1: process.env.EXPO_PUBLIC_DRAPE_INTERACTION_SYSTEM_V1 === 'true',
  quoteNegotiationV1: process.env.EXPO_PUBLIC_QUOTE_NEGOTIATION_V1 === 'true',
  chatOrderActionsV1: process.env.EXPO_PUBLIC_CHAT_ORDER_ACTIONS_V1 === 'true',
  drapeVisionUiV2: process.env.EXPO_PUBLIC_DRAPE_VISION_UI_V2 === 'true',
  darkThemeV1: process.env.EXPO_PUBLIC_DARK_THEME_V1 === 'true',
  groupOrdersV1: process.env.EXPO_PUBLIC_GROUP_ORDERS_V1 === 'true',
})

type FeatureFlagAudience = 'ALL' | 'CUSTOMER' | 'TAILOR' | 'OPS'

export type RemoteFeatureFlag = {
  enabled: boolean
  audience: FeatureFlagAudience | string
  rolloutPercent: number
  metadata: Record<string, unknown>
  updatedAt: string | null
}

export type RemoteFeatureFlags = Record<string, RemoteFeatureFlag>

async function fetchFeatureFlags(audience: FeatureFlagAudience) {
  const { data, error } = await supabase.rpc('get_feature_flags', { p_audience: audience })
  if (error) throw error
  return (data && typeof data === 'object' && !Array.isArray(data) ? data : {}) as RemoteFeatureFlags
}

export function useFeatureFlags(audience: FeatureFlagAudience = 'ALL') {
  return useQuery({
    queryKey: ['feature-flags', audience],
    queryFn: () => fetchFeatureFlags(audience),
    staleTime: 5 * 60_000,
    refetchOnReconnect: true,
  })
}
