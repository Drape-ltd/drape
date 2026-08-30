import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendAccountEventEmail } from "./account-email.ts";
import { asRecord, asString } from "./jobs.ts";
import { type PushPreferenceKey, sendPushToUser } from "./notify.ts";
import { sendSmsToUser } from "./sms.ts";

type CampaignChannel = "IN_APP" | "PUSH" | "EMAIL" | "SMS";
type ChannelOutcome = {
  status?: string;
  terminal?: boolean;
};

type RecipientRow = {
  id: string;
  campaign_id: string;
  user_id: string;
  audience_snapshot: Record<string, unknown> | null;
  consent_snapshot: Record<string, unknown> | null;
  status: string;
  channel_outcomes: Record<string, ChannelOutcome> | null;
  channels: string[] | null;
};

const TERMINAL_RECIPIENT_STATUSES = new Set([
  "DELIVERED",
  "PARTIAL",
  "SKIPPED",
  "FAILED",
  "DEAD",
]);

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function channelObject(value: unknown, channel: CampaignChannel) {
  const source = asRecord(value);
  return asRecord(source[channel] ?? source[channel.toLowerCase()]);
}

function pathValue(source: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((value, segment) => {
    return asRecord(value)[segment];
  }, source);
}

function renderTemplate(template: string, variables: Record<string, unknown>) {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/gu, (_match, key: string) => {
    const value = pathValue(variables, key);
    if (value === null || value === undefined) {
      throw new Error(`Communication template variable is missing: ${key}`);
    }
    return typeof value === "string" ? value : String(value);
  });
}

function destinationLinks(destination: Record<string, unknown>) {
  const key = asString(destination.key ?? destination.destinationKey) ??
    "NOTIFICATIONS";
  const params = asRecord(destination.params ?? destination.destinationParams);
  const orderId = asString(params.orderId ?? params.order_id);
  const caseId = asString(params.caseId ?? params.case_id);

  const defaults: Record<
    string,
    { webPath: string; appUrl: string; ctaLabel: string }
  > = {
    ORDER_DETAIL: {
      webPath: orderId
        ? `/account/orders?orderId=${encodeURIComponent(orderId)}`
        : "/account/orders",
      appUrl: orderId
        ? `drape://orders/${encodeURIComponent(orderId)}`
        : "drape://orders",
      ctaLabel: "View order",
    },
    ORDER_CHAT: {
      webPath: orderId
        ? `/messages?orderId=${encodeURIComponent(orderId)}`
        : "/messages",
      appUrl: orderId
        ? `drape://messages?orderId=${encodeURIComponent(orderId)}`
        : "drape://messages",
      ctaLabel: "Open conversation",
    },
    PAYOUT_SETUP: {
      webPath: "/account/payout",
      appUrl: "drape://payout",
      ctaLabel: "Review payout",
    },
    ACCOUNT_SETTINGS: {
      webPath: "/account",
      appUrl: "drape://account",
      ctaLabel: "Open account",
    },
    SERVICE_STATUS: {
      webPath: "/status",
      appUrl: "drape://notifications",
      ctaLabel: "View status",
    },
    SUPPORT_CASE: {
      webPath: caseId
        ? `/support?caseId=${encodeURIComponent(caseId)}`
        : "/support",
      appUrl: caseId
        ? `drape://support?caseId=${encodeURIComponent(caseId)}`
        : "drape://support",
      ctaLabel: "View support case",
    },
    PROMOTION: {
      webPath: "/promotions",
      appUrl: "drape://promotions",
      ctaLabel: "View offer",
    },
    NOTIFICATIONS: {
      webPath: "/account/notifications",
      appUrl: "drape://notifications",
      ctaLabel: "View update",
    },
  };
  const fallback = defaults[key] ?? defaults.NOTIFICATIONS;
  return {
    key,
    params,
    webPath: asString(destination.webPath) ?? fallback.webPath,
    appUrl: asString(destination.appUrl) ?? fallback.appUrl,
    ctaLabel: asString(destination.ctaLabel) ?? fallback.ctaLabel,
  };
}

