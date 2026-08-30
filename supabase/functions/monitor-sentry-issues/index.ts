import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeCronRequest } from "../_shared/cron.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { getServiceRoleKey, getSupabaseUrl } from "../_shared/env.ts";
import { createOrRefreshOpsIssue } from "../_shared/ops-issues.ts";
import { Sentry } from "../_shared/sentry.ts";
import {
  normalizeSentryIssue,
  type SentryMonitorState,
  shouldNotifySentryIssue,
} from "../_shared/sentry-monitor.ts";

const FN = "monitor-sentry-issues";

function response(body: unknown, status: number, cors: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

async function sentryGet(path: string, token: string) {
  const result = await fetch(`https://sentry.io/api/0${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!result.ok) throw new Error(`SENTRY_HTTP_${result.status}`);
  return await result.json();
}

Deno.serve(async (request) => {
  const cors = getCorsHeaders(request);
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }
  if (request.method !== "POST") {
    return response({ error: "METHOD_NOT_ALLOWED" }, 405, cors);
  }
  const unauthorized = await authorizeCronRequest(request, FN, cors);
  if (unauthorized) return unauthorized;

  const token = Deno.env.get("SENTRY_MONITOR_TOKEN")?.trim() ?? "";
  const org = Deno.env.get("SENTRY_MONITOR_ORG")?.trim() ?? "";
  if (!token || !org) {
    return response({ error: "SENTRY_MONITOR_NOT_CONFIGURED" }, 503, cors);
  }

  const configuredProjects = (Deno.env.get("SENTRY_MONITOR_PROJECTS") ?? "")
    .split(",").map((value) => value.trim()).filter(Boolean);
  const supabase = createClient(getSupabaseUrl(), getServiceRoleKey());
  const now = new Date();

  try {
    const projectsResponse = await sentryGet(
      `/organizations/${encodeURIComponent(org)}/projects/`,
      token,
    );
    const projects = Array.isArray(projectsResponse)
      ? projectsResponse.map((item) => item?.slug).filter((
        slug,
      ): slug is string =>
        typeof slug === "string" &&
        (!configuredProjects.length || configuredProjects.includes(slug))
      )
      : [];

    let inspected = 0;
    let alerted = 0;
    let suppressed = 0;
    for (const project of projects) {
      const rawIssues = await sentryGet(
        `/projects/${encodeURIComponent(org)}/${
          encodeURIComponent(project)
        }/issues/?query=is%3Aunresolved&sort=freq&limit=50`,
        token,
      );
      for (const rawIssue of Array.isArray(rawIssues) ? rawIssues : []) {
        const issue = normalizeSentryIssue(rawIssue);
        if (!issue) continue;
        inspected += 1;
        const stateResult = await supabase.from("sentry_ops_monitor_state")
          .select("last_count,last_severity,last_notified_at")
          .eq("sentry_issue_id", issue.issueId).maybeSingle();
        if (stateResult.error) {
          throw new Error(`STATE_LOOKUP_FAILED:${stateResult.error.message}`);
        }
        const state = stateResult.data as SentryMonitorState | null;
        const notify = shouldNotifySentryIssue(issue, state, now);

        if (notify) {
          const opsIssue = await createOrRefreshOpsIssue(supabase, {
            issueType: "SYSTEM_ALERT",
            severity: issue.severity,
            source: FN,
            actorRole: "SYSTEM",
            relatedEntityType: "sentry_issue",
            relatedEntityId: issue.issueId,
            stage: issue.projectSlug,
            title: issue.title,
            description:
              `${issue.projectSlug} reported a ${issue.level} runtime issue. Sentry recorded ${issue.count} occurrence(s).`,
            recommendedAction:
              "Open this authenticated Ops case, correlate the opaque Sentry issue ID with safe application logs, then record a terminal recovery outcome.",
            dedupeKey: issue.dedupeKey,
            metadata: {
              sentry_issue_id: issue.issueId,
              sentry_short_id: issue.shortId,
              sentry_project: issue.projectSlug,
              sentry_level: issue.level,
              occurrence_count: issue.count,
              sentry_last_seen_at: issue.lastSeenAt,
            },
            notifyOps: issue.severity === "CRITICAL",
          });
          if (!opsIssue) throw new Error("OPS_ISSUE_PERSISTENCE_FAILED");
          alerted += 1;
        } else {
          suppressed += 1;
        }

        const stateWrite = await supabase.from("sentry_ops_monitor_state")
          .upsert({
            sentry_issue_id: issue.issueId,
            project_slug: issue.projectSlug,
            dedupe_key: issue.dedupeKey,
            last_count: issue.count,
            last_severity: issue.severity,
            last_seen_at: issue.lastSeenAt ?? now.toISOString(),
            last_notified_at: notify
              ? now.toISOString()
              : state?.last_notified_at ?? null,
            updated_at: now.toISOString(),
          }, { onConflict: "sentry_issue_id" });
        if (stateWrite.error) {
          throw new Error(`STATE_WRITE_FAILED:${stateWrite.error.message}`);
        }
      }
    }

    return response(
      { ok: true, projects: projects.length, inspected, alerted, suppressed },
      200,
      cors,
    );
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "UNKNOWN_MONITOR_FAILURE";
    await Sentry.captureMessage("Sentry issue monitor failed", {
      level: "error",
      tags: { function: FN },
      extra: { error: message },
    });
    return response(
      { error: "SENTRY_MONITOR_FAILED", detail: message },
      503,
      cors,
    );
  }
});
