import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { OpsReadAction } from './ops-read-policy.ts'

type ProjectionPrincipal = { email: string; roles: string[]; subject: string }

function text(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function cleanUrls(value: unknown) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((entry): entry is string => typeof entry === 'string' && /^https?:\/\//iu.test(entry.trim())).map((entry) => entry.trim()))].slice(0, 24)
}

function assertResults(results: Array<{ error: { message?: string } | null }>, label: string) {
  const failed = results.find((result) => result.error)
  if (failed?.error) throw new Error(`${label} is unavailable: ${failed.error.message ?? 'unknown database error'}`)
}

async function trustCase(supabase: SupabaseClient, input: Record<string, unknown>) {
  const tailorProfileId = text(input.tailorProfileId)
  const userId = text(input.userId)
  if (!tailorProfileId && !userId) return null
  let query = supabase.from('tailor_profiles').select('id,user_id,display_name,location,specialty_tags,trust_verification_video_path,trust_verification_challenge_id,trust_verification_challenge_text,avatar_url,portfolio_photo_urls,portfolio_video_urls,id_verification_status,id_verification_submitted_at,payout_account_verified,payout_provider,payout_currency')
  query = tailorProfileId ? query.eq('id', tailorProfileId) : query.eq('user_id', userId as string)
  const profileResult = await query.maybeSingle()
  if (profileResult.error) throw new Error(`Trust profile context is unavailable: ${profileResult.error.message}`)
  const profile = profileResult.data
  if (!profile?.id || !profile.user_id) return null
  const [userResult, proofResult] = await Promise.all([
    supabase.from('users').select('id,email,display_name').eq('id', profile.user_id).maybeSingle(),
    supabase.from('seller_items').select('id,title,category,photo_urls').eq('tailor_profile_id', profile.id).eq('is_live', false).order('updated_at', { ascending: false }).limit(8),
  ])
  assertResults([userResult, proofResult], 'Trust evidence')
  return {
    profileId: String(profile.id), userId: String(profile.user_id), displayName: String(profile.display_name ?? userResult.data?.display_name ?? 'Tailor'),
    email: text(userResult.data?.email), location: text(profile.location), specialties: Array.isArray(profile.specialty_tags) ? profile.specialty_tags.map(String) : [],
    challengeId: text(profile.trust_verification_challenge_id), challengeText: text(profile.trust_verification_challenge_text),
    hasChallengeVideo: Boolean(text(profile.trust_verification_video_path)), submittedAt: text(profile.id_verification_submitted_at), reviewStatus: String(profile.id_verification_status ?? 'NOT_SUBMITTED'),
    avatarUrl: text(profile.avatar_url), portfolioPhotoUrls: cleanUrls(profile.portfolio_photo_urls), portfolioVideoUrls: cleanUrls(profile.portfolio_video_urls),
    proofItems: (proofResult.data ?? []).map((item) => ({ id: String(item.id), title: String(item.title ?? 'Portfolio proof'), category: text(item.category), mediaUrls: cleanUrls(item.photo_urls) })),
    payoutAccountVerified: profile.payout_account_verified === true, payoutProvider: text(profile.payout_provider), payoutCurrency: text(profile.payout_currency),
  }
}

async function supportCase(supabase: SupabaseClient, input: Record<string, unknown>) {
  const userId = text(input.userId)
  const orderId = text(input.orderId)
  if (!userId && !orderId) return null
  const orderResult = orderId
    ? await supabase.from('orders').select('id,reference,stage,order_kind,delivery_method,payment_provider,customer_id,tailor_id').eq('id', orderId).maybeSingle()
    : { data: null, error: null }
  if (orderResult.error) throw new Error(`Support order context is unavailable: ${orderResult.error.message}`)
  const relatedUserIds = [...new Set([userId, orderResult.data?.customer_id, orderResult.data?.tailor_id].filter((value): value is string => typeof value === 'string' && value.length > 0))]
  const userResult = relatedUserIds.length > 0 ? await supabase.from('users').select('id,email,display_name').in('id', relatedUserIds) : { data: [], error: null }
  if (userResult.error) throw new Error(`Support participant context is unavailable: ${userResult.error.message}`)
  const users = new Map((userResult.data ?? []).map((user) => [String(user.id), user]))
  const requester = userId ? users.get(userId) : null
  const customer = orderResult.data?.customer_id ? users.get(String(orderResult.data.customer_id)) : null
  const tailor = orderResult.data?.tailor_id ? users.get(String(orderResult.data.tailor_id)) : null
  return {
    userId, requesterName: text(requester?.display_name), requesterEmail: text(requester?.email),
    order: orderResult.data ? { id: String(orderResult.data.id), reference: text(orderResult.data.reference), stage: text(orderResult.data.stage), kind: text(orderResult.data.order_kind), deliveryMethod: text(orderResult.data.delivery_method), paymentProvider: text(orderResult.data.payment_provider), customerName: text(customer?.display_name), tailorName: text(tailor?.display_name) } : null,
  }
}

async function money(supabase: SupabaseClient) {
  const [requests, decisions, attempts, payouts, tranches] = await Promise.all([
    supabase.from('money_desk_requests').select('id,reference,action_type,status,target_type,target_id,order_id,amount,currency,reason,requester_email,requester_role,risk_level,risk_reasons,required_approval_count,approval_count,policy_version,correlation_id,execution_outcome,provider_reference,created_at,updated_at').order('created_at', { ascending: false }).limit(150),
    supabase.from('money_desk_decisions').select('id,request_id,decision,approver_email,approver_role,reason,created_at').order('created_at', { ascending: false }).limit(500),
    supabase.from('money_desk_execution_attempts').select('id,request_id,status,executor_email,executor_role,provider_reference,failure_code,failure_summary,correlation_id,started_at,completed_at').order('started_at', { ascending: false }).limit(500),
    supabase.from('payouts').select('id,order_id,status,amount,currency,provider,processed_at').in('status', ['PENDING', 'PROCESSING', 'BLOCKED', 'FAILED']).limit(500),
    supabase.from('order_settlement_tranches').select('id,order_id,code,status,amount,currency,eligible_at,correlation_id').in('status', ['ELIGIBLE', 'RELEASE_REQUESTED', 'BLOCKED']).limit(500),
  ])
  assertResults([requests, decisions, attempts, payouts, tranches], 'Money Desk')
  const orderIds = [...new Set((requests.data ?? []).map((row) => text(row.order_id)).filter((value): value is string => Boolean(value)))]
  const ordersResult = orderIds.length > 0 ? await supabase.from('orders').select('id,reference').in('id', orderIds) : { data: [], error: null }
  assertResults([ordersResult], 'Money Desk order context')
  const orderRefs = new Map((ordersResult.data ?? []).map((row) => [String(row.id), text(row.reference)]))
  const decisionRows = (decisions.data ?? []).map((row) => ({ id: String(row.id), requestId: String(row.request_id), decision: String(row.decision), approverEmail: String(row.approver_email), approverRole: String(row.approver_role), reason: String(row.reason), createdAt: String(row.created_at) }))
  const attemptRows = (attempts.data ?? []).map((row) => ({ id: String(row.id), requestId: String(row.request_id), status: String(row.status), executorEmail: String(row.executor_email), executorRole: String(row.executor_role), providerReference: text(row.provider_reference), failureCode: text(row.failure_code), failureSummary: text(row.failure_summary), correlationId: String(row.correlation_id), startedAt: String(row.started_at), completedAt: text(row.completed_at) }))
  const payoutStatuses = (payouts.data ?? []).map((row) => String(row.status).toUpperCase())
  const trancheStatuses = (tranches.data ?? []).map((row) => String(row.status).toUpperCase())
  return {
    requests: (requests.data ?? []).map((row) => { const orderId = text(row.order_id); return { id: String(row.id), reference: String(row.reference), actionType: String(row.action_type), actionLabel: String(row.action_type), status: String(row.status), targetType: String(row.target_type), targetId: String(row.target_id), orderId, orderReference: orderId ? orderRefs.get(orderId) ?? null : null, amount: typeof row.amount === 'number' ? row.amount : null, currency: text(row.currency), reason: String(row.reason), requesterEmail: String(row.requester_email), requesterRole: String(row.requester_role), riskLevel: String(row.risk_level), riskReasons: Array.isArray(row.risk_reasons) ? row.risk_reasons.map(String) : [], requiredApprovalCount: Number(row.required_approval_count), approvalCount: Number(row.approval_count), policyVersion: text(row.policy_version), correlationId: String(row.correlation_id), executionOutcome: text(row.execution_outcome), providerReference: text(row.provider_reference), createdAt: String(row.created_at), updatedAt: String(row.updated_at), decisions: decisionRows.filter((entry) => entry.requestId === String(row.id)), attempts: attemptRows.filter((entry) => entry.requestId === String(row.id)) } }),
    payouts: (payouts.data ?? []).map((row) => ({ id: String(row.id), orderId: text(row.order_id), status: String(row.status), amount: numberValue(row.amount), currency: String(row.currency), provider: String(row.provider), processedAt: text(row.processed_at) })),
    tranches: (tranches.data ?? []).map((row) => ({ id: String(row.id), orderId: String(row.order_id), code: String(row.code), status: String(row.status), amount: numberValue(row.amount), currency: String(row.currency), eligibleAt: text(row.eligible_at), correlationId: String(row.correlation_id) })),
    payoutSummary: { pending: payoutStatuses.filter((status) => status === 'PENDING').length, blocked: payoutStatuses.filter((status) => ['BLOCKED', 'FAILED'].includes(status)).length, processing: payoutStatuses.filter((status) => status === 'PROCESSING').length },
    settlementSummary: { eligible: trancheStatuses.filter((status) => status === 'ELIGIBLE').length, requested: trancheStatuses.filter((status) => status === 'RELEASE_REQUESTED').length, blocked: trancheStatuses.filter((status) => status === 'BLOCKED').length },
    observedAt: new Date().toISOString(),
  }
}

async function activeMoneyGrant(supabase: SupabaseClient, input: Record<string, unknown>, principal: ProjectionPrincipal) {
  const actorEmail = principal.email.toLowerCase()
  const actorSubject = principal.subject
  const actorRole = text(input.actorRole)?.toUpperCase()
  if (!actorEmail || !actorSubject || !actorRole) throw new Error('Money Desk grant identity is incomplete.')
  if (!principal.roles.some((role) => role.toUpperCase() === actorRole)) throw new Error('Money Desk grant role is not held by this workforce principal.')
  const result = await supabase.from('money_desk_jit_grants').select('id,expires_at,action_scopes').eq('actor_email', actorEmail).eq('actor_subject', actorSubject).eq('actor_role', actorRole).is('revoked_at', null).gt('expires_at', new Date().toISOString()).order('expires_at', { ascending: false }).limit(1).maybeSingle()
  assertResults([result], 'Money Desk grant')
  return result.data?.id ? { id: String(result.data.id), expiresAt: String(result.data.expires_at), actionScopes: Array.isArray(result.data.action_scopes) ? result.data.action_scopes.map(String) : [] } : null
}

async function reliability(supabase: SupabaseClient, environment: string) {
  const [incidents, providers, jobs, monitors, jobItems, jobCases] = await Promise.all([
    supabase.from('service_incidents').select('id,incident_key,title,summary,severity,status,affected_services,public_visible,acknowledgement_required,source,source_reference,started_at,resolved_at,updated_at,last_observed_at,runbook_url,correlation_id,acknowledged_at,snoozed_until,snooze_reason').eq('environment', environment).order('updated_at', { ascending: false }).limit(100),
    supabase.rpc('get_provider_health'),
    supabase.rpc('get_job_queue_health'),
    supabase.from('ops_monitor_state').select('id,monitor_key,target_id,target_name,healthy,severity,http_status,latency_ms,detail,checked_at,last_transition_at,slack_delivery').eq('environment', environment).order('checked_at', { ascending: false }).limit(24),
    supabase.from('job_queue').select('id,job_type,status,attempt_count,max_attempts,run_at,created_at,updated_at').in('status', ['PENDING', 'RETRYABLE', 'PROCESSING', 'DEAD']).order('updated_at', { ascending: false }).limit(200),
    supabase.from('ops_issues').select('case_number,issue_number,canonical_status,status,related_entity_id,updated_at').eq('related_entity_type', 'job_queue').eq('environment', environment).order('updated_at', { ascending: false }).limit(1000),
  ])
  assertResults([incidents, providers, jobs, monitors, jobItems, jobCases], 'Reliability')
  const providerRows = Array.isArray(providers.data) ? providers.data as Array<Record<string, unknown>> : []
  const job = asRecord(jobs.data)
  const statusCounts = asRecord(job.statusCounts)
  const casesByJobId = new Map<string, Record<string, unknown>>()
  for (const issue of jobCases.data ?? []) {
    const jobId = String(issue.related_entity_id ?? '')
    if (jobId && !casesByJobId.has(jobId)) casesByJobId.set(jobId, issue)
  }
  return {
    incidents: (incidents.data ?? []).map((row) => ({ id: String(row.id), incidentKey: String(row.incident_key), title: String(row.title), summary: String(row.summary), severity: String(row.severity), status: String(row.status), affectedServices: Array.isArray(row.affected_services) ? row.affected_services.map(String) : [], publicVisible: row.public_visible === true, acknowledgementRequired: row.acknowledgement_required === true, source: String(row.source), sourceReference: text(row.source_reference), startedAt: String(row.started_at), resolvedAt: text(row.resolved_at), updatedAt: String(row.updated_at), lastObservedAt: text(row.last_observed_at), runbookUrl: text(row.runbook_url), correlationId: String(row.correlation_id), acknowledgedAt: text(row.acknowledged_at), snoozedUntil: text(row.snoozed_until), snoozeReason: text(row.snooze_reason) })),
    providers: providerRows.map((row) => ({ provider: text(row.provider) ?? 'UNKNOWN', operation: text(row.operation) ?? 'GENERAL', status: text(row.status) ?? 'UNKNOWN', failureCount: numberValue(row.failureCount), circuitOpenUntil: text(row.circuitOpenUntil), hasRecordedError: Boolean(text(row.lastError)), lastSuccessAt: text(row.lastSuccessAt), lastFailureAt: text(row.lastFailureAt), updatedAt: text(row.updatedAt) })),
    monitors: (monitors.data ?? []).map((row) => { const slack = asRecord(row.slack_delivery); return { id: String(row.id), monitorKey: String(row.monitor_key), targetId: String(row.target_id), targetName: String(row.target_name), healthy: row.healthy === true, severity: String(row.severity), httpStatus: numberValue(row.http_status), latencyMs: numberValue(row.latency_ms), detail: String(row.detail), checkedAt: String(row.checked_at), lastTransitionAt: String(row.last_transition_at), slackDeliveredAt: text(slack.deliveredAt) } }),
    jobs: { pending: numberValue(statusCounts.PENDING), retryable: numberValue(job.retryableCount), processing: numberValue(statusCounts.PROCESSING), dead: numberValue(job.deadCount), totalDead: numberValue(job.totalDeadCount), reviewedDead: numberValue(job.reviewedDeadCount), oldestPendingAt: text(job.oldestPendingAt), oldestProcessingAt: text(job.oldestProcessingAt) },
    jobItems: (jobItems.data ?? []).map((row) => { const issue = casesByJobId.get(String(row.id)); return { id: String(row.id), type: String(row.job_type), status: String(row.status), attempts: numberValue(row.attempt_count), maxAttempts: numberValue(row.max_attempts), runAt: String(row.run_at), createdAt: String(row.created_at), updatedAt: String(row.updated_at), linkedCaseNumber: issue ? displayCaseNumber(issue) : null, linkedCaseStatus: issue ? String(issue.canonical_status ?? issue.status) : null } }),
    observedAt: new Date().toISOString(),
  }
}

function isUuid(value: string | null) {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value))
}

