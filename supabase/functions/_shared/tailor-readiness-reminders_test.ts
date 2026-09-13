import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  payoutReminderCopy,
  payoutReminderSendsEmail,
  payoutReminderStage,
} from "./tailor-readiness-reminders.ts";

const DAY_MS = 24 * 60 * 60 * 1_000;
const anchor = "2026-09-01T12:00:00.000Z";
const atDay = (day: number) => Date.parse(anchor) + day * DAY_MS;

Deno.test("payout reminder cadence is bounded and idempotency-friendly", () => {
  assertEquals(payoutReminderStage(anchor, atDay(0)), null);
  assertEquals(payoutReminderStage(anchor, atDay(1)), "day-1");
  assertEquals(payoutReminderStage(anchor, atDay(3)), "day-3");
  assertEquals(payoutReminderStage(anchor, atDay(7)), "day-7");
  assertEquals(payoutReminderStage(anchor, atDay(14)), "day-14");
  assertEquals(payoutReminderStage(anchor, atDay(30)), "day-30");
  assertEquals(payoutReminderStage(anchor, atDay(120)), "day-30");
});

Deno.test("day three remains an inbox and push nudge without another email", () => {
  assertEquals(payoutReminderSendsEmail("day-1"), true);
  assertEquals(payoutReminderSendsEmail("day-3"), false);
  assertEquals(payoutReminderSendsEmail("day-7"), true);
});

Deno.test("payout copy distinguishes pending, approved, and reverification states", () => {
  assertEquals(
    payoutReminderCopy({
      verificationStatus: "PENDING",
      reverificationRequired: false,
    }).title,
    "Set up payouts while we review you",
  );
  assertEquals(
    payoutReminderCopy({
      verificationStatus: "VERIFIED",
      reverificationRequired: false,
    }).title,
    "Finish payouts to start taking paid work",
  );
  assertEquals(
    payoutReminderCopy({
      verificationStatus: "VERIFIED",
      reverificationRequired: true,
    }).title,
    "Your payout account needs an update",
  );
});
