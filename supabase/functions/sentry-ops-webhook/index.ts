import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getServiceRoleKey, getSupabaseUrl } from "../_shared/env.ts";
import {
  createOrRefreshOpsIssue,
  resolveOpsIssueByDedupeKey,
} from "../_shared/ops-issues.ts";
import { parseSentryOpsEvent } from "../_shared/sentry-ops-webhook.ts";

const FN = "sentry-ops-webhook";

async function timingSafeEqual(left: string, right: string) {
  const encoder = new TextEncoder();
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  const leftBytes = new Uint8Array(leftHash);
  const rightBytes = new Uint8Array(rightHash);
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index] ^ rightBytes[index];
  }
  return difference === 0;
}

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  }

  const expectedSecret = Deno.env.get("SENTRY_OPS_WEBHOOK_SECRET")?.trim() ??
    "";
  const suppliedSecret = request.headers.get("x-drape-sentry-secret")?.trim() ??
    "";
  if (
    !expectedSecret || !suppliedSecret ||
    !(await timingSafeEqual(expectedSecret, suppliedSecret))
  ) {
    return json({ error: "UNAUTHORIZED" }, 401);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "INVALID_JSON" }, 400);
  }

  const parsed = parseSentryOpsEvent(payload);
  const supabase = createClient(getSupabaseUrl(), getServiceRoleKey());
  if (parsed.isResolved) {
    await resolveOpsIssueByDedupeKey(supabase, parsed.dedupeKey, {
      sentry_resolution_received: true,
      sentry_issue_id: parsed.issueId,
      sentry_project: parsed.projectSlug,
    });
    return json({ accepted: true, resolved: true }, 202);
  }
  const opsIssue = await createOrRefreshOpsIssue(supabase, {
    issueType: "SYSTEM_ALERT",
    severity: parsed.severity,
    source: FN,
    actorRole: "SYSTEM",
    relatedEntityType: "sentry_issue",
    relatedEntityId: parsed.issueId ?? parsed.shortId,
    stage: parsed.projectSlug,
    title: parsed.title,
    description:
      `${parsed.projectSlug} reported a ${parsed.level} runtime issue. The alert has occurred ${parsed.count} time(s).`,
    recommendedAction:
      "Open the authenticated Ops case, correlate the Sentry issue ID with Edge and client logs, then record a terminal recovery outcome.",
    dedupeKey: parsed.dedupeKey,
    metadata: {
      sentry_issue_id: parsed.issueId,
      sentry_short_id: parsed.shortId,
      sentry_project: parsed.projectSlug,
      sentry_level: parsed.level,
      occurrence_count: parsed.count,
    },
    notifyOps: parsed.severity === "CRITICAL",
  });

  if (!opsIssue) return json({ error: "OPS_ISSUE_PERSISTENCE_FAILED" }, 503);

  return json({
    accepted: true,
    issueId: opsIssue.id,
    issueNumber: opsIssue.issue_number,
  }, 202);
});
