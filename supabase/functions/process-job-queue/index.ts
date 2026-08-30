import {
  createClient,
  type SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { authorizeCronRequest } from "../_shared/cron.ts";
import { getServiceRoleKey, getSupabaseUrl } from "../_shared/env.ts";
import {
  asRecord,
  asString,
  claimDueJobs,
  createWorkerId,
  enqueueBackgroundJob,
  finishJob,
  type JobRow,
  type JobType,
} from "../_shared/jobs.ts";
import { log } from "../_shared/logger.ts";
import { type PushPayload, sendPushToUser } from "../_shared/notify.ts";
import { sendAccountEventEmail } from "../_shared/account-email.ts";
import {
  sendOrderConfirmationEmails,
  sendOrderEventEmail,
} from "../_shared/order-email.ts";
import { createOrRefreshOpsIssue } from "../_shared/ops-issues.ts";
import { createOverduePayoutIssues } from "../_shared/payout-watchdog.ts";
import { Sentry } from "../_shared/sentry.ts";
import { sendSmsToUser } from "../_shared/sms.ts";
import { reconcilePaymentWebhook } from "../_shared/payment-webhook-reconciliation.ts";
import { processFabricCandidateRelease } from "../_shared/fabric-release.ts";
import { processDispatchRefund } from "../_shared/drapeon-dispatch-refund.ts";
import { reconcileDispatchRunIfReady } from "../_shared/drapeon-dispatch-reconciliation.ts";
import { loadQueuedDeliveryWebhook } from "../_shared/delivery-webhook.ts";
import { sendOpsSlackDigest, sendOpsSlackEvent } from "../_shared/slack-ops.ts";
import {
  processCommunicationCampaignRecipient,
  recordCommunicationCampaignJobFailure,
} from "../_shared/communication-campaign-worker.ts";

const FN = "process-job-queue";
const DEFAULT_LIMIT = 25;
const PAUSE_VALUES = new Set(["1", "true", "yes", "on"]);
const ALLOWED_JOB_TYPES = new Set<JobType>([
  "SEND_PUSH",
  "SEND_SMS",
  "SEND_ACCOUNT_EVENT_EMAIL",
  "SEND_ORDER_EVENT_EMAIL",
  "SEND_ORDER_CONFIRMATION_EMAILS",
  "SEND_OPS_VERIFICATION_EMAIL",
  "SEND_OPS_SLACK",
  "SEND_OPS_SLACK_DIGEST",
  "CREATE_OPS_ISSUE",
  "PROCESS_PAYMENT_WEBHOOK",
  "RECONCILE_PAYMENT_WEBHOOK",
  "PROCESS_FABRIC_RELEASE",
  "PROCESS_TIP_PAYOUT",
  "PROCESS_DISPATCH_REFUND",
  "RECONCILE_DISPATCH_RUN",
  "PROCESS_DELIVERY_WEBHOOK",
  "RECONCILE_DELIVERY_WEBHOOK",
  "SEND_COMMUNICATION_CAMPAIGN",
]);

type NotificationDeliveryResult = {
  channel: "PUSH" | "EMAIL" | "SMS";
  status: "DELIVERED" | "SKIPPED";
  reason?: string | null;
  provider?: string | null;
  providerReference?: string | null;
};

function jsonResponse(
  body: unknown,
  status: number,
  cors: Record<string, string>,
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function backgroundWorkersPaused() {
  const value = Deno.env.get("DRAPE_BACKGROUND_WORKERS_PAUSED")?.trim()
    .toLowerCase();
  return value ? PAUSE_VALUES.has(value) : false;
}

function isAllowedJobType(value: string | null): value is JobType {
  return !!value && ALLOWED_JOB_TYPES.has(value as JobType);
}

async function readProcessingOptions(req: Request) {
  const fallback = { limit: DEFAULT_LIMIT, jobTypes: null as JobType[] | null };
  if (req.method !== "POST") return fallback;

  try {
    const body = await req.json();
    const payload = asRecord(body);
    const limitValue = Number(payload.limit);
    const limit = Number.isFinite(limitValue)
      ? Math.max(1, Math.min(100, Math.trunc(limitValue)))
      : DEFAULT_LIMIT;
    const jobTypes = Array.isArray(payload.jobTypes)
      ? payload.jobTypes
        .map((item) => asString(item))
        .filter(isAllowedJobType)
      : null;

    return {
      limit,
      jobTypes: jobTypes && jobTypes.length > 0 ? jobTypes : null,
    };
  } catch {
    return fallback;
  }
}

function requireString(payload: Record<string, unknown>, key: string) {
  const value = asString(payload[key]);
  if (!value) throw new Error(`Job payload is missing ${key}`);
  return value;
}

function stringRecord(value: unknown) {
  const source = asRecord(value);
  const output: Record<string, string> = {};
  for (const [key, item] of Object.entries(source)) {
    if (typeof item === "string") output[key] = item;
    else if (typeof item === "number" || typeof item === "boolean") {
      output[key] = String(item);
    }
  }
  return output;
}

function ensureAudience(value: string | null, field: string) {
  if (value === "CUSTOMER" || value === "TAILOR") return value;
  throw new Error(`Job payload ${field} must be CUSTOMER or TAILOR`);
}

function ensurePaymentPhase(value: string | null) {
  if (
    value === "INITIAL_ORDER" || value === "FULFILLMENT" ||
    value === "CONSULTATION"
  ) return value;
  throw new Error(
    "Job payload phase must be INITIAL_ORDER, FULFILLMENT, or CONSULTATION",
  );
}

function optionalInterruptionLevel(
  value: unknown,
): PushPayload["interruptionLevel"] | undefined {
  const level = asString(value);
  if (!level) return undefined;
  if (level === "timeSensitive") return "time-sensitive";
  if (
    level === "passive" || level === "active" || level === "time-sensitive" ||
    level === "critical"
  ) {
    return level;
  }
  throw new Error("Job payload interruptionLevel is invalid");
}

function paymentProvider(value: string | null) {
  if (value === "PAYSTACK" || value === "STRIPE") return value;
  throw new Error("Job payload provider must be PAYSTACK or STRIPE");
}

async function updateWebhookLifecycle(
  supabase: SupabaseClient,
  webhookEventId: string,
  values: Record<string, unknown>,
) {
  const { error } = await supabase
    .from("payment_webhook_events")
    .update(values)
    .eq("id", webhookEventId);
  if (error) {
    throw new Error(
      `Could not update payment webhook lifecycle: ${error.message}`,
    );
  }
}

async function processQueuedPaymentWebhook(
  supabase: SupabaseClient,
  payload: Record<string, unknown>,
) {
  const webhookEventId = requireString(payload, "webhookEventId");
  const provider = paymentProvider(asString(payload.provider));
  await updateWebhookLifecycle(supabase, webhookEventId, {
    processing_status: "PROCESSING",
    processing_started_at: new Date().toISOString(),
    last_processing_error: null,
  });

  const serviceRoleKey = getServiceRoleKey();
  const endpoint = `${getSupabaseUrl()}/functions/v1/${
    provider === "PAYSTACK" ? "paystack-webhook" : "stripe-webhook"
  }`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey,
      "Content-Type": "application/json",
      "x-drape-webhook-event-id": webhookEventId,
    },
    body: "{}",
  });
  const responseBody = await response.text();
  if (!response.ok) {
    throw new Error(
      `${provider} queued webhook replay returned ${response.status}: ${
        responseBody.slice(0, 500)
      }`,
    );
  }

  const processed = await supabase
    .from("payment_webhook_events")
    .select("processed_at, processing_result")
    .eq("id", webhookEventId)
    .maybeSingle();
  if (processed.error) {
    throw new Error(
      `Could not verify queued webhook outcome: ${processed.error.message}`,
    );
  }
  if (
    !(processed.data as { processed_at?: string | null } | null)?.processed_at
  ) {
    throw new Error(
      `${provider} webhook handler returned success without a terminal processing record.`,
    );
  }

  await enqueueBackgroundJob(supabase, {
    eventType: "payment.webhook.reconciliation_requested",
    aggregateType: "payment_webhook_event",
    aggregateId: webhookEventId,
    idempotencyKey:
      `payment-webhook-reconciliation:${provider.toLowerCase()}:${webhookEventId}`,
    payload: { webhookEventId, provider },
    metadata: {
      processingResult:
        (processed.data as { processing_result?: string | null })
          .processing_result ?? null,
    },
    jobType: "RECONCILE_PAYMENT_WEBHOOK",
    priority: 25,
    maxAttempts: 12,
    runAt: new Date(Date.now() + 30_000).toISOString(),
  });
}

