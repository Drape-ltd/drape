import 'server-only'

import { invokeOpsReadBroker, requiresOpsEdgeBroker } from '../../web/lib/ops-edge-broker'
import { createServiceRoleClient } from '../../web/lib/server-supabase'

function clientOrThrow() {
  const client = createServiceRoleClient()
  if (!client) throw new Error('The Ops database projection is unavailable. No fixture fallback is permitted.')
  return client
}

function text(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function assertResults(results: Array<{ error: { message: string } | null }>, label: string) {
  const failed = results.find((result) => result.error)
  if (failed?.error) throw new Error(`${label} is unavailable: ${failed.error.message}`)
}

function isUuid(value: string | null) {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value))
}

function displayCaseNumber(row: Record<string, unknown>) {
  return text(row.case_number) ?? `OPS-${String(Number(row.issue_number ?? 0)).padStart(6, '0')}`
}

async function loadCustomerNetworkDataDirect() {
  const client = clientOrThrow()
  const userResult = await client.from('users').select('id,display_name,role,region_code,default_currency,phone_verified_at,created_at,updated_at').eq('role', 'CUSTOMER').order('updated_at', { ascending: false }).limit(300)
  assertResults([userResult], 'Customer operations')
  const rows = userResult.data ?? []
  const userIds = rows.map((row) => String(row.id))
  if (userIds.length === 0) return { customers: [], observedAt: new Date().toISOString(), coverageLimit: 300 }
  const [issues, deletions] = await Promise.all([
    client.from('ops_issues').select('id,user_id,severity,canonical_status,status,updated_at').in('user_id', userIds).order('updated_at', { ascending: false }).limit(1000),
    client.from('account_deletion_requests').select('id,user_id,status,requested_at').in('user_id', userIds).order('requested_at', { ascending: false }).limit(500),
  ])
  assertResults([issues, deletions], 'Customer operational state')
  const issueRows = issues.data ?? []
  const deletionRows = deletions.data ?? []
  return {
    customers: rows.map((row) => {
      const userId = String(row.id)
      const openIssues = issueRows.filter((issue) => String(issue.user_id) === userId && !['RESOLVED', 'CLOSED', 'CANCELLED'].includes(String(issue.canonical_status ?? issue.status)))
      const deletion = deletionRows.find((request) => String(request.user_id) === userId)
      return { id: userId, name: String(row.display_name ?? 'Customer'), role: String(row.role), region: text(row.region_code), currency: text(row.default_currency), phoneVerified: Boolean(row.phone_verified_at), openCaseCount: openIssues.length, highestOpenSeverity: openIssues.some((issue) => String(issue.severity) === 'CRITICAL') ? 'CRITICAL' : openIssues.some((issue) => String(issue.severity) === 'HIGH') ? 'HIGH' : openIssues.length ? 'MEDIUM' : null, deletionStatus: deletion ? String(deletion.status) : null, createdAt: String(row.created_at), updatedAt: String(row.updated_at) }
    }),
    observedAt: new Date().toISOString(),
    coverageLimit: 300,
  }
}

