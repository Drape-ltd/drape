import {
  createClient,
  type SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeCronRequest } from "../_shared/cron.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { getServiceRoleKey, getSupabaseUrl } from "../_shared/env.ts";
import { audit, log } from "../_shared/logger.ts";
import { sendPushToUser } from "../_shared/notify.ts";
import { sendOrderEventEmail } from "../_shared/order-email.ts";
import {
  parseOrderSupportMeta,
  serializeOrderSupportMeta,
  type ConsultationMeta,
} from "../_shared/order-support.ts";
import { createOrRefreshOpsIssue } from "../_shared/ops-issues.ts";
import { releaseConsultationSlot } from "../_shared/consultation-bookings.ts";
import {
  getClientIp,
  RATE_LIMITS,
  rateLimit,
  rateLimitExceededResponse,
} from "../_shared/rateLimit.ts";

const FN = "send-consultation-reminders";
const WINDOW_MS = 5 * 60 * 1000;
const THIRTY_MIN_MS = 30 * 60 * 1000;
const FIVE_MIN_MS = 5 * 60 * 1000;
const CONSULTATION_DURATION_MS = 30 * 60 * 1000;
const POST_SLOT_FOLLOW_UP_MS = 10 * 60 * 1000;
const REQUEST_FOLLOW_UP_MS = 24 * 60 * 60 * 1000;
const REQUEST_EXPIRE_MS = 48 * 60 * 60 * 1000;

declare const EdgeRuntime: {
  waitUntil(promise: Promise<unknown>): void;
};