async function reconcileQueuedPaymentWebhook(
  supabase: SupabaseClient,
  payload: Record<string, unknown>,
) {
  const webhookEventId = requireString(payload, "webhookEventId");
  const provider = paymentProvider(asString(payload.provider));
  await updateWebhookLifecycle(supabase, webhookEventId, {
    reconciliation_status: "RECONCILING",
  });
  const result = await reconcilePaymentWebhook(supabase, {
    webhookEventId,
    provider,
  });
  await updateWebhookLifecycle(supabase, webhookEventId, {
    reconciliation_status: result.matched ? "MATCHED" : "MISMATCH",
    reconciliation_result: result,
    reconciled_at: new Date().toISOString(),
  });

  if (!result.matched) {
    await Promise.allSettled([
      Sentry.captureMessage("Payment webhook did not reconcile with provider", {
        level: "error",
        tags: {
          fn: FN,
          provider,
          failure_class: "webhook_reconciliation_mismatch",
        },
        extra: { webhookEventId, ...result },
      }),
      createOrRefreshOpsIssue(supabase, {
        issueType: "SYSTEM_ALERT",
        severity: "CRITICAL",
        source: FN,
        actorRole: "SYSTEM",
        relatedEntityType: "payment_webhook_event",
        relatedEntityId: webhookEventId,
        provider,
        stage: "WEBHOOK_RECONCILIATION",
        title: "Payment event does not match provider state",
        description:
          `${provider} event ${result.expectedEventType} was processed, but the provider reconciliation did not match.`,
        recommendedAction:
          "Inspect the signed event, current provider object, payment ledger, and any customer-visible outcome before making another money movement.",
        dedupeKey: `payment-webhook-reconciliation-mismatch:${webhookEventId}`,
        metadata: { webhook_event_id: webhookEventId, reconciliation: result },
      }),
    ]);
  }
}