async function customers(supabase: SupabaseClient) {
  const userResult = await supabase
    .from('users')
    .select('id,display_name,role,region_code,default_currency,phone_verified_at,created_at,updated_at')
    .eq('role', 'CUSTOMER')
    .order('updated_at', { ascending: false })
    .limit(300)
  assertResults([userResult], 'Customer operations')
  const rows = userResult.data ?? []
  const userIds = rows.map((row) => String(row.id))
  if (userIds.length === 0) return { customers: [], observedAt: new Date().toISOString(), coverageLimit: 300 }
  const [issues, deletions] = await Promise.all([
    supabase.from('ops_issues').select('id,user_id,severity,canonical_status,status,updated_at').in('user_id', userIds).order('updated_at', { ascending: false }).limit(1000),
    supabase.from('account_deletion_requests').select('id,user_id,status,requested_at').in('user_id', userIds).order('requested_at', { ascending: false }).limit(500),
  ])
  assertResults([issues, deletions], 'Customer operational state')
  const issueRows = issues.data ?? []
  const deletionRows = deletions.data ?? []
  return {
    customers: rows.map((row) => {
      const userId = String(row.id)
      const userIssues = issueRows.filter((issue) => String(issue.user_id) === userId)
      const openIssues = userIssues.filter((issue) => !['RESOLVED', 'CLOSED', 'CANCELLED'].includes(String(issue.canonical_status ?? issue.status)))
      const deletion = deletionRows.find((request) => String(request.user_id) === userId)
      return {
        id: userId,
        name: String(row.display_name ?? 'Customer'),
        role: String(row.role),
        region: text(row.region_code),
        currency: text(row.default_currency),
        phoneVerified: Boolean(row.phone_verified_at),
        openCaseCount: openIssues.length,
        highestOpenSeverity: openIssues.some((issue) => String(issue.severity) === 'CRITICAL') ? 'CRITICAL' : openIssues.some((issue) => String(issue.severity) === 'HIGH') ? 'HIGH' : openIssues.length ? 'MEDIUM' : null,
        deletionStatus: deletion ? String(deletion.status) : null,
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at),
      }
    }),
    observedAt: new Date().toISOString(),
    coverageLimit: 300,
  }
}

