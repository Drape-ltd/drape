# Drape Design Foundation

This is the source-of-truth brief for the first Figma file and for implementation reviews.

Implementation mapping lives in [figma-coverage.md](./figma-coverage.md).

## Direction

Drape should feel like a calm, premium marketplace for culturally important clothing. The reference bar is Airbnb's clarity and restraint, with more fashion warmth and trust cues because Drape handles payments, measurements, and tailor relationships.

The product should not feel like a template, a generic fintech dashboard, or a decorative fashion landing page. The app experience should be image-led, simple to scan, and clear about what happens next.

## Brand Tokens

- Primary: Needle Green `#2D6A4F`
- Primary dark: `#245540`
- Primary light: `#E8F5EF`
- Background: `#F9F7F3`
- Surface: `#FFFFFF`
- Ink: `#2C2C2A`
- Muted text: `#888780`
- Accent: `#D85A30`

## Typography

- Display: Fraunces
- UI/body: Inter
- Fallback display: system serif only when the custom font cannot load
- Fallback UI: system sans

Use display type for true headings, profile names, empty-state titles, and high-emphasis numbers. Do not use display type for dense labels, helper text, form inputs, body copy, or long paragraphs.

## Brand Entry

- The legacy `drape` wordmark belongs on the welcome / brand-entry screen only.
- Sign-in, create-account, recovery, role selection, and setup screens should stay form-first: clear title, helpful copy, no repeated wordmark.
- Back controls should use an icon + label with a 44px minimum touch target, not raw arrow text.

## Component Rules

- Cards: max 8-12px radius unless the component is media-led.
- Buttons: 52px height for primary actions, full-width on core flows.
- Icon buttons: minimum 44x44 touch target.
- Images: never leave broken image frames; show intentional placeholders.
- Bottom sheets: preferred for short choices, save flows, filters, and lightweight creation.
- Forms: one clear action per screen; labels above inputs; keyboard safe by default.
- In-app guides belong in compact, discoverable rows near the relevant workflow. Mark them with Needle Green and concise labels; do not hide them under generic support copy.

## Forbidden Patterns

- Do not use oversized explanatory slabs, left-rail callouts, or banner-cards for routine guidance. They make screens feel template-built and crowd mobile space.
- Do not show internal roadmap, implementation, or "future scope" language to users. Product planning belongs in docs, not in the app UI.
- Multi-choice setup controls should be compact rows, segmented controls, toggles, or bottom sheets. Avoid stacked full-width selectable cards unless the choice is media-led or genuinely high stakes.
- Trust, verification, payout, and access states should be quiet status rows with clear next actions. Do not use promotional-looking verification banners.

## Core Figma Pages

1. Foundations: color, type, spacing, radius, shadow, dark mode.
2. Components: buttons, fields, cards, bottom sheets, tabs, badges, empty/error/loading states.
3. Customer flows: explore, tailor profile, custom order, ready-made checkout, tracking, messages, settings.
4. Tailor flows: setup, dashboard, order detail, stage update, shop item creation, payout.
5. Drape Vision: iOS scan, Android fallback/manual path, review before save, order evidence.
6. Store screenshots: App Store and Play Store frames built from real product screens.

## Launch Design Standard

Every launch screen should answer these without explanation:

- What can I do here?
- What happens if I tap the primary action?
- Can I trust this person, payment, or state?
- What happens next?
- How do I recover if something goes wrong?