async function loadCustomerDetailDataDirect(customerId: string) {
  if (!isUuid(customerId)) throw new Error('The customer identifier is invalid.')
  const client = clientOrThrow()
  const [user, profile, ordersResult, deletions, issues] = await Promise.all([
    client.from('users').select('id,email,display_name,role,region_code,default_currency,phone_verified_at,created_at,updated_at').eq('id', customerId).eq('role', 'CUSTOMER').maybeSingle(),
    client.from('customer_profiles').select('id,user_id,display_name,unit_preference,updated_at').eq('user_id', customerId).maybeSingle(),
    client.from('orders').select('id,reference,order_kind,item_title,garment_type,stage,stage_updated_at,total_amount,quoted_amount,currency,quoted_currency,delivery_method,created_at').eq('customer_id', customerId).order('stage_updated_at', { ascending: false }).limit(100),
    client.from('account_deletion_requests').select('id,status,reason,requested_at,acknowledged_at,processed_at,completed_at').eq('user_id', customerId).order('requested_at', { ascending: false }).limit(20),
    client.from('ops_issues').select('id,case_number,issue_number,issue_type,severity,canonical_status,status,title,recommended_action,updated_at').eq('user_id', customerId).order('updated_at', { ascending: false }).limit(100),
  ])
  assertResults([user, profile, ordersResult, deletions, issues], 'Customer record')
  if (!user.data) return null
  return {
    customer: { id: String(user.data.id), name: text(profile.data?.display_name) ?? String(user.data.display_name ?? 'Customer'), email: text(user.data.email), role: String(user.data.role), region: text(user.data.region_code), currency: text(user.data.default_currency), phoneVerified: Boolean(user.data.phone_verified_at), measurementProfilePresent: Boolean(profile.data?.id), measurementUnit: text(profile.data?.unit_preference), createdAt: String(user.data.created_at), updatedAt: String(user.data.updated_at) },
    orders: (ordersResult.data ?? []).map((row) => ({ id: String(row.id), reference: String(row.reference), kind: text(row.order_kind), item: text(row.item_title) ?? text(row.garment_type) ?? 'Order', stage: String(row.stage), stageUpdatedAt: String(row.stage_updated_at), amount: typeof row.total_amount === 'number' ? row.total_amount : typeof row.quoted_amount === 'number' ? row.quoted_amount : null, currency: text(row.quoted_currency) ?? text(row.currency), deliveryMethod: text(row.delivery_method), createdAt: String(row.created_at) })),
    deletions: (deletions.data ?? []).map((row) => ({ id: String(row.id), status: String(row.status), reason: text(row.reason), requestedAt: String(row.requested_at), acknowledgedAt: text(row.acknowledged_at), processedAt: text(row.processed_at), completedAt: text(row.completed_at) })),
    cases: (issues.data ?? []).map((row) => ({ id: String(row.id), caseNumber: displayCaseNumber(row), type: String(row.issue_type), severity: String(row.severity), status: String(row.canonical_status ?? row.status), title: String(row.title), recommendedAction: String(row.recommended_action), updatedAt: String(row.updated_at) })),
    observedAt: new Date().toISOString(),
  }
}

async function loadTailorDetailDataDirect(tailorProfileId: string) {
  if (!isUuid(tailorProfileId)) throw new Error('The tailor identifier is invalid.')
  const client = clientOrThrow()
  const profile = await client.from('tailor_profiles').select('id,user_id,display_name,business_name,bio,location,languages,specialty_tags,price_range_min,price_range_max,currency,id_verification_status,payout_account_verified,payout_reverification_required,payout_provider,payout_currency,is_live,profile_completed,availability,shop_paused,total_orders,avg_rating,created_at,updated_at').eq('id', tailorProfileId).maybeSingle()
  assertResults([profile], 'Tailor record')
  if (!profile.data) return null
  const userId = String(profile.data.user_id)
  const [user, items, ordersResult, issues] = await Promise.all([
    client.from('users').select('id,email,display_name,role,region_code,created_at,updated_at').eq('id', userId).maybeSingle(),
    client.from('seller_items').select('id,title,category,is_live,stock_status,updated_at').eq('tailor_profile_id', tailorProfileId).order('updated_at', { ascending: false }).limit(100),
    client.from('orders').select('id,reference,order_kind,item_title,garment_type,stage,stage_updated_at,total_amount,quoted_amount,currency,quoted_currency,delivery_method,created_at').eq('tailor_id', userId).order('stage_updated_at', { ascending: false }).limit(100),
    client.from('ops_issues').select('id,case_number,issue_number,issue_type,severity,canonical_status,status,title,recommended_action,updated_at').or(`tailor_profile_id.eq.${tailorProfileId},user_id.eq.${userId}`).order('updated_at', { ascending: false }).limit(100),
  ])
  assertResults([user, items, ordersResult, issues], 'Tailor operational state')
  return {
    tailor: { id: String(profile.data.id), userId, name: text(profile.data.business_name) ?? text(profile.data.display_name) ?? 'Tailor', email: text(user.data?.email), bio: text(profile.data.bio), location: text(profile.data.location), region: text(user.data?.region_code), languages: Array.isArray(profile.data.languages) ? profile.data.languages.map(String) : [], specialties: Array.isArray(profile.data.specialty_tags) ? profile.data.specialty_tags.map(String) : [], priceMin: typeof profile.data.price_range_min === 'number' ? profile.data.price_range_min : null, priceMax: typeof profile.data.price_range_max === 'number' ? profile.data.price_range_max : null, currency: text(profile.data.currency), trustStatus: String(profile.data.id_verification_status ?? 'NOT_SUBMITTED'), payoutReady: Boolean(profile.data.payout_account_verified) && !Boolean(profile.data.payout_reverification_required), payoutProvider: text(profile.data.payout_provider), payoutCurrency: text(profile.data.payout_currency), live: Boolean(profile.data.is_live), profileComplete: Boolean(profile.data.profile_completed), availability: text(profile.data.availability), shopPaused: Boolean(profile.data.shop_paused), totalOrders: Number(profile.data.total_orders ?? 0), rating: typeof profile.data.avg_rating === 'number' ? profile.data.avg_rating : null, createdAt: String(profile.data.created_at), updatedAt: String(profile.data.updated_at) },
    items: (items.data ?? []).map((row) => ({ id: String(row.id), title: String(row.title), category: text(row.category), live: Boolean(row.is_live), stockStatus: text(row.stock_status), updatedAt: String(row.updated_at) })),
    orders: (ordersResult.data ?? []).map((row) => ({ id: String(row.id), reference: String(row.reference), kind: text(row.order_kind), item: text(row.item_title) ?? text(row.garment_type) ?? 'Order', stage: String(row.stage), stageUpdatedAt: String(row.stage_updated_at), amount: typeof row.total_amount === 'number' ? row.total_amount : typeof row.quoted_amount === 'number' ? row.quoted_amount : null, currency: text(row.quoted_currency) ?? text(row.currency), deliveryMethod: text(row.delivery_method), createdAt: String(row.created_at) })),
    cases: (issues.data ?? []).map((row) => ({ id: String(row.id), caseNumber: displayCaseNumber(row), type: String(row.issue_type), severity: String(row.severity), status: String(row.canonical_status ?? row.status), title: String(row.title), recommendedAction: String(row.recommended_action), updatedAt: String(row.updated_at) })),
    observedAt: new Date().toISOString(),
  }
}