async function customerDetail(supabase: SupabaseClient, input: Record<string, unknown>) {
  const customerId = text(input.customerId)
  if (!isUuid(customerId)) throw new Error('The customer identifier is invalid.')
  const [user, profile, ordersResult, deletions, issues] = await Promise.all([
    supabase.from('users').select('id,email,display_name,role,region_code,default_currency,phone_verified_at,created_at,updated_at').eq('id', customerId as string).eq('role', 'CUSTOMER').maybeSingle(),
    supabase.from('customer_profiles').select('id,user_id,display_name,unit_preference,updated_at').eq('user_id', customerId as string).maybeSingle(),
    supabase.from('orders').select('id,reference,order_kind,item_title,garment_type,stage,stage_updated_at,total_amount,quoted_amount,currency,quoted_currency,delivery_method,created_at').eq('customer_id', customerId as string).order('stage_updated_at', { ascending: false }).limit(100),
    supabase.from('account_deletion_requests').select('id,status,reason,requested_at,acknowledged_at,processed_at,completed_at').eq('user_id', customerId as string).order('requested_at', { ascending: false }).limit(20),
    supabase.from('ops_issues').select('id,case_number,issue_number,issue_type,severity,canonical_status,status,title,recommended_action,updated_at').eq('user_id', customerId as string).order('updated_at', { ascending: false }).limit(100),
  ])
  assertResults([user, profile, ordersResult, deletions, issues], 'Customer record')
  if (!user.data) return null
  return {
    customer: {
      id: String(user.data.id),
      name: text(profile.data?.display_name) ?? String(user.data.display_name ?? 'Customer'),
      email: text(user.data.email),
      role: String(user.data.role),
      region: text(user.data.region_code),
      currency: text(user.data.default_currency),
      phoneVerified: Boolean(user.data.phone_verified_at),
      measurementProfilePresent: Boolean(profile.data?.id),
      measurementUnit: text(profile.data?.unit_preference),
      createdAt: String(user.data.created_at),
      updatedAt: String(user.data.updated_at),
    },
    orders: (ordersResult.data ?? []).map((row) => ({ id: String(row.id), reference: String(row.reference), kind: text(row.order_kind), item: text(row.item_title) ?? text(row.garment_type) ?? 'Order', stage: String(row.stage), stageUpdatedAt: String(row.stage_updated_at), amount: typeof row.total_amount === 'number' ? row.total_amount : typeof row.quoted_amount === 'number' ? row.quoted_amount : null, currency: text(row.quoted_currency) ?? text(row.currency), deliveryMethod: text(row.delivery_method), createdAt: String(row.created_at) })),
    deletions: (deletions.data ?? []).map((row) => ({ id: String(row.id), status: String(row.status), reason: text(row.reason), requestedAt: String(row.requested_at), acknowledgedAt: text(row.acknowledged_at), processedAt: text(row.processed_at), completedAt: text(row.completed_at) })),
    cases: (issues.data ?? []).map((row) => ({ id: String(row.id), caseNumber: displayCaseNumber(row), type: String(row.issue_type), severity: String(row.severity), status: String(row.canonical_status ?? row.status), title: String(row.title), recommendedAction: String(row.recommended_action), updatedAt: String(row.updated_at) })),
    observedAt: new Date().toISOString(),
  }
}

