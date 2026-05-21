import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

export type JobType =
  | 'SEND_PUSH'
  | 'SEND_SMS'
  | 'SEND_ORDER_EVENT_EMAIL'
  | 'SEND_ORDER_CONFIRMATION_EMAILS'
  | 'CREATE_OPS_ISSUE'

export type JobRow = {
  id: string
  event_id: string | null
  job_type: JobType | string
  status: string
  priority: number
  run_at: string
  attempt_count: number
  max_attempts: number
  locked_at: string | null
  locked_by: string | null
  completed_at: string | null
  last_error: string | null
  dedupe_key: string | null
  payload: Record<string, unknown>
  created_at: string
  updated_at: string
}

export type EnqueueDomainEventInput = {
  eventType: string
  aggregateType: string
  idempotencyKey: string
  payload?: Record<string, unknown>
  aggregateId?: string | null
  actorId?: string | null
  actorRole?: string | null
  orderId?: string | null
  metadata?: Record<string, unknown>
  jobs?: JobType[]
  priority?: number
  maxAttempts?: number
  runAt?: string | null
}

export function createWorkerId(prefix = 'edge-worker') {
  return `${prefix}-${crypto.randomUUID()}`
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

export function asString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

export async function enqueueDomainEvent(
  supabase: SupabaseClient,
  input: EnqueueDomainEventInput,
) {
  const { data, error } = await supabase.rpc('enqueue_domain_event', {
    p_event_type: input.eventType,
    p_aggregate_type: input.aggregateType,
    p_idempotency_key: input.idempotencyKey,
    p_payload: input.payload ?? {},
    p_aggregate_id: input.aggregateId ?? null,
    p_actor_id: input.actorId ?? null,
    p_actor_role: input.actorRole ?? null,
    p_order_id: input.orderId ?? null,
    p_metadata: input.metadata ?? {},
    p_jobs: input.jobs ?? [],
    p_priority: input.priority ?? 100,
    p_max_attempts: input.maxAttempts ?? 5,
    p_run_at: input.runAt ?? new Date().toISOString(),
  })

  if (error) throw new Error(error.message)
  return data as string
}

export async function enqueueBackgroundJob(
  supabase: SupabaseClient,
  input: Omit<EnqueueDomainEventInput, 'jobs'> & { jobType: JobType },
) {
  return await enqueueDomainEvent(supabase, {
    ...input,
    jobs: [input.jobType],
  })
}

export async function claimDueJobs(
  supabase: SupabaseClient,
  workerId: string,
  limit = 10,
  jobTypes?: string[] | null,
) {
  const { data, error } = await supabase.rpc('claim_due_jobs', {
    p_worker_id: workerId,
    p_limit: limit,
    p_job_types: jobTypes && jobTypes.length > 0 ? jobTypes : null,
  })

  if (error) throw new Error(error.message)
  return (Array.isArray(data) ? data : []) as JobRow[]
}

export async function finishJob(
  supabase: SupabaseClient,
  input: {
    jobId: string
    workerId: string
    succeeded: boolean
    error?: string | null
    retryDelaySeconds?: number | null
    durationMs?: number | null
  },
) {
  const { error } = await supabase.rpc('finish_job', {
    p_job_id: input.jobId,
    p_worker_id: input.workerId,
    p_succeeded: input.succeeded,
    p_error: input.error ?? null,
    p_retry_delay_seconds: input.retryDelaySeconds ?? null,
    p_duration_ms: input.durationMs ?? null,
  })

  if (error) throw new Error(error.message)
}