async function updateDeliveryWebhookLifecycle(
  supabase: SupabaseClient,
  webhookEventId: string,
  values: Record<string, unknown>,
) {
  const { error } = await supabase.from("delivery_webhook_events").update(
    values,
  ).eq("id", webhookEventId);
  if (error) {
    throw new Error(
      `Could not update delivery webhook lifecycle: ${error.message}`,
    );
  }
}

async function processQueuedDeliveryWebhook(
  supabase: SupabaseClient,
  payload: Record<string, unknown>,
) {
  const webhookEventId = requireString(payload, "webhookEventId");
  const queued = await loadQueuedDeliveryWebhook(supabase, webhookEventId);
  if (queued.processed_at) return;
  await updateDeliveryWebhookLifecycle(supabase, webhookEventId, {
    processing_status: "PROCESSING",
    processing_started_at: new Date().toISOString(),
    last_processing_error: null,
  });
  const serviceRoleKey = getServiceRoleKey();
  const response = await fetch(
    `${getSupabaseUrl()}/functions/v1/delivery-webhook`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
        "Content-Type": "application/json",
        "x-drape-delivery-webhook-event-id": webhookEventId,
      },
      body: "{}",
    },
  );
  const responseText = await response.text();
  if (!response.ok) {
    await updateDeliveryWebhookLifecycle(supabase, webhookEventId, {
      processing_status: "RETRYABLE",
      last_processing_error: responseText.slice(0, 1000),
    });
    throw new Error(
      `Delivery webhook replay returned ${response.status}: ${
        responseText.slice(0, 500)
      }`,
    );
  }
  let result: Record<string, unknown> = {};
  try {
    result = asRecord(JSON.parse(responseText));
  } catch {
    result = { response: responseText.slice(0, 500) };
  }
  await updateDeliveryWebhookLifecycle(supabase, webhookEventId, {
    processing_status: "PROCESSED",
    processing_result: result,
    processed_at: new Date().toISOString(),
    reconciliation_status: "PENDING",
  });
  await enqueueBackgroundJob(supabase, {
    eventType: "delivery.webhook.reconciliation_requested",
    aggregateType: "delivery_webhook_event",
    aggregateId: webhookEventId,
    idempotencyKey: `delivery-webhook-reconciliation:${webhookEventId}`,
    payload: { webhookEventId },
    metadata: {
      provider: queued.provider,
      providerEventId: queued.provider_event_id,
    },
    jobType: "RECONCILE_DELIVERY_WEBHOOK",
    priority: 30,
    maxAttempts: 12,
    runAt: new Date(Date.now() + 30_000).toISOString(),
  });
}

