#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const DEFAULT_TIMEOUT_MS = 15_000;

const targets = [
  {
    id: "drape-dev-live",
    name: "Drape DEV",
    url: "https://pqptfuqogvrajozfsqzi.supabase.co/functions/v1/service-health?check=live",
    kind: "drape",
  },
  {
    id: "drape-prod-live",
    name: "Drape PROD",
    url: "https://wkfsrunetmgjdtcurmoj.supabase.co/functions/v1/service-health?check=live",
    kind: "drape",
  },
  {
    id: "supabase-status",
    name: "Supabase",
    url: "https://status.supabase.com/api/v2/summary.json",
    kind: "atlassian",
  },
  {
    id: "daily-status",
    name: "Daily",
    url: "https://status.daily.co/api/v2/summary.json",
    kind: "atlassian",
  },
  {
    id: "paystack-status",
    name: "Paystack",
    url: "https://status.paystack.com/v3/summary.json",
    kind: "paystack",
  },
  {
    id: "stripe-status",
    name: "Stripe",
    url: "https://status.stripe.com/current",
    kind: "stripe",
  },
  {
    id: "cloudflare-status",
    name: "Cloudflare",
    url: "https://www.cloudflarestatus.com/api/v2/summary.json",
    kind: "atlassian",
  },
  {
    id: "sentry-status",
    name: "Sentry",
    url: "https://status.sentry.io/api/v2/summary.json",
    kind: "atlassian",
  },
  {
    id: "expo-status",
    name: "Expo",
    url: "https://status.expo.dev/api/v2/summary.json",
    kind: "atlassian",
  },
  {
    id: "slack-status",
    name: "Slack",
    url: "https://slack-status.com/api/v2.0.0/current",
    kind: "slack",
  },
];

if (process.env.DRAPE_HEALTHCHECK_SECRET) {
  targets.push({
    id: "drape-dev-ready",
    name: "Drape DEV readiness",
    url: "https://pqptfuqogvrajozfsqzi.supabase.co/functions/v1/service-health?check=ready&tier=beta",
    kind: "drape-ready",
    authorization: `Bearer ${process.env.DRAPE_HEALTHCHECK_SECRET}`,
  });
}

if (process.env.DRAPE_PROD_HEALTHCHECK_SECRET) {
  targets.push({
    id: "drape-prod-ready",
    name: "Drape PROD readiness",
    url: "https://wkfsrunetmgjdtcurmoj.supabase.co/functions/v1/service-health?check=ready",
    kind: "drape-ready",
    authorization: `Bearer ${process.env.DRAPE_PROD_HEALTHCHECK_SECRET}`,
  });
}

const outputIndex = process.argv.indexOf("--output");
const outputPath = outputIndex >= 0 ? process.argv[outputIndex + 1] : null;
const fixtureIndex = process.argv.indexOf("--fixture");
const fixturePath = fixtureIndex >= 0 ? process.argv[fixtureIndex + 1] : null;
const fixture = fixturePath
  ? JSON.parse(await readFile(fixturePath, "utf8"))
  : null;

