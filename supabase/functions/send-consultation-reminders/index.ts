import {
  createClient,
  type SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeCronRequest } from "../_shared/cron.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { getServiceRoleKey, getSupabaseUrl } from "../_shared/env.ts";
import { audit, log } from "../_shared/logger.ts";
import {
  parseOrderSupportMeta,
  serializeOrderSupportMeta,
  type ConsultationMeta,
  type OrderCallMeta,
} from "../_shared/order-support.ts";
import { createOrRefreshOpsIssue } from "../_shared/ops-issues.ts";
import { refundSettledOrderPayments } from "../_shared/payment-refunds.ts";
import { enqueueOrderEventEmailJob, enqueuePushJob, enqueueSmsJob } from "../_shared/side-effect-jobs.ts";
import {
  deriveConsultationTerminalAction,
  shouldOpenQuotePreparationAfterConsultation,
  type ConsultationAttendanceOutcome,
} from "../../../packages/shared/src/consultations.ts";
import {
  getClientIp,
  RATE_LIMITS,
  rateLimit,
  rateLimitExceededResponse,
} from "../_shared/rateLimit.ts";

const FN = "send-consultation-reminders";
const WINDOW_MS = 5 * 60 * 1000;
const THIRTY_MIN_MS = 30 * 60 * 1000;
const TEN_MIN_MS = 10 * 60 * 1000;
const FIVE_MIN_MS = 5 * 60 * 1000;
const CONSULTATION_DURATION_MS = 30 * 60 * 1000;
const REQUEST_FOLLOW_UP_MS = 24 * 60 * 60 * 1000;
const REQUEST_EXPIRE_MS = 48 * 60 * 60 * 1000;
const ORDER_CALL_JOIN_LATE_MS = 30 * 60 * 1000;
const ORDER_CALL_STAGES = [
  "PENDING_QUOTE",
  "CONSULTATION",
  "QUOTE_SENT",
  "PAYMENT_PENDING",
  "PAYMENT_FAILED",
  "CONFIRMED",
  "DESIGNING",
  "SOURCING",
  "CUTTING",
  "SEWING",
  "FINISHING",
  "READY_FOR_COLLECTION",
  "READY_FOR_DRAPE_DISPATCH",
  "OUT_FOR_DELIVERY",
  "SHIPPED",
  "DELIVERED",
  "COLLECTED",
  "IN_DISPUTE",
] as const;

type ReminderKind = "30" | "10" | "5" | "now";

type OrderRow = {
  id: string;
  reference: string | null;
  customer_id: string | null;
  tailor_id: string | null;
  stage: string;
  special_note: string | null;
  video_call_url: string | null;
  order_kind?: string | null;
  garment_type?: string | null;
  item_title?: string | null;
  item_size?: string | null;
};

type ConsultationBookingRow = {
  id: string;
  order_id: string;
  customer_id: string;
  tailor_id: string;
  status: string;
  fee_mode: "FREE" | "PAID";
  fee_amount: number | null;
  fee_currency: string | null;
  payment_status: string;
  settlement_status: string;
  commercial_correlation_id: string;
};

type ConsultationScheduleRow = {
  scheduled_start_at: string;
  scheduled_end_at: string;
  fee_mode: "FREE" | "PAID";
  fee_amount: number | null;
  fee_currency: string | null;
  fee_creditable: boolean;
  payment_status: string;
  paid_at: string | null;
  call_type: "AUDIO" | "VIDEO";
  policy_version: string | null;
};

type ConsultationEvidenceRow = {
  derived_outcome: ConsultationAttendanceOutcome;
  customer_verified_seconds: number;
  tailor_verified_seconds: number;
  verified_overlap_seconds: number;
  provider_evidence_complete: boolean;
};

function shouldSkip(meta: ConsultationMeta | null, nowMs: number) {
  if (!meta) return true;
  if (meta.reminderEnabled === false) return true;
  if (meta.status !== "SCHEDULED" && meta.status !== "APPROVED") return true;
  if (!meta.scheduledStartAt) return true;
  const startsAt = new Date(meta.scheduledStartAt).getTime();
  if (!Number.isFinite(startsAt)) return true;
  if (startsAt < nowMs - WINDOW_MS) return true;
  if (meta.feeAmount && meta.feeAmount > 0 && meta.paymentTiming === "BEFORE_CALL_STARTS" && !meta.paidAt) {
    return true;
  }
  return false;
}

function dueReminder(meta: ConsultationMeta, nowMs: number): ReminderKind | null {
  const startsAt = new Date(meta.scheduledStartAt!).getTime();
  const msUntil = startsAt - nowMs;

  if (!meta.reminderStartSentAt && msUntil <= 0 && msUntil >= -WINDOW_MS) {
    return "now";
  }

  if (msUntil > 0 && !meta.reminder5SentAt && msUntil <= FIVE_MIN_MS) {
    return "5";
  }

  if (msUntil > FIVE_MIN_MS && !meta.reminder10SentAt && msUntil <= TEN_MIN_MS) {
    return "10";
  }

  if (msUntil > TEN_MIN_MS && !meta.reminder30SentAt && msUntil <= THIRTY_MIN_MS) {
    return "30";
  }

  return null;
}

function shouldSkipOrderCall(meta: OrderCallMeta | null, nowMs: number) {
  if (!meta) return true;
  if (meta.reminderEnabled === false) return true;
  if (meta.status !== "SCHEDULED") return true;
  if (!meta.scheduledStartAt) return true;
  if (meta.completedAt || meta.expiredAt) return true;
  const startsAt = new Date(meta.scheduledStartAt).getTime();
  if (!Number.isFinite(startsAt)) return true;
  if (startsAt < nowMs - WINDOW_MS) return true;
  return false;
}

function dueOrderCallReminder(meta: OrderCallMeta, nowMs: number): ReminderKind | null {
  const startsAt = new Date(meta.scheduledStartAt!).getTime();
  const msUntil = startsAt - nowMs;

  if (!meta.reminderStartSentAt && msUntil <= 0 && msUntil >= -WINDOW_MS) {
    return "now";
  }

  if (msUntil > 0 && !meta.reminder5SentAt && msUntil <= FIVE_MIN_MS) {
    return "5";
  }

  if (msUntil > FIVE_MIN_MS && !meta.reminder10SentAt && msUntil <= TEN_MIN_MS) {
    return "10";
  }

  if (msUntil > TEN_MIN_MS && !meta.reminder30SentAt && msUntil <= THIRTY_MIN_MS) {
    return "30";
  }

  return null;
}

