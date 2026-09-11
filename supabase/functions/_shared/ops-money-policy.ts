export type OpsMoneyCommand = 'ELEVATE' | 'DECIDE' | 'EXECUTE'

const COMMAND_ROLES: Record<OpsMoneyCommand, readonly string[]> = {
  ELEVATE: ['admin', 'finance', 'customer_success', 'ops'],
  DECIDE: ['admin', 'finance'],
  EXECUTE: ['admin', 'finance'],
}

export function isOpsMoneyCommand(value: unknown): value is OpsMoneyCommand {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(COMMAND_ROLES, value)
}

export function selectOpsMoneyActorRole(roles: string[], command: OpsMoneyCommand) {
  const normalized = new Set(roles.map((role) => role.trim().toLowerCase()))
  return COMMAND_ROLES[command].find((role) => normalized.has(role)) ?? null
}

export function canUseOpsMoneyCommand(roles: string[], command: OpsMoneyCommand) {
  return selectOpsMoneyActorRole(roles, command) !== null
}
