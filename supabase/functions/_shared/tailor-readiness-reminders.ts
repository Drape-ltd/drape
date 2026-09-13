const DAY_MS = 24 * 60 * 60 * 1_000;

export type PayoutReminderStage =
  | "day-1"
  | "day-3"
  | "day-7"
  | "day-14"
  | "day-30";

export function payoutReminderStage(
  anchorAt: string | null | undefined,
  nowMs = Date.now(),
): PayoutReminderStage | null {
  const anchorMs = anchorAt ? Date.parse(anchorAt) : Number.NaN;
  if (!Number.isFinite(anchorMs) || nowMs < anchorMs + DAY_MS) return null;
  const ageDays = Math.floor((nowMs - anchorMs) / DAY_MS);
  if (ageDays < 3) return "day-1";
  if (ageDays < 7) return "day-3";
  if (ageDays < 14) return "day-7";
  if (ageDays < 30) return "day-14";
  return "day-30";
}

export function payoutReminderCopy(input: {
  verificationStatus: string | null | undefined;
  reverificationRequired: boolean;
}) {
  if (input.reverificationRequired) {
    return {
      title: "Your payout account needs an update",
      body:
        "Update and verify your payout details so Drapeon can keep releasing eligible earnings without delay.",
      emailSubject: "Update your Drapeon payout account",
      eyebrow: "Payout action needed",
    };
  }

  if (input.verificationStatus === "PENDING") {
    return {
      title: "Set up payouts while we review you",
      body:
        "Your trust review is in progress. Connect your payout account now so paid work can open as soon as you are approved.",
      emailSubject: "Finish your Drapeon payout setup",
      eyebrow: "While we review you",
    };
  }

  return {
    title: "Finish payouts to start taking paid work",
    body:
      "Your tailor profile is approved, but paid quotes, live selling, and earnings release remain paused until your payout account is verified.",
    emailSubject: "One step remains before you can take paid work",
    eyebrow: "Payout setup required",
  };
}

export function payoutReminderSendsEmail(stage: PayoutReminderStage) {
  return stage !== "day-3";
}