function titleFor(kind: ReminderKind) {
  if (kind === "now") return "Consultation starting now";
  return `Consultation in ${kind} minutes`;
}

function bodyFor(kind: ReminderKind) {
  if (kind === "now") return "Your Drapeon consultation is starting now. Tap to join.";
  return `Your Drapeon consultation starts in ${kind} minutes. Open the order to prepare or join.`;
}

function smsBodyFor(order: OrderRow, kind: ReminderKind) {
  if (kind === "now") return `Drapeon: your consultation for order ${orderRef(order)} is starting now. Open Drapeon to join.`;
  return `Drapeon: your consultation for order ${orderRef(order)} starts in ${kind} minutes. Open Drapeon to prepare or join.`;
}

function orderCallTitleFor(kind: ReminderKind) {
  if (kind === "now") return "Order call starting now";
  return `Order call in ${kind} minutes`;
}

function orderCallBodyFor(kind: ReminderKind) {
  if (kind === "now") return "Your scheduled order call is starting now. Tap to join.";
  return `Your scheduled order call starts in ${kind} minutes. Open Messages to prepare or join.`;
}

function orderCallSmsBodyFor(order: OrderRow, kind: ReminderKind) {
  if (kind === "now") return `Drapeon: your scheduled order call for ${orderRef(order)} is starting now. Open Drapeon to join.`;
  return `Drapeon: your scheduled order call for ${orderRef(order)} starts in ${kind} minutes. Open Drapeon to prepare or join.`;
}

function requestAgeMs(meta: ConsultationMeta, nowMs: number) {
  const raw = meta.requestedAt ?? meta.proposedStartAt;
  if (!raw) return null;
  const requestedAt = new Date(raw).getTime();
  if (!Number.isFinite(requestedAt)) return null;
  return nowMs - requestedAt;
}

function scheduledEndMs(meta: ConsultationMeta) {
  const rawEnd = meta.scheduledEndAt ?? null;
  const endMs = rawEnd ? new Date(rawEnd).getTime() : NaN;
  if (Number.isFinite(endMs)) return endMs;
  if (!meta.scheduledStartAt) return null;
  const startMs = new Date(meta.scheduledStartAt).getTime();
  if (!Number.isFinite(startMs)) return null;
  return startMs + CONSULTATION_DURATION_MS;
}

function isUnresolvedScheduledConsultation(meta: ConsultationMeta | null) {
  if (!meta) return false;
  return meta.status === "APPROVED" || meta.status === "SCHEDULED" || meta.status === "COMPLETED";
}

async function consultationMetaForOrder(
  supabase: SupabaseClient,
  order: OrderRow,
  existing: ConsultationMeta | null,
) {
  if (existing) return existing;
  const { data, error } = await supabase
    .from("consultation_bookings")
    .select("scheduled_start_at,scheduled_end_at,fee_mode,fee_amount,fee_currency,fee_creditable,payment_status,paid_at,call_type,policy_version")
    .eq("order_id", order.id)
    .eq("status", "CONFIRMED")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const booking = data as ConsultationScheduleRow | null;
  if (!booking) return null;
  const duration = Math.round(
    (new Date(booking.scheduled_end_at).getTime() - new Date(booking.scheduled_start_at).getTime()) / 60_000,
  );
  return {
    status: "SCHEDULED",
    feeMode: booking.fee_mode,
    feeAmount: booking.fee_amount,
    feeCurrency: booking.fee_currency,
    feeCreditable: booking.fee_creditable,
    paymentTiming: booking.fee_mode === "PAID" ? "BEFORE_CALL_STARTS" : "WAIVED_OR_FREE",
    paidAt: booking.payment_status === "PAID" ? booking.paid_at : null,
    scheduledStartAt: booking.scheduled_start_at,
    scheduledEndAt: booking.scheduled_end_at,
    reminderEnabled: true,
    policyVersion: booking.policy_version,
    durationMinutes: ([15, 30, 45, 60].includes(duration) ? duration : 30) as 15 | 30 | 45 | 60,
    callType: booking.call_type === "AUDIO" ? "AUDIO" : "VIDEO",
  } satisfies ConsultationMeta;
}

function orderRef(order: OrderRow) {
  return order.reference?.trim() || order.id.slice(0, 8).toUpperCase();
}

async function sendReminder(
  supabase: SupabaseClient,
  order: OrderRow,
  meta: ConsultationMeta,
  kind: ReminderKind,
) {
  const urgent = kind === "10" || kind === "5" || kind === "now";
  const callType = meta.callType === "AUDIO" ? "audio" : "video";
  const data: Record<string, string> = urgent
    ? { orderId: order.id, target: "call-join", callKind: "consultation", callType }
    : { orderId: order.id };
  const payload = {
    title: titleFor(kind),
    body: bodyFor(kind),
    preferenceKey: "orderUpdates" as const,
    data,
    ...(urgent ? { channelId: "calls", sound: "default", interruptionLevel: "time-sensitive" as const } : {}),
  };

  const sends: Promise<boolean>[] = [];
  if (order.customer_id) {
    sends.push(enqueuePushJob(supabase, {
      userId: order.customer_id,
      source: FN,
      orderId: order.id,
      idempotencyKey: `consultation-reminder:${order.id}:${kind}:customer`,
      priority: 15,
      notification: payload,
    }));
    sends.push(enqueueSmsJob(supabase, {
      userId: order.customer_id,
      audience: "CUSTOMER",
      source: FN,
      orderId: order.id,
      event: `consultation_reminder_${kind}`,
      idempotencyKey: `consultation-reminder:${order.id}:${kind}:customer:sms`,
      priority: 15,
      body: smsBodyFor(order, kind),
    }));
    sends.push(enqueueOrderEventEmailJob(supabase, {
      order,
      recipientUserId: order.customer_id,
      audience: "CUSTOMER",
      subject: titleFor(kind),
      headline: titleFor(kind),
      body: bodyFor(kind),
      ctaLabel: kind === "30" ? "Open order" : "Open Drapeon to join",
      source: FN,
      idempotencyKey: `consultation-reminder:${order.id}:${kind}:customer:email`,
      priority: 15,
    }));
  }
  if (order.tailor_id) {
    sends.push(enqueuePushJob(supabase, {
      userId: order.tailor_id,
      source: FN,
      orderId: order.id,
      idempotencyKey: `consultation-reminder:${order.id}:${kind}:tailor`,
      priority: 15,
      notification: payload,
    }));
    sends.push(enqueueSmsJob(supabase, {
      userId: order.tailor_id,
      audience: "TAILOR",
      source: FN,
      orderId: order.id,
      event: `consultation_reminder_${kind}`,
      idempotencyKey: `consultation-reminder:${order.id}:${kind}:tailor:sms`,
      priority: 15,
      body: smsBodyFor(order, kind),
    }));
    sends.push(enqueueOrderEventEmailJob(supabase, {
      order,
      recipientUserId: order.tailor_id,
      audience: "TAILOR",
      subject: titleFor(kind),
      headline: titleFor(kind),
      body: bodyFor(kind),
      ctaLabel: kind === "30" ? "Open order" : "Open Drapeon to join",
      source: FN,
      idempotencyKey: `consultation-reminder:${order.id}:${kind}:tailor:email`,
      priority: 15,
    }));
  }
  const queued = await Promise.all(sends);
  if (queued.some((result) => !result)) {
    throw new Error(`Could not queue every consultation ${kind}-minute reminder delivery.`);
  }
}

