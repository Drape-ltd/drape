import { assertEquals, assertMatch } from "jsr:@std/assert";
import {
  normalizeSentryIssue,
  sanitizeSentryText,
  shouldNotifySentryIssue,
} from "./sentry-monitor.ts";

Deno.test("sanitizeSentryText removes contact, link, and credential values", () => {
  const value = sanitizeSentryText(
    "Failed for person@example.com +1 615 555 0199 https://example.com sk_test_secretsecretsecret",
  );
  assertMatch(value, /\[email hidden\]/u);
  assertMatch(value, /\[phone hidden\]/u);
  assertMatch(value, /\[link hidden\]/u);
  assertMatch(value, /\[credential hidden\]/u);
});

Deno.test("normalizeSentryIssue creates a safe stable identity", () => {
  assertEquals(
    normalizeSentryIssue({
      id: "1234",
      shortId: "MOBILE-12",
      project: { slug: "drape-mobile" },
      level: "fatal",
      title: "Crash in checkout",
      count: "7",
    }),
    {
      issueId: "1234",
      shortId: "MOBILE-12",
      projectSlug: "drape-mobile",
      level: "fatal",
      title: "Crash in checkout",
      count: 7,
      severity: "CRITICAL",
      dedupeKey: "sentry:drape-mobile:1234",
      lastSeenAt: null,
    },
  );
});

Deno.test("shouldNotifySentryIssue suppresses count churn inside cooldown", () => {
  const issue = normalizeSentryIssue({
    id: "1234",
    project: { slug: "drape-mobile" },
    level: "error",
    title: "Crash",
    count: 8,
  })!;
  const now = new Date("2026-08-27T12:00:00.000Z");
  assertEquals(shouldNotifySentryIssue(issue, null, now), true);
  assertEquals(
    shouldNotifySentryIssue(issue, {
      last_count: 7,
      last_severity: "HIGH",
      last_notified_at: "2026-08-27T11:45:00.000Z",
    }, now),
    false,
  );
  assertEquals(
    shouldNotifySentryIssue(issue, {
      last_count: 7,
      last_severity: "HIGH",
      last_notified_at: "2026-08-27T11:00:00.000Z",
    }, now),
    true,
  );
});
