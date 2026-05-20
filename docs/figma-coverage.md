# Drape Figma Coverage

Source file: `Drape Design System - Launch Foundation`
Figma key: `LuB0N6BnLoZUhG1TLqpAp2`
Last audited: 2026-05-19

## Coverage Status

The launch Figma file is implemented as the reference layer for the mobile app brand system. The app keeps richer production screens where they already carry live data, permissions, media, and payment states; the Figma primitives are mapped into reusable components so those screens can converge without losing behavior.

## Foundations

- Color tokens: mapped through `packages/shared/src/design-system.ts` and `apps/mobile/constants/theme.ts`.
- Primary green: `#2D6A4F`.
- Typography: Fraunces display faces are loaded as `DrapeDisplay` / `DrapeDisplayBold`; Inter UI faces are loaded as `DrapeText`, `DrapeTextMedium`, `DrapeTextSemiBold`, and `DrapeTextBold`.
- Auth branding: the legacy `drape` wordmark is intentionally limited to the welcome / brand-entry moment. Sign-in, sign-up, recovery, role select, and setup screens remain form-first.

## Component Mapping

- `Button / Primary`, `Button / Secondary`, `Button / Destructive`, `Button / Disabled`: `apps/mobile/components/ui/Button.tsx`.
- `Input / Default`, `Input / Focus`, `Input / Error`: `apps/mobile/components/ui/Input.tsx`.
- `Card / Tailor`, `Card / Ready-made Item`: `apps/mobile/components/ui/MarketplaceCard.tsx`.
- `Card / Payment Trust`: `apps/mobile/components/ui/PaymentTrustCard.tsx`.
- `State / Empty`, `State / Error Recovery`: `apps/mobile/components/ui/StateCard.tsx`.
- `Sheet / Collection Picker`: `apps/mobile/components/ui/CollectionPickerSheet.tsx`.
- `Order / Timeline`: `apps/mobile/components/ui/OrderTimelineCard.tsx`.
- `Greeting / Morning`, `Greeting / Afternoon`, `Greeting / Evening`: `apps/mobile/components/ui/GreetingCard.tsx` plus `apps/mobile/lib/time-of-day.ts`.
- `Brand Companion / Direction`: `apps/mobile/components/ui/BrandCompanionCard.tsx`.
- Profile/photo surfaces: `apps/mobile/components/ui/AvatarImage.tsx` is used in messages and tailor client CRM so threads feel person-led instead of generic.

## Screen Mapping

- `00 Brand Entry`: welcome screen and auth foundation in `apps/mobile/app/(auth)/welcome.tsx` and shared auth header/back components.
- `03 Customer Flows`: explore, tailor profile, custom order, ready-made checkout, messages, orders, wishlist, and account screens are aligned to the launch brand tokens. Production screens keep additional logic and safety copy beyond the static Figma frames.
- `04 Tailor Flows`: tailor setup, payout setup, dashboard, order brief, stage update, shop item creation, earnings, and client CRM are represented in the app. The code keeps production preflights, availability, media upload, payout, and order-state behavior.
- `05 Drape Vision`: scan preparation, Android manual fallback, result review, retake/manual escape paths, and evidence visibility are implemented across Vision and measurement entry points.
- `06 Store Screenshots`: retained as submission reference. Final screenshots still need real-device capture from the production-ready build.
- `07 QA States`: empty, offline, provider-down, and delete-guard patterns map to `StateCard`, existing guarded payment/deletion flows, and human-readable error states.

## Intentional Exclusions

- App icon and splash artwork are not finalized in code from this pass. Founder direction is to leave icon/splash alone until the logo direction is chosen.
- Figma logo concepts are reference-only, not app assets.
- Live App Store / Play Store screenshots remain a launch-submission task after final real-device QA.