function pushPreference(category: string, purpose: string): PushPreferenceKey {
  if (purpose === "MARKETING" || category === "PROMOTION") return "promotions";
  if (category === "PAYMENT") return "paymentConfirmations";
  if (category === "PAYOUT") return "paymentReleased";
  if (category === "MESSAGE") return "messages";
  if (category === "QUOTE") return "quotes";
  if (category === "REVIEW") return "reviews";
  return "platformUpdates";
}

function requestedChannels(recipient: RecipientRow): CampaignChannel[] {
  return (recipient.channels ?? ["IN_APP"])
    .filter((channel): channel is CampaignChannel =>
      ["IN_APP", "PUSH", "EMAIL", "SMS"].includes(channel)
    );
}

function channelTerminal(recipient: RecipientRow, channel: CampaignChannel) {
  return recipient.channel_outcomes?.[channel]?.terminal === true;
}

async function recordOutcome(
  supabase: SupabaseClient,
  recipientId: string,
  channel: CampaignChannel,
  status: "DELIVERED" | "SENT" | "SKIPPED" | "FAILED",
  options: {
    reason?: string | null;
    provider?: string | null;
    providerReference?: string | null;
    terminal?: boolean;
  } = {},
) {
  const { error } = await supabase.rpc(
    "record_communication_recipient_channel_outcome",
    {
      p_recipient_id: recipientId,
      p_channel: channel,
      p_status: status,
      p_reason: options.reason ?? null,
      p_provider: options.provider ?? null,
      p_provider_reference: options.providerReference ?? null,
      p_terminal: options.terminal ?? true,
    },
  );
  if (error) {
    throw new Error(`Could not record ${channel} outcome: ${error.message}`);
  }
}

async function refreshRecipient(supabase: SupabaseClient, recipientId: string) {
  const { data, error } = await supabase
    .from("communication_campaign_recipients")
    .select(
      "id,campaign_id,user_id,audience_snapshot,consent_snapshot,status,channel_outcomes,channels",
    )
    .eq("id", recipientId)
    .single();
  if (error) {
    throw new Error(`Communication recipient lookup failed: ${error.message}`);
  }
  return data as RecipientRow;
}

async function settleRecipient(supabase: SupabaseClient, recipientId: string) {
  const recipient = await refreshRecipient(supabase, recipientId);
  const channels = requestedChannels(recipient);
  const outcomes = channels.map((channel) =>
    recipient.channel_outcomes?.[channel] ?? {}
  );
  if (!outcomes.every((outcome) => outcome.terminal === true)) return "SENDING";

  const statuses = outcomes.map((outcome) => outcome.status ?? "FAILED");
  const delivered =
    statuses.filter((status) => status === "DELIVERED" || status === "SENT")
      .length;
  const skipped = statuses.filter((status) => status === "SKIPPED").length;
  const failed = statuses.filter((status) => status === "FAILED").length;
  const status = failed === statuses.length
    ? "FAILED"
    : skipped === statuses.length
    ? "SKIPPED"
    : delivered === statuses.length
    ? "DELIVERED"
    : "PARTIAL";

  const { error } = await supabase
    .from("communication_campaign_recipients")
    .update({ status, completed_at: new Date().toISOString() })
    .eq("id", recipientId);
  if (error) {
    throw new Error(
      `Communication recipient completion failed: ${error.message}`,
    );
  }
  const { error: refreshError } = await supabase.rpc(
    "refresh_communication_campaign_status",
    {
      p_campaign_id: recipient.campaign_id,
    },
  );
  if (refreshError) {
    throw new Error(
      `Communication campaign refresh failed: ${refreshError.message}`,
    );
  }
  return status;
}

