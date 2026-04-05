# V1 Decisions: Account Recovery, Reauthentication, And Sensitive-Request Verification

Date: April 2, 2026

## Why This Exists

Drape needs a practical answer to:

- how self-serve recovery should work
- when support can help recover an account
- when an active session is enough
- when Drape should require stronger proof before a risky action

This document turns the research into a working V1 stance.

## Important Scope Note

This is a V1 product-policy stance, not final legal advice.

## Core Principle

Make it easy for the real user to recover access, but hard for support, messaging, or social engineering to become an account-takeover shortcut.

## Decision 1: Email-Link Recovery Stays The Primary Self-Serve Recovery Method

### Chosen rule

For V1, Drape should keep email-link password reset as the main self-serve recovery path.

### Why

This matches the current product shape and is cleaner than rushing into SMS recovery before phone identity is mature.

## Decision 2: Phone Should Not Become The Sole Self-Serve Recovery Factor In V1

### Chosen rule

For V1, Drape should not offer “recover my account by phone number only” or “OTP to phone is enough to take over the account” as a primary recovery path.

### Why

Phone normalization, phone verification, SIM-swap risk, shared-family-device reality, and channel abuse controls are not mature enough yet.

## Decision 3: Shared Phones And Shared Devices Are Allowed, But Fraud Limits Still Matter

### Chosen rule

For V1, Drape should not treat one shared device or family phone as automatically suspicious by itself.

### Better posture

- tolerate legitimate shared-device reality
- add anti-fraud limits for scale abuse

### Why

This fits public-facing mobile reality better, especially in lower-infrastructure markets.

## Decision 4: Password Change Must Continue To Require Reauthentication

### Chosen rule

For V1, Drape should keep password change behind step-up verification.

### Why

This is one of the clearest places where an active session alone is not enough.

## Decision 5: Future Email Change And Phone Change Should Also Be Treated As Sensitive

### Chosen rule

For V1, Drape should treat changes to recovery-adjacent identity fields as sensitive actions.

### Practical implication

If phone is used for account recovery, account notification, or stronger trust later, phone change should require step-up verification rather than only an active session.

### Why

Recovery channel changes are a classic account-takeover path.

## Decision 6: Signed-In Session Is Enough To Initiate Some Requests, But Not To Trust Any New Delivery Channel

### Chosen rule

For V1:

- a signed-in session can be enough to initiate account deletion or data-access handling
- but Drape should not use a newly claimed channel to deliver sensitive data or finalize recovery without stronger verification

### Why

Initiation and release are different risk levels.

## Decision 7: Support Recovery Must Be Conservative For Unproofed Accounts

### Chosen rule

For V1, support should not casually reset or transfer access for ordinary unproofed customer accounts when the requester no longer controls the bound recovery channel.

### Better posture

- preserve the account
- pause risky actions if needed
- explain the verified recovery path
- avoid blind manual takeover

### Why

Narrative proof is too weak for account takeover protection.

## Decision 8: Verified Tailor Recovery Can Use A Stronger Manual Review Path

### Chosen rule

For V1, tailor accounts that already went through stronger identity verification may use a higher-friction, evidence-based support recovery path.

### Why

Drape may have a better factual basis for re-verifying those accounts than for ordinary customer accounts.

## Decision 9: Sensitive Data Requests Need Proportionate Identity Proof

### Chosen rule

For V1, Drape should use proportionate verification for export, deletion, and similar rights requests.

### Better posture

- existing authenticated session can count when risk is low
- ask for more when the risk of wrong disclosure is higher
- formal ID only when necessary

### Why

This follows the “reasonable and proportionate” standard better than either blanket trust or blanket document requests.

## Decision 10: Recovery And Sensitive Changes Should Trigger Notifications

### Chosen rule

For V1, Drape should notify the account’s existing contact channels when events such as these happen:

- password reset
- recovery-path use
- future email or phone change
- deletion request
- high-risk access or export handling

### Why

Notifications are one of the simplest ways to surface unauthorized activity early.

## Decision 11: Security Questions Stay Out

### Chosen rule

For V1, Drape should not use security questions as a primary recovery method.

### Why

They are weak, guessable, and easy to social-engineer.

## Decision 12: Recovery Policy Should Be Honest About What Support Can And Cannot Do

### Chosen rule

For V1, Drape should not imply that support can always restore access instantly.

### Better copy posture

- self-serve recovery through your bound email
- support can help review and guide next steps
- some recoveries may require stronger proof or may not be possible instantly

### Why

Honest recovery promises are safer than overly generous ones.

## Decision 13: Future Product Should Model Recovery Governance More Explicitly

### Chosen rule

When implemented further, useful fields and primitives likely include:

- `recent_reauth_at`
- `recovery_channel_verified_at`
- `recovery_review_status`
- `recovery_risk_level`
- `export_identity_verified_at`
- `deletion_identity_verified_at`
- `auth_notification_sent_at`

### Why

Right now, too much of this is implied by UI and support process instead of explicit system state.

## Recommendation Summary

The cleanest V1 posture is:

- keep email-link recovery as the self-serve default
- keep password changes behind reauth
- treat phone and future recovery-channel changes as sensitive
- do not let support casually bypass bound-channel recovery for unproofed accounts
- use proportionate proof for export and deletion handling
- tolerate shared-device reality while still limiting large-scale abuse

## Sources

- [OWASP: Forgot Password Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html)
- [OWASP: Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
- [ICO: What should we consider when responding to a request?](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/right-of-access/what-should-we-consider-when-responding-to-a-request/)
- [NIST SP 800-63B](https://pages.nist.gov/800-63-4/sp800-63b.html)
