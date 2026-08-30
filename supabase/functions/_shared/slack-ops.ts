import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { asRecord, asString } from "./jobs.ts";
import { getSupabaseUrl } from "./env.ts";

type SlackChannelKey =
  | "ENGINEERING_ERRORS"
  | "OPS_CRITICAL"
  | "OPS_DELIVERY"
  | "OPS_INTAKE"
  | "OPS_MONEY"
  | "OPS_SAFETY";

type OpsIssue = {
  id: string;
  issue_number: number;
  issue_type: string;
  severity: string;
  status: string;
  source: string;
  order_id: string | null;
  provider: string | null;
  stage: string | null;
  title: string;
  description: string;
  recommended_action: string;
  created_at: string;
  updated_at: string;
};

type OpsAudit = {
  id: string;
  issue_id: string;
  action_taken: string;
  performed_role: string | null;
  reason: string | null;
  created_at: string;
  after_state: Record<string, unknown> | null;
};

const CHANNEL_ENV: Record<SlackChannelKey, string> = {
  ENGINEERING_ERRORS: "SLACK_CHANNEL_ENGINEERING_ERRORS",
  OPS_CRITICAL: "SLACK_CHANNEL_OPS_CRITICAL",
  OPS_DELIVERY: "SLACK_CHANNEL_OPS_DELIVERY",
  OPS_INTAKE: "SLACK_CHANNEL_OPS_INTAKE",
  OPS_MONEY: "SLACK_CHANNEL_OPS_MONEY",
  OPS_SAFETY: "SLACK_CHANNEL_OPS_SAFETY",
};

const MONEY_TYPES = new Set([
  "PAYMENT_BLOCKED",
  "PAYOUT_BLOCKED",
  "PAYOUT_FAILED",
  "REFUND_FAILED",
  "WEBHOOK_ERROR",
  "ESCROW_STUCK",
  "DOUBLE_CHARGE_RISK",
  "FABRIC_APPROVAL",
]);
const SAFETY_TYPES = new Set([
  "CONVERSATION_SAFETY",
  "CONTENT_FLAG",
  "CONTACT_BYPASS",
]);
const DELIVERY_TYPES = new Set([
  "DELIVERY_REVIEW",
  "FULFILLMENT_RECONCILIATION_FAILED",
]);
function environmentName() {
  const configured = Deno.env.get("DRAPE_ENV") ?? Deno.env.get("ENVIRONMENT");
  if (configured?.trim()) return configured.trim().toUpperCase();
  const url = getSupabaseUrl();
  if (url.includes("wkfsrunetmgjdtcurmoj")) return "PROD";
  if (url.includes("pqptfuqogvrajozfsqzi")) return "DEV";
  return "UNKNOWN";
}

function webBaseUrl() {
  // Ops links must never inherit the public storefront URL. Production
  // middleware intentionally returns 404 for /ops on the public hostname.
  return (Deno.env.get("OPS_WEB_BASE_URL") ?? "https://ops.drapeon.co")
    .replace(/\/+$/u, "");
}

export function exactOpsIssueUrl(issueId: string, baseUrl = webBaseUrl()) {
  const encoded = encodeURIComponent(issueId);
  return `${
    baseUrl.replace(/\/+$/u, "")
  }/ops?view=workflow-issues&focusIssue=${encoded}#workflow-issue-${encoded}`;
}

export function redactSlackText(value: unknown, maxLength = 600) {
  const text = String(value ?? "")
    .replace(/https?:\/\/\S+/giu, "[secure link hidden]")
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/giu, "[email hidden]")
    .replace(
      /\b(?:sk|pk|rk)[_-](?:live|test|prod|dev)?[_-]?[a-z0-9_-]{12,}\b/giu,
      "[secret hidden]",
    )
    .replace(/\bxox[baprs]-[a-z0-9-]{12,}\b/giu, "[secret hidden]")
    .replace(
      /\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/gu,
      "[token hidden]",
    )
    .replace(
      /\b(?:token|secret|password|authorization|api[_ -]?key)\s*[:=]\s*(?:bearer\s+)?\S+/giu,
      "[credential hidden]",
    )
    .replace(/\+?\d[\d\s().-]{7,}\d/gu, "[phone/account hidden]")
    .replace(/\s+/gu, " ")
    .trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function specialistChannel(
  issue: Pick<OpsIssue, "issue_type">,
): SlackChannelKey {
  if (SAFETY_TYPES.has(issue.issue_type)) return "OPS_SAFETY";
  if (DELIVERY_TYPES.has(issue.issue_type)) return "OPS_DELIVERY";
  if (MONEY_TYPES.has(issue.issue_type)) return "OPS_MONEY";
  return "OPS_INTAKE";
}