async function reconcileQueuedDeliveryWebhook(
  supabase: SupabaseClient,
  payload: Record<string, unknown>,
) {
  const webhookEventId = requireString(payload, "webhookEventId");
  const queued = await loadQueuedDeliveryWebhook(supabase, webhookEventId);
  await updateDeliveryWebhookLifecycle(supabase, webhookEventId, {
    reconciliation_status: "RECONCILING",
  });
  const result = asRecord(queued.processing_result);
  const skipped = asString(result.skipped);
  const orderId = asString(result.orderId) ?? asString(result.order_id);
  const fulfillmentEventId = asString(result.fulfillmentEventId);
  // A signed provider update that is irrelevant to the customer-visible
  // lifecycle is a legitimate terminal skip. Missing tracking/order context is
  // recoverable data loss and must surface in Ops instead of disappearing.
  const terminalSkips = new Set(["not_financial_evidence"]);
  let matched = skipped ? terminalSkips.has(skipped) : false;
  let reason = skipped
    ? (matched ? `TERMINAL_SKIP:${skipped}` : `UNRESOLVED_SKIP:${skipped}`)
    : null;

  if (orderId && fulfillmentEventId) {
    const { data, error } = await supabase
      .from("order_fulfillment_events")
      .select("id,order_id,event_type,provider_event_id")
      .eq("id", fulfillmentEventId)
      .eq("order_id", orderId)
      .maybeSingle();
    if (error) {
      throw new Error(`Could not reconcile dispatch event: ${error.message}`);
    }
    matched = !!data && data.provider_event_id === queued.provider_event_id;
    reason = matched
      ? "DISPATCH_EVENT_MATCHED"
      : "DISPATCH_EVENT_MISSING_OR_MISMATCHED";
  }

  await updateDeliveryWebhookLifecycle(supabase, webhookEventId, {
    reconciliation_status: matched ? "MATCHED" : "MISMATCH",
    reconciliation_result: { matched, reason, orderId, fulfillmentEventId },
    reconciled_at: new Date().toISOString(),
  });
  if (!matched) {
    await Promise.allSettled([
      Sentry.captureMessage(
        "Delivery webhook did not reconcile with dispatch timeline",
        {
          level: "error",
          tags: {
            fn: FN,
            provider: queued.provider,
            failure_class: "delivery_webhook_reconciliation_mismatch",
          },
          extra: {
            webhookEventId,
            providerEventId: queued.provider_event_id,
            orderId,
            fulfillmentEventId,
            reason,
          },
        },
      ),
      createOrRefreshOpsIssue(supabase, {
        issueType: "SYSTEM_ALERT",
        severity: "HIGH",
        source: FN,
        actorRole: "SYSTEM",
        orderId,
        relatedEntityType: "delivery_webhook_event",
        relatedEntityId: webhookEventId,
        provider: queued.provider,
        stage: "DELIVERY_WEBHOOK_RECONCILIATION",
        title: "Delivery update did not reconcile",
        description:
          `Signed ${queued.provider} event ${queued.provider_event_id} did not match the Drapeon Dispatch timeline.`,
        recommendedAction:
          "Compare the signed provider event, tracking number, dispatch parcel, order timeline, and any customer-visible delivery state before retrying.",
        dedupeKey: `delivery-webhook-reconciliation:${webhookEventId}`,
        metadata: {
          webhook_event_id: webhookEventId,
          provider_event_id: queued.provider_event_id,
          reason,
        },
      }),
    ]);
  }
}