async function sendOrderCallReminder(
  supabase: SupabaseClient,
  order: OrderRow,
  kind: ReminderKind,
) {
  const urgent = kind === "10" || kind === "5" || kind === "now";
  const data: Record<string, string> = urgent
    ? { orderId: order.id, target: "call-join", callKind: "ready-made", callType: "video" }
    : { orderId: order.id, target: "messages" };
  const payload = {
    title: orderCallTitleFor(kind),
    body: orderCallBodyFor(kind),
    preferenceKey: "messages" as const,
    data,
    ...(urgent ? { channelId: "calls", sound: "default", interruptionLevel: "time-sensitive" as const } : {}),
  };

  const sends: Promise<boolean>[] = [];
  if (order.customer_id) {
    sends.push(enqueuePushJob(supabase, {
      userId: order.customer_id,
      source: FN,
      orderId: order.id,
      idempotencyKey: `order-call-reminder:${order.id}:${kind}:customer`,
      priority: 15,
      notification: payload,
    }));
    sends.push(enqueueSmsJob(supabase, {
      userId: order.customer_id,
      audience: "CUSTOMER",
      source: FN,
      orderId: order.id,
      event: `order_call_reminder_${kind}`,
      idempotencyKey: `order-call-reminder:${order.id}:${kind}:customer:sms`,
      priority: 15,
      body: orderCallSmsBodyFor(order, kind),
    }));
    sends.push(enqueueOrderEventEmailJob(supabase, {
      order,
      recipientUserId: order.customer_id,
      audience: "CUSTOMER",
      subject: orderCallTitleFor(kind),
      headline: orderCallTitleFor(kind),
      body: orderCallBodyFor(kind),
      ctaLabel: kind === "30" ? "Open order" : "Open Drapeon to join",
      source: FN,
      idempotencyKey: `order-call-reminder:${order.id}:${kind}:customer:email`,
      priority: 15,
    }));
  }
  if (order.tailor_id) {
    sends.push(enqueuePushJob(supabase, {
      userId: order.tailor_id,
      source: FN,
      orderId: order.id,
      idempotencyKey: `order-call-reminder:${order.id}:${kind}:tailor`,
      priority: 15,
      notification: payload,
    }));
    sends.push(enqueueSmsJob(supabase, {
      userId: order.tailor_id,
      audience: "TAILOR",
      source: FN,
      orderId: order.id,
      event: `order_call_reminder_${kind}`,
      idempotencyKey: `order-call-reminder:${order.id}:${kind}:tailor:sms`,
      priority: 15,
      body: orderCallSmsBodyFor(order, kind),
    }));
    sends.push(enqueueOrderEventEmailJob(supabase, {
      order,
      recipientUserId: order.tailor_id,
      audience: "TAILOR",
      subject: orderCallTitleFor(kind),
      headline: orderCallTitleFor(kind),
      body: orderCallBodyFor(kind),
      ctaLabel: kind === "30" ? "Open order" : "Open Drapeon to join",
      source: FN,
      idempotencyKey: `order-call-reminder:${order.id}:${kind}:tailor:email`,
      priority: 15,
    }));
  }

  const queued = await Promise.all(sends);
  if (queued.some((result) => !result)) {
    throw new Error(`Could not queue every order-call ${kind}-minute reminder delivery.`);
  }
}

async function notifyBothByPushAndEmail(
  supabase: SupabaseClient,
  order: OrderRow,
  payload: { title: string; customerBody: string; tailorBody: string },
) {
  const sends: Promise<unknown>[] = [];
  if (order.customer_id) {
    sends.push(enqueuePushJob(supabase, {
      userId: order.customer_id,
      source: FN,
      orderId: order.id,
      idempotencyKey: `consultation-followup:${order.id}:${payload.title}:customer:push`,
      priority: 20,
      notification: {
        title: payload.title,
        body: payload.customerBody,
        preferenceKey: "orderUpdates",
        data: { orderId: order.id },
      },
    }));
    sends.push(enqueueOrderEventEmailJob(supabase, {
      order,
      recipientUserId: order.customer_id,
      audience: "CUSTOMER",
      subject: payload.title,
      body: payload.customerBody,
      source: FN,
      idempotencyKey: `consultation-followup:${order.id}:${payload.title}:customer:email`,
    }));
    sends.push(enqueueSmsJob(supabase, {
      userId: order.customer_id,
      audience: "CUSTOMER",
      source: FN,
      orderId: order.id,
      event: "consultation_followup",
      idempotencyKey: `consultation-followup:${order.id}:${payload.title}:customer:sms`,
      priority: 20,
      body: `Drapeon: ${payload.customerBody}`,
    }));
  }

  if (order.tailor_id) {
    sends.push(enqueuePushJob(supabase, {
      userId: order.tailor_id,
      source: FN,
      orderId: order.id,
      idempotencyKey: `consultation-followup:${order.id}:${payload.title}:tailor:push`,
      priority: 20,
      notification: {
        title: payload.title,
        body: payload.tailorBody,
        preferenceKey: "newOrders",
        data: { orderId: order.id },
      },
    }));
    sends.push(enqueueOrderEventEmailJob(supabase, {
      order,
      recipientUserId: order.tailor_id,
      audience: "TAILOR",
      subject: payload.title,
      body: payload.tailorBody,
      source: FN,
      idempotencyKey: `consultation-followup:${order.id}:${payload.title}:tailor:email`,
    }));
    sends.push(enqueueSmsJob(supabase, {
      userId: order.tailor_id,
      audience: "TAILOR",
      source: FN,
      orderId: order.id,
      event: "consultation_followup",
      idempotencyKey: `consultation-followup:${order.id}:${payload.title}:tailor:sms`,
      priority: 20,
      body: `Drapeon: ${payload.tailorBody}`,
    }));
  }

  await Promise.allSettled(sends);
}