async function loadTailorNetworkDataDirect() {
  const client = clientOrThrow()
  const [profiles, applications, items] = await Promise.all([
    client.from('tailor_profiles').select('id,user_id,display_name,business_name,location,id_verification_status,payout_account_verified,payout_reverification_required,is_live,profile_completed,availability,shop_paused,total_orders,avg_rating,updated_at').order('updated_at', { ascending: false }).limit(200),
    client.from('tailor_applications').select('id,business_name,display_name,status,source,created_at').order('created_at', { ascending: false }).limit(100),
    client.from('seller_items').select('id,tailor_profile_id,is_live,stock_status').limit(1000),
  ])
  assertResults([profiles, applications, items], 'Tailor Network')
  const sellerItems = items.data ?? []
  return {
    profiles: (profiles.data ?? []).map((row) => ({
      id: String(row.id), name: text(row.business_name) ?? text(row.display_name) ?? 'Tailor profile', location: text(row.location), trust: String(row.id_verification_status ?? 'NOT_SUBMITTED'), payoutReady: Boolean(row.payout_account_verified) && !Boolean(row.payout_reverification_required), live: Boolean(row.is_live), profileComplete: Boolean(row.profile_completed), availability: text(row.availability), shopPaused: Boolean(row.shop_paused), totalOrders: Number(row.total_orders ?? 0), rating: typeof row.avg_rating === 'number' ? row.avg_rating : null, itemCount: sellerItems.filter((item) => String(item.tailor_profile_id) === String(row.id)).length, liveItemCount: sellerItems.filter((item) => String(item.tailor_profile_id) === String(row.id) && item.is_live && !['SOLD_OUT', 'HIDDEN'].includes(String(item.stock_status))).length, updatedAt: String(row.updated_at),
    })),
    applications: (applications.data ?? []).map((row) => ({ id: String(row.id), name: text(row.business_name) ?? text(row.display_name) ?? 'Tailor application', status: String(row.status), source: text(row.source), createdAt: String(row.created_at) })),
    observedAt: new Date().toISOString(),
  }
}