async function processJob(supabase: SupabaseClient, job: JobRow) {
  const payload = asRecord(job.payload);

  switch (job.job_type) {
    case "SEND_PUSH": {
      const userId = requireString(payload, "userId");
      const notification = asRecord(payload.notification);
      const result = await sendPushToUser(supabase, userId, {
        title: requireString(notification, "title"),
        body: requireString(notification, "body"),
        data: stringRecord(notification.data),
        preferenceKey: asString(notification.preferenceKey) as never,
        channelId: asString(notification.channelId) ?? undefined,
        sound: asString(notification.sound) ?? undefined,
        interruptionLevel: optionalInterruptionLevel(
          notification.interruptionLevel,
        ),
      });
      if (result.status === "ERROR") {
        throw new Error(`Push delivery failed: ${result.reason}`);
      }
      if (result.status === "SKIPPED") {
        log(
          result.reason === "NO_TOKEN" ? "warn" : "info",
          FN,
          "push.skipped",
          {
            job_id: job.id,
            user_id: userId,
            reason: result.reason,
          },
        );
      }
      return {
        channel: "PUSH",
        status: result.status === "SKIPPED" ? "SKIPPED" : "DELIVERED",
        reason: result.status === "SKIPPED" ? result.reason : null,
        provider: "EXPO_OR_WEB_PUSH",
      } satisfies NotificationDeliveryResult;
    }

    case "SEND_SMS": {
      const result = await sendSmsToUser({
        supabase,
        userId: requireString(payload, "userId"),
        audience: ensureAudience(asString(payload.audience), "audience"),
        orderId: asString(payload.orderId),
        event: requireString(payload, "event"),
        body: requireString(payload, "body"),
        fallbackPhone: asString(payload.fallbackPhone),
      });
      return {
        channel: "SMS",
        status: result.status,
        reason: "reason" in result ? result.reason : null,
        provider: result.provider,
        providerReference: "providerReference" in result
          ? result.providerReference
          : null,
      } satisfies NotificationDeliveryResult;
    }

    case "SEND_ACCOUNT_EVENT_EMAIL": {
      const details = Array.isArray(payload.details)
        ? payload.details.map((item) => asRecord(item)).map((item) => ({
          label: requireString(item, "label"),
          value: requireString(item, "value"),
        }))
        : [];
      const result = await sendAccountEventEmail(supabase, {
        userId: requireString(payload, "userId"),
        recipientEmail: asString(payload.recipientEmail),
        subject: requireString(payload, "subject"),
        headline: requireString(payload, "headline"),
        body: requireString(payload, "body"),
        eyebrow: asString(payload.eyebrow) ?? undefined,
        ctaLabel: requireString(payload, "ctaLabel"),
        webPath: requireString(payload, "webPath"),
        appUrl: asString(payload.appUrl),
        details,
      });
      return {
        channel: "EMAIL",
        status: result.status,
        reason: "reason" in result ? result.reason : null,
        provider: "provider" in result ? result.provider : "RESEND",
        providerReference: "providerReference" in result
          ? result.providerReference
          : null,
      } satisfies NotificationDeliveryResult;
    }

    case "SEND_COMMUNICATION_CAMPAIGN": {
      await processCommunicationCampaignRecipient(
        supabase,
        requireString(payload, "recipientId"),
      );
      return null;
    }

    case "SEND_ORDER_EVENT_EMAIL": {
      const onlyIfMessageUnreadId = asString(payload.onlyIfMessageUnreadId);
      if (onlyIfMessageUnreadId) {
        const { data: message, error: messageError } = await supabase
          .from("messages")
          .select("id, read_at, is_deleted")
          .eq("id", onlyIfMessageUnreadId)
          .maybeSingle();
        if (messageError) {
          throw new Error(
            `Unread message check failed: ${messageError.message}`,
          );
        }
        if (!message || message.read_at || message.is_deleted === true) {
          return {
            channel: "EMAIL",
            status: "SKIPPED",
            reason: message?.read_at
              ? "MESSAGE_READ"
              : message?.is_deleted
              ? "MESSAGE_REMOVED"
              : "MESSAGE_NOT_FOUND",
            provider: "RESEND",
          } satisfies NotificationDeliveryResult;
        }
      }
      const result = await sendOrderEventEmail(supabase, {
        order: asRecord(payload.order) as never,
        recipientUserId: requireString(payload, "recipientUserId"),
        audience: ensureAudience(asString(payload.audience), "audience"),
        subject: requireString(payload, "subject"),
        headline: asString(payload.headline) ?? undefined,
        body: requireString(payload, "body"),
        ctaLabel: asString(payload.ctaLabel) ?? undefined,
        materialAdvanceId: asString(payload.materialAdvanceId),
        action: asString(payload.action),
        evidenceImageUrl: asString(payload.evidenceImageUrl),
        evidenceStorageBucket:
          asString(payload.evidenceStorageBucket) === "commercial-evidence"
            ? "commercial-evidence"
            : "order-photos",
      });
      return {
        channel: "EMAIL",
        status: result.status,
        reason: "reason" in result ? result.reason : null,
        provider: "provider" in result ? result.provider : "RESEND",
        providerReference: "providerReference" in result
          ? result.providerReference
          : null,
      } satisfies NotificationDeliveryResult;
    }

    case "SEND_ORDER_CONFIRMATION_EMAILS": {
      await sendOrderConfirmationEmails(
        supabase,
        asRecord(payload.order) as never,
        ensurePaymentPhase(asString(payload.phase)) as never,
      );
      return {
        channel: "EMAIL",
        status: "DELIVERED",
        provider: "RESEND",
      } satisfies NotificationDeliveryResult;
    }

    case "SEND_OPS_VERIFICATION_EMAIL": {
      const tailorId = requireString(payload, "tailorId");
      const deliveryKey = requireString(payload, "deliveryKey");
      const serviceRoleKey = getServiceRoleKey();
      const { data, error } = await supabase.functions.invoke(
        "notify-ops-verification",
        {
          body: { tailorId, deliveryKey },
          headers: {
            Authorization: `Bearer ${serviceRoleKey}`,
            apikey: serviceRoleKey,
          },
        },
      );
      if (error) {
        throw new Error(`Ops verification email failed: ${error.message}`);
      }
      const response = asRecord(data);
      if (response.ok !== true) {
        throw new Error(
          `Ops verification email returned an invalid response: ${
            asString(response.error) ?? "unknown error"
          }`,
        );
      }
      return {
        channel: "EMAIL",
        status: "DELIVERED",
        provider: "RESEND",
      } satisfies NotificationDeliveryResult;
    }

    case "SEND_OPS_SLACK": {
      await sendOpsSlackEvent(supabase, {
        jobId: job.id,
        issueId: requireString(payload, "issueId"),
        auditLogId: requireString(payload, "auditLogId"),
      });
      return null;
    }

    case "SEND_OPS_SLACK_DIGEST": {
      await sendOpsSlackDigest(supabase, job.id);
      return null;
    }

    case "CREATE_OPS_ISSUE": {
      await createOrRefreshOpsIssue(supabase, {
        issueType: requireString(payload, "issueType"),
        severity: requireString(payload, "severity"),
        source: requireString(payload, "source"),
        actorId: asString(payload.actorId),
        actorRole: asString(payload.actorRole),
        orderId: asString(payload.orderId),
        userId: asString(payload.userId),
        tailorProfileId: asString(payload.tailorProfileId),
        relatedEntityType: asString(payload.relatedEntityType),
        relatedEntityId: asString(payload.relatedEntityId),
        provider: asString(payload.provider),
        stage: asString(payload.stage),
        title: requireString(payload, "title"),
        description: requireString(payload, "description"),
        recommendedAction: requireString(payload, "recommendedAction"),
        dedupeKey: requireString(payload, "dedupeKey"),
        metadata: asRecord(payload.metadata),
      } as never);
      return null;
    }

    case "PROCESS_PAYMENT_WEBHOOK": {
      await processQueuedPaymentWebhook(supabase, payload);
      return null;
    }

    case "RECONCILE_PAYMENT_WEBHOOK": {
      await reconcileQueuedPaymentWebhook(supabase, payload);
      return null;
    }

    case "PROCESS_FABRIC_RELEASE": {
      await processFabricCandidateRelease(
        supabase,
        requireString(payload, "candidateId"),
      );
      return null;
    }

    case "PROCESS_TIP_PAYOUT": {
      const tipId = requireString(payload, "tipId");
      const serviceRoleKey = getServiceRoleKey();
      const { data, error } = await supabase.functions.invoke(
        "release-order-tip",
        {
          body: { tipId },
          headers: {
            Authorization: `Bearer ${serviceRoleKey}`,
            apikey: serviceRoleKey,
          },
        },
      );
      if (error) {
        throw new Error(`Automatic tip payout failed: ${error.message}`);
      }
      const response = asRecord(data);
      if (response.ok !== true) {
        throw new Error(
          `Automatic tip payout was not completed: ${
            asString(response.error) ?? "unknown error"
          }`,
        );
      }
      return null;
    }

    case "PROCESS_DISPATCH_REFUND": {
      await processDispatchRefund(supabase, requireString(payload, "runId"));
      return null;
    }

    case "RECONCILE_DISPATCH_RUN": {
      await reconcileDispatchRunIfReady(
        supabase,
        requireString(payload, "runId"),
      );
      return null;
    }

    case "PROCESS_DELIVERY_WEBHOOK": {
      await processQueuedDeliveryWebhook(supabase, payload);
      return null;
    }

    case "RECONCILE_DELIVERY_WEBHOOK": {
      await reconcileQueuedDeliveryWebhook(supabase, payload);
      return null;
    }

    default:
      throw new Error(`Unsupported job type: ${job.job_type}`);
  }
}