export function routedChannelKeys(
  issue: Pick<
    OpsIssue,
    "issue_type" | "severity" | "source" | "stage" | "title"
  >,
) {
  const context = `${issue.source} ${issue.stage ?? ""} ${issue.title}`
    .toLowerCase();
  let specialist = specialistChannel(issue);
  if (
    /delivery|dispatch|shipping|fulfil|fulfill|courier|rider/u.test(context)
  ) specialist = "OPS_DELIVERY";
  if (
    /payment|payout|refund|money|ledger|settlement|transfer|tax/u.test(context)
  ) specialist = "OPS_MONEY";
  if (/safety|abuse|harass|threat|content flag/u.test(context)) {
    specialist = "OPS_SAFETY";
  }
  const channels = new Set<SlackChannelKey>([specialist]);
  if (issue.severity === "CRITICAL") channels.add("OPS_CRITICAL");
  if (issue.issue_type === "SYSTEM_ALERT") channels.add("ENGINEERING_ERRORS");
  return [...channels];
}

function channelId(key: SlackChannelKey) {
  return Deno.env.get(CHANNEL_ENV[key])?.trim() ?? null;
}

function eventLabel(action: string) {
  const labels: Record<string, string> = {
    ISSUE_CREATED: "New case",
    ISSUE_REOPENED: "Case reopened",
    ISSUE_REFRESHED: "Case updated",
    ISSUE_AUTO_RESOLVED: "Case auto-resolved",
    ISSUE_RESOLVED: "Case resolved",
    ISSUE_ESCALATED: "Case escalated",
  };
  return labels[action] ?? action.toLowerCase().replaceAll("_", " ");
}

function issueBlocks(
  issue: OpsIssue,
  audit: OpsAudit,
  channelKey: SlackChannelKey,
) {
  const env = environmentName();
  const title = redactSlackText(issue.title, 140);
  const description = redactSlackText(issue.description);
  const recommendation = redactSlackText(issue.recommended_action);
  const header = `[${env}] #${
    String(issue.issue_number).padStart(4, "0")
  } · ${issue.severity} · ${eventLabel(audit.action_taken)}`;
  const context = [
    issue.issue_type,
    issue.status,
    issue.order_id ? `Order ${redactSlackText(issue.order_id, 60)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const blocks: Array<Record<string, unknown>> = [
    {
      type: "header",
      text: { type: "plain_text", text: header.slice(0, 150), emoji: true },
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: `*${title}*\n${description}` },
    },
    {
      type: "context",
      elements: [{ type: "mrkdwn", text: redactSlackText(context, 300) }],
    },
  ];
  if (recommendation) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*Next safe action*\n${recommendation}` },
    });
  }
  // Operator-entered reasons can contain evidence or customer correspondence.
  // Keep Slack deliberately summary-only; the authenticated Ops case owns details.
  blocks.push({
    type: "actions",
    elements: [{
      type: "button",
      text: { type: "plain_text", text: "Open exact Ops case", emoji: true },
      url: exactOpsIssueUrl(issue.id),
      action_id: `open_ops_${channelKey.toLowerCase()}`,
    }],
  });
  return blocks;
}

async function slackPost(input: {
  channel: string;
  text: string;
  blocks: Array<Record<string, unknown>>;
  threadTs?: string | null;
}) {
  const token = Deno.env.get("SLACK_BOT_TOKEN")?.trim();
  if (!token) throw new Error("SLACK_BOT_TOKEN is not configured");
  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      channel: input.channel,
      text: input.text,
      blocks: input.blocks,
      thread_ts: input.threadTs ?? undefined,
      unfurl_links: false,
      unfurl_media: false,
    }),
  });
  const result = asRecord(await response.json());
  const timestamp = asString(result.ts);
  if (!response.ok || result.ok !== true || !timestamp) {
    throw new Error(
      `Slack delivery failed (${response.status}): ${
        redactSlackText(asString(result.error) ?? "unknown error", 120)
      }`,
    );
  }
  return timestamp;
}

