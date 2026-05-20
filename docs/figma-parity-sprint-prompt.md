# Drape Figma Parity Sprint Prompt

This prompt is the operating contract for the launch UI/UX sprint. Follow it before every design claim, every code edit, and every status update. The goal is not to create components that resemble Figma in isolation. The goal is for the real Drape app, with real data and real navigation, to feel intentional, premium, trustworthy, and coherent screen by screen.

## Core Rule

Do not say "done", "covered", "mapped", "complete", or "Figma parity" unless the exact real app screen has been inspected and verified.

A screen is not complete because:

- A component exists.
- A code path was patched.
- TypeScript passes.
- A static Figma frame looks good.
- One happy-path screenshot looks acceptable.

A screen is complete only when all of these are true:

- It matches the Figma direction: calm, image-led, Airbnb-level clarity, Needle Green `#2D6A4F`, restrained cards, premium spacing, and display type only where it earns the space.
- It works with live app data, including missing images, sparse data, and long names.
- It handles loading, empty, error, success, disabled, offline, retry, and destructive states.
- It has clear navigation, an exit path, and visible feedback for every meaningful tap.
- It shows no raw errors, broken media, clipped text, awkward type hierarchy, default-looking UI, placeholder/test copy, or accidental developer language.
- It preserves auth, permissions, payment rules, privacy rules, and backend behavior.
- It has been verified with commands and, where possible, device screenshots.
- It passes `pnpm --dir apps/mobile typecheck` and `pnpm --dir apps/mobile lint`.

If any of those are not true, the screen is not complete. Say what remains.

## Figma Interpretation

Use the Figma file as product direction, not as decoration:

- Image-first trust: profiles, shop items, wishlists, order proofs, and messages must make media feel central and well-cropped.
- Airbnb-style clarity: lists and cards should be scannable, calm, spacious, and obvious without explanatory text.
- Human language: every empty, error, and recovery state should sound like Drape, not a library default.
- No visual noise: no nested card stacks, random heavy shadows, cramped labels, or giant dead placeholder blocks.
- Premium defaults: if data is missing, the fallback must still look designed.

## Absolute Execution Order

Work in this order. Do not jump ahead because a later screen is easier.

1. Wishlist overview, collection detail, collection edit/create sheets, save-to-wishlist sheets, saved tailor/item states.
2. Explore discovery, tailor cards, search/filter surfaces, profile entry and return-state preservation.
3. Tailor profile, portfolio media, profile trust copy, ready-made shop entry, ready-made detail, and checkout.
4. Messages list and threads for customer and tailor, including profile pictures, read states, empty states, blocked content, and closed-order copy.
5. Customer profile, customer account settings, login/security, notification settings, payments, privacy, and delete-account guard.
6. Tailor profile, setup, payout, account settings, shop management, clients, earnings, and verification states.
7. Customer custom order flow, payment, order detail, tracking, timeline, stage media, pickup/delivery copy, and review flow.
8. Tailor order detail, quote/payment state, production stage updates, media capture, stage gates, and pickup completion.
9. Vision/manual measurement flows, Android fallback, retake/use-manual paths, evidence review, privacy copy, and navigation return paths.
10. Global QA states: loading skeletons, empty states, error recovery, offline behavior, stale data, small-screen wrapping, dark mode, and accessibility labels.

## Current Sprint Addendum

These are active blockers for the current UI pass and must be checked on the Samsung A17 before making any broad completion claim:

- Android bottom navigation safety: sticky CTAs, form footers, and modal buttons must sit above system navigation icons with enough padding to tap confidently.
- Client-facing tailor media: profile hero photos and portfolio tiles must be tappable, previewable full-screen, dismissible, and usable with live image URLs.
- Density pass: remove large instructional blocks that push the actual task below the first viewport. The first screenful should show the user's object of interest, not coaching copy.
- Profile and settings pass: profile cards should use space efficiently, settings should feel like account controls rather than nested cards, and no screen should rely on a giant green header.
- Dark mode pass: every touched screen must use design tokens, not hardcoded white/black assumptions.
- Exclusions remain: app icon and splash artwork stay untouched until the logo direction is chosen.

## Screen Audit Loop

For every screen:

1. Inspect the code path and the real route.
2. Inspect the screen with real data or the closest reachable device state.
3. Ask:
   - Would a first-time user know what to do in 5 seconds?
   - Does this look like a real funded product?
   - Does this protect trust, money, and cultural wardrobe?
   - What happens if data is missing, media fails, the network drops, or the user taps back?
   - Is anything here uglier than the Figma direction?
4. Fix the actual app screen, not just the shared primitive.
5. Re-run checks.
6. Capture evidence or state exactly why device evidence is blocked.
7. Move to the next screen only after recording remaining gaps.

## Wishlist Bar

Wishlist is not acceptable until:

- The overview looks like a premium saved-lists surface, not a settings list.
- Collection covers use real saved media when available and intentional mosaic/brand placeholders when not.
- Collection detail feels like a proper saved-items gallery.
- The empty state feels designed, not blank.
- Create, rename, note, move, and delete flows have good sheets, keyboard behavior, feedback, and recovery.
- Save-to-wishlist from tailor and ready-made surfaces feels immediate and explains what happened.
- Saved states are visible and consistent everywhere hearts/bookmarks appear.

## Reporting Contract

Use this exact format in status notes:

- Found: one sentence naming the actual user-facing problem.
- Fixed: one sentence naming the behavior or UI change.
- Verified: command/device evidence only.
- Remaining: anything still ugly, unverified, externally blocked, or deferred with a reason.

Never hide remaining gaps behind optimistic language. If something is only code-inspected, say "code-inspected." If something is device-verified, say which device and screenshot/log evidence. If the device is stuck, unavailable, or signed into the wrong role, say that plainly and keep fixing what can be fixed from code.

## Stop Conditions

Do not stop because progress was made. Stop only when:

- Every item in the execution order is verified, or
- The only remaining items require an external blocker such as a missing device, unavailable account, app store credential, production decision, or third-party dashboard action.

If stopped by blockers, list each blocker with the exact action needed to unblock it.

## Working Tone

Be strict and honest. No victory laps. No vague "looks good." No broad completion claims. Find the rough edges, fix them, verify them, and keep moving.
