# Drapeon Trust Video Verification

## Decision

Drapeon verifies that a real person stands behind a tailor profile and its portfolio. It does not collect a government identity document and does not create a biometric template.

Payout providers perform their own regulated KYC. Drapeon consumes provider account identifiers, verification/capability status, and actionable failure reasons; it does not copy the provider's identity evidence into Drapeon storage.

## Evidence And Challenge

The tailor records a private 8–15 second video containing:

- their face and natural voice;
- a randomized phrase shown for that session;
- a spoken confirmation that the profile and portfolio represent their work.

The challenge identifier and exact prompt are stored with the private video path. Reusing a static clip must not satisfy a newly generated challenge.

The review is manual. V1 does not perform face recognition, document OCR, liveness scoring, or automated biometric matching.

## Storage And Access

- Bucket: `trust-verification`
- Path owner: `verification-video/{tailor_user_id}/challenge_{challenge_id}_{timestamp}.{ext}`
- Accepted formats: MP4, MOV, WebM
- Maximum object size: 50 MB
- Objects remain private and are viewed by Ops through short-lived signed URLs.
- Submission records the active consent-policy version.
- Every Ops evidence view and decision must remain auditable.

## State Model

Legacy `id_verification_*` names remain for database and client compatibility. They represent marketplace trust review and must use `id_verification_method = 'CHALLENGE_VIDEO'`.

- `NOT_SUBMITTED` or `REJECTED`: a new challenge may be recorded.
- `PENDING`: evidence is locked while Ops reviews it.
- `VERIFIED`: the trust gate passed and the storefront may go live.
- `REJECTED`: the storefront stays hidden and the tailor receives a specific retake reason.

Protected fields may only transition through the submission and Ops decision RPCs. Service-role fixture code must not bypass these transitions by directly patching verification status.

## Independent Payout Gate

Marketplace trust and payout readiness are deliberately separate:

- trust approval controls profile visibility and marketplace participation;
- payment-provider verification controls paid checkout, payout destination readiness, and earnings release;
- a trust-approved tailor may be visible while paid capabilities remain paused;
- a provider KYC failure must not silently revoke marketplace trust approval.

Drapeon may require confirmation that the account details entered by the tailor match the provider-resolved destination before saving them. It must not compare those details against a Drapeon-held government-ID name because Drapeon does not hold that evidence.

## Ops Decision Contract

Approval must prove:

- a pending challenge-video submission;
- profile name, phone, profile image, at least one specialty, and portfolio proof;
- status transitions to `VERIFIED`;
- `is_verified` and `is_live` become true;
- the related Ops issue resolves;
- issue and decision audit rows are written;
- email and push attempts reach a recorded terminal outcome.

Rejection must prove:

- a pending submission and a specific reason;
- status transitions to `REJECTED`;
- the storefront remains hidden;
- the related Ops issue resolves;
- audit rows and notification outcomes are recorded;
- the tailor can start a fresh randomized challenge.

An HTTP success or redirect alone is not proof. Development QA must inspect persisted profile state, issue state, audits, and side-effect outcomes for both decisions.

## Cross-Platform UX

Mobile and web must use the same challenge policy and consent version. Both surfaces must:

- request camera and microphone permission before recording;
- show the exact challenge while recording;
- enforce the 8–15 second duration;
- allow preview and retake without losing setup state;
- upload to private storage;
- return to setup after a successful submission;
- explain that payout verification occurs separately with the payment provider.

## Out Of Scope

- government-ID collection by Drapeon;
- document-number storage;
- OCR or face recognition;
- biometric templates;
- automated identity matching;
- replacing payment-provider KYC;
- production retention deletion automation without separate legal and provider approval.

## Required Regression Gates

Before release:

1. Mobile and web typechecks pass.
2. Shared challenge-policy and Ops decision tests pass.
3. Relevant Edge functions pass `deno check` and unit tests.
4. The migration is applied to development before production.
5. A disposable pending profile is approved through the real Ops route and its state, audit, email, and push outcomes are asserted.
6. A separate disposable pending profile is rejected through the real Ops route with the same assertions.
7. Mobile camera/microphone recording and contextual return are verified on a fresh native build.

Production migration or function deployment still requires explicit approval.