async function createConsultationOpsIssue(
  supabase: SupabaseClient,
  order: OrderRow,
  severity: "HIGH" | "CRITICAL",
  reason: "REQUEST_WAITING" | "POST_SLOT_FOLLOW_UP" | "EXPIRED",
) {
  const title =
    reason === "REQUEST_WAITING"
      ? "Consultation request is waiting on tailor"
      : reason === "POST_SLOT_FOLLOW_UP"
      ? "Consultation needs quote or decline"
      : "Consultation expired without resolution";

  const description =
    reason === "REQUEST_WAITING"
      ? `Order ${orderRef(order)} has a customer consultation request waiting more than 24 hours.`
      : reason === "POST_SLOT_FOLLOW_UP"
      ? `Order ${orderRef(order)} has passed its consultation time and still needs quote, decline, or support follow-up.`
      : `Order ${orderRef(order)} left consultation without quote or decline and was returned to quote review.`;

  await createOrRefreshOpsIssue(supabase, {
    issueType: "ORDER_REVIEW",
    severity,
    source: FN,
    actorRole: "SYSTEM",
    orderId: order.id,
    userId: order.customer_id,
    stage: order.stage,
    title,
    description,
    recommendedAction:
      "Check the order thread and make sure the tailor either sends a quote, reschedules, or declines the order.",
    dedupeKey: `consultation:${reason.toLowerCase()}:${order.id}`,
    metadata: {
      reason,
      reference: order.reference ?? null,
    },
  });
}

async function returnConsultationToQuote(
  supabase: SupabaseClient,
  order: OrderRow,
  meta: ConsultationMeta,
  input: { status: "COMPLETED" | "EXPIRED"; note: string; nowIso: string },
) {
  const supportMeta = parseOrderSupportMeta(order.special_note);
  const nextConsultation: ConsultationMeta = {
    ...meta,
    status: input.status,
    expiredAt: input.status === "EXPIRED" ? input.nowIso : null,
  };
  const orderUpdate = order.stage === "CONSULTATION"
    ? {
      stage: "PENDING_QUOTE",
      stage_updated_at: input.nowIso,
      video_call_url: null,
      special_note: serializeOrderSupportMeta({
        ...supportMeta,
        consultation: nextConsultation,
      }),
    }
    : {
      video_call_url: null,
      special_note: serializeOrderSupportMeta({
        ...supportMeta,
        consultation: nextConsultation,
      }),
    };
  const { error } = await supabase
    .from("orders")
    .update(orderUpdate)
    .eq("id", order.id)
    .in("stage", ["CONSULTATION", "PENDING_QUOTE"]);
  if (error) throw new Error(error.message);
  if (order.stage === "CONSULTATION") {
    await supabase.from("order_stage_updates").insert({
      order_id: order.id,
      stage: "PENDING_QUOTE",
      note: input.note,
    });
  }
}

async function openQuotePreparationAfterWindow(
  supabase: SupabaseClient,
  order: OrderRow,
  meta: ConsultationMeta,
  nowIso: string,
) {
  if (order.stage !== "CONSULTATION") return false;

  if (!shouldOpenQuotePreparationAfterConsultation({
    scheduledEndAt: meta.scheduledEndAt ?? scheduledEndMs(meta)!,
    now: nowIso,
  })) return false;

  const supportMeta = parseOrderSupportMeta(order.special_note);
  const { data: moved, error } = await supabase
    .from("orders")
    .update({
      stage: "PENDING_QUOTE",
      stage_updated_at: nowIso,
      video_call_url: null,
      special_note: serializeOrderSupportMeta({
        ...supportMeta,
        consultation: meta,
      }),
    })
    .eq("id", order.id)
    .eq("stage", "CONSULTATION")
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!moved?.id) return false;

  const { error: rescheduleError } = await supabase
    .from("consultation_reschedule_requests")
    .update({
      status: "CANCELLED",
      response_note: "The booked consultation window ended and quote preparation reopened.",
      responded_at: nowIso,
      updated_at: nowIso,
    })
    .eq("order_id", order.id)
    .eq("status", "PENDING");
  if (rescheduleError) throw new Error(rescheduleError.message);

  await supabase.from("order_stage_updates").insert({
    order_id: order.id,
    stage: "PENDING_QUOTE",
    note: "The booked consultation window ended. Quote preparation reopened while attendance and fee settlement continue separately.",
  });
  await notifyBothByPushAndEmail(supabase, order, {
    title: "Consultation finished",
    customerBody: "The booked consultation window ended. The order is now waiting for the tailor's quote; any fee review continues in the background.",
    tailorBody: "The booked consultation window ended. Send the customer's quote or decline the order; any fee review continues in the background.",
  });
  await audit(supabase, {
    event: "consultation.quote_preparation_opened",
    actor_role: "SYSTEM",
    order_id: order.id,
    payload: {
      function: FN,
      scheduled_start_at: meta.scheduledStartAt,
      scheduled_end_at: meta.scheduledEndAt,
    },
  });
  return true;
}

