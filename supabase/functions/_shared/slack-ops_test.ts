import {
  assert,
  assertEquals,
  assertFalse,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  exactOpsIssueUrl,
  redactSlackText,
  routedChannelKeys,
} from "./slack-ops.ts";

Deno.test("Slack Ops links open the exact authenticated case", () => {
  const issueId = "case id/with unsafe chars";
  const url = exactOpsIssueUrl(issueId, "https://ops.drapeon.co/");
  assertStringIncludes(url, "https://ops.drapeon.co/ops?");
  assertStringIncludes(url, "view=workflow-issues");
  assertStringIncludes(url, `focusIssue=${encodeURIComponent(issueId)}`);
  assertStringIncludes(url, `#workflow-issue-${encodeURIComponent(issueId)}`);
});

Deno.test("Slack summaries redact contact data, URLs, and common secrets", () => {
  const safe = redactSlackText(
    "email person@example.com phone +1 (615) 964-2153 url https://private.example/proof " +
      "api_key=sk_test_1234567890abcdefghijkl xoxb-1234567890-abcdefghijkl password=hunter2",
  );
  assertFalse(safe.includes("person@example.com"));
  assertFalse(safe.includes("615"));
  assertFalse(safe.includes("private.example"));
  assertFalse(safe.includes("sk_test"));
  assertFalse(safe.includes("xoxb-"));
  assertFalse(safe.includes("hunter2"));
  assertStringIncludes(safe, "[email hidden]");
  assertStringIncludes(safe, "[secure link hidden]");
});

Deno.test("critical money cases route to specialist and critical channels", () => {
  const channels = routedChannelKeys({
    issue_type: "PAYOUT_FAILED",
    severity: "CRITICAL",
    source: "release-order-payouts",
    stage: null,
    title: "Provider transfer failed",
  });
  assert(channels.includes("OPS_MONEY"));
  assert(channels.includes("OPS_CRITICAL"));
  assertEquals(channels.length, 2);
});

Deno.test("system alerts route to intake and engineering channels", () => {
  const channels = routedChannelKeys({
    issue_type: "SYSTEM_ALERT",
    severity: "HIGH",
    source: "sentry-ops-webhook",
    stage: null,
    title: "Runtime failure",
  });
  assert(channels.includes("OPS_INTAKE"));
  assert(channels.includes("ENGINEERING_ERRORS"));
});