async function loadIssueAndAudit(
  supabase: SupabaseClient,
  issueId: string,
  auditLogId: string,
) {
  const [issueResponse, auditResponse] = await Promise.all([
    supabase.from("ops_issues").select(
      "id,issue_number,issue_type,severity,status,source,order_id,provider,stage,title,description,recommended_action,created_at,updated_at",
    ).eq("id", issueId).single(),
    supabase.from("ops_audit_logs").select(
      "id,issue_id,action_taken,performed_role,reason,created_at,after_state",
    ).eq("id", auditLogId).eq("issue_id", issueId).single(),
  ]);
  if (issueResponse.error) {
    throw new Error(
      `Could not load Slack Ops issue: ${issueResponse.error.message}`,
    );
  }
  if (auditResponse.error) {
    throw new Error(
      `Could not load Slack Ops audit event: ${auditResponse.error.message}`,
    );
  }
  return {
    issue: issueResponse.data as OpsIssue,
    audit: auditResponse.data as OpsAudit,
  };
}

async function deliveredRow(supabase: SupabaseClient, dedupeKey: string) {
  const { data, error } = await supabase
    .from("ops_slack_deliveries")
    .select("id,status,slack_message_ts,thread_ts,attempt_count")
    .eq("dedupe_key", dedupeKey)
    .maybeSingle();
  if (error) {
    throw new Error(`Could not inspect Slack delivery: ${error.message}`);
  }
  return data as {
    id: string;
    status: string;
    slack_message_ts: string | null;
    thread_ts: string | null;
    attempt_count: number;
  } | null;
}

async function parentThread(
  supabase: SupabaseClient,
  issueId: string,
  channelKey: SlackChannelKey,
) {
  const { data, error } = await supabase
    .from("ops_slack_deliveries")
    .select("slack_message_ts,thread_ts")
    .eq("issue_id", issueId)
    .eq("channel_key", channelKey)
    .eq("status", "DELIVERED")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error(`Could not load Slack case thread: ${error.message}`);
  }
  return (data?.thread_ts ?? data?.slack_message_ts ?? null) as string | null;
}

export async function sendOpsSlackEvent(
  supabase: SupabaseClient,
  input: { jobId: string; issueId: string; auditLogId: string },
) {
  const { issue, audit } = await loadIssueAndAudit(
    supabase,
    input.issueId,
    input.auditLogId,
  );
  const channels = routedChannelKeys(issue);
  const failures: string[] = [];

  for (const key of channels) {
    const id = channelId(key);
    const dedupeKey = `ops-slack:${audit.id}:${key}`;
    if (!id) {
      await supabase.from("ops_slack_deliveries").upsert({
        job_id: input.jobId,
        issue_id: issue.id,
        audit_log_id: audit.id,
        event_kind: audit.action_taken,
        channel_key: key,
        channel_id: "UNCONFIGURED",
        status: "RETRYABLE",
        attempt_count: 1,
        error_code: "CHANNEL_NOT_CONFIGURED",
        error_message: `${key} is not configured`,
        dedupe_key: dedupeKey,
      }, { onConflict: "dedupe_key" });
      failures.push(`${key} is not configured`);
      continue;
    }
    const existing = await deliveredRow(supabase, dedupeKey);
    if (existing?.status === "DELIVERED") continue;
    const isRoot = audit.action_taken === "ISSUE_CREATED";
    const threadTs = isRoot
      ? null
      : await parentThread(supabase, issue.id, key);
    try {
      const ts = await slackPost({
        channel: id,
        threadTs,
        text:
          `[${environmentName()}] ${issue.severity} Ops case #${issue.issue_number}: ${
            redactSlackText(issue.title, 120)
          }`,
        blocks: issueBlocks(issue, audit, key),
      });
      const { error } = await supabase.from("ops_slack_deliveries").upsert({
        job_id: input.jobId,
        issue_id: issue.id,
        audit_log_id: audit.id,
        event_kind: audit.action_taken,
        channel_key: key,
        channel_id: id,
        slack_message_ts: ts,
        thread_ts: threadTs ?? ts,
        status: "DELIVERED",
        attempt_count: (existing?.attempt_count ?? 0) + 1,
        provider_status: "ok",
        error_code: null,
        error_message: null,
        dedupe_key: dedupeKey,
        delivered_at: new Date().toISOString(),
        terminal_at: new Date().toISOString(),
      }, { onConflict: "dedupe_key" });
      if (error) throw new Error(error.message);
    } catch (error) {
      const message = redactSlackText(
        error instanceof Error ? error.message : String(error),
        500,
      );
      await supabase.from("ops_slack_deliveries").upsert({
        job_id: input.jobId,
        issue_id: issue.id,
        audit_log_id: audit.id,
        event_kind: audit.action_taken,
        channel_key: key,
        channel_id: id,
        status: "RETRYABLE",
        attempt_count: (existing?.attempt_count ?? 0) + 1,
        error_code: "SLACK_POST_FAILED",
        error_message: message,
        dedupe_key: dedupeKey,
      }, { onConflict: "dedupe_key" });
      failures.push(`${key}: ${message}`);
    }
  }
  if (failures.length) {
    throw new Error(`Slack Ops delivery incomplete: ${failures.join("; ")}`);
  }
  return { deliveredChannels: channels };
}