async function tailorDetail(supabase: SupabaseClient, input: Record<string, unknown>) {
  const tailorProfileId = text(input.tailorProfileId)
  if (!isUuid(tailorProfileId)) throw new Error('The tailor identifier is invalid.')
  const profile = await supabase.from('tailor_profiles').select('id,user_id,display_name,business_name,bio,location,languages,specialty_tags,price_range_min,price_range_max,currency,id_verification_status,payout_account_verified,payout_reverification_required,payout_provider,payout_currency,is_live,profile_completed,availability,shop_paused,total_orders,avg_rating,created_at,updated_at').eq('id', tailorProfileId as string).maybeSingle()
  assertResults([profile], 'Tailor record')
  if (!profile.data) return null
  const userId = String(profile.data.user_id)
  const [user, items, ordersResult, issues] = await Promise.all([
    supabase.from('users').select('id,email,display_name,role,region_code,created_at,updated_at').eq('id', userId).maybeSingle(),
    supabase.from('seller_items').select('id,title,category,is_live,stock_status,updated_at').eq('tailor_profile_id', tailorProfileId as string).order('updated_at', { ascending: false }).limit(100),
    supabase.from('orders').select('id,reference,order_kind,item_title,garment_type,stage,stage_updated_at,total_amount,quoted_amount,currency,quoted_currency,delivery_method,created_at').eq('tailor_id', userId).order('stage_updated_at', { ascending: false }).limit(100),
    supabase.from('ops_issues').select('id,case_number,issue_number,issue_type,severity,canonical_status,status,title,recommended_action,updated_at').or(`tailor_profile_id.eq.${tailorProfileId},user_id.eq.${userId}`).order('updated_at', { ascending: false }).limit(100),
  ])
  assertResults([user, items, ordersResult, issues], 'Tailor operational state')
  return {
    tailor: {
      id: String(profile.data.id), userId, name: text(profile.data.business_name) ?? text(profile.data.display_name) ?? 'Tailor', email: text(user.data?.email), accountMode: text(user.data?.role) ?? 'CUSTOMER', bio: text(profile.data.bio), location: text(profile.data.location), region: text(user.data?.region_code), languages: Array.isArray(profile.data.languages) ? profile.data.languages.map(String) : [], specialties: Array.isArray(profile.data.specialty_tags) ? profile.data.specialty_tags.map(String) : [], priceMin: typeof profile.data.price_range_min === 'number' ? profile.data.price_range_min : null, priceMax: typeof profile.data.price_range_max === 'number' ? profile.data.price_range_max : null, currency: text(profile.data.currency), trustStatus: String(profile.data.id_verification_status ?? 'NOT_SUBMITTED'), payoutReady: Boolean(profile.data.payout_account_verified) && !Boolean(profile.data.payout_reverification_required), payoutProvider: text(profile.data.payout_provider), payoutCurrency: text(profile.data.payout_currency), live: Boolean(profile.data.is_live), profileComplete: Boolean(profile.data.profile_completed), availability: text(profile.data.availability), shopPaused: Boolean(profile.data.shop_paused), totalOrders: Number(profile.data.total_orders ?? 0), rating: typeof profile.data.avg_rating === 'number' ? profile.data.avg_rating : null, createdAt: String(profile.data.created_at), updatedAt: String(profile.data.updated_at),
    },
    items: (items.data ?? []).map((row) => ({ id: String(row.id), title: String(row.title), category: text(row.category), live: Boolean(row.is_live), stockStatus: text(row.stock_status), updatedAt: String(row.updated_at) })),
    orders: (ordersResult.data ?? []).map((row) => ({ id: String(row.id), reference: String(row.reference), kind: text(row.order_kind), item: text(row.item_title) ?? text(row.garment_type) ?? 'Order', stage: String(row.stage), stageUpdatedAt: String(row.stage_updated_at), amount: typeof row.total_amount === 'number' ? row.total_amount : typeof row.quoted_amount === 'number' ? row.quoted_amount : null, currency: text(row.quoted_currency) ?? text(row.currency), deliveryMethod: text(row.delivery_method), createdAt: String(row.created_at) })),
    cases: (issues.data ?? []).map((row) => ({ id: String(row.id), caseNumber: displayCaseNumber(row), type: String(row.issue_type), severity: String(row.severity), status: String(row.canonical_status ?? row.status), title: String(row.title), recommendedAction: String(row.recommended_action), updatedAt: String(row.updated_at) })),
    observedAt: new Date().toISOString(),
  }
}