export async function processCommunicationCampaignRecipient(
  supabase: SupabaseClient,
  recipientId: string,
) {
  let recipient = await refreshRecipient(supabase, recipientId);
  if (TERMINAL_RECIPIENT_STATUSES.has(recipient.status)) {
    return { status: recipient.status, replay: true };
  }

  const { data: campaign, error: campaignError } = await supabase
    .from("communication_campaigns")
    .select(
      "id,status,kind,category,purpose,severity,template_version_id,destination,acknowledgement_required,expires_at,correlation_id",
    )
    .eq("id", recipient.campaign_id)
    .single();
  if (campaignError) {
    throw new Error(
      `Communication campaign lookup failed: ${campaignError.message}`,
    );
  }

  if (campaign.status === "PAUSED") {
    return { status: "PAUSED", deferred: true };
  }
  const cancelled = campaign.status === "CANCELLED";
  const expired = campaign.expires_at &&
    new Date(campaign.expires_at).getTime() <= Date.now();
  if (cancelled || expired) {
    for (const channel of requestedChannels(recipient)) {
      if (!channelTerminal(recipient, channel)) {
        await recordOutcome(supabase, recipient.id, channel, "SKIPPED", {
          reason: cancelled ? "CAMPAIGN_CANCELLED" : "CAMPAIGN_EXPIRED",
        });
      }
    }
    return { status: await settleRecipient(supabase, recipient.id) };
  }

  const { data: template, error: templateError } = await supabase
    .from("communication_template_versions")
    .select("subject_template,title_template,body_template,channel_content")
    .eq("id", campaign.template_version_id)
    .single();
  if (templateError) {
    throw new Error(
      `Communication template lookup failed: ${templateError.message}`,
    );
  }

  const snapshot = asRecord(recipient.audience_snapshot);
  const destination = asRecord(campaign.destination);
  const variables = {
    ...snapshot,
    ...asRecord(destination.variables),
    recipientId: recipient.id,
    userId: recipient.user_id,
    campaignId: campaign.id,
  };
  const links = destinationLinks(destination);
  const baseTitle = renderTemplate(template.title_template, variables);
  const baseBody = renderTemplate(template.body_template, variables);
  const baseSubject = renderTemplate(template.subject_template, variables);

  const { error: sendingError } = await supabase
    .from("communication_campaign_recipients")
    .update({ status: "SENDING" })
    .eq("id", recipient.id);
  if (sendingError) {
    throw new Error(
      `Communication recipient start failed: ${sendingError.message}`,
    );
  }

  for (const channel of requestedChannels(recipient)) {
    recipient = await refreshRecipient(supabase, recipient.id);
    if (channelTerminal(recipient, channel)) continue;
    const content = channelObject(template.channel_content, channel);
    const title = renderTemplate(
      asString(content.title) ?? baseTitle,
      variables,
    );
    const body = renderTemplate(asString(content.body) ?? baseBody, variables);

    try {
      if (channel === "IN_APP") {
        const { error } = await supabase.from("communication_inbox").insert({
          recipient_id: recipient.user_id,
          category: campaign.category,
          purpose: campaign.purpose,
          severity: campaign.severity,
          title,
          body,
          destination_key: links.key,
          destination_params: links.params,
          media: Array.isArray(destination.media) ? destination.media : [],
          campaign_id: campaign.id,
          correlation_id: campaign.correlation_id,
          acknowledgement_required: campaign.acknowledgement_required,
          deduplication_key:
            `campaign:${campaign.id}:recipient:${recipient.id}:IN_APP`,
          expires_at: campaign.expires_at,
        });
        if (error && error.code !== "23505") throw error;
        await recordOutcome(supabase, recipient.id, channel, "DELIVERED", {
          provider: "DRAPEON_INBOX",
        });
      } else if (channel === "PUSH") {
        const result = await sendPushToUser(supabase, recipient.user_id, {
          title,
          body,
          data: Object.fromEntries(
            Object.entries(links.params).map((
              [key, value],
            ) => [key, String(value)]),
          ),
          preferenceKey: pushPreference(campaign.category, campaign.purpose),
          interruptionLevel: campaign.severity === "CRITICAL"
            ? "time-sensitive"
            : "active",
          communication: {
            category: campaign.category,
            purpose: campaign.purpose,
            severity: campaign.severity,
            mandatory: campaign.purpose !== "MARKETING",
            inApp: false,
            destinationKey: links.key,
            destinationParams: links.params,
            campaignId: campaign.id,
            correlationId: campaign.correlation_id,
            expiresAt: campaign.expires_at ?? undefined,
          },
        });
        if (result.status === "ERROR") throw new Error(result.reason);
        await recordOutcome(
          supabase,
          recipient.id,
          channel,
          result.status === "SENT" ? "SENT" : "SKIPPED",
          {
            reason: result.status === "SKIPPED" ? result.reason : null,
            provider: "EXPO_OR_WEB_PUSH",
          },
        );
      } else if (channel === "EMAIL") {
        const result = await sendAccountEventEmail(supabase, {
          userId: recipient.user_id,
          recipientEmail: asString(snapshot.email),
          subject: renderTemplate(
            asString(content.subject) ?? baseSubject,
            variables,
          ),
          headline: renderTemplate(
            asString(content.headline) ?? title,
            variables,
          ),
          body,
          eyebrow: asString(content.eyebrow) ?? undefined,
          ctaLabel: asString(content.ctaLabel) ?? links.ctaLabel,
          webPath: links.webPath,
          appUrl: links.appUrl,
        });
        await recordOutcome(supabase, recipient.id, channel, result.status, {
          reason: "reason" in result ? result.reason : null,
          provider: "provider" in result ? result.provider : "RESEND",
          providerReference: "providerReference" in result
            ? result.providerReference
            : null,
        });
      } else {
        const role = asString(snapshot.role) === "TAILOR"
          ? "TAILOR"
          : "CUSTOMER";
        const result = await sendSmsToUser({
          supabase,
          userId: recipient.user_id,
          audience: role,
          orderId: asString(links.params.orderId ?? links.params.order_id),
          event: `communication.${campaign.kind.toLowerCase()}`,
          body,
          fallbackPhone: asString(snapshot.phone),
        });
        await recordOutcome(supabase, recipient.id, channel, result.status, {
          reason: "reason" in result ? result.reason : null,
          provider: result.provider,
          providerReference: "providerReference" in result
            ? result.providerReference
            : null,
        });
      }
    } catch (error) {
      await recordOutcome(supabase, recipient.id, channel, "FAILED", {
        reason: errorMessage(error),
        terminal: false,
      });
      throw error;
    }
  }

  return { status: await settleRecipient(supabase, recipient.id) };
}

export async function recordCommunicationCampaignJobFailure(
  supabase: SupabaseClient,
  recipientId: string,
  message: string,
  dead: boolean,
) {
  const recipient = await refreshRecipient(supabase, recipientId).catch(() =>
    null
  );
  if (!recipient) return;
  if (dead) {
    for (const channel of requestedChannels(recipient)) {
      if (!channelTerminal(recipient, channel)) {
        await recordOutcome(supabase, recipient.id, channel, "FAILED", {
          reason: `JOB_DEAD:${message}`,
          terminal: true,
        });
      }
    }
    await supabase.from("communication_campaign_recipients").update({
      status: "DEAD",
      completed_at: new Date().toISOString(),
    }).eq("id", recipient.id);
  } else {
    await supabase.from("communication_campaign_recipients").update({
      status: "QUEUED",
    }).eq("id", recipient.id);
  }
  await supabase.from("communication_campaigns").update({ last_error: message })
    .eq("id", recipient.campaign_id);
  await supabase.rpc("refresh_communication_campaign_status", {
    p_campaign_id: recipient.campaign_id,
  });
}