type OrderRow = {
  id: string;
  reference: string | null;
  customer_id: string | null;
  tailor_id: string | null;
  stage: string;
  special_note: string | null;
  video_call_url: string | null;
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

function dueReminder(meta: ConsultationMeta, nowMs: number): "30" | "5" | null {
  const startsAt = new Date(meta.scheduledStartAt!).getTime();
  const msUntil = startsAt - nowMs;

  if (!meta.reminder30SentAt && Math.abs(msUntil - THIRTY_MIN_MS) <= WINDOW_MS) {
    return "30";
  }

  if (!meta.reminder5SentAt && Math.abs(msUntil - FIVE_MIN_MS) <= WINDOW_MS) {
    return "5";
  }

  return null;
}

function titleFor(kind: "30" | "5") {
  return kind === "30" ? "Consultation in 30 minutes" : "Consultation starts soon";
}

function bodyFor(kind: "30" | "5") {
  return kind === "30"
    ? "Your Drape consultation is coming up. Open the order when you are ready."
    : "Your Drape consultation starts in 5 minutes. Open the order to join or start the call.";
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

function orderRef(order: OrderRow) {
  return order.reference?.trim() || order.id.slice(0, 8).toUpperCase();
}

async function sendReminder(
  supabase: SupabaseClient,
  order: OrderRow,
  kind: "30" | "5",
) {
  const payload = {
    title: titleFor(kind),
    body: bodyFor(kind),
    preferenceKey: "orderUpdates" as const,
    data: { orderId: order.id },
  };

  const sends: Promise<unknown>[] = [];
  if (order.customer_id) sends.push(sendPushToUser(supabase, order.customer_id, payload));
  if (order.tailor_id) sends.push(sendPushToUser(supabase, order.tailor_id, payload));
  await Promise.allSettled(sends);
}

async function notifyBothByPushAndEmail(
  supabase: SupabaseClient,
  order: OrderRow,
  payload: { title: string; customerBody: string; tailorBody: string },
) {
  const sends: Promise<unknown>[] = [];
  if (order.customer_id) {
    sends.push(sendPushToUser(supabase, order.customer_id, {
      title: payload.title,
      body: payload.customerBody,
      preferenceKey: "orderUpdates",
      data: { orderId: order.id },
    }));
    EdgeRuntime.waitUntil(sendOrderEventEmail(supabase, {
      order,
      recipientUserId: order.customer_id,
      audience: "CUSTOMER",
      subject: payload.title,
      body: payload.customerBody,
    }));
  }

  if (order.tailor_id) {
    sends.push(sendPushToUser(supabase, order.tailor_id, {
      title: payload.title,
      body: payload.tailorBody,
      preferenceKey: "newOrders",
      data: { orderId: order.id },
    }));
    EdgeRuntime.waitUntil(sendOrderEventEmail(supabase, {
      order,
      recipientUserId: order.tailor_id,
      audience: "TAILOR",
      subject: payload.title,
      body: payload.tailorBody,
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

    if (ageMs >= REQUEST_EXPIRE_MS) {
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
        note: "Drape expired the unanswered consultation request and returned the order to quote review.",
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
  if (ageAfterEnd < POST_SLOT_FOLLOW_UP_MS) return "skipped" as const;

  if (!meta.followUpSentAt) {
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

    await createConsultationOpsIssue(supabase, order, "HIGH", "POST_SLOT_FOLLOW_UP");
    await notifyBothByPushAndEmail(supabase, order, {
      title: "Consultation follow-up needed",
      customerBody: "The consultation time has passed. We are following up so the order moves to a quote, reschedule, or clear next step.",
      tailorBody: "The consultation time has passed. Send a quote, reschedule, or decline this order so the customer has a clear next step.",
    });
    await audit(supabase, {
      event: "consultation.post_slot_follow_up",
      actor_role: "SYSTEM",
      order_id: order.id,
      severity: "warn",
      payload: {
        function: FN,
        scheduled_start_at: meta.scheduledStartAt,
        room_created: Boolean(order.video_call_url),
      },
    });
    return "followed_up" as const;
  }

  if (ageAfterEnd >= REQUEST_FOLLOW_UP_MS) {
    const hadRoom = Boolean(order.video_call_url) || meta.status === "COMPLETED";
    const nextConsultation = {
      ...meta,
      status: hadRoom ? "COMPLETED" as const : "EXPIRED" as const,
      expiredAt: hadRoom ? meta.expiredAt ?? null : nowIso,
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

    await releaseConsultationSlot(supabase, order.id, hadRoom ? "COMPLETED" : "CANCELLED");
    await supabase.from("order_stage_updates").insert({
      order_id: order.id,
      stage: "PENDING_QUOTE",
      note: hadRoom
        ? "Drape returned the order to quote review after the consultation window ended."
        : "Drape expired the missed consultation slot and returned the order to quote review.",
    });
    await createConsultationOpsIssue(supabase, order, hadRoom ? "HIGH" : "CRITICAL", "EXPIRED");
    await notifyBothByPushAndEmail(supabase, order, {
      title: hadRoom ? "Quote follow-up needed" : "Consultation slot expired",
      customerBody: hadRoom
        ? "The consultation window is complete. We are nudging the tailor to send a quote or next step."
        : "The consultation slot expired without a call. The order is back in quote review and Drape has flagged it for follow-up.",
      tailorBody: hadRoom
        ? "The consultation window is complete. Send a quote, reschedule, or decline the order now."
        : "The consultation slot expired without a call. Send a quote, reschedule, or decline the order so the customer has a next step.",
    });
    await audit(supabase, {
      event: hadRoom ? "consultation.returned_to_quote_review" : "consultation.slot_expired",
      actor_role: "SYSTEM",
      order_id: order.id,
      severity: hadRoom ? "warn" : "error",
      payload: {
        function: FN,
        scheduled_start_at: meta.scheduledStartAt,
        room_created: Boolean(order.video_call_url),
      },
    });
    return "expired" as const;
  }

  return "skipped" as const;
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
    const { data, error } = await supabase
      .from("orders")
      .select("id, reference, customer_id, tailor_id, stage, special_note, video_call_url, order_kind, garment_type, item_title, item_size")
      .eq("stage", "CONSULTATION")
      .not("special_note", "is", null);

    if (error) {
      log("error", FN, "orders.lookup_failed", { error: error.message });
      return new Response(JSON.stringify({ error: "Could not check consultation reminders" }), {
        status: 500,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    let sent30 = 0;
    let sent5 = 0;
    let followedUp = 0;
    let expired = 0;
    let skipped = 0;

    for (const order of (data ?? []) as OrderRow[]) {
      const supportMeta = parseOrderSupportMeta(order.special_note);
      const consultation = supportMeta.consultation ?? null;
      try {
        const lifecycle = await handleConsultationLifecycle(supabase, order, consultation, now);
        if (lifecycle === "followed_up") followedUp += 1;
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
        reminder5SentAt: kind === "5" ? now.toISOString() : consultation!.reminder5SentAt ?? null,
      };

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

      await sendReminder(supabase, order, kind);
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
      else sent5 += 1;
    }

    return new Response(JSON.stringify({ ok: true, sent30, sent5, followedUp, expired, skipped }), {
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
