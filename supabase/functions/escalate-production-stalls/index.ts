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
  stage: OrderStage;
  stage_updated_at: string | null;
  created_at: string | null;
  tailor_profiles?: TailorProfileRelation | TailorProfileRelation[] | null;
};

type ExistingIssueRow = {
  id: string;
  status: string | null;
};

function issueKey(orderId: string, days: number) {
  return `production-stall:${days}d:${orderId}`;
}

function orderLabel(order: OrderRow) {
  return order.reference ? `order ${order.reference}` : "this order";
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

async function findOpsIssue(
  supabase: SupabaseClient,
  dedupeKey: string,
): Promise<ExistingIssueRow | null> {
  const { data, error } = await supabase
    .from("ops_issues")
    .select("id, status")
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
    title: "Production update is overdue",
    description: `${
      orderLabel(order)
    } has had no production stage update for ${daysIdle} days.`,
    recommendedAction:
      "Check the order thread, remind the tailor to post a production update, and follow up if there is no response.",
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
    title: "Order auto-escalated for production inactivity",
    description: `${
      orderLabel(order)
    } has had no production stage update for ${daysIdle} days and was moved to dispute review.`,
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

async function ensureSystemDispute(
  supabase: SupabaseClient,
  order: OrderRow,
  daysIdle: number,
) {
  const reason = "Tailor inactivity";
  const description =
    `Drape opened this review automatically because the tailor has not posted a production update for ${daysIdle} days.`;

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
          "Please post an update for this order so the customer knows what is happening.",
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
        "id, reference, customer_id, tailor_id, tailor_profile_id, stage, stage_updated_at, created_at, tailor_profiles!tailor_profile_id(user_id, display_name)",
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
              dispute_id: dispute.id,
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

          await createDisputeIssue(supabase, order, daysIdle);
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
            `Drape reminded the tailor after ${daysIdle} days without a production update.`,
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

    return new Response(
      JSON.stringify({
        ok: true,
        reminded,
        reminderRefreshed,
        disputed,
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