async function tailors(supabase: SupabaseClient) {
  const [profiles, applications, items] = await Promise.all([
    supabase.from('tailor_profiles').select('id,user_id,display_name,business_name,location,id_verification_status,payout_account_verified,payout_reverification_required,is_live,profile_completed,availability,shop_paused,total_orders,avg_rating,updated_at').order('updated_at', { ascending: false }).limit(200),
    supabase.from('tailor_applications').select('id,business_name,display_name,status,source,created_at').order('created_at', { ascending: false }).limit(100),
    supabase.from('seller_items').select('id,tailor_profile_id,is_live,stock_status').limit(1000),
  ])
  assertResults([profiles, applications, items], 'Tailor Network')
  const sellerItems = items.data ?? []
  return { profiles: (profiles.data ?? []).map((row) => ({ id: String(row.id), name: text(row.business_name) ?? text(row.display_name) ?? 'Tailor profile', location: text(row.location), trust: String(row.id_verification_status ?? 'NOT_SUBMITTED'), payoutReady: Boolean(row.payout_account_verified) && !Boolean(row.payout_reverification_required), live: Boolean(row.is_live), profileComplete: Boolean(row.profile_completed), availability: text(row.availability), shopPaused: Boolean(row.shop_paused), totalOrders: Number(row.total_orders ?? 0), rating: typeof row.avg_rating === 'number' ? row.avg_rating : null, itemCount: sellerItems.filter((item) => String(item.tailor_profile_id) === String(row.id)).length, liveItemCount: sellerItems.filter((item) => String(item.tailor_profile_id) === String(row.id) && item.is_live && !['SOLD_OUT', 'HIDDEN'].includes(String(item.stock_status))).length, updatedAt: String(row.updated_at) })), applications: (applications.data ?? []).map((row) => ({ id: String(row.id), name: text(row.business_name) ?? text(row.display_name) ?? 'Tailor application', status: String(row.status), source: text(row.source), createdAt: String(row.created_at) })), observedAt: new Date().toISOString() }
}

async function vision(supabase: SupabaseClient) {
  const [scans, logs, issues] = await Promise.all([
    supabase.from('measurement_scans').select('id,user_id,capture_method,capture_version,status,confidence_overall,requires_tailor_review,created_at,updated_at').order('created_at', { ascending: false }).limit(300),
    supabase.from('drape_vision_scan_logs').select('id,user_id,session_id,mode,event_type,capture_version,capture_count,frame_sample_count,created_at').order('created_at', { ascending: false }).limit(500),
    supabase.from('ops_issues').select('id,case_number,issue_number,title,severity,canonical_status,status,recommended_action,related_entity_id,updated_at').or('issue_type.ilike.%VISION%,issue_type.ilike.%MEASUREMENT%').order('updated_at', { ascending: false }).limit(100),
  ])
  assertResults([scans, logs, issues], 'Measurements & Vision')
  return { scans: (scans.data ?? []).map((row) => ({ id: String(row.id), captureMethod: String(row.capture_method), version: String(row.capture_version), status: String(row.status), confidence: text(row.confidence_overall), requiresReview: Boolean(row.requires_tailor_review), createdAt: String(row.created_at), updatedAt: String(row.updated_at) })), sessions: (logs.data ?? []).map((row) => ({ id: String(row.id), sessionId: String(row.session_id), mode: String(row.mode), eventType: String(row.event_type), version: String(row.capture_version), captureCount: Number(row.capture_count), frameCount: Number(row.frame_sample_count), createdAt: String(row.created_at) })), issues: (issues.data ?? []).map((row) => ({ id: String(row.id), caseNumber: text(row.case_number) ?? `OPS-${String(Number(row.issue_number ?? 0)).padStart(6, '0')}`, title: String(row.title), severity: String(row.severity), status: String(row.canonical_status ?? row.status), recommendedAction: String(row.recommended_action), updatedAt: String(row.updated_at) })), observedAt: new Date().toISOString() }
}

async function delivery(supabase: SupabaseClient) {
  const [runs, parcels, events] = await Promise.all([
    supabase.from('order_fulfillment_runs').select('id,order_id,method,status,funding_status,currency,captured_allowance_amount,shortfall_total_amount,unused_allowance_amount,customer_refund_status,provider_name,booked_at,delivered_at,correlation_id,updated_at').order('updated_at', { ascending: false }).limit(200),
    supabase.from('order_fulfillment_parcels').select('id,run_id,order_id,status,provider_name,service_level,provider_reference,tracking_number,eta_at,last_status_at,updated_at').order('updated_at', { ascending: false }).limit(400),
    supabase.from('order_fulfillment_events').select('id,run_id,order_id,event_type,source,occurred_at,correlation_id').order('occurred_at', { ascending: false }).limit(500),
  ])
  assertResults([runs, parcels, events], 'Delivery & Supply')
  const parcelRows = parcels.data ?? []; const eventRows = events.data ?? []
  return { runs: (runs.data ?? []).map((row) => ({ id: String(row.id), orderId: String(row.order_id), method: String(row.method), status: String(row.status), fundingStatus: String(row.funding_status), currency: String(row.currency), capturedAllowanceAmount: Number(row.captured_allowance_amount), shortfallAmount: Number(row.shortfall_total_amount), unusedAllowanceAmount: Number(row.unused_allowance_amount), refundStatus: String(row.customer_refund_status), provider: text(row.provider_name), parcelCount: parcelRows.filter((parcel) => String(parcel.run_id) === String(row.id)).length, lastEvent: eventRows.find((event) => String(event.run_id) === String(row.id)) ? String(eventRows.find((event) => String(event.run_id) === String(row.id))?.event_type) : null, bookedAt: text(row.booked_at), deliveredAt: text(row.delivered_at), correlationId: String(row.correlation_id), updatedAt: String(row.updated_at) })), parcels: parcelRows.map((row) => ({ id: String(row.id), runId: String(row.run_id), orderId: String(row.order_id), status: String(row.status), provider: text(row.provider_name), serviceLevel: text(row.service_level), reference: text(row.provider_reference), trackingNumber: text(row.tracking_number), etaAt: text(row.eta_at), lastStatusAt: text(row.last_status_at), updatedAt: String(row.updated_at) })), observedAt: new Date().toISOString() }
}

