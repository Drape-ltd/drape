import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { canUseOpsMoneyCommand, isOpsMoneyCommand, selectOpsMoneyActorRole } from './ops-money-policy.ts'

Deno.test('unknown Money Desk commands fail closed', () => {
  assertEquals(isOpsMoneyCommand('ELEVATE'), true)
  assertEquals(isOpsMoneyCommand('SUBMIT'), false)
  assertEquals(isOpsMoneyCommand(''), false)
})

Deno.test('operations and customer success can elevate but cannot approve or execute', () => {
  for (const role of ['ops', 'customer_success']) {
    assertEquals(canUseOpsMoneyCommand([role], 'ELEVATE'), true)
    assertEquals(canUseOpsMoneyCommand([role], 'DECIDE'), false)
    assertEquals(canUseOpsMoneyCommand([role], 'EXECUTE'), false)
  }
})

Deno.test('finance and admin retain approval and execution authority', () => {
  assertEquals(canUseOpsMoneyCommand(['finance'], 'DECIDE'), true)
  assertEquals(canUseOpsMoneyCommand(['finance'], 'EXECUTE'), true)
  assertEquals(canUseOpsMoneyCommand(['admin'], 'DECIDE'), true)
  assertEquals(selectOpsMoneyActorRole(['trust', 'finance', 'admin'], 'EXECUTE'), 'admin')
})