async function loadVisionOperationsDataDirect() {
  const client = clientOrThrow()
  const [scans, logs, issues] = await Promise.all([
    client.from('measurement_scans').select('id,user_id,capture_method,capture_version,status,confidence_overall,requires_tailor_review,created_at,updated_at').order('created_at', { ascending: false }).limit(300),
    client.from('drape_vision_scan_logs').select('id,user_id,session_id,mode,event_type,capture_version,capture_count,frame_sample_count,created_at').order('created_at', { ascending: false }).limit(500),
    client.from('ops_issues').select('id,case_number,issue_number,title,severity,canonical_status,status,recommended_action,related_entity_id,updated_at').or('issue_type.ilike.%VISION%,issue_type.ilike.%MEASUREMENT%').order('updated_at', { ascending: false }).limit(100),
  ])
  assertResults([scans, logs, issues], 'Measurements & Vision')
  return {
    scans: (scans.data ?? []).map((row) => ({ id: String(row.id), captureMethod: String(row.capture_method), version: String(row.capture_version), status: String(row.status), confidence: text(row.confidence_overall), requiresReview: Boolean(row.requires_tailor_review), createdAt: String(row.created_at), updatedAt: String(row.updated_at) })),
    sessions: (logs.data ?? []).map((row) => ({ id: String(row.id), sessionId: String(row.session_id), mode: String(row.mode), eventType: String(row.event_type), version: String(row.capture_version), captureCount: Number(row.capture_count), frameCount: Number(row.frame_sample_count), createdAt: String(row.created_at) })),
    issues: (issues.data ?? []).map((row) => ({ id: String(row.id), caseNumber: text(row.case_number) ?? `OPS-${String(Number(row.issue_number ?? 0)).padStart(6, '0')}`, title: String(row.title), severity: String(row.severity), status: String(row.canonical_status ?? row.status), recommendedAction: String(row.recommended_action), updatedAt: String(row.updated_at) })),
    observedAt: new Date().toISOString(),
  }
}

async function loadDeliveryOperationsDataDirect() {
  const client = clientOrThrow()
  const [runs, parcels, events] = await Promise.all([
    client.from('order_fulfillment_runs').select('id,order_id,method,status,funding_status,currency,captured_allowance_amount,shortfall_total_amount,unused_allowance_amount,customer_refund_status,provider_name,booked_at,delivered_at,correlation_id,updated_at').order('updated_at', { ascending: false }).limit(200),
    client.from('order_fulfillment_parcels').select('id,run_id,order_id,status,provider_name,service_level,provider_reference,tracking_number,eta_at,last_status_at,updated_at').order('updated_at', { ascending: false }).limit(400),
    client.from('order_fulfillment_events').select('id,run_id,order_id,event_type,source,occurred_at,correlation_id').order('occurred_at', { ascending: false }).limit(500),
  ])
  assertResults([runs, parcels, events], 'Delivery & Supply')
  const parcelRows = parcels.data ?? []
  const eventRows = events.data ?? []
  return {
    runs: (runs.data ?? []).map((row) => ({ id: String(row.id), orderId: String(row.order_id), method: String(row.method), status: String(row.status), fundingStatus: String(row.funding_status), currency: String(row.currency), capturedAllowanceAmount: Number(row.captured_allowance_amount), shortfallAmount: Number(row.shortfall_total_amount), unusedAllowanceAmount: Number(row.unused_allowance_amount), refundStatus: String(row.customer_refund_status), provider: text(row.provider_name), parcelCount: parcelRows.filter((parcel) => String(parcel.run_id) === String(row.id)).length, lastEvent: eventRows.find((event) => String(event.run_id) === String(row.id)) ? String(eventRows.find((event) => String(event.run_id) === String(row.id))?.event_type) : null, bookedAt: text(row.booked_at), deliveredAt: text(row.delivered_at), correlationId: String(row.correlation_id), updatedAt: String(row.updated_at) })),
    parcels: parcelRows.map((row) => ({ id: String(row.id), runId: String(row.run_id), orderId: String(row.order_id), status: String(row.status), provider: text(row.provider_name), serviceLevel: text(row.service_level), reference: text(row.provider_reference), trackingNumber: text(row.tracking_number), etaAt: text(row.eta_at), lastStatusAt: text(row.last_status_at), updatedAt: String(row.updated_at) })),
    observedAt: new Date().toISOString(),
  }
}

