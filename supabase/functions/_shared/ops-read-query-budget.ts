import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

export type OpsReadQueryMeter = {
  client: SupabaseClient
  count: () => number
}

/**
 * Counts datastore operations at the Supabase query-builder boundary. Every
 * PostgREST request starts with `from` and every database function starts with
 * `rpc`, so the meter measures real outbound database calls without reading or
 * retaining any result payload.
 */
export function meterOpsReadQueries(client: SupabaseClient): OpsReadQueryMeter {
  let queryCount = 0
  const metered = new Proxy(client, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver)
      if ((property === 'from' || property === 'rpc') && typeof value === 'function') {
        return (...args: unknown[]) => {
          queryCount += 1
          return Reflect.apply(value, target, args)
        }
      }
      return typeof value === 'function' ? value.bind(target) : value
    },
  })

  return {
    client: metered as SupabaseClient,
    count: () => queryCount,
  }
}
