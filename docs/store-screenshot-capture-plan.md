# Drapeon Store Screenshot Capture Plan

Date: August 30, 2026
Status: Capture plan ready; physical iPhone and Android devices not connected

## Purpose

Capture one truthful, globally representative product narrative from isolated production reviewer fixtures. The screenshots must show real app UI and seeded state without exposing credentials, private customer data, internal tools, debug overlays, payment failures, or placeholder content.

This capture does not authorize a release build, store upload, account deletion, payment, payout, or production-data mutation beyond ordinary reviewer navigation.

## Accounts and Fixture

- iPhone: `review.apple@drapeon.co`
- Android: `review.google@drapeon.co`
- Featured tailor: **Alder & Rue**, London
- Existing project: **DRPGBAT3D**
- Credentials: owner-only handoff at `/private/tmp/drape-reviewer-credentials.txt`

Before capture, confirm all eight showcase studios load and no images, biographies, tags, locations, prices, or availability states show placeholders or private test data.

## Narrative and Shot Order

Capture the same ordered story on iPhone and Android where the feature is applicable:

| Order | Screen | Store message | Required state |
| --- | --- | --- | --- |
| 1 | Customer Explore | Discover independent craftsmanship worldwide | Multiple globally representative studios; strong imagery; no loading placeholders |
| 2 | Alder & Rue profile | Find work and expertise that fit your vision | Portfolio, specialties, location, availability, and custom-order action visible |
| 3 | Custom brief setup | Share your idea, references, and requirements | Filled but non-sensitive example with clear progress and one primary action |
| 4 | Measurements | Add measurements with control | Use the supported platform state; Android may show the honest manual-first path |
| 5 | Project `DRPGBAT3D` | Review every detail before moving forward | GBP 384 quote, contextual state, and intentionally unavailable payment explained without an error presentation |
| 6 | Project conversation | Keep decisions connected to the garment | Clean customer–tailor thread with no private phone number, address, or test noise |
| 7 | Order/project timeline | Follow the work from brief to handoff | Production stages and approved media; no impossible or contradictory state |
| 8 | Notifications deep link | Return to the exact work that changed | Quote notification opens `DRPGBAT3D` and fresh state |
| 9 | Privacy settings | Control your data and account | Privacy controls and Delete account entry are easy to locate; do not submit deletion |

The final listing may use seven or eight of these shots. Prefer the clearest narrative over filling the ten-shot maximum.

## Device Targets

### Apple

- Primary capture: iPhone 6.9-inch accepted portrait size.
- Preferred native sizes: `1260x2736`, `1290x2796`, or `1320x2868`.
- Files: PNG or JPEG without alpha/transparency.
- Apple accepts one to ten screenshots.

### Google Play

- Capture a real Android phone portrait set.
- Use at least two screenshots; publish the complete narrative set.
- Keep each side between 320 px and 3840 px and the long side no more than twice the short side.
- Prepare the Play feature graphic separately; it is not an app screenshot.

Verify the current console requirements again immediately before upload.

## Capture Rules

- Use production reviewer accounts and production showcase fixtures.
- Hide status-bar notifications unrelated to Drapeon and enable Do Not Disturb.
- Use consistent time, battery, locale, theme, font scale, and network conditions.
- Clear keyboards, menus, toasts, debug banners, dev-client chrome, and accessibility inspectors unless intentionally demonstrating them.
- Do not show email addresses, passwords, addresses, phone numbers, payment credentials, internal UUIDs, Ops screens, or provider secrets.
- Do not composite fake controls or fabricated customer reviews into the app.
- Keep captions outside the raw screenshot workflow until the clean captures have been approved.
- Preserve raw captures separately from framed or captioned store assets.

## Per-Shot Acceptance

- Screen is fully loaded and visually stable.
- Back, close, and primary actions are visible and valid for the state.
- No content is obscured by keyboard, dock, sheet, safe area, or crop.
- Garments retain head, hem, sleeves, and important detail.
- Text is readable at store-listing scale.
- No broken image, placeholder, random account, duplicate studio, or contradictory workflow appears.
- iPhone and Android show platform-appropriate UI without cross-platform artifacts.
- The screenshot supports one marketing claim that the shipped build actually fulfills.

## Live Interaction Proof During Capture

Record separately from the marketing screenshots:

1. Password login on each platform.
2. Google OAuth on Android and iOS.
3. Sign in with Apple on a real iPhone.
4. Notification tap into `DRPGBAT3D` from terminated and background states.
5. Privacy → Delete account reachability without submitting the reusable account.
6. Sign out and account switching without stale customer data.

These are QA artifacts, not store-listing screenshots.

## Capture Completion Gate

- Raw iPhone and Android folders contain the approved ordered set.
- Dimensions and file formats pass console validation.
- Product, design, privacy, and QA review each approve the contact sheet.
- Reviewer notes describe any intentional platform difference.
- Credentials remain outside source control.
- No images are uploaded until the final set is explicitly approved.