export async function sendOpsSlackDigest(
  supabase: SupabaseClient,
  jobId: string,
) {
  const { data, error } = await supabase
    .from("ops_issues")
    .select("id,issue_number,severity,status,issue_type,title,created_at")
    .in("status", ["OPEN", "IN_REVIEW", "ESCALATED"])
    .order("severity", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(100);
  if (error) {
    throw new Error(`Could not build Slack Ops digest: ${error.message}`);
  }
  const priority: Record<string, number> = {
    CRITICAL: 0,
    HIGH: 1,
    MEDIUM: 2,
    LOW: 3,
  };
  const rows = (Array.isArray(data) ? data : []).sort((left, right) => {
    const severityOrder = (priority[left.severity] ?? 9) -
      (priority[right.severity] ?? 9);
    return severityOrder ||
      Date.parse(left.created_at) - Date.parse(right.created_at);
  });
  const critical = rows.filter((row) => row.severity === "CRITICAL").length;
  const high = rows.filter((row) => row.severity === "HIGH").length;
  const oldest =
    [...rows].sort((left, right) =>
      Date.parse(left.created_at) - Date.parse(right.created_at)
    )[0];
  const key: SlackChannelKey = "OPS_INTAKE";
  const id = channelId(key);
  if (!id) throw new Error("OPS_INTAKE is not configured");
  const dateKey = new Date().toISOString().slice(0, 10);
  const dedupeKey = `ops-slack-digest:${environmentName()}:${dateKey}`;
  if ((await deliveredRow(supabase, dedupeKey))?.status === "DELIVERED") {
    return { skipped: "ALREADY_DELIVERED" };
  }
  const text =
    `[${environmentName()}] Daily Ops digest: ${rows.length} active, ${critical} critical, ${high} high.`;
  const blocks: Array<Record<string, unknown>> = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `[${environmentName()}] Daily Ops digest`,
        emoji: true,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          `*${rows.length} active* · *${critical} critical* · *${high} high*${
            oldest
              ? `\nOldest: #${oldest.issue_number} · ${
                redactSlackText(oldest.title, 180)
              }`
              : "\nNo active cases."
          }`,
      },
    },
    {
      type: "actions",
      elements: [{
        type: "button",
        text: { type: "plain_text", text: "Open active Ops queue" },
        url: `${webBaseUrl()}/ops?view=workflow-issues#workflow-issues`,
        action_id: "open_ops_digest",
      }],
    },
  ];
  const existing = await deliveredRow(supabase, dedupeKey);
  try {
    const ts = await slackPost({ channel: id, text, blocks });
    const { error: saveError } = await supabase.from("ops_slack_deliveries")
      .upsert({
        job_id: jobId,
        issue_id: null,
        audit_log_id: null,
        event_kind: "DAILY_DIGEST",
        channel_key: key,
        channel_id: id,
        slack_message_ts: ts,
        thread_ts: ts,
        status: "DELIVERED",
        attempt_count: (existing?.attempt_count ?? 0) + 1,
        provider_status: "ok",
        dedupe_key: dedupeKey,
        delivered_at: new Date().toISOString(),
        terminal_at: new Date().toISOString(),
      }, { onConflict: "dedupe_key" });
    if (saveError) {
      throw new Error(
        `Could not record Slack digest delivery: ${saveError.message}`,
      );
    }
  } catch (error) {
    const message = redactSlackText(
      error instanceof Error ? error.message : String(error),
      500,
    );
    await supabase.from("ops_slack_deliveries").upsert({
      job_id: jobId,
      issue_id: null,
      audit_log_id: null,
      event_kind: "DAILY_DIGEST",
      channel_key: key,
      channel_id: id,
      status: "RETRYABLE",
      attempt_count: (existing?.attempt_count ?? 0) + 1,
      error_code: "SLACK_DIGEST_FAILED",
      error_message: message,
      dedupe_key: dedupeKey,
    }, { onConflict: "dedupe_key" });
    throw error;
  }
  return { active: rows.length, critical, high };
}