async function communications(supabase: SupabaseClient) {
  const [campaigns, recipients, providerEvents, jobs, jobCases] = await Promise.all([
    supabase.from('communication_campaigns').select('id,name,kind,category,purpose,severity,status,risk_level,scheduled_at,expires_at,correlation_id,created_at,updated_at').order('created_at', { ascending: false }).limit(100),
    supabase.from('communication_campaign_recipients').select('campaign_id,status,updated_at').order('updated_at', { ascending: false }).limit(2000),
    supabase.from('communication_provider_events').select('id,provider,channel,signature_verified,status,attempts,next_attempt_at,processed_at,correlation_id,received_at').order('received_at', { ascending: false }).limit(300),
    supabase.from('job_queue').select('id,job_type,status,attempt_count,max_attempts,run_at,created_at,updated_at').or('job_type.ilike.%EMAIL%,job_type.ilike.%PUSH%,job_type.ilike.%SMS%,job_type.ilike.%COMMUNICATION%').order('created_at', { ascending: false }).limit(300),
    supabase.from('ops_issues').select('case_number,issue_number,canonical_status,status,related_entity_id,updated_at').eq('related_entity_type', 'job_queue').order('updated_at', { ascending: false }).limit(1000),
  ])
  assertResults([campaigns, recipients, providerEvents, jobs, jobCases], 'Communications')
  const recipientRows = recipients.data ?? []
  const casesByJobId = new Map<string, Record<string, unknown>>()
  for (const issue of jobCases.data ?? []) { const jobId = String(issue.related_entity_id ?? ''); if (jobId && !casesByJobId.has(jobId)) casesByJobId.set(jobId, issue) }
  return { campaigns: (campaigns.data ?? []).map((row) => { const audience = recipientRows.filter((recipient) => String(recipient.campaign_id) === String(row.id)); return { id: String(row.id), name: String(row.name), kind: String(row.kind), category: String(row.category), purpose: String(row.purpose), severity: String(row.severity), status: String(row.status), riskLevel: String(row.risk_level), scheduledAt: text(row.scheduled_at), expiresAt: text(row.expires_at), correlationId: String(row.correlation_id), createdAt: String(row.created_at), updatedAt: String(row.updated_at), recipients: audience.length, delivered: audience.filter((entry) => String(entry.status) === 'DELIVERED').length, failed: audience.filter((entry) => ['FAILED', 'DEAD'].includes(String(entry.status))).length } }), providerEvents: (providerEvents.data ?? []).map((row) => ({ id: String(row.id), provider: String(row.provider), channel: String(row.channel), signatureVerified: Boolean(row.signature_verified), status: String(row.status), attempts: Number(row.attempts), nextAttemptAt: text(row.next_attempt_at), processedAt: text(row.processed_at), correlationId: String(row.correlation_id), receivedAt: String(row.received_at) })), jobs: (jobs.data ?? []).map((row) => { const issue = casesByJobId.get(String(row.id)); return { id: String(row.id), type: String(row.job_type), status: String(row.status), attempts: Number(row.attempt_count), maxAttempts: Number(row.max_attempts), runAt: String(row.run_at), createdAt: String(row.created_at), updatedAt: String(row.updated_at), linkedCaseNumber: issue ? displayCaseNumber(issue) : null, linkedCaseStatus: issue ? String(issue.canonical_status ?? issue.status) : null } }), observedAt: new Date().toISOString() }
}