function notificationChannelForJob(jobType: string) {
  if (jobType === "SEND_PUSH") return "PUSH";
  if (jobType === "SEND_SMS") return "SMS";
  if (jobType.includes("EMAIL")) return "EMAIL";
  return null;
}

async function finishNotificationJob(
  supabase: SupabaseClient,
  job: JobRow,
  workerId: string,
  durationMs: number,
  result: NotificationDeliveryResult | null,
  deadReason?: string,
) {
  const channel = result?.channel ?? notificationChannelForJob(job.job_type);
  if (!channel) {
    await finishJob(supabase, {
      jobId: job.id,
      workerId,
      succeeded: !deadReason,
      error: deadReason ?? null,
      durationMs,
    });
    return;
  }
  const payload = asRecord(job.payload);
  const recipientUserId = asString(payload.userId) ??
    asString(payload.recipientUserId);
  const { error } = await supabase.rpc("finish_notification_job", {
    p_job_id: job.id,
    p_worker_id: workerId,
    p_succeeded: !deadReason,
    p_error: deadReason ?? null,
    p_duration_ms: durationMs,
    p_channel: channel,
    p_outcome_status: deadReason ? "DEAD" : result?.status ?? "DEAD",
    p_recipient_user_id: recipientUserId,
    p_order_id: asString(payload.orderId) ??
      asString(asRecord(payload.order).id),
    p_reason: deadReason ?? result?.reason ?? null,
    p_provider: result?.provider ?? null,
    p_provider_reference: result?.providerReference ?? null,
    p_metadata: {
      job_type: job.job_type,
      attempt_count: job.attempt_count,
    },
  });
  if (error) {
    throw new Error(`Could not finish notification job: ${error.message}`);
  }
}