async function loadCommunicationsOperationsDataDirect() {
  const client = clientOrThrow()
  const [campaigns, recipients, providerEvents, jobs] = await Promise.all([
    client.from('communication_campaigns').select('id,name,kind,category,purpose,severity,status,risk_level,scheduled_at,expires_at,correlation_id,created_at,updated_at').order('created_at', { ascending: false }).limit(100),
    client.from('communication_campaign_recipients').select('campaign_id,status,updated_at').order('updated_at', { ascending: false }).limit(2000),
    client.from('communication_provider_events').select('id,provider,channel,signature_verified,status,attempts,next_attempt_at,processed_at,correlation_id,received_at').order('received_at', { ascending: false }).limit(300),
    client.from('job_queue').select('id,job_type,status,attempt_count,max_attempts,run_at,created_at,updated_at').or('job_type.ilike.%EMAIL%,job_type.ilike.%PUSH%,job_type.ilike.%SMS%,job_type.ilike.%COMMUNICATION%').order('created_at', { ascending: false }).limit(300),
  ])
  assertResults([campaigns, recipients, providerEvents, jobs], 'Communications')
  const recipientRows = recipients.data ?? []
  return {
    campaigns: (campaigns.data ?? []).map((row) => {
      const audience = recipientRows.filter((recipient) => String(recipient.campaign_id) === String(row.id))
      return { id: String(row.id), name: String(row.name), kind: String(row.kind), category: String(row.category), purpose: String(row.purpose), severity: String(row.severity), status: String(row.status), riskLevel: String(row.risk_level), scheduledAt: text(row.scheduled_at), expiresAt: text(row.expires_at), correlationId: String(row.correlation_id), createdAt: String(row.created_at), updatedAt: String(row.updated_at), recipients: audience.length, delivered: audience.filter((entry) => String(entry.status) === 'DELIVERED').length, failed: audience.filter((entry) => ['FAILED', 'DEAD'].includes(String(entry.status))).length }
    }),
    providerEvents: (providerEvents.data ?? []).map((row) => ({ id: String(row.id), provider: String(row.provider), channel: String(row.channel), signatureVerified: Boolean(row.signature_verified), status: String(row.status), attempts: Number(row.attempts), nextAttemptAt: text(row.next_attempt_at), processedAt: text(row.processed_at), correlationId: String(row.correlation_id), receivedAt: String(row.received_at) })),
    jobs: (jobs.data ?? []).map((row) => ({ id: String(row.id), type: String(row.job_type), status: String(row.status), attempts: Number(row.attempt_count), maxAttempts: Number(row.max_attempts), runAt: String(row.run_at), createdAt: String(row.created_at), updatedAt: String(row.updated_at) })),
    observedAt: new Date().toISOString(),
  }
}

async function loadAccessGovernanceDataDirect() {
  const client = clientOrThrow()
  const environment = (process.env.DRAPE_OPS_ENV ?? 'development').trim().toUpperCase()
  const [principalResult, issueResult] = await Promise.all([
    client.from('ops_workforce_principals').select('id,email,status,roles,permitted_environments,session_revoked_before,access_review_due_at,last_seen_at,created_at,updated_at').order('email').limit(200),
    client.from('ops_issues').select('id,case_number,issue_number,related_entity_id,canonical_status,record_version,updated_at').eq('related_entity_type', 'workforce_principal').eq('environment', environment).order('updated_at', { ascending: false }).limit(300),
  ])
  assertResults([principalResult, issueResult], 'Workforce authority')
  const latestCases = new Map<string, Record<string, unknown>>()
  for (const issue of issueResult.data ?? []) {
    const targetId = String(issue.related_entity_id ?? '')
    if (targetId && !latestCases.has(targetId)) latestCases.set(targetId, issue)
  }
  return {
    principals: (principalResult.data ?? []).map((row) => {
      const issue = latestCases.get(String(row.id))
      return {
        id: String(row.id), email: String(row.email), status: String(row.status), roles: Array.isArray(row.roles) ? row.roles.map(String) : [], environments: Array.isArray(row.permitted_environments) ? row.permitted_environments.map(String) : [], revokedBefore: text(row.session_revoked_before), reviewDueAt: text(row.access_review_due_at), lastSeenAt: text(row.last_seen_at), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
        offboardingCase: issue ? { id: String(issue.id), caseNumber: displayCaseNumber(issue), status: String(issue.canonical_status), recordVersion: Number(issue.record_version) } : null,
      }
    }),
    observedAt: new Date().toISOString(),
  }
}

