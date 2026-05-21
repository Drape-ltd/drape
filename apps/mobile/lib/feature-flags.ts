import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export type DrapeFeatureFlag = {
  enabled: boolean
  audience: string
  rolloutPercent: number
  metadata: Record<string, unknown>
  updatedAt: string | null
}

export type DrapeFeatureFlags = Record<string, DrapeFeatureFlag>

async function fetchFeatureFlags(audience: 'ALL' | 'CUSTOMER' | 'TAILOR' | 'OPS' = 'ALL') {
  const { data, error } = await supabase.rpc('get_feature_flags', { p_audience: audience })
  if (error) throw error
  return (data && typeof data === 'object' ? data : {}) as DrapeFeatureFlags
}

export function useFeatureFlags(audience: 'ALL' | 'CUSTOMER' | 'TAILOR' | 'OPS' = 'ALL') {
  return useQuery({
    queryKey: ['feature-flags', audience],
    queryFn: () => fetchFeatureFlags(audience),
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: 1,
  })
}
