# Release UI Change Audit — 2026-08-31

## Scope

This audit covers the currently uncommitted release-facing UI changes on mobile and the directly affected web auth/custom-order surfaces. It applies the repository UI, navigation, workflow-outcome, and native verification rules before any new build is created.

## Review gates

- One dominant persistent action per screen; secondary and destructive actions remain inline.
- Persistent actions use the Drapeon floating capsule dock, reserve content clearance, compact on scroll, and compact while the keyboard is active.
- Disabled actions expose their disabled/busy state and have a nearby explanation when a missing requirement blocks progress.
- Every input has a visible or explicit accessible label; icon-only controls have accessible names.
- Validation errors are announced and sit beside the relevant field; success/status copy does not use error styling.
- Back, header back, gesture/system back, modal close, cancellation, and completion use the same contextual exit.
- Async work preserves entered state, prevents duplicate submission, and renders recoverable errors.
- New-account phone entry does not assume a country. Existing E.164 values may restore their country.
- Content remains readable above the keyboard, safe area, sheets, and floating action dock.

## Audited surfaces

| Surface | Result | Notes |
| --- | --- | --- |
| Customer setup | Pass in source | One floating `Save and continue` action; invalid setup is disabled with a nearby requirement; owner-scoped draft recovery; contextual exits; distinct success/error feedback; keyboard compaction; labelled phone verification. |
| Tailor setup | Pass in source | One context-aware floating action; invalid setup sections are disabled with a nearby requirement; section/step draft recovery; keyboard compaction; labelled upload, location, ready-made, verification, and exit controls. |
| Shared phone input | Pass in source | Blank country state uses a labelled `Country` selector; no NG/US default; existing international values infer country; country list is neutral alphabetical order. |
| Customer/tailor deletion | Pass in source | Provider-aware identity confirmation; durable request receipt; contextual return; labelled fields and actions; disabled/busy state exposed. |
| Customer/tailor privacy and account settings | Pass in source | Deletion links preserve return history. Copy now says `Identity confirmation required`, which is accurate for password, Apple, and Google accounts. |
| Wishlist collection detail | Pass in source | Header back and Android gesture/system back share one exit; sheets and icon controls are labelled; modal submit exposes disabled/busy state. |
| Group-order launch gate | Pass in source | Hidden on mobile and web; stale group drafts cannot reopen the unsupported UI; server remains authoritative. |
| Android Vision discovery | Pass in source | Unavailable specialist scans are not presented as launch CTAs; Fit 360 remains capability-gated. |
| Web OAuth callback | Pass in source | Status remains explicit and returning accounts retain their established workspace. No new competing CTA. |
| Android icon and splash source | Asset inspected | 1024×1024 RGBA foreground is centered and transparent. Installed splash scale and adaptive-mask appearance still require the release-candidate device pass. |
| Auth sign-in, sign-up, recovery, and reset | Pass in source | Shared focused-field reveal; email/name/current-password/new-password semantics; autofill writes through controlled values; helper/error clearance preserved. |
| Customer brief | Pass in source | Shared focused-field reveal covers every step and re-runs as multiline content grows; floating-dock clearance remains reserved; recipient and structured address autofill semantics added. |
| Wishlist edit sheet | Pass in source | Sheet content is now bounded and keyboard-aware; focused input, requirement copy, and the single compact submit action remain reachable. |

## Corrections made during this audit

- Renamed the customer setup CTA from `Continue to Drapeon` to the outcome-specific `Save and continue`.
- Separated successful verification/status copy from destructive error styling.
- Added screen-reader announcement semantics to affected validation errors.
- Added missing accessible names and disabled/busy states to affected controls.
- Made tailor setup use the standard compact floating-dock behavior while typing.
- Replaced the awkward empty phone prefix (`-- Code`) with a neutral globe + `Country` selector.
- Removed featured-country ordering so the unselected country list does not imply a default market.
- Replaced inaccurate `Password confirmation required` account-settings copy with `Identity confirmation required`.
- Disabled workflow-invalid customer and tailor setup actions and kept the exact missing requirement adjacent to them.
- Added the missing explanation beside a disabled empty-name wishlist action.
- Added a shared `KeyboardAwareScrollView` that reveals the focused native input when the keyboard opens, focus moves while it is open, or multiline content changes the form height.
- Applied explicit platform autofill semantics for account name, email/username, current and new passwords, phone, OTP, recipient name, and structured postal-address fields.
- Made deletion forms and the wishlist editor keyboard-aware, including clearance for helper/error copy and the single action.
- Prevented the customer order screen from querying before auth hydration and normalized PostgREST failures into real `Error` objects with safe diagnostic fields for Sentry.
- Hardened the shared Sentry boundary so explicit and automatic captures of Supabase/provider error objects recover the real message, code, details, and hint while retaining Drapeon’s PII scrubber.

## Keyboard and autofill source audit

| Form family | Focus recovery | Autofill contract | Growing multiline content |
| --- | --- | --- | --- |
| Sign in / sign up / recovery / reset | Shared keyboard-aware scroll | Name, email/username, current password, new password | Not applicable |
| Customer setup | Shared keyboard-aware scroll plus existing draft persistence | Name, telephone, SMS OTP | Rechecked on content-size change |
| Tailor setup | Shared keyboard-aware scroll plus existing section drafts | Name, telephone, postal address, SMS OTP | Bio and pickup details rechecked as they grow |
| Custom brief | Shared keyboard-aware scroll plus existing draft persistence | Recipient name, telephone, postal address | Brief, group notes, fit/fabric/vendor/delivery notes rechecked as they grow |
| Account deletion | Keyboard avoider plus shared keyboard-aware scroll | Current password where password reauth applies | Optional deletion reason rechecked as it grows |
| Wishlist editor | Bounded keyboard-aware sheet | Not applicable | Private note remains scrollable with requirement/action clearance |

Shared scaffold-based sheets already use focused native-handle reveal and retain that established behavior. Media/choice sheets with no editable text do not require keyboard handling.

## Build gate still required

Do not call the UI release-ready until a physical Android and iPhone pass confirms:

1. customer setup typing, validation, OTP, background/kill/relaunch restoration, and completion;
2. tailor setup section restoration, upload failure recovery, trust-video return, and dock compaction;
3. blank-country selection plus restoration of an existing international phone number;
4. wishlist header back, Android gesture back, item actions, and sheets;
5. deletion from settings and incomplete onboarding using email, Google, and Apple accounts as applicable;
6. narrow layout, text scaling, keyboard movement, safe-area clearance, and splash/adaptive icon appearance.

## Packaging hazard

An untracked repository-root `app.json` currently contains only `{ "expo": {} }`. The real mobile config is `apps/mobile/app.json`. The root file must not be included in the release commit and should be removed or explicitly justified before running Expo commands from the repository root.
