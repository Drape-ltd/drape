# Research Notes: Account Recovery, Reauthentication, And Sensitive-Request Verification

Date: April 2, 2026

## Why This Exists

Drape already has:

- email-based password reset
- in-app password change
- privacy and deletion request flows
- profile editing for identity-adjacent fields like phone number

What is still ambiguous is:

- what Drape should treat as real account recovery
- when an active session is enough
- when Drape should require step-up verification
- how support should handle “I lost access” cases without creating an account-takeover path
- how all of this should adapt to shared devices, family phones, and weaker infrastructure realities

This note is the research layer for that ambiguity.

## Important Scope Note

This is a product-policy note, not final legal advice.

## High-Signal Takeaways

- Drape’s current self-serve recovery shape is email-link based, which is reasonable for V1.
- Drape already does the right thing for password change by requiring reauthentication first.
- Drape is lighter than it should be for some other sensitive actions, especially phone changes and deletion/export-style requests.
- Support recovery is necessary, but it should not become a casual backdoor around the normal auth system.
- In African-market reality, shared phones and shared devices are normal enough that Drape should not treat that alone as suspicious, but Drape still needs anti-fraud thresholds.
- If Drape has not identity-proofed an account, support-led recovery should be much more conservative.

## 1. What Drape Already Does Today

Important local strengths:

- `forgot-password` sends an email reset link through Supabase using a mobile deep link
- `reset-password` waits for the recovery session before showing the new-password form
- after password reset, the app signs the user out and sends them back through normal sign-in
- in-app password change requires reauthentication first:
  - biometric if enabled
  - otherwise current password
- email is read-only in the current customer personal-info screen

Important local gaps:

- customer phone number can currently be changed from an active session without separate reauthentication
- deletion request initiation is session-based and rate-limited, but does not currently step up identity
- data export is still a support email request, so identity verification for that path is still mostly procedural rather than encoded
- there is no explicit self-serve phone-based recovery path yet
- there is no explicit policy layer yet for support-assisted “lost email / lost access” recovery
- it is not obvious from the current local code that all existing sessions are invalidated after recovery, beyond the current device being signed out after password reset

Important Drape takeaway:

- the core auth flow is decent
- the sensitive-request verification boundary is still underdefined

## 2. OWASP Guidance: Recovery Must Be Enumeration-Safe And Reauth Must Protect Sensitive Changes

OWASP’s current guidance says:

- forgot-password request flows should return consistent messages for existing and non-existing accounts
- the response timing should also stay consistent
- URL tokens are the simplest and fastest implementation for password reset
- after reset, users should log in through the normal mechanism instead of being automatically logged in
- applications should ask users whether to invalidate existing sessions, or do that automatically

OWASP’s authentication guidance also says:

- change-password flows should require current password verification
- current credentials should be required before changing sensitive account information such as password or email
- reauthentication is critical after high-risk events like account recovery, password resets, or suspicious behavior

Important Drape takeaway:

- Drape’s email-link reset flow is directionally right
- Drape’s in-app password-change gate is directionally right
- Drape should extend the same thinking to other sensitive account changes and recovery-adjacent actions

## 3. ICO Guidance: Identity Checks For Data Requests Should Be Proportionate

ICO’s current guidance says:

- organisations can ask for enough information to judge that the requester is the right person
- checks should be reasonable and proportionate
- formal ID should only be requested if necessary
- existing verification measures, such as an existing username and password, can be used
- the level of checking can depend on the sensitivity of the information and the harm of disclosing it to the wrong person

Important Drape takeaway:

- not every data request needs passport-level proof
- but export and deletion requests should not rely on “trust me, it’s my account” support emails either

## 4. NIST Guidance: Shared Devices Are Normal, But Recovery Needs Real Verification

NIST’s current guidance says:

- public-facing applications should not prevent a device from being used as an authenticator by multiple subscribers, though they may add anti-fraud limits
- if recovery addresses were not previously validated or verified, they should be verified before they are trusted for recovery
- when accounts have not been identity-proofed, recovery should rely on real recovery methods rather than pretending reproofing exists
- alternative recovery methods involving an agent are allowed, but must be risk-based and documented
- invalidation requests should be handled using a risk-based determination of authenticity
- account recovery should trigger notifications

Important Drape takeaway:

- shared family phones should not be treated as instant fraud by default
- but Drape should not add phone-based recovery casually
- if phone ever becomes a recovery address, it must be normalized, verified, and governed properly first

## 5. The Biggest Drape Distinction

The most useful product distinction here is:

- self-serve recovery
- in-session sensitive changes
- signed-out support recovery
- signed-in sensitive privacy / data requests

Those are not the same problem.

For Drape:

- password reset is self-serve recovery
- password change, future email change, and future recovery-channel changes are in-session sensitive changes
- “I lost my inbox / I can’t get in” is signed-out support recovery
- deletion and export requests are privacy-sensitive, but not identical to login recovery

Important Drape takeaway:

- one blanket “verify identity” rule will be too weak in some places and too heavy in others

## 6. What Recovery Should Mean For Unproofed Customer Accounts

Most customer accounts in Drape are not identity-proofed at a strong standard.

Important implication:

- support should be cautious about manually taking over these accounts when the user no longer controls the bound email channel

The strongest product inference is:

- for ordinary unproofed customer accounts, Drape should not promise instant support-led credential reset just because someone can describe the account convincingly
- support can help preserve evidence, pause risk, and explain next steps
- but direct takeover should require control of a verified recovery channel or a stronger future recovery primitive

Important Drape takeaway:

- “customer support can always get you back in” sounds kind, but can become an account-takeover vulnerability

## 7. What Recovery Should Mean For Verified Tailor Accounts

Tailor accounts may eventually have:

- ID verification
- payout onboarding
- bank-linked operational identity

That does not mean support should be casual, but it does mean Drape may have a stronger basis for re-verifying them than it does for ordinary customer accounts.

Important Drape inference:

- verified tailor recovery can be higher-friction and evidence-based
- that path is more defensible than blind customer-account takeover, because Drape may already hold stronger identity evidence for the tailor

## 8. The Strongest V1 Shape

The cleanest V1 posture is:

- keep self-serve recovery email-link based
- keep password changes behind reauthentication
- do not add phone or SMS as a sole self-serve recovery channel yet
- do not let support casually bypass bound-channel recovery for unproofed accounts
- use proportionate proof for deletion and export requests
- send notifications when recovery or major sensitive changes happen

## 9. What This Means For V1

The strongest V1 direction is:

- email-link recovery remains the primary self-serve path
- phone stays a notification / future trust field, not a full recovery factor yet
- signed-in session can be enough to initiate some lower-friction requests
- but changing recovery-adjacent data or delivering sensitive data should use stronger checks
- support-assisted recovery must be documented, slow enough to be safe, and evidence-based
- Drape should explicitly separate shared-device tolerance from fraud tolerance

## Sources

- [OWASP: Forgot Password Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html)
- [OWASP: Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
- [ICO: What should we consider when responding to a request?](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/right-of-access/what-should-we-consider-when-responding-to-a-request/)
- [NIST SP 800-63B](https://pages.nist.gov/800-63-4/sp800-63b.html)