function compact(value, max = 220) {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

function unresolvedIncidents(body) {
  return (body?.incidents ?? []).filter((incident) =>
    !["resolved", "completed", "postmortem"].includes(
      String(incident?.status ?? "").toLowerCase(),
    ),
  );
}

function normalize(target, body) {
  if (target.kind === "drape") {
    const ok = body?.ok === true && body?.status === "ok";
    return { ok, detail: ok ? "Operational" : compact(body?.message || body?.status || "Liveness failed") };
  }

  if (target.kind === "drape-ready") {
    const failures = Object.entries(body?.checks ?? {})
      .filter(([, check]) => check?.status === "fail")
      .map(([name, check]) => `${name}: ${check?.message ?? "failed"}`);
    const ok = body?.ok === true && failures.length === 0;
    return { ok, detail: ok ? "Ready" : compact(failures.join("; ") || body?.message || "Readiness failed") };
  }

  if (target.kind === "atlassian") {
    const incidents = unresolvedIncidents(body);
    const degraded = (body?.components ?? []).filter((component) =>
      !["operational", "under_maintenance"].includes(
        String(component?.status ?? "").toLowerCase(),
      ),
    );
    const indicator = String(body?.status?.indicator ?? "unknown").toLowerCase();
    const ok = indicator === "none" && incidents.length === 0 && degraded.length === 0;
    const detail = incidents.length
      ? incidents.map((incident) => incident?.name).filter(Boolean).join("; ")
      : degraded.length
        ? degraded.map((component) => `${component?.name}: ${component?.status}`).join("; ")
        : body?.status?.description || indicator;
    return { ok, detail: compact(detail || (ok ? "Operational" : "Status unavailable")) };
  }

  if (target.kind === "stripe") {
    const statuses = Object.entries(body?.statuses ?? {});
    const unhealthy = statuses.filter(([, status]) => String(status).toLowerCase() !== "up");
    const ok = String(body?.largestatus ?? "").toLowerCase() === "up" && unhealthy.length === 0;
    return {
      ok,
      detail: compact(ok ? body?.message || "Operational" : unhealthy.map(([name, status]) => `${name}: ${status}`).join("; ") || body?.message),
    };
  }

  if (target.kind === "paystack") {
    const incidents = body?.activeIncidents ?? body?.active_incidents ?? [];
    const ok = String(body?.page?.status ?? "").toUpperCase() === "UP" && incidents.length === 0;
    return {
      ok,
      detail: compact(ok ? "Operational" : incidents.map((incident) => incident?.name || incident?.title).filter(Boolean).join("; ") || body?.page?.status || "Status unavailable"),
    };
  }

  if (target.kind === "slack") {
    const incidents = body?.active_incidents ?? [];
    const ok = String(body?.status ?? "").toLowerCase() === "active" && incidents.length === 0;
    return {
      ok,
      detail: compact(ok ? "Operational" : incidents.map((incident) => incident?.title).filter(Boolean).join("; ") || body?.status || "Status unavailable"),
    };
  }

  return { ok: false, detail: "Unknown monitor type" };
}

async function fetchTarget(target) {
  const fixtureValue = fixture?.[target.id];
  if (fixtureValue) {
    const status = Number(fixtureValue.status ?? 200);
    if (status < 200 || status >= 300) {
      return { ...target, ok: false, httpStatus: status, detail: `HTTP ${status}` };
    }
    const normalized = normalize(target, fixtureValue.body ?? fixtureValue);
    return { ...target, ...normalized, httpStatus: status };
  }

  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    try {
      const response = await fetch(target.url, {
        headers: {
          accept: "application/json",
          "user-agent": "Drapeon-External-Service-Observer/1.0",
          ...(target.authorization ? { authorization: target.authorization } : {}),
        },
        signal: controller.signal,
      });
      const text = await response.text();
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
      if (!response.ok) {
        lastError = `HTTP ${response.status}`;
      } else if (!body) {
        lastError = "Non-JSON response";
      } else {
        const normalized = normalize(target, body);
        return { ...target, ...normalized, httpStatus: response.status };
      }
    } catch (error) {
      lastError = error?.name === "AbortError" ? "Timed out" : compact(error?.message || error);
    } finally {
      clearTimeout(timeout);
    }
  }
  return { ...target, ok: false, httpStatus: 0, detail: lastError || "Request failed" };
}

const results = await Promise.all(targets.map(fetchTarget));
const unhealthy = results
  .filter((result) => !result.ok)
  .map((result) => ({ id: result.id, name: result.name, detail: result.detail, httpStatus: result.httpStatus }))
  .sort((a, b) => a.id.localeCompare(b.id));
const state = unhealthy.length === 0 ? "ok" : "fail";
const fingerprintSource = unhealthy.length === 0
  ? "healthy"
  : JSON.stringify(unhealthy.map(({ id, detail, httpStatus }) => ({ id, detail, httpStatus })));
const fingerprint = createHash("sha256").update(fingerprintSource).digest("hex").slice(0, 16);
const summary = state === "ok"
  ? `All ${results.length} monitored services are operational.`
  : `${unhealthy.length} of ${results.length} monitored services need attention: ${unhealthy.map((item) => `${item.name} (${item.detail})`).join("; ")}`;
const report = {
  checkedAt: new Date().toISOString(),
  state,
  fingerprint,
  summary: compact(summary, 1_500),
  targets: results.map(({ authorization: _authorization, kind: _kind, ...result }) => result),
};

const serialized = `${JSON.stringify(report, null, 2)}\n`;
if (outputPath) {
  await writeFile(outputPath, serialized, "utf8");
}
process.stdout.write(serialized);