async function reportDeadJob(
  supabase: SupabaseClient,
  job: JobRow,
  errorMessage: string,
) {
  await Promise.allSettled([
    Sentry.captureMessage("Drapeon job reached dead-letter state", {
      level: "error",
      tags: { fn: FN, job_type: job.job_type },
      extra: {
        job_id: job.id,
        event_id: job.event_id,
        attempt_count: job.attempt_count,
        max_attempts: job.max_attempts,
        dedupe_key: job.dedupe_key,
        error: errorMessage,
      },
    }),
    ["CREATE_OPS_ISSUE", "SEND_OPS_SLACK", "SEND_OPS_SLACK_DIGEST"].includes(
        job.job_type,
      )
      ? Promise.resolve()
      : createOrRefreshOpsIssue(supabase, {
        issueType: "SYSTEM_ALERT",
        severity: "HIGH",
        source: FN,
        relatedEntityType: "job_queue",
        relatedEntityId: job.id,
        provider: null,
        stage: job.job_type,
        title: "A background job could not be completed",
        description:
          `Job ${job.job_type} failed after ${job.attempt_count} attempt(s): ${errorMessage}`,
        recommendedAction:
          "Review the job payload, provider status, and retry manually after correcting the root cause.",
        dedupeKey: `job-dead:${job.id}`,
        metadata: {
          job_id: job.id,
          event_id: job.event_id,
          job_type: job.job_type,
          dedupe_key: job.dedupe_key,
          payload: job.payload,
        },
      }),
  ]);
}