async function loadAuditReportDataDirect() {
  const client = clientOrThrow()
  const environment = (process.env.DRAPE_OPS_ENV ?? 'development').trim().toUpperCase()
  const [receipts, events, audits, exportRequests] = await Promise.all([
    client.from('ops_action_receipts').select('id,issue_id,action_key,outcome,human_status,correlation_id,persisted_at,completed_at,side_effects,blockers,failure_code').order('persisted_at', { ascending: false }).limit(300),
    client.from('ops_case_events').select('id,issue_id,event_type,actor_label,from_status,to_status,summary,correlation_id,occurred_at').order('occurred_at', { ascending: false }).limit(300),
    client.from('ops_audit_logs').select('id,issue_id,action_taken,performed_by,performed_role,reason,created_at').order('created_at', { ascending: false }).limit(300),
    client.from('ops_export_requests').select('id,reference,dataset,status,reason,filters,row_limit,row_count,requester_email,source_watermark,content_sha256,failure_code,download_count,requested_at,completed_at,expires_at,last_downloaded_at').eq('environment', environment).order('requested_at', { ascending: false }).limit(100),
  ])
  assertResults([receipts, events, audits, exportRequests], 'Reports & Audit')
  return { receipts: receipts.data ?? [], events: events.data ?? [], audits: audits.data ?? [], exportRequests: exportRequests.data ?? [], observedAt: new Date().toISOString() }
}

export async function loadTailorNetworkData(): Promise<Awaited<ReturnType<typeof loadTailorNetworkDataDirect>>> {
  return requiresOpsEdgeBroker() ? invokeOpsReadBroker('tailors') : loadTailorNetworkDataDirect()
}

export async function loadCustomerNetworkData(): Promise<Awaited<ReturnType<typeof loadCustomerNetworkDataDirect>>> {
  return requiresOpsEdgeBroker() ? invokeOpsReadBroker('customers') : loadCustomerNetworkDataDirect()
}

export async function loadCustomerDetailData(customerId: string): Promise<Awaited<ReturnType<typeof loadCustomerDetailDataDirect>>> {
  return requiresOpsEdgeBroker() ? invokeOpsReadBroker('customer-detail', { customerId }) : loadCustomerDetailDataDirect(customerId)
}

export async function loadTailorDetailData(tailorProfileId: string): Promise<Awaited<ReturnType<typeof loadTailorDetailDataDirect>>> {
  return requiresOpsEdgeBroker() ? invokeOpsReadBroker('tailor-detail', { tailorProfileId }) : loadTailorDetailDataDirect(tailorProfileId)
}

export async function loadVisionOperationsData(): Promise<Awaited<ReturnType<typeof loadVisionOperationsDataDirect>>> {
  return requiresOpsEdgeBroker() ? invokeOpsReadBroker('vision') : loadVisionOperationsDataDirect()
}

export async function loadDeliveryOperationsData(): Promise<Awaited<ReturnType<typeof loadDeliveryOperationsDataDirect>>> {
  return requiresOpsEdgeBroker() ? invokeOpsReadBroker('delivery') : loadDeliveryOperationsDataDirect()
}

export async function loadCommunicationsOperationsData(): Promise<Awaited<ReturnType<typeof loadCommunicationsOperationsDataDirect>>> {
  return requiresOpsEdgeBroker() ? invokeOpsReadBroker('communications') : loadCommunicationsOperationsDataDirect()
}

export async function loadAccessGovernanceData(): Promise<Awaited<ReturnType<typeof loadAccessGovernanceDataDirect>>> {
  return requiresOpsEdgeBroker() ? invokeOpsReadBroker('access-governance') : loadAccessGovernanceDataDirect()
}

export async function loadAuditReportData(): Promise<Awaited<ReturnType<typeof loadAuditReportDataDirect>>> {
  return requiresOpsEdgeBroker() ? invokeOpsReadBroker('audit-report') : loadAuditReportDataDirect()
}
