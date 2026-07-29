import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getDailyApiKey } from './env.ts'
import { audit, log } from './logger.ts'
import {
  createOrRefreshOpsIssue,
  resolveOpsIssueByDedupeKey,
} from './ops-issues.ts'
import { getProviderCircuit, recordProviderHealth } from './provider-health.ts'
import { Sentry } from './sentry.ts'

const DAILY_CREATE_ROOM_OPERATION = 'CREATE_ROOM'
const DAILY_ISSUE_DEDUPE_KEY = 'provider:daily:create-room'
const DAILY_TIMEOUT_MS = 10_000

export type DailyRoomFailureReason =
  | 'DAILY_NOT_CONFIGURED'
  | 'DAILY_UNAVAILABLE'

type DailyRoomInput = {
  supabase: SupabaseClient
  functionName: string
  orderId: string
  actorId: string
  actorRole: string
  stage?: string | null
  callKind: 'CONSULTATION' | 'READY_MADE'
  roomName: string
  expiresAt: number
  audioOnly: boolean
}

type DailyRoomResult =
  | { ok: true; url: string }
  | { ok: false; reason: DailyRoomFailureReason }

type DailyFailureContext = {
  input: DailyRoomInput
  reason: DailyRoomFailureReason
  providerStatus?: number | null
  latencyMs: number
  circuitStatus?: string | null
}

async function reportDailyFailure({
  input,
  reason,
  providerStatus = null,
  latencyMs,
  circuitStatus = null,
}: DailyFailureContext) {
  const safeMetadata = {
    provider: 'DAILY',
    operation: DAILY_CREATE_ROOM_OPERATION,
    callKind: input.callKind,
    reason,
    providerStatus,
    circuitStatus,
    latencyMs,
  }

  log('error', input.functionName, 'daily.room_creation_failed', {
    order_id: input.orderId,
    actor_id: input.actorId,
    stage: input.stage ?? null,
    ...safeMetadata,
  })

  await Promise.allSettled([
    recordProviderHealth(input.supabase, {
      provider: 'DAILY',
      operation: DAILY_CREATE_ROOM_OPERATION,
      succeeded: false,
      error: reason,
      openAfterFailures: 3,
      openSeconds: 300,
      metadata: safeMetadata,
    }),
    audit(input.supabase, {
      event: 'provider.daily_room_failed',
      actor_id: input.actorId,
      actor_role: input.actorRole,
      order_id: input.orderId,
      severity: 'error',
      payload: {
        function: input.functionName,
        ...safeMetadata,
      },
    }),
    Sentry.captureMessage('Daily room creation failed', {
      level: 'error',
      tags: {
        function: input.functionName,
        provider: 'DAILY',
        operation: DAILY_CREATE_ROOM_OPERATION,
        reason,
        callKind: input.callKind,
      },
      extra: {
        orderId: input.orderId,
        actorId: input.actorId,
        stage: input.stage ?? null,
        providerStatus,
        circuitStatus,
        latencyMs,
      },
    }),
    createOrRefreshOpsIssue(input.supabase, {
      issueType: 'SYSTEM_ALERT',
      severity: reason === 'DAILY_NOT_CONFIGURED' ? 'CRITICAL' : 'HIGH',
      source: input.functionName,
      actorId: input.actorId,
      actorRole: input.actorRole,
      orderId: input.orderId,
      provider: 'DAILY',
      stage: input.stage ?? null,
      relatedEntityType: 'ORDER',
      relatedEntityId: input.orderId,
      title: 'Daily calling is unavailable',
      description: 'Drapeon could not create a Daily call room and moved the participants to the protected message fallback.',
      recommendedAction: 'Check the Daily provider dashboard, API credentials, circuit status, and recent provider logs before retrying.',
      dedupeKey: DAILY_ISSUE_DEDUPE_KEY,
      metadata: safeMetadata,
      notifyOps: true,
    }),
  ])
}

export async function createDailyRoomWithObservability(
  input: DailyRoomInput,
): Promise<DailyRoomResult> {
  const startedAt = Date.now()
  const circuit = await getProviderCircuit(
    input.supabase,
    'DAILY',
    DAILY_CREATE_ROOM_OPERATION,
  )

  if (circuit.open) {
    await reportDailyFailure({
      input,
      reason: 'DAILY_UNAVAILABLE',
      latencyMs: Date.now() - startedAt,
      circuitStatus: circuit.status,
    })
    return { ok: false, reason: 'DAILY_UNAVAILABLE' }
  }

  let dailyApiKey = ''
  try {
    dailyApiKey = getDailyApiKey()
  } catch {
    await reportDailyFailure({
      input,
      reason: 'DAILY_NOT_CONFIGURED',
      latencyMs: Date.now() - startedAt,
      circuitStatus: circuit.status,
    })
    return { ok: false, reason: 'DAILY_NOT_CONFIGURED' }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), DAILY_TIMEOUT_MS)

  try {
    const response = await fetch('https://api.daily.co/v1/rooms', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${dailyApiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'drapeon-edge-calling/1.0',
      },
      body: JSON.stringify({
        name: input.roomName,
        properties: {
          exp: input.expiresAt,
          max_participants: 2,
          enable_chat: true,
          enable_screenshare: false,
          start_video_off: input.audioOnly,
          start_audio_off: false,
        },
      }),
    })

    const latencyMs = Date.now() - startedAt
    if (!response.ok) {
      await reportDailyFailure({
        input,
        reason: 'DAILY_UNAVAILABLE',
        providerStatus: response.status,
        latencyMs,
        circuitStatus: circuit.status,
      })
      return { ok: false, reason: 'DAILY_UNAVAILABLE' }
    }

    const payload = await response.json() as { url?: unknown }
    const roomUrl = typeof payload.url === 'string' ? payload.url : ''
    if (!roomUrl.startsWith('https://')) {
      await reportDailyFailure({
        input,
        reason: 'DAILY_UNAVAILABLE',
        providerStatus: response.status,
        latencyMs,
        circuitStatus: circuit.status,
      })
      return { ok: false, reason: 'DAILY_UNAVAILABLE' }
    }

    await Promise.allSettled([
      recordProviderHealth(input.supabase, {
        provider: 'DAILY',
        operation: DAILY_CREATE_ROOM_OPERATION,
        succeeded: true,
        metadata: {
          callKind: input.callKind,
          latencyMs,
        },
      }),
      resolveOpsIssueByDedupeKey(
        input.supabase,
        DAILY_ISSUE_DEDUPE_KEY,
        {
          function: input.functionName,
          callKind: input.callKind,
          orderId: input.orderId,
          latencyMs,
        },
      ),
    ])

    log('info', input.functionName, 'daily.room_created', {
      order_id: input.orderId,
      actor_id: input.actorId,
      stage: input.stage ?? null,
      provider: 'DAILY',
      call_kind: input.callKind,
      latency_ms: latencyMs,
    })
    return { ok: true, url: roomUrl }
  } catch (error) {
    await reportDailyFailure({
      input,
      reason: 'DAILY_UNAVAILABLE',
      latencyMs: Date.now() - startedAt,
      circuitStatus: circuit.status,
    })
    log('warn', input.functionName, 'daily.request_exception', {
      order_id: input.orderId,
      error: error instanceof Error ? error.name : 'UnknownError',
    })
    return { ok: false, reason: 'DAILY_UNAVAILABLE' }
  } finally {
    clearTimeout(timeout)
  }
}