async function accessGovernance(supabase: SupabaseClient, environment: string) {
  const [principalResult, issueResult] = await Promise.all([
    supabase.from('ops_workforce_principals').select('id,email,status,roles,permitted_environments,session_revoked_before,access_review_due_at,last_seen_at,created_at,updated_at').order('email').limit(200),
    supabase.from('ops_issues').select('id,case_number,issue_number,related_entity_id,canonical_status,record_version,updated_at').eq('related_entity_type', 'workforce_principal').eq('environment', environment).order('updated_at', { ascending: false }).limit(300),
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

async function auditReport(supabase: SupabaseClient, environment: string) {
  const [receipts, events, audits, exportRequests] = await Promise.all([
    supabase.from('ops_action_receipts').select('id,issue_id,action_key,outcome,human_status,correlation_id,persisted_at,completed_at,side_effects,blockers,failure_code').order('persisted_at', { ascending: false }).limit(300),
    supabase.from('ops_case_events').select('id,issue_id,event_type,actor_label,from_status,to_status,summary,correlation_id,occurred_at').order('occurred_at', { ascending: false }).limit(300),
    supabase.from('ops_audit_logs').select('id,issue_id,action_taken,performed_by,performed_role,reason,created_at').order('created_at', { ascending: false }).limit(300),
    supabase.from('ops_export_requests').select('id,reference,dataset,status,reason,filters,row_limit,row_count,requester_email,source_watermark,content_sha256,failure_code,download_count,requested_at,completed_at,expires_at,last_downloaded_at').eq('environment', environment).order('requested_at', { ascending: false }).limit(100),
  ])
  assertResults([receipts, events, audits, exportRequests], 'Reports & Audit')
  return { receipts: receipts.data ?? [], events: events.data ?? [], audits: audits.data ?? [], exportRequests: exportRequests.data ?? [], observedAt: new Date().toISOString() }
}

const TERMINAL_ORDER_STAGES = new Set(['COMPLETE', 'CANCELLED', 'DECLINED', 'REFUNDED', 'PARTIALLY_REFUNDED', 'EXPIRED'])
const CUSTOMER_ORDER_STAGES = new Set(['QUOTE_SENT', 'PAYMENT_PENDING', 'AWAITING_CUSTOMER_CONFIRMATION', 'DELIVERED', 'READY_FOR_COLLECTION'])
const OPS_ORDER_STAGES = new Set(['READY_FOR_DRAPE_DISPATCH', 'OUT_FOR_DELIVERY', 'SHIPPED', 'IN_DISPUTE'])

function orderNextStep(stage: string) {
  if (TERMINAL_ORDER_STAGES.has(stage)) return { nextOwner: 'Closed', nextAction: 'No lifecycle action is available.' }
  if (CUSTOMER_ORDER_STAGES.has(stage)) return { nextOwner: 'Customer', nextAction: stage === 'PAYMENT_PENDING' ? 'Complete payment.' : stage === 'DELIVERED' ? 'Confirm receipt or raise a concern.' : 'Review and respond.' }
  if (OPS_ORDER_STAGES.has(stage)) return { nextOwner: 'Drapeon Ops', nextAction: stage === 'IN_DISPUTE' ? 'Review the linked case and evidence.' : 'Verify the handoff or dispatch state.' }
  return { nextOwner: 'Tailor', nextAction: stage === 'PENDING_QUOTE' ? 'Review the brief and quote or request consultation.' : 'Complete the current production step.' }
}

function displayCaseNumber(row: Record<string, unknown>) {
  return text(row.case_number) ?? `OPS-${String(Number(row.issue_number ?? 0)).padStart(6, '0')}`
}

async function orders(supabase: SupabaseClient) {
  const orderResult = await supabase.from('orders').select('id,reference,order_kind,garment_type,item_title,stage,stage_updated_at,created_at,quoted_amount,total_amount,currency,quoted_currency,delivery_method,customer_id,tailor_id').order('stage_updated_at', { ascending: false }).limit(200)
  assertResults([orderResult], 'Order lifecycle')
  const rows = orderResult.data ?? []
  const ids = rows.map((row) => String(row.id))
  if (ids.length === 0) return { orders: [], observedAt: new Date().toISOString() }
  const [payments, issues, requests, fulfillments, settlements] = await Promise.all([
    supabase.from('order_payments').select('order_id,phase,status,created_at').in('order_id', ids).order('created_at', { ascending: false }).limit(600),
    supabase.from('ops_issues').select('order_id,status').in('order_id', ids).in('status', ['OPEN', 'IN_REVIEW', 'ESCALATED']).limit(600),
    supabase.from('money_desk_requests').select('order_id,status,created_at').in('order_id', ids).order('created_at', { ascending: false }).limit(600),
    supabase.from('order_fulfillment_runs').select('order_id,status').in('order_id', ids).limit(300),
    supabase.from('order_settlement_plans').select('order_id,status').in('order_id', ids).limit(300),
  ])
  assertResults([payments, issues, requests, fulfillments, settlements], 'Order operational context')
  const paymentRows = payments.data ?? []; const issueRows = issues.data ?? []; const requestRows = requests.data ?? []
  const fulfillmentMap = new Map((fulfillments.data ?? []).map((row) => [String(row.order_id), String(row.status)]))
  const settlementMap = new Map((settlements.data ?? []).map((row) => [String(row.order_id), String(row.status)]))
  return { orders: rows.map((row) => { const id = String(row.id); const latestPayment = paymentRows.find((entry) => String(entry.order_id) === id); const latestMoney = requestRows.find((entry) => String(entry.order_id) === id); const stage = String(row.stage); return { id, reference: String(row.reference), kind: text(row.order_kind) ?? 'CUSTOM', item: text(row.item_title) ?? text(row.garment_type) ?? 'Order', stage, stageUpdatedAt: String(row.stage_updated_at), createdAt: String(row.created_at), amount: typeof row.total_amount === 'number' ? row.total_amount : typeof row.quoted_amount === 'number' ? row.quoted_amount : null, currency: text(row.quoted_currency) ?? text(row.currency), deliveryMethod: text(row.delivery_method), customerId: String(row.customer_id), tailorId: text(row.tailor_id), paymentStatus: latestPayment ? String(latestPayment.status) : null, paymentPhase: latestPayment ? String(latestPayment.phase) : null, openCaseCount: issueRows.filter((entry) => String(entry.order_id) === id).length, moneyStatus: latestMoney ? String(latestMoney.status) : null, fulfillmentStatus: fulfillmentMap.get(id) ?? null, settlementStatus: settlementMap.get(id) ?? null, ...orderNextStep(stage) } }), observedAt: new Date().toISOString() }
}

async function orderDetail(supabase: SupabaseClient, input: Record<string, unknown>) {
  const orderId = text(input.orderId)
  if (!orderId || !/^[0-9a-f-]{36}$/iu.test(orderId)) throw new Error('The order identifier is invalid.')
  const orderResult = await supabase.from('orders').select('id,reference,order_kind,garment_type,item_title,description,stage,stage_updated_at,created_at,quoted_amount,total_amount,currency,quoted_currency,delivery_method,customer_id,tailor_id,deadline,occasion,fabric_source,escrow_released,escrow_released_at,handoff_completed_at,customer_handoff_confirmed_at,tracking_number,carrier').eq('id', orderId).maybeSingle()
  assertResults([orderResult], 'Order detail')
  const row = orderResult.data
  if (!row) return null
  const id = String(row.id)
  const [stages, events, payments, fulfillmentEvents, tranches, cases, moneyRequests] = await Promise.all([
    supabase.from('order_stage_updates').select('id,stage,note,created_at').eq('order_id', id).order('created_at', { ascending: false }).limit(100),
    supabase.from('order_events').select('id,event_type,title,summary,actor_role,created_at').eq('order_id', id).order('created_at', { ascending: false }).limit(100),
    supabase.from('order_payments').select('id,phase,provider,amount,currency,status,refunded_amount,created_at,confirmed_at').eq('order_id', id).order('created_at', { ascending: false }).limit(100),
    supabase.from('order_fulfillment_events').select('id,event_type,source,customer_note,occurred_at').eq('order_id', id).order('occurred_at', { ascending: false }).limit(100),
    supabase.from('order_settlement_tranches').select('id,code,amount,currency,status,eligible_at,released_at,blocked_reason,correlation_id').eq('order_id', id).order('sequence'),
    supabase.from('ops_issues').select('id,case_number,issue_number,issue_type,severity,status,canonical_status,title,recommended_action,updated_at').eq('order_id', id).order('updated_at', { ascending: false }).limit(100),
    supabase.from('money_desk_requests').select('id,reference,action_type,status,amount,currency,correlation_id,created_at').eq('order_id', id).order('created_at', { ascending: false }).limit(100),
  ])
  assertResults([stages, events, payments, fulfillmentEvents, tranches, cases, moneyRequests], 'Order evidence')
  const customerId = String(row.customer_id); const tailorId = text(row.tailor_id)
  const [customer, tailor] = await Promise.all([
    supabase.from('customer_profiles').select('display_name').eq('user_id', customerId).maybeSingle(),
    tailorId ? supabase.from('tailor_profiles').select('display_name,business_name').eq('user_id', tailorId).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ])
  assertResults([customer, tailor], 'Order participant labels')
  const paymentRows = payments.data ?? []; const latestPayment = paymentRows[0]; const moneyRows = moneyRequests.data ?? []; const caseRows = cases.data ?? []; const fulfillmentRows = fulfillmentEvents.data ?? []; const trancheRows = tranches.data ?? []; const stage = String(row.stage)
  const timeline = [
    ...(stages.data ?? []).map((entry) => ({ id: String(entry.id), type: String(entry.stage), title: `Stage · ${String(entry.stage)}`, summary: text(entry.note), actor: 'Order lifecycle', occurredAt: String(entry.created_at), source: 'stage' })),
    ...(events.data ?? []).map((entry) => ({ id: String(entry.id), type: String(entry.event_type), title: String(entry.title), summary: text(entry.summary), actor: String(entry.actor_role), occurredAt: String(entry.created_at), source: 'order' })),
    ...fulfillmentRows.map((entry) => ({ id: String(entry.id), type: String(entry.event_type), title: `Fulfilment · ${String(entry.event_type)}`, summary: text(entry.customer_note), actor: String(entry.source), occurredAt: String(entry.occurred_at), source: 'fulfillment' })),
  ].sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt))
  return {
    order: { id, reference: String(row.reference), kind: text(row.order_kind) ?? 'CUSTOM', item: text(row.item_title) ?? text(row.garment_type) ?? 'Order', stage, stageUpdatedAt: String(row.stage_updated_at), createdAt: String(row.created_at), amount: typeof row.total_amount === 'number' ? row.total_amount : typeof row.quoted_amount === 'number' ? row.quoted_amount : null, currency: text(row.quoted_currency) ?? text(row.currency), deliveryMethod: text(row.delivery_method), customerId, tailorId, paymentStatus: latestPayment ? String(latestPayment.status) : null, paymentPhase: latestPayment ? String(latestPayment.phase) : null, openCaseCount: caseRows.filter((entry) => !['RESOLVED', 'CLOSED', 'CANCELLED'].includes(String(entry.canonical_status ?? entry.status))).length, moneyStatus: moneyRows[0] ? String(moneyRows[0].status) : null, fulfillmentStatus: fulfillmentRows[0] ? String(fulfillmentRows[0].event_type) : null, settlementStatus: trancheRows.some((entry) => String(entry.status) === 'BLOCKED') ? 'BLOCKED' : trancheRows.some((entry) => String(entry.status) === 'ELIGIBLE') ? 'ELIGIBLE' : null, ...orderNextStep(stage), description: text(row.description), deadline: text(row.deadline), occasion: text(row.occasion), fabricSource: text(row.fabric_source), escrowReleased: Boolean(row.escrow_released), escrowReleasedAt: text(row.escrow_released_at), handoffCompletedAt: text(row.handoff_completed_at), customerHandoffConfirmedAt: text(row.customer_handoff_confirmed_at), trackingNumber: text(row.tracking_number), carrier: text(row.carrier), customerName: text(customer.data?.display_name), tailorName: text(tailor.data?.business_name) ?? text(tailor.data?.display_name) },
    timeline,
    payments: paymentRows.map((entry) => ({ id: String(entry.id), phase: String(entry.phase), provider: text(entry.provider), amount: Number(entry.amount), currency: String(entry.currency), status: String(entry.status), refundedAmount: Number(entry.refunded_amount ?? 0), createdAt: String(entry.created_at), confirmedAt: text(entry.confirmed_at) })),
    tranches: trancheRows.map((entry) => ({ id: String(entry.id), code: String(entry.code), amount: Number(entry.amount), currency: String(entry.currency), status: String(entry.status), eligibleAt: text(entry.eligible_at), releasedAt: text(entry.released_at), blockedReason: text(entry.blocked_reason), correlationId: String(entry.correlation_id) })),
    cases: caseRows.map((entry) => ({ id: String(entry.id), caseNumber: displayCaseNumber(entry), type: String(entry.issue_type), severity: String(entry.severity), status: String(entry.canonical_status ?? entry.status), title: String(entry.title), recommendedAction: String(entry.recommended_action), updatedAt: String(entry.updated_at) })),
    moneyRequests: moneyRows.map((entry) => ({ id: String(entry.id), reference: String(entry.reference), actionType: String(entry.action_type), status: String(entry.status), amount: typeof entry.amount === 'number' ? entry.amount : null, currency: text(entry.currency), correlationId: String(entry.correlation_id), createdAt: String(entry.created_at) })),
    observedAt: new Date().toISOString(),
  }
}

export async function runOpsReadProjection(supabase: SupabaseClient, action: OpsReadAction, environment: string, input: Record<string, unknown>, principal: ProjectionPrincipal) {
  switch (action) {
    case 'trust-case': return trustCase(supabase, input)
    case 'support-case': return supportCase(supabase, input)
    case 'money': return money(supabase)
    case 'money-grant': return activeMoneyGrant(supabase, input, principal)
    case 'reliability': return reliability(supabase, environment)
    case 'customers': return customers(supabase)
    case 'customer-detail': return customerDetail(supabase, input)
    case 'tailors': return tailors(supabase)
    case 'tailor-detail': return tailorDetail(supabase, input)
    case 'vision': return vision(supabase)
    case 'delivery': return delivery(supabase)
    case 'communications': return communications(supabase)
    case 'access-governance': return accessGovernance(supabase, environment)
    case 'audit-report': return auditReport(supabase, environment)
    case 'orders': return orders(supabase)
    case 'order-detail': return orderDetail(supabase, input)
    default: throw new Error(`The ${action} projection has not been installed.`)
  }
}