async function openConsultationSettlementReview(
  supabase: SupabaseClient,
  order: OrderRow,
  booking: ConsultationBookingRow | null,
  evidence: ConsultationEvidenceRow | null,
  reason: string,
) {
  if (booking?.id) {
    await supabase.from("consultation_bookings").update({
      settlement_status: booking.fee_mode === "PAID" ? "OPS_REVIEW" : booking.settlement_status,
      settlement_failure_reason: reason,
    }).eq("id", booking.id);
    await supabase.from("consultation_commercial_events").insert({
      booking_id: booking.id,
      order_id: order.id,
      event_type: "OPS_REVIEW_OPENED",
      actor_role: "SYSTEM",
      amount: booking.fee_amount,
      currency: booking.fee_currency,
      correlation_id: booking.commercial_correlation_id,
      payload: { reason, evidence, function: FN },
    });
  }
  await createOrRefreshOpsIssue(supabase, {
    issueType: "ORDER_REVIEW",
    severity: booking?.fee_mode === "PAID" ? "CRITICAL" : "HIGH",
    source: FN,
    actorRole: "SYSTEM",
    orderId: order.id,
    userId: order.customer_id,
    stage: order.stage,
    relatedEntityType: booking ? "CONSULTATION_BOOKING" : undefined,
    relatedEntityId: booking?.id ?? undefined,
    title: "Consultation outcome needs review",
    description: `Drapeon could not safely determine the consultation outcome for order ${orderRef(order)}.`,
    recommendedAction: "Review the recorded call participation, attendance reports, and payment state before choosing reschedule, refund, or verified earning.",
    dedupeKey: `consultation-terminal-review:${booking?.id ?? order.id}`,
    metadata: { reason, evidence, reference: order.reference ?? null },
  });
}

