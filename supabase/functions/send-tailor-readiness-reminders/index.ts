import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeCronRequest } from "../_shared/cron.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { getServiceRoleKey, getSupabaseUrl } from "../_shared/env.ts";
import { enqueueBackgroundJob } from "../_shared/jobs.ts";
import { audit, log } from "../_shared/logger.ts";
import { Sentry } from "../_shared/sentry.ts";
import {
  payoutReminderCopy,
  payoutReminderSendsEmail,
  payoutReminderStage,
} from "../_shared/tailor-readiness-reminders.ts";

const FN = "send-tailor-readiness-reminders";
const MAX_PROFILES_PER_RUN = 500;

type TailorProfile = {
  id: string;
  user_id: string;
  id_verification_status: string | null;
  id_verification_submitted_at: string | null;
  payout_account_verified: boolean | null;
  payout_reverification_required: boolean | null;
  payout_account_last_changed_at: string | null;
  created_at: string;
};

function reminderAnchor(profile: TailorProfile) {
  if (profile.payout_reverification_required === true) {
    return profile.payout_account_last_changed_at ??
      profile.id_verification_submitted_at ?? profile.created_at;
  }
  return profile.id_verification_submitted_at ?? profile.created_at;
}

function reminderEpisode(profile: TailorProfile) {
  if (profile.payout_reverification_required === true) {
    return `reverify:${reminderAnchor(profile).slice(0, 10)}`;
  }
  return `setup:${
    String(profile.id_verification_status ?? "unknown").toLowerCase()
  }`;
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const unauthorized = await authorizeCronRequest(req, FN, cors);
  if (unauthorized) return unauthorized;

  const supabase = createClient(getSupabaseUrl(), getServiceRoleKey());
  try {
    const { data, error } = await supabase
      .from("tailor_profiles")
      .select(
        "id,user_id,id_verification_status,id_verification_submitted_at,payout_account_verified,payout_reverification_required,payout_account_last_changed_at,created_at",
      )
      .in("id_verification_status", ["PENDING", "VERIFIED", "APPROVED"])
      .or(
        "payout_account_verified.is.false,payout_account_verified.is.null,payout_reverification_required.is.true",
      )
      .order("created_at", { ascending: true })
      .limit(MAX_PROFILES_PER_RUN);

    if (error) throw error;

    let eligible = 0;
    let pushQueued = 0;
    let emailQueued = 0;
    const nowMs = Date.now();

    for (const profile of (data ?? []) as TailorProfile[]) {
      if (
        profile.payout_account_verified === true &&
        profile.payout_reverification_required !== true
      ) continue;
      const stage = payoutReminderStage(reminderAnchor(profile), nowMs);
      if (!stage) continue;
      eligible += 1;

      const copy = payoutReminderCopy({
        verificationStatus: profile.id_verification_status,
        reverificationRequired: profile.payout_reverification_required === true,
      });
      const dedupeBase = `payout-readiness:${profile.id}:${
        reminderEpisode(profile)
      }:${stage}`;
      const push = await enqueueBackgroundJob(supabase, {
        eventType: "TAILOR_PAYOUT_READINESS_REMINDER",
        aggregateType: "TAILOR_PROFILE",
        aggregateId: profile.id,
        actorId: profile.user_id,
        actorRole: "TAILOR",
        idempotencyKey: `${dedupeBase}:push`,
        jobType: "SEND_PUSH",
        priority: 45,
        payload: {
          userId: profile.user_id,
          onlyIfPayoutIncomplete: true,
          notification: {
            title: copy.title,
            body: copy.body,
            data: {
              destination: "PAYOUT_SETUP",
              url: "/profile/payout-setup",
              type: "payout_readiness_reminder",
            },
            preferenceKey: "paymentReleased",
            communication: {
              category: "PAYOUT",
              purpose: "OPERATIONAL",
              severity: "NOTICE",
              inApp: true,
              destinationKey: "PAYOUT_SETUP",
              deduplicationKey: dedupeBase,
            },
          },
        },
      });
      if (push) pushQueued += 1;

      if (payoutReminderSendsEmail(stage)) {
        const email = await enqueueBackgroundJob(supabase, {
          eventType: "TAILOR_PAYOUT_READINESS_REMINDER",
          aggregateType: "TAILOR_PROFILE",
          aggregateId: profile.id,
          actorId: profile.user_id,
          actorRole: "TAILOR",
          idempotencyKey: `${dedupeBase}:email`,
          jobType: "SEND_ACCOUNT_EVENT_EMAIL",
          priority: 45,
          payload: {
            userId: profile.user_id,
            onlyIfPayoutIncomplete: true,
            subject: copy.emailSubject,
            eyebrow: copy.eyebrow,
            headline: copy.title,
            body: copy.body,
            ctaLabel: "Set up payouts",
            webPath: "/account/payout",
            appUrl: "drape://profile/payout-setup",
            details: [
              {
                label: "What stays paused",
                value: "Paid quotes, live selling, and earnings release",
              },
              {
                label: "What to do",
                value: "Open Drapeon and complete the payout provider checks",
              },
            ],
          },
        });
        if (email) emailQueued += 1;
      }
    }

    await audit(supabase, {
      event: "tailor.payout_readiness_reminders_queued",
      actor_role: "SYSTEM",
      payload: {
        function: FN,
        scanned: data?.length ?? 0,
        eligible,
        push_queued: pushQueued,
        email_queued: emailQueued,
      },
    });

    return new Response(
      JSON.stringify({
        ok: true,
        scanned: data?.length ?? 0,
        eligible,
        pushQueued,
        emailQueued,
      }),
      {
        headers: { ...cors, "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log("error", FN, "failed", { error: message });
    await Sentry.captureMessage("Tailor payout readiness reminders failed", {
      level: "error",
      tags: { function: FN },
      extra: { safe_error: message },
    });
    return new Response(
      JSON.stringify({
        ok: false,
        error: "Payout readiness reminders failed.",
      }),
      {
        status: 500,
        headers: { ...cors, "Content-Type": "application/json" },
      },
    );
  }
});
