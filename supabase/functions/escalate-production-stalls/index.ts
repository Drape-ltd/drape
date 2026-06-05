import {
  createClient,
  type SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2";
import {
  type OrderStage,
  PRODUCTION_STAGES,
} from "../../../packages/shared/src/order-machine.ts";
import { authorizeCronRequest } from "../_shared/cron.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { getServiceRoleKey, getSupabaseUrl } from "../_shared/env.ts";
import { audit, log } from "../_shared/logger.ts";
import { sendPushToUser } from "../_shared/notify.ts";
import { createOrRefreshOpsIssue } from "../_shared/ops-issues.ts";
import {
  getClientIp,
  RATE_LIMITS,
  rateLimit,
  rateLimitExceededResponse,
} from "../_shared/rateLimit.ts";

const FN = "escalate-production-stalls";
const REMINDER_DAYS = 5;
const DISPUTE_DAYS = 10;
const DEADLINE_WARNING_DAYS = 2;
const PICKUP_REMINDER_DAYS = 7;
const PICKUP_OPS_DAYS = 14;
const PICKUP_STORAGE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

declare const EdgeRuntime: {
  waitUntil(promise: Promise<unknown>): void;
};

type TailorProfileRelation = {
  user_id: string | null;
  display_name: string | null;
};

type OrderRow = {
  id: string;
  reference: string | null;
  customer_id: string | null;
  tailor_id: string | null;
  tailor_profile_id: string | null;
  order_kind: string | null;
  stage: OrderStage;
  deadline: string | null;
  delivery_method?: string | null;
  handoff_completed_at?: string | null;
  customer_handoff_confirmed_at?: string | null;
  stage_updated_at: string | null;
  created_at: string | null;
  tailor_profiles?: TailorProfileRelation | TailorProfileRelation[] | null;
};

type ExistingIssueRow = {
  id: string;
  status: string | null;
  metadata?: Record<string, unknown> | null;
};

function issueKey(orderId: string, days: number) {
  return `production-stall:${days}d:${orderId}`;
}

function deadlineIssueKey(orderId: string) {
  return `deadline-risk:${orderId}`;
}

function pickupIssueKey(orderId: string, days: number) {
  return `pickup-uncollected:${days}d:${orderId}`;
}

function orderLabel(order: OrderRow) {
  return order.reference ? `order ${order.reference}` : "this order";
}

function isReadyMade(order: OrderRow) {
  return order.order_kind === "READY_MADE";
}

function staleUpdateLabel(order: OrderRow) {
  return isReadyMade(order) ? "fulfillment update" : "production update";
}

function tailorUserId(order: OrderRow) {
  if (order.tailor_id) return order.tailor_id;
  const relation = Array.isArray(order.tailor_profiles)
    ? order.tailor_profiles[0]
    : order.tailor_profiles;
  return relation?.user_id ?? null;
}

function staleDays(order: OrderRow, nowMs: number) {
  const raw = order.stage_updated_at ?? order.created_at;
  if (!raw) return 0;
  return Math.floor((nowMs - new Date(raw).getTime()) / DAY_MS);
}

function daysUntilDeadline(order: OrderRow, nowMs: number) {
  if (!order.deadline) return null;
  const deadlineMs = new Date(order.deadline).getTime();
  if (!Number.isFinite(deadlineMs)) return null;
  return Math.ceil((deadlineMs - nowMs) / DAY_MS);
}

async function findOpsIssue(
  supabase: SupabaseClient,
  dedupeKey: string,
): Promise<ExistingIssueRow | null> {
  const { data, error } = await supabase
    .from("ops_issues")
    .select("id, status, metadata")
    .eq("dedupe_key", dedupeKey)
    .maybeSingle();

  if (error) {
    log("error", FN, "ops_issue.lookup_failed", {
      dedupe_key: dedupeKey,
      error: error.message,
    });
    return null;
  }

  return (data as ExistingIssueRow | null) ?? null;
}

async function createReminderIssue(
  supabase: SupabaseClient,
  order: OrderRow,
  daysIdle: number,
) {
  return await createOrRefreshOpsIssue(supabase, {
    issueType: "PRODUCTION_STALL",
    severity: "HIGH",
    source: FN,
    actorRole: "SYSTEM",
    orderId: order.id,
    userId: order.customer_id,
    tailorProfileId: order.tailor_profile_id,
    stage: order.stage,
    title: isReadyMade(order)
      ? "Ready-made fulfillment is overdue"
      : "Production update is overdue",
    description: `${
      orderLabel(order)
    } has had no ${staleUpdateLabel(order)} for ${daysIdle} days.`,
    recommendedAction:
      isReadyMade(order)
        ? "Check the order thread, remind the tailor to prepare or hand off the item, and follow up if there is no response."
        : "Check the order thread, remind the tailor to post a production update, and follow up if there is no response.",
    dedupeKey: issueKey(order.id, REMINDER_DAYS),
    metadata: {
      days_idle: daysIdle,
      reminder_after_days: REMINDER_DAYS,
      dispute_after_days: DISPUTE_DAYS,
      stage_updated_at: order.stage_updated_at,
    },
  });
}

async function createDisputeIssue(
  supabase: SupabaseClient,
  order: OrderRow,
  daysIdle: number,
) {
  return await createOrRefreshOpsIssue(supabase, {
    issueType: "PRODUCTION_STALL",
    severity: "CRITICAL",
    source: FN,
    actorRole: "SYSTEM",
    orderId: order.id,
    userId: order.customer_id,
    tailorProfileId: order.tailor_profile_id,
    stage: "IN_DISPUTE",
    title: isReadyMade(order)
      ? "Ready-made order auto-escalated for fulfillment inactivity"
      : "Order auto-escalated for production inactivity",
    description: `${
      orderLabel(order)
    } has had no ${staleUpdateLabel(order)} for ${daysIdle} days and was moved to dispute review.`,
    recommendedAction:
      "Contact the tailor immediately, confirm whether production is still active, and protect the customer before releasing any payout.",
    dedupeKey: issueKey(order.id, DISPUTE_DAYS),
    metadata: {
      days_idle: daysIdle,
      reminder_after_days: REMINDER_DAYS,
      dispute_after_days: DISPUTE_DAYS,
      previous_stage: order.stage,
      stage_updated_at: order.stage_updated_at,
    },
  });
}

async function createDeadlineIssue(
  supabase: SupabaseClient,
  order: OrderRow,
  daysRemaining: number,
) {
  return await createOrRefreshOpsIssue(supabase, {
    issueType: "ORDER_REVIEW",
    severity: daysRemaining <= 1 ? "HIGH" : "MEDIUM",
    source: FN,
    actorRole: "SYSTEM",
    orderId: order.id,
    userId: order.customer_id,
    tailorProfileId: order.tailor_profile_id,
    stage: order.stage,
    title: "Order deadline is approaching",
    description: `${orderLabel(order)} is due in ${daysRemaining} day${
      daysRemaining === 1 ? "" : "s"
    } and should have a clear customer-facing update.`,
    recommendedAction:
      "Check the order thread, confirm the tailor's next step, and make sure the customer knows whether the deadline still holds.",
    dedupeKey: deadlineIssueKey(order.id),
    metadata: {
      deadline: order.deadline,
      days_remaining: daysRemaining,
      warning_after_days: DEADLINE_WARNING_DAYS,
      stage_updated_at: order.stage_updated_at,
    },
  });
}

async function createPickupIssue(
  supabase: SupabaseClient,
  order: OrderRow,
  daysWaiting: number,
) {
  const severity = daysWaiting >= PICKUP_STORAGE_DAYS
    ? "HIGH"
    : daysWaiting >= PICKUP_OPS_DAYS
      ? "MEDIUM"
      : "LOW";
  return await createOrRefreshOpsIssue(supabase, {
    issueType: "ORDER_REVIEW",
    severity,
    source: FN,
    actorRole: "SYSTEM",
    orderId: order.id,
    userId: order.customer_id,
    tailorProfileId: order.tailor_profile_id,
    stage: order.stage,
    title: daysWaiting >= PICKUP_STORAGE_DAYS
      ? "Pickup order has become a storage risk"
      : daysWaiting >= PICKUP_OPS_DAYS
        ? "Pickup order is still uncollected"
        : "Pickup reminder needed",
    description: `${orderLabel(order)} has been ready for collection for ${daysWaiting} days without customer confirmation.`,
    recommendedAction: daysWaiting >= PICKUP_STORAGE_DAYS
      ? "Contact both parties, confirm whether the garment is still with the tailor, and decide the storage or reschedule plan before payout release."
      : daysWaiting >= PICKUP_OPS_DAYS
        ? "Follow up with the customer and tailor to schedule collection, then log the plan in the order timeline."
        : "Remind the customer to collect the garment and remind the tailor to keep the pickup record inside Drape.",
    dedupeKey: pickupIssueKey(order.id, daysWaiting >= PICKUP_STORAGE_DAYS ? PICKUP_STORAGE_DAYS : daysWaiting >= PICKUP_OPS_DAYS ? PICKUP_OPS_DAYS : PICKUP_REMINDER_DAYS),
    metadata: {
      days_waiting: daysWaiting,
      reminder_after_days: PICKUP_REMINDER_DAYS,
      ops_after_days: PICKUP_OPS_DAYS,
      storage_after_days: PICKUP_STORAGE_DAYS,
      stage_updated_at: order.stage_updated_at,
    },
  });
}

async function resolveSupersededReminderIssue(
  supabase: SupabaseClient,
  order: OrderRow,
  supersededByIssueId: string | null | undefined,
) {
  const existing = await findOpsIssue(supabase, issueKey(order.id, REMINDER_DAYS));
  if (!existing?.id || existing.status === "RESOLVED") return;

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("ops_issues")
    .update({
      status: "RESOLVED",
      resolved_at: now,
      last_seen_at: now,
      metadata: {
        ...(existing.metadata ?? {}),
        superseded_by: "production_stall_10d",
        superseded_by_issue_id: supersededByIssueId ?? null,
      },
    })
    .eq("id", existing.id);

  if (error) {
    log("warn", FN, "reminder_issue.resolve_failed", {
      order_id: order.id,
      issue_id: existing.id,
      error: error.message,
    });
    return;
  }

  await supabase.from("ops_audit_logs").insert({
    issue_id: existing.id,
    action_taken: "ISSUE_SUPERSEDED",
    performed_by: null,
    performed_role: "SYSTEM",
    reason: "The 5-day production-stall reminder was superseded by the 10-day dispute escalation.",
    before_state: { status: existing.status },
    after_state: {
      status: "RESOLVED",
      superseded_by_issue_id: supersededByIssueId ?? null,
    },
  });
}

async function ensureSystemDispute(
  supabase: SupabaseClient,
  order: OrderRow,
  daysIdle: number,
) {
  const reason = "Tailor inactivity";
  const description =
    `Drape opened this review automatically because the tailor has not posted a ${staleUpdateLabel(order)} for ${daysIdle} days.`;

  const existing = await supabase
    .from("disputes")
    .select("id")
    .eq("order_id", order.id)
    .maybeSingle();

  if (existing.error) throw new Error(existing.error.message);

  if (existing.data?.id) {
    const { error } = await supabase
      .from("disputes")
      .update({
        customer_id: order.customer_id,
        reason,
        description,
        status: "OPEN",
        resolution: null,
        resolved_at: null,
        resolved_by: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.data.id);

    if (error) throw new Error(error.message);
    return { id: existing.data.id as string, created: false };
  }

  const { data, error } = await supabase
    .from("disputes")
    .insert({
      order_id: order.id,
      customer_id: order.customer_id,
      reason,
      description,
      updated_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);
  return { id: data.id as string, created: true };
}

async function sendReminderNotifications(
  supabase: SupabaseClient,
  order: OrderRow,
) {
  if (order.customer_id) {
    EdgeRuntime.waitUntil(
      sendPushToUser(supabase, order.customer_id, {
        title: "We are checking on your order",
        body: "Your order hasn't been updated recently. We're following up.",
        preferenceKey: "orderUpdates",
        data: { orderId: order.id },
      }),
    );
  }

  const tailorId = tailorUserId(order);
  if (tailorId) {
    EdgeRuntime.waitUntil(
      sendPushToUser(supabase, tailorId, {
        title: "Production update needed",
        body:
          isReadyMade(order)
            ? "Please update this order so the customer knows whether it is being prepared, packed, or handed off."
            : "Please post an update for this order so the customer knows what is happening.",
        preferenceKey: "newOrders",
        data: { orderId: order.id },
      }),
    );
  }
}

async function sendDisputeNotifications(
  supabase: SupabaseClient,
  order: OrderRow,
) {
  if (order.customer_id) {
    EdgeRuntime.waitUntil(
      sendPushToUser(supabase, order.customer_id, {
        title: "Drape is stepping in",
        body:
          "Your order has been paused for support review because production updates stopped.",
        data: { orderId: order.id },
      }),
    );
  }

  const tailorId = tailorUserId(order);
  if (tailorId) {
    EdgeRuntime.waitUntil(
      sendPushToUser(supabase, tailorId, {
        title: "Order review opened",
        body:
          "This order has not been updated in 10 days. Add an update in Drape or respond to support.",
        data: { orderId: order.id },
      }),
    );
  }
}

async function sendDeadlineNotifications(
  supabase: SupabaseClient,
  order: OrderRow,
  daysRemaining: number,
) {
  if (order.customer_id) {
    EdgeRuntime.waitUntil(
      sendPushToUser(supabase, order.customer_id, {
        title: "Order deadline check",
        body:
          daysRemaining <= 1
            ? "Your order deadline is close. We are checking that the next step is clear."
            : "Your order deadline is coming up. We are checking that progress stays on track.",
        preferenceKey: "orderUpdates",
        data: { orderId: order.id },
      }),
    );
  }

  const tailorId = tailorUserId(order);
  if (tailorId) {
    EdgeRuntime.waitUntil(
      sendPushToUser(supabase, tailorId, {
        title: "Deadline check needed",
        body:
          daysRemaining <= 1
            ? "This order deadline is very close. Post the next update or message the customer now."
            : "This order deadline is coming up. Add a progress update so the customer is not left guessing.",
        preferenceKey: "newOrders",
        data: { orderId: order.id },
      }),
    );
  }
}

async function sendPickupNotifications(
  supabase: SupabaseClient,
  order: OrderRow,
  daysWaiting: number,
) {
  if (order.customer_id) {
    EdgeRuntime.waitUntil(
      sendPushToUser(supabase, order.customer_id, {
        title: "Pickup reminder",
        body: daysWaiting >= PICKUP_OPS_DAYS
          ? "Your order has been waiting for collection. Drape is checking in so pickup stays clear."
          : "Your order is ready for collection. Please collect it soon or message the tailor inside Drape.",
        preferenceKey: "orderUpdates",
        data: { orderId: order.id },
      }),
    );
  }

  const tailorId = tailorUserId(order);
  if (tailorId) {
    EdgeRuntime.waitUntil(
      sendPushToUser(supabase, tailorId, {
        title: "Pickup still open",
        body: daysWaiting >= PICKUP_OPS_DAYS
          ? "Drape is checking on this uncollected pickup. Keep the garment and any pickup plan in the order thread."
          : "This pickup is still open. Message the customer in Drape if collection needs a new time.",
        preferenceKey: "newOrders",
        data: { orderId: order.id },
      }),
    );
  }
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
    if (!limit.allowed) {
      return rateLimitExceededResponse(cors, limit.retryAfter);
    }

    const now = new Date();
    const nowMs = now.getTime();
    const reminderCutoff = new Date(nowMs - REMINDER_DAYS * DAY_MS)
      .toISOString();

    const { data, error } = await supabase
      .from("orders")
      .select(
        "id, reference, customer_id, tailor_id, tailor_profile_id, order_kind, stage, stage_updated_at, created_at, tailor_profiles!tailor_profile_id(user_id, display_name)",
      )
      .in("stage", PRODUCTION_STAGES)
      .lte("stage_updated_at", reminderCutoff)
      .order("stage_updated_at", { ascending: true });

    if (error) {
      log("error", FN, "orders.lookup_failed", { error: error.message });
      return new Response(
        JSON.stringify({ error: "Could not check production stalls" }),
        {
          status: 500,
          headers: { ...cors, "Content-Type": "application/json" },
        },
      );
    }

    let reminded = 0;
    let reminderRefreshed = 0;
    let disputed = 0;
    let deadlineWarnings = 0;
    let deadlineWarningsRefreshed = 0;
    let pickupReminders = 0;
    let pickupRemindersRefreshed = 0;
    let skipped = 0;

    for (const order of (data ?? []) as OrderRow[]) {
      const daysIdle = staleDays(order, nowMs);

      try {
        if (daysIdle >= DISPUTE_DAYS) {
          const beforeIssue = await findOpsIssue(
            supabase,
            issueKey(order.id, DISPUTE_DAYS),
          );
          const dispute = await ensureSystemDispute(
            supabase,
            order,
            daysIdle,
          );

          const { data: updated, error: updateError } = await supabase
            .from("orders")
            .update({
              stage: "IN_DISPUTE",
              stage_updated_at: now.toISOString(),
            })
            .eq("id", order.id)
            .in("stage", PRODUCTION_STAGES)
            .select("id")
            .maybeSingle();

          if (updateError) throw new Error(updateError.message);
          if (!updated?.id) {
            if (dispute.created) {
              await supabase.from("disputes").delete().eq("id", dispute.id);
            }
            skipped += 1;
            continue;
          }

          const criticalIssue = await createDisputeIssue(supabase, order, daysIdle);
          await resolveSupersededReminderIssue(supabase, order, criticalIssue?.id);
          await supabase.from("order_stage_updates").insert({
            order_id: order.id,
            stage: "IN_DISPUTE",
            note:
              `Drape opened support review after ${daysIdle} days without a production update.`,
          });
          await audit(supabase, {
            event: "order.production_stall_disputed",
            actor_role: "SYSTEM",
            order_id: order.id,
            severity: "error",
            payload: {
              function: FN,
              days_idle: daysIdle,
              from_stage: order.stage,
              dispute_id: dispute.id,
            },
          });

          disputed += 1;
          if (!beforeIssue?.id) await sendDisputeNotifications(supabase, order);
          continue;
        }

        const beforeIssue = await findOpsIssue(
          supabase,
          issueKey(order.id, REMINDER_DAYS),
        );
        await createReminderIssue(supabase, order, daysIdle);

        if (beforeIssue?.id) {
          reminderRefreshed += 1;
          continue;
        }

        await supabase.from("order_stage_updates").insert({
          order_id: order.id,
          stage: order.stage,
          note:
            `Drape reminded the tailor after ${daysIdle} days without a ${staleUpdateLabel(order)}.`,
        });
        await audit(supabase, {
          event: "order.production_stall_reminder",
          actor_role: "SYSTEM",
          order_id: order.id,
          severity: "warn",
          payload: {
            function: FN,
            days_idle: daysIdle,
            stage: order.stage,
          },
        });

        reminded += 1;
        await sendReminderNotifications(supabase, order);
      } catch (orderError) {
        skipped += 1;
        log("error", FN, "order.process_failed", {
          order_id: order.id,
          error: orderError instanceof Error
            ? orderError.message
            : String(orderError),
        });
      }
    }

    const deadlineCutoff = new Date(nowMs + DEADLINE_WARNING_DAYS * DAY_MS)
      .toISOString();
    const { data: deadlineOrders, error: deadlineError } = await supabase
      .from("orders")
      .select(
        "id, reference, customer_id, tailor_id, tailor_profile_id, order_kind, stage, deadline, stage_updated_at, created_at, tailor_profiles!tailor_profile_id(user_id, display_name)",
      )
      .eq("order_kind", "CUSTOM")
      .in("stage", PRODUCTION_STAGES)
      .not("deadline", "is", null)
      .gte("deadline", now.toISOString())
      .lte("deadline", deadlineCutoff)
      .order("deadline", { ascending: true });

    if (deadlineError) {
      log("error", FN, "deadline_orders.lookup_failed", {
        error: deadlineError.message,
      });
    } else {
      for (const order of (deadlineOrders ?? []) as OrderRow[]) {
        const daysRemaining = daysUntilDeadline(order, nowMs);
        if (daysRemaining == null || daysRemaining < 0 || daysRemaining > DEADLINE_WARNING_DAYS) {
          continue;
        }

        try {
          const existingIssue = await findOpsIssue(
            supabase,
            deadlineIssueKey(order.id),
          );
          await createDeadlineIssue(supabase, order, daysRemaining);

          if (existingIssue?.id) {
            deadlineWarningsRefreshed += 1;
            continue;
          }

          await supabase.from("order_stage_updates").insert({
            order_id: order.id,
            stage: order.stage,
            note:
              `Drape flagged this order because the deadline is due in ${daysRemaining} day${
                daysRemaining === 1 ? "" : "s"
              }.`,
          });
          await audit(supabase, {
            event: "order.deadline_warning",
            actor_role: "SYSTEM",
            order_id: order.id,
            severity: daysRemaining <= 1 ? "warn" : "info",
            payload: {
              function: FN,
              deadline: order.deadline,
              days_remaining: daysRemaining,
              stage: order.stage,
            },
          });

          deadlineWarnings += 1;
          await sendDeadlineNotifications(supabase, order, daysRemaining);
        } catch (orderError) {
          skipped += 1;
          log("error", FN, "deadline_order.process_failed", {
            order_id: order.id,
            error: orderError instanceof Error
              ? orderError.message
              : String(orderError),
          });
        }
      }
    }

    const pickupCutoff = new Date(nowMs - PICKUP_REMINDER_DAYS * DAY_MS)
      .toISOString();
    const { data: pickupOrders, error: pickupError } = await supabase
      .from("orders")
      .select(
        "id, reference, customer_id, tailor_id, tailor_profile_id, order_kind, stage, delivery_method, handoff_completed_at, customer_handoff_confirmed_at, stage_updated_at, created_at, tailor_profiles!tailor_profile_id(user_id, display_name)",
      )
      .eq("stage", "READY_FOR_COLLECTION")
      .eq("delivery_method", "LOCAL_COLLECTION")
      .is("customer_handoff_confirmed_at", null)
      .lte("stage_updated_at", pickupCutoff)
      .order("stage_updated_at", { ascending: true });

    if (pickupError) {
      log("error", FN, "pickup_orders.lookup_failed", {
        error: pickupError.message,
      });
    } else {
      for (const order of (pickupOrders ?? []) as OrderRow[]) {
        const daysWaiting = staleDays(order, nowMs);
        if (daysWaiting < PICKUP_REMINDER_DAYS) continue;
        const threshold = daysWaiting >= PICKUP_STORAGE_DAYS
          ? PICKUP_STORAGE_DAYS
          : daysWaiting >= PICKUP_OPS_DAYS
            ? PICKUP_OPS_DAYS
            : PICKUP_REMINDER_DAYS;

        try {
          const existingIssue = await findOpsIssue(
            supabase,
            pickupIssueKey(order.id, threshold),
          );
          await createPickupIssue(supabase, order, daysWaiting);

          if (existingIssue?.id) {
            pickupRemindersRefreshed += 1;
            continue;
          }

          await supabase.from("order_stage_updates").insert({
            order_id: order.id,
            stage: order.stage,
            note:
              `Drape flagged this pickup because it has been ready for collection for ${daysWaiting} day${
                daysWaiting === 1 ? "" : "s"
              }.`,
          });
          await audit(supabase, {
            event: "order.pickup_uncollected",
            actor_role: "SYSTEM",
            order_id: order.id,
            severity: daysWaiting >= PICKUP_STORAGE_DAYS ? "warn" : "info",
            payload: {
              function: FN,
              days_waiting: daysWaiting,
              threshold,
              stage_updated_at: order.stage_updated_at,
            },
          });

          pickupReminders += 1;
          await sendPickupNotifications(supabase, order, daysWaiting);
        } catch (orderError) {
          skipped += 1;
          log("error", FN, "pickup_order.process_failed", {
            order_id: order.id,
            error: orderError instanceof Error
              ? orderError.message
              : String(orderError),
          });
        }
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        reminded,
        reminderRefreshed,
        disputed,
        deadlineWarnings,
        deadlineWarningsRefreshed,
        pickupReminders,
        pickupRemindersRefreshed,
        skipped,
      }),
      {
        status: 200,
        headers: { ...cors, "Content-Type": "application/json" },
      },
    );
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
