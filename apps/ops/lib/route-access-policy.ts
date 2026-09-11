export type OpsArea =
  | 'customers'
  | 'tailors'
  | 'orders'
  | 'vision'
  | 'communications'
  | 'trust'
  | 'delivery'
  | 'money'
  | 'incidents'
  | 'providers'
  | 'overview'
  | 'reports'
  | 'access'

export const OPS_AREA_ROLES: Readonly<Record<OpsArea, readonly string[]>> = Object.freeze({
  customers: ['admin', 'customer_success', 'ops'],
  tailors: ['admin', 'trust', 'customer_success', 'ops'],
  orders: ['admin', 'finance', 'customer_success', 'ops'],
  vision: ['admin', 'trust', 'engineering', 'ops'],
  communications: ['admin', 'engineering', 'customer_success', 'ops'],
  trust: ['admin', 'trust'],
  delivery: ['admin', 'customer_success', 'ops'],
  money: ['admin', 'finance'],
  incidents: ['admin', 'engineering', 'ops'],
  providers: ['admin', 'engineering', 'ops'],
  overview: ['admin', 'engineering', 'ops'],
  reports: ['admin', 'engineering'],
  access: ['admin'],
})

export function isOpsArea(value: unknown): value is OpsArea {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(OPS_AREA_ROLES, value)
}

export function canAccessOpsArea(role: string, area: OpsArea) {
  return OPS_AREA_ROLES[area].includes(role.trim().toLowerCase())
}
