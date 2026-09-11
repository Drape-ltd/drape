import { assertEquals } from 'jsr:@std/assert@1'
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { meterOpsReadQueries } from './ops-read-query-budget.ts'

Deno.test('Ops read query meter counts from and rpc calls without counting unrelated client access', () => {
  const fakeClient = {
    from: (table: string) => ({ table }),
    rpc: (name: string) => ({ name }),
    channel: (name: string) => ({ name }),
  } as unknown as SupabaseClient
  const meter = meterOpsReadQueries(fakeClient)

  meter.client.from('ops_issues')
  meter.client.rpc('get_provider_health')
  meter.client.channel('ops')

  assertEquals(meter.count(), 2)
})
