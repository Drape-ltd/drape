type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function safeOpaqueId(value: unknown) {
  const candidate = text(value);
  return /^[a-zA-Z0-9._:-]{1,160}$/u.test(candidate) ? candidate : "";
}

export function parseSentryOpsEvent(body: unknown) {
  const root = record(body);
  const data = record(root.data);
  const issue = record(data.issue);
  const event = record(data.event);
  const project = record(issue.project);
  const eventProject = record(event.project);
  const action = text(root.action) || text(data.action) || text(issue.status);

  const issueId = safeOpaqueId(issue.id) || safeOpaqueId(event.issue_id) ||
    safeOpaqueId(event.id);
  const shortId = safeOpaqueId(issue.shortId) || safeOpaqueId(issue.short_id);
  const projectSlug = safeOpaqueId(project.slug) ||
    safeOpaqueId(eventProject.slug) || safeOpaqueId(root.project) ||
    "unknown-project";
  const level = text(issue.level) || text(event.level) || text(data.level) ||
    "error";
  const rawTitle = text(issue.title) || text(event.title) ||
    text(event.message) || "A monitored runtime issue needs review";
  const title = rawTitle.replace(/https?:\/\/\S+/giu, "[link hidden]").slice(
    0,
    180,
  );
  const count = Number(issue.count ?? event.count ?? 1);
  const severity = level === "fatal"
    ? "CRITICAL"
    : level === "warning"
    ? "MEDIUM"
    : "HIGH";
  const identity = issueId || shortId || `${projectSlug}:${title.slice(0, 80)}`;

  return {
    issueId: issueId || null,
    shortId: shortId || null,
    projectSlug,
    level,
    title,
    count: Number.isFinite(count) && count > 0 ? Math.floor(count) : 1,
    severity,
    isResolved: action.toLowerCase() === "resolved" ||
      text(issue.status).toLowerCase() === "resolved",
    dedupeKey: `sentry:${projectSlug}:${identity}`.slice(0, 500),
  } as const;
}