async function finalizeScheduledConsultation(
  supabase: SupabaseClient,
  order: OrderRow,
  meta: ConsultationMeta,
  nowIso: string,
) {
  const { data: bookingData, error: bookingError } = await supabase
    .from("consultation_bookings")
    .select("id,order_id,customer_id,tailor_id,status,fee_mode,fee_amount,fee_currency,payment_status,settlement_status,commercial_correlation_id")
    .eq("order_id", order.id)
    .eq("status", "CONFIRMED")
    .order("scheduled_start_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (bookingError) throw new Error(bookingError.message);
  const booking = (bookingData ?? null) as ConsultationBookingRow | null;

  if (!booking) {
    if (meta.feeMode === "FREE" || !meta.feeAmount) {
      await returnConsultationToQuote(supabase, order, meta, {
        status: "EXPIRED",
        nowIso,
        note: "The free consultation closed after no call activity. The order returned to quote review.",
      });
      await notifyBothByPushAndEmail(supabase, order, {
        title: "Consultation closed",
        customerBody: "No call activity was recorded, so the free consultation closed. The order is ready for a quote or another conversation.",
        tailorBody: "No call activity was recorded, so the free consultation closed. Send a quote, message the customer, or decline the order.",
      });
      return "closed" as const;
    }
    await openConsultationSettlementReview(supabase, order, null, null, "PAID_BOOKING_NOT_FOUND");
    return "review" as const;
  }

  const { count: openReviewCount, error: reviewError } = await supabase
    .from("consultation_attendance_reviews")
    .select("id", { count: "exact", head: true })
    .eq("booking_id", booking.id)
    .in("status", ["COUNTERPARTY_REVIEW", "OPS_REVIEW"]);
  if (reviewError) throw new Error(reviewError.message);

  const { data: evidenceData, error: evidenceError } = await supabase.rpc(
    "refresh_consultation_attendance_evidence",
    { p_booking_id: booking.id },
  );
  if (evidenceError) throw new Error(evidenceError.message);
  const evidence = evidenceData as ConsultationEvidenceRow;
  const terminalAction = deriveConsultationTerminalAction({
    feeMode: booking.fee_mode,
    paymentStatus: booking.payment_status,
    attendanceOutcome: evidence.derived_outcome,
    customerVerifiedSeconds: evidence.customer_verified_seconds ?? 0,
    tailorVerifiedSeconds: evidence.tailor_verified_seconds ?? 0,
    hasOpenReview: (openReviewCount ?? 0) > 0,
  });

  if (terminalAction === "OPS_REVIEW") {
    await openConsultationSettlementReview(
      supabase,
      order,
      booking,
      evidence,
      (openReviewCount ?? 0) > 0 ? "ATTENDANCE_REPORT_OPEN" : "CALL_ACTIVITY_CONFLICT",
    );
    return "review" as const;
  }

  if (terminalAction === "COMPLETE_FREE" || terminalAction === "CLOSE_FREE_NO_ACTIVITY") {
    const attended = terminalAction === "COMPLETE_FREE";
    const bookingStatus = attended ? "COMPLETED" : "EXPIRED";
    const { error } = await supabase.from("consultation_bookings").update({
      status: bookingStatus,
      settlement_status: "NOT_REQUIRED",
      settlement_outcome: attended ? "ATTENDED" : "EXPIRED_NO_ACTIVITY",
      earned_amount: 0,
      refunded_amount: 0,
      settled_at: nowIso,
      settlement_failure_reason: null,
    }).eq("id", booking.id).eq("status", "CONFIRMED");
    if (error) throw new Error(error.message);
    await returnConsultationToQuote(supabase, order, meta, {
      status: attended ? "COMPLETED" : "EXPIRED",
      nowIso,
      note: attended
        ? "Drapeon verified the free consultation and returned the order to quote review."
        : "The free consultation closed after no activity and returned the order to quote review.",
    });
    await notifyBothByPushAndEmail(supabase, order, {
      title: attended ? "Consultation complete" : "Consultation closed",
      customerBody: attended
        ? "The consultation is complete. The tailor can now send your quote."
        : "No call activity was recorded, so the free consultation closed. The order is ready for a quote or another conversation.",
      tailorBody: attended
        ? "The consultation is complete. Send the customer a quote or clear next step."
        : "No call activity was recorded, so the free consultation closed. Send a quote, message the customer, or decline the order.",
    });
    return "closed" as const;
  }

  if (terminalAction === "RELEASE_TAILOR_EARNING") {
    const noShow = evidence.derived_outcome === "CUSTOMER_NO_SHOW_ELIGIBLE";
    const { error: statusError } = await supabase.from("consultation_bookings").update({
      status: noShow ? "NO_SHOW" : "COMPLETED",
    }).eq("id", booking.id).eq("status", "CONFIRMED");
    if (statusError) throw new Error(statusError.message);
    if (!["EARNED", "RELEASE_PENDING", "RELEASED"].includes(booking.settlement_status)) {
      const { data: claimed, error } = await supabase.from("consultation_bookings").update({
        settlement_status: "EARNED",
        settlement_outcome: noShow ? "CUSTOMER_NO_SHOW" : "ATTENDED",
        earned_amount: booking.fee_amount ?? 0,
        refunded_amount: 0,
        settlement_eligible_at: nowIso,
        settlement_failure_reason: null,
      }).eq("id", booking.id).eq("settlement_status", "HELD").select("id").maybeSingle();
      if (error) throw new Error(error.message);
      if (claimed?.id) {
        await supabase.from("consultation_commercial_events").insert({
          booking_id: booking.id,
          order_id: order.id,
          event_type: "ATTENDANCE_EARNED",
          actor_role: "SYSTEM",
          amount: booking.fee_amount ?? 0,
          currency: booking.fee_currency,
          correlation_id: booking.commercial_correlation_id,
          payload: { attendance_outcome: evidence.derived_outcome, evidence, function: FN },
        });
      }
    }
    await returnConsultationToQuote(supabase, order, meta, {
      status: "COMPLETED",
      nowIso,
      note: noShow
        ? "Drapeon verified the tailor wait and returned the order to quote review."
        : "Drapeon verified consultation attendance and returned the order to quote review.",
    });
    const { error: releaseError } = await supabase.functions.invoke("release-consultation-earning", {
      body: { bookingId: booking.id },
    });
    if (releaseError) {
      await openConsultationSettlementReview(supabase, order, booking, evidence, `EARNING_RELEASE_INVOKE_FAILED:${releaseError.message}`);
    }
    await notifyBothByPushAndEmail(supabase, order, {
      title: noShow ? "Consultation attendance settled" : "Consultation complete",
      customerBody: noShow
        ? "Drapeon verified the scheduled wait. The consultation fee is being released under the no-show policy, and the order is back in quote review."
        : "The consultation is complete. The tailor can now send your quote.",
      tailorBody: noShow
        ? "Drapeon verified your scheduled wait. Your consultation earning is processing, and the order is back in quote review."
        : "The consultation is complete. Your verified earning is processing; send the customer a quote or clear next step.",
    });
    return "closed" as const;
  }

  try {
    const refund = await refundSettledOrderPayments(supabase, {
      orderId: order.id,
      reason: "No verified consultation service activity was recorded.",
      actorRole: "SYSTEM",
      allowedPhases: ["CONSULTATION"],
    });
    const refundPending = refund.pendingAttempts.length > 0;
    const { error } = await supabase.from("consultation_bookings").update({
      status: evidence.derived_outcome === "TAILOR_NO_SHOW_ELIGIBLE" ? "NO_SHOW" : "EXPIRED",
      payment_status: refundPending ? booking.payment_status : "REFUNDED",
      settlement_status: refundPending ? "REFUND_PENDING" : "REFUNDED",
      settlement_outcome: evidence.derived_outcome === "TAILOR_NO_SHOW_ELIGIBLE"
        ? "TAILOR_NO_SHOW_REFUND"
        : "EXPIRED_NO_ACTIVITY_REFUND",
      earned_amount: 0,
      refunded_amount: booking.fee_amount ?? 0,
      settled_at: refundPending ? null : nowIso,
      settlement_failure_reason: null,
    }).eq("id", booking.id).eq("status", "CONFIRMED");
    if (error) throw new Error(error.message);
    await supabase.from("consultation_commercial_events").insert({
      booking_id: booking.id,
      order_id: order.id,
      event_type: refundPending ? "REFUND_PENDING" : "CANCELLATION_COMPLETED",
      actor_role: "SYSTEM",
      amount: booking.fee_amount ?? 0,
      currency: booking.fee_currency,
      correlation_id: booking.commercial_correlation_id,
      payload: { attendance_outcome: evidence.derived_outcome, evidence, function: FN },
    });
    await returnConsultationToQuote(supabase, order, meta, {
      status: "EXPIRED",
      nowIso,
      note: "The missed consultation closed and its customer refund was recorded. The order returned to quote review.",
    });
    await notifyBothByPushAndEmail(supabase, order, {
      title: refundPending ? "Consultation refund processing" : "Consultation refunded",
      customerBody: refundPending
        ? "No verified consultation service activity was recorded. Your refund is processing to the original payment method, and the order is back in quote review."
        : "No verified consultation service activity was recorded. The consultation was refunded to the original payment method, and the order is back in quote review.",
      tailorBody: "No verified consultation service activity was recorded. The customer refund is being handled automatically, and the order is back in quote review.",
    });
    return "closed" as const;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await supabase.from("consultation_bookings").update({
      settlement_status: "FAILED",
      settlement_failure_reason: message,
    }).eq("id", booking.id);
    await openConsultationSettlementReview(supabase, order, booking, evidence, `REFUND_FAILED:${message}`);
    return "review" as const;
  }
}

async function handleConsultationLifecycle(
  supabase: SupabaseClient,
  order: OrderRow,
  meta: ConsultationMeta | null,
  now: Date,
) {
  if (!meta || meta.expiredAt) return "skipped" as const;
  const nowIso = now.toISOString();
  const nowMs = now.getTime();
  const supportMeta = parseOrderSupportMeta(order.special_note);

  if (meta.status === "REQUESTED") {
    const ageMs = requestAgeMs(meta, nowMs);
    if (ageMs == null) return "skipped" as const;
    const explicitExpiryMs = meta.requestExpiresAt ? new Date(meta.requestExpiresAt).getTime() : NaN;
    const requestExpired = Number.isFinite(explicitExpiryMs)
      ? nowMs >= explicitExpiryMs
      : ageMs >= REQUEST_EXPIRE_MS;

    if (requestExpired) {
      const nextConsultation = {
        ...meta,
        status: "EXPIRED" as const,
        expiredAt: nowIso,
      };
      const { error } = await supabase
        .from("orders")
        .update({
          stage: "PENDING_QUOTE",
          stage_updated_at: nowIso,
          special_note: serializeOrderSupportMeta({
            ...supportMeta,
            consultation: nextConsultation,
          }),
        })
        .eq("id", order.id)
        .eq("stage", "CONSULTATION");

      if (error) throw new Error(error.message);

      await supabase.from("order_stage_updates").insert({
        order_id: order.id,
        stage: "PENDING_QUOTE",
        note: "Drapeon expired the unanswered consultation request and returned the order to quote review.",
      });
      await createConsultationOpsIssue(supabase, order, "HIGH", "EXPIRED");
      await notifyBothByPushAndEmail(supabase, order, {
        title: "Consultation request expired",
        customerBody: "The consultation request was not answered in time. The order is back in quote review so the tailor can still quote or message you.",
        tailorBody: "A consultation request expired. Send a quote, message the customer, or decline the order so they are not left waiting.",
      });
      await audit(supabase, {
        event: "consultation.request_expired",
        actor_role: "SYSTEM",
        order_id: order.id,
        severity: "warn",
        payload: { function: FN },
      });
      return "expired" as const;
    }

    if (ageMs >= REQUEST_FOLLOW_UP_MS && !meta.followUpSentAt) {
      const nextConsultation = {
        ...meta,
        followUpSentAt: nowIso,
      };
      const { error } = await supabase
        .from("orders")
        .update({
          special_note: serializeOrderSupportMeta({
            ...supportMeta,
            consultation: nextConsultation,
          }),
        })
        .eq("id", order.id)
        .eq("stage", "CONSULTATION");

      if (error) throw new Error(error.message);

      await createConsultationOpsIssue(supabase, order, "HIGH", "REQUEST_WAITING");
      await notifyBothByPushAndEmail(supabase, order, {
        title: "Consultation request still open",
        customerBody: "We are following up because your consultation request has not been answered yet.",
        tailorBody: "A customer is still waiting on this consultation request. Approve, reschedule, decline, or send a quote.",
      });
      await audit(supabase, {
        event: "consultation.request_follow_up",
        actor_role: "SYSTEM",
        order_id: order.id,
        severity: "warn",
        payload: { function: FN },
      });
      return "followed_up" as const;
    }

    return "skipped" as const;
  }

  if (!isUnresolvedScheduledConsultation(meta)) return "skipped" as const;
  const endMs = scheduledEndMs(meta);
  if (endMs == null) return "skipped" as const;
  const ageAfterEnd = nowMs - endMs;
  if (ageAfterEnd < 0) return "skipped" as const;

  if (order.stage === "CONSULTATION") {
    return await openQuotePreparationAfterWindow(supabase, order, meta, nowIso)
      ? "quote_ready" as const
      : "skipped" as const;
  }

  if (ageAfterEnd >= REQUEST_FOLLOW_UP_MS) {
    const result = await finalizeScheduledConsultation(supabase, order, meta, nowIso);
    await audit(supabase, {
      event: "consultation.terminal_outcome_recorded",
      actor_role: "SYSTEM",
      order_id: order.id,
      severity: result === "review" ? "warn" : "info",
      payload: {
        function: FN,
        scheduled_start_at: meta.scheduledStartAt,
        result,
      },
    });
    return result === "closed" ? "expired" as const : "skipped" as const;
  }

  return "skipped" as const;
}

async function handleReadyMadeOrderCall(
  supabase: SupabaseClient,
  order: OrderRow,
  now: Date,
) {
  const supportMeta = parseOrderSupportMeta(order.special_note);
  const orderCall = supportMeta.orderCall ?? null;
  if (!orderCall || orderCall.status !== "SCHEDULED" || !orderCall.scheduledStartAt || orderCall.completedAt || orderCall.expiredAt) {
    return "skipped" as const;
  }

  const startsAt = new Date(orderCall.scheduledStartAt).getTime();
  if (!Number.isFinite(startsAt)) return "skipped" as const;

  if (now.getTime() > startsAt + ORDER_CALL_JOIN_LATE_MS) {
    const nextOrderCall = {
      ...orderCall,
      status: "EXPIRED" as const,
      expiredAt: now.toISOString(),
    };
    const { error } = await supabase
      .from("orders")
      .update({
        special_note: serializeOrderSupportMeta({
          ...supportMeta,
          orderCall: nextOrderCall,
        }),
      })
      .eq("id", order.id);

    if (error) throw new Error(error.message);

    await audit(supabase, {
      event: "order_call.expired",
      actor_role: "SYSTEM",
      order_id: order.id,
      severity: "warn",
      payload: {
        function: FN,
        scheduled_start_at: orderCall.scheduledStartAt,
      },
    });
    return "expired" as const;
  }

  return "active" as const;
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const unauthorized = await authorizeCronRequest(req, FN, cors);
    if (unauthorized) return unauthorized;

    const supabase = createClient(getSupabaseUrl(), getServiceRoleKey());
    const clientIp = getClientIp(req);
    const limit = await rateLimit(
      supabase,
      clientIp,
      FN,
      RATE_LIMITS.authenticated.limit,
      RATE_LIMITS.authenticated.windowMs,
      { ip: clientIp, userAgent: req.headers.get("user-agent") },
    );
    if (!limit.allowed) return rateLimitExceededResponse(cors, limit.retryAfter);

    const now = new Date();
    const nowMs = now.getTime();
    const requestBody = await req.json().catch(() => ({})) as { orderReference?: unknown };
    const orderReference = typeof requestBody.orderReference === "string"
      ? requestBody.orderReference.trim().replace(/^#/, "").toUpperCase()
      : null;
    if (orderReference && !/^DRP[A-Z0-9]{5,16}$/.test(orderReference)) {
      return new Response(JSON.stringify({ error: "Invalid order reference" }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    let activeConsultationQuery = supabase
      .from("orders")
      .select("id, reference, customer_id, tailor_id, stage, special_note, video_call_url, order_kind, garment_type, item_title, item_size")
      .eq("stage", "CONSULTATION");
    let settlingConsultationQuery = supabase
      .from("orders")
      .select("id, reference, customer_id, tailor_id, stage, special_note, video_call_url, order_kind, garment_type, item_title, item_size")
      .eq("stage", "PENDING_QUOTE")
      .not("special_note", "is", null);
    if (orderReference) {
      activeConsultationQuery = activeConsultationQuery.eq("reference", orderReference);
      settlingConsultationQuery = settlingConsultationQuery.eq("reference", orderReference);
    }
    const [activeConsultations, settlingConsultations] = await Promise.all([
      activeConsultationQuery,
      settlingConsultationQuery,
    ]);
    const error = activeConsultations.error ?? settlingConsultations.error;
    const data = [...(activeConsultations.data ?? []), ...(settlingConsultations.data ?? [])];

    if (error) {
      log("error", FN, "orders.lookup_failed", { error: error.message });
      return new Response(JSON.stringify({ error: "Could not check consultation reminders" }), {
        status: 500,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    let readyMadeCallQuery = supabase
      .from("orders")
      .select("id, reference, customer_id, tailor_id, stage, special_note, video_call_url, order_kind, garment_type, item_title, item_size")
      .in("stage", ORDER_CALL_STAGES)
      .not("special_note", "is", null);
    if (orderReference) readyMadeCallQuery = readyMadeCallQuery.eq("reference", orderReference);
    const { data: readyMadeCallData, error: readyMadeCallError } = await readyMadeCallQuery;

    if (readyMadeCallError) {
      log("warn", FN, "ready_made_order_calls.lookup_failed", { error: readyMadeCallError.message });
    }

    let sent30 = 0;
    let sent10 = 0;
    let sent5 = 0;
    let sentNow = 0;
    let orderCallSent30 = 0;
    let orderCallSent10 = 0;
    let orderCallSent5 = 0;
    let orderCallSentNow = 0;
    let followedUp = 0;
    let quoteReady = 0;
    let expired = 0;
    let skipped = 0;

    for (const order of (data ?? []) as OrderRow[]) {
      const supportMeta = parseOrderSupportMeta(order.special_note);
      let consultation: ConsultationMeta | null = null;
      try {
        consultation = await consultationMetaForOrder(supabase, order, supportMeta.consultation ?? null);
        const lifecycle = await handleConsultationLifecycle(supabase, order, consultation, now);
        if (lifecycle === "followed_up") followedUp += 1;
        if (lifecycle === "quote_ready") {
          quoteReady += 1;
          continue;
        }
        if (lifecycle === "expired") {
          expired += 1;
          continue;
        }
      } catch (error) {
        skipped += 1;
        log("error", FN, "consultation.lifecycle_failed", {
          order_id: order.id,
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }

      if (shouldSkip(consultation, nowMs)) {
        skipped += 1;
        continue;
      }

      const kind = dueReminder(consultation!, nowMs);
      if (!kind) {
        skipped += 1;
        continue;
      }

      const nextConsultation = {
        ...consultation!,
        reminder30SentAt: kind === "30" ? now.toISOString() : consultation!.reminder30SentAt ?? null,
        reminder10SentAt: kind === "10" ? now.toISOString() : consultation!.reminder10SentAt ?? null,
        reminder5SentAt: kind === "5" ? now.toISOString() : consultation!.reminder5SentAt ?? null,
        reminderStartSentAt: kind === "now" ? now.toISOString() : consultation!.reminderStartSentAt ?? null,
      };

      try {
        await sendReminder(supabase, order, consultation!, kind);
      } catch (error) {
        skipped += 1;
        log("warn", FN, "consultation.reminder_enqueue_failed", {
          order_id: order.id,
          reminder: kind,
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }

      const { error: updateError } = await supabase
        .from("orders")
        .update({
          special_note: serializeOrderSupportMeta({
            ...supportMeta,
            consultation: nextConsultation,
          }),
        })
        .eq("id", order.id);

      if (updateError) {
        skipped += 1;
        log("warn", FN, "order.update_failed", { order_id: order.id, error: updateError.message });
        continue;
      }

      await audit(supabase, {
        event: "consultation.reminder_sent",
        actor_role: "SYSTEM",
        order_id: order.id,
        payload: {
          function: FN,
          reminder: kind,
          scheduled_start_at: consultation!.scheduledStartAt,
        },
      });

      if (kind === "30") sent30 += 1;
      else if (kind === "10") sent10 += 1;
      else if (kind === "5") sent5 += 1;
      else sentNow += 1;
    }

    for (const order of (readyMadeCallData ?? []) as OrderRow[]) {
      const supportMeta = parseOrderSupportMeta(order.special_note);
      const orderCall = supportMeta.orderCall ?? null;
      try {
        const lifecycle = await handleReadyMadeOrderCall(supabase, order, now);
        if (lifecycle === "expired") {
          expired += 1;
          continue;
        }
      } catch (error) {
        skipped += 1;
        log("error", FN, "ready_made_order_call.lifecycle_failed", {
          order_id: order.id,
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }

      if (shouldSkipOrderCall(orderCall, nowMs)) {
        skipped += 1;
        continue;
      }

      const kind = dueOrderCallReminder(orderCall!, nowMs);
      if (!kind) {
        skipped += 1;
        continue;
      }

      const nextOrderCall = {
        ...orderCall!,
        reminder30SentAt: kind === "30" ? now.toISOString() : orderCall!.reminder30SentAt ?? null,
        reminder10SentAt: kind === "10" ? now.toISOString() : orderCall!.reminder10SentAt ?? null,
        reminder5SentAt: kind === "5" ? now.toISOString() : orderCall!.reminder5SentAt ?? null,
        reminderStartSentAt: kind === "now" ? now.toISOString() : orderCall!.reminderStartSentAt ?? null,
      };

      try {
        await sendOrderCallReminder(supabase, order, kind);
      } catch (error) {
        skipped += 1;
        log("warn", FN, "ready_made_order_call.reminder_enqueue_failed", {
          order_id: order.id,
          reminder: kind,
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }

      const { error: updateError } = await supabase
        .from("orders")
        .update({
          special_note: serializeOrderSupportMeta({
            ...supportMeta,
            orderCall: nextOrderCall,
          }),
        })
        .eq("id", order.id);

      if (updateError) {
        skipped += 1;
        log("warn", FN, "ready_made_order_call.update_failed", { order_id: order.id, error: updateError.message });
        continue;
      }

      await audit(supabase, {
        event: "order_call.reminder_sent",
        actor_role: "SYSTEM",
        order_id: order.id,
        payload: {
          function: FN,
          reminder: kind,
          scheduled_start_at: orderCall!.scheduledStartAt,
        },
      });

      if (kind === "30") orderCallSent30 += 1;
      else if (kind === "10") orderCallSent10 += 1;
      else if (kind === "5") orderCallSent5 += 1;
      else orderCallSentNow += 1;
    }

    return new Response(JSON.stringify({ ok: true, sent30, sent10, sent5, sentNow, orderCallSent30, orderCallSent10, orderCallSent5, orderCallSentNow, followedUp, quoteReady, expired, skipped }), {
      status: 200,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (error) {
    log("error", FN, "unhandled", {
      error: error instanceof Error ? error.message : String(error),
    });
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