async function recordWebhookJobFailure(
  supabase: SupabaseClient,
  job: JobRow,
  errorMessage: string,
  dead: boolean,
) {
  const paymentJob = job.job_type === "PROCESS_PAYMENT_WEBHOOK" ||
    job.job_type === "RECONCILE_PAYMENT_WEBHOOK";
  const deliveryJob = job.job_type === "PROCESS_DELIVERY_WEBHOOK" ||
    job.job_type === "RECONCILE_DELIVERY_WEBHOOK";
  if (!paymentJob && !deliveryJob) return;
  const webhookEventId = asString(asRecord(job.payload).webhookEventId);
  if (!webhookEventId) return;
  const processingJob = job.job_type === "PROCESS_PAYMENT_WEBHOOK" ||
    job.job_type === "PROCESS_DELIVERY_WEBHOOK";
  const values = processingJob
    ? {
      processing_status: dead ? "DEAD" : "RETRYABLE",
      last_processing_error: errorMessage.slice(0, 2000),
    }
    : {
      reconciliation_status: dead ? "DEAD" : "RETRYABLE",
      reconciliation_result: {
        error: errorMessage.slice(0, 2000),
        attemptCount: job.attempt_count,
      },
    };
  const updateLifecycle = deliveryJob
    ? updateDeliveryWebhookLifecycle
    : updateWebhookLifecycle;
  await updateLifecycle(supabase, webhookEventId, values).catch((error) => {
    log("error", FN, "webhook_job.failure_state_update_failed", {
      webhook_event_id: webhookEventId,
      job_id: job.id,
      webhook_kind: deliveryJob ? "DELIVERY" : "PAYMENT",
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

async function recordSlackJobFailure(
  supabase: SupabaseClient,
  job: JobRow,
  errorMessage: string,
  dead: boolean,
) {
  if (
    job.job_type !== "SEND_OPS_SLACK" &&
    job.job_type !== "SEND_OPS_SLACK_DIGEST"
  ) return;
  const { error } = await supabase
    .from("ops_slack_deliveries")
    .update({
      status: dead ? "DEAD" : "RETRYABLE",
      error_code: dead ? "JOB_DEAD" : "JOB_RETRYABLE",
      error_message: errorMessage.slice(0, 2000),
      terminal_at: dead ? new Date().toISOString() : null,
    })
    .eq("job_id", job.id)
    .neq("status", "DELIVERED");
  if (error) {
    log("error", FN, "slack_job.failure_state_update_failed", {
      job_id: job.id,
      job_type: job.job_type,
      error: error.message,
    });
  }
}

async function runPayoutWatchdog(supabase: SupabaseClient) {
  try {
    const overdue = await createOverduePayoutIssues(supabase);
    if (overdue.length > 0) {
      log("warn", FN, "payout_watchdog.overdue_without_row", {
        count: overdue.length,
        orders: overdue.map((item) => ({
          order_id: item.order.id,
          reference: item.order.reference,
          payout_ready_at: item.payoutReadyAt,
          minutes_past_ready: item.minutesPastReady,
        })),
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log("error", FN, "payout_watchdog.failed", { error: message });
    await Sentry.captureMessage(
      "Payout watchdog failed during job processing",
      {
        level: "error",
        tags: { fn: FN, watchdog: "payout_overdue_no_row" },
        extra: { error: message },
      },
    );
  }
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  if (req.method !== "POST") {
    return jsonResponse(
      {
        error: "Method not allowed",
        message: "Use POST to process queued jobs.",
      },
      405,
      cors,
    );
  }

  const unauthorized = await authorizeCronRequest(req, FN, cors);
  if (unauthorized) return unauthorized;

  const workerId = createWorkerId(FN);
  const { limit, jobTypes } = await readProcessingOptions(req);
  if (backgroundWorkersPaused()) {
    log("warn", FN, "background_workers.paused", {
      worker_id: workerId,
      job_types: jobTypes,
    });
    return jsonResponse(
      {
        ok: true,
        workerId,
        jobTypes,
        paused: true,
        claimed: 0,
        succeeded: 0,
        retryable: 0,
        dead: 0,
        results: [],
      },
      200,
      cors,
    );
  }

  const supabase = createClient(getSupabaseUrl(), getServiceRoleKey());
  const watchdogNeeded = !jobTypes || jobTypes.includes("CREATE_OPS_ISSUE");
  if (watchdogNeeded) await runPayoutWatchdog(supabase);
  const jobs = await claimDueJobs(supabase, workerId, limit, jobTypes);
  const results: Array<{
    id: string;
    jobType: string;
    status: "SUCCEEDED" | "RETRYABLE" | "DEAD";
    error?: string;
  }> = [];

  for (const job of jobs) {
    const startedAt = performance.now();
    try {
      const deliveryResult = await processJob(supabase, job);
      await finishNotificationJob(
        supabase,
        job,
        workerId,
        Math.round(performance.now() - startedAt),
        deliveryResult,
      );
      results.push({ id: job.id, jobType: job.job_type, status: "SUCCEEDED" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const willDead = job.attempt_count >= job.max_attempts;
      log("warn", FN, "job.failed", {
        job_id: job.id,
        job_type: job.job_type,
        attempt_count: job.attempt_count,
        max_attempts: job.max_attempts,
        error: message,
      });
      await recordWebhookJobFailure(supabase, job, message, willDead);
      await recordSlackJobFailure(supabase, job, message, willDead);
      if (job.job_type === "SEND_COMMUNICATION_CAMPAIGN") {
        const recipientId = asString(asRecord(job.payload).recipientId);
        if (recipientId) {
          await recordCommunicationCampaignJobFailure(
            supabase,
            recipientId,
            message,
            willDead,
          );
        }
      }

      if (willDead) {
        await finishNotificationJob(
          supabase,
          job,
          workerId,
          Math.round(performance.now() - startedAt),
          null,
          message,
        );
        await reportDeadJob(supabase, job, message);
      } else {
        await finishJob(supabase, {
          jobId: job.id,
          workerId,
          succeeded: false,
          error: message,
          durationMs: Math.round(performance.now() - startedAt),
        });
      }
      results.push({
        id: job.id,
        jobType: job.job_type,
        status: willDead ? "DEAD" : "RETRYABLE",
        error: message,
      });
    }
  }

  return jsonResponse(
    {
      ok: true,
      workerId,
      jobTypes,
      watchdogRan: watchdogNeeded,
      claimed: jobs.length,
      succeeded: results.filter((result) =>
        result.status === "SUCCEEDED"
      ).length,
      retryable:
        results.filter((result) => result.status === "RETRYABLE").length,
      dead: results.filter((result) => result.status === "DEAD").length,
      results,
    },
    200,
    cors,
  );
});
