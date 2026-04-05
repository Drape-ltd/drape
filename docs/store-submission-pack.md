# Store Submission Pack

Date: April 2, 2026

## Purpose

This is the lightweight checklist for preparing Drape's first App Store / TestFlight / Play submission package.

Use it with:

- `docs/release-checklist.md`
- `docs/testflight-review-notes.md`
- `docs/mobile-permissions-and-disclosure-audit.md`

## App Basics

- App name: `Drape`
- Bundle ID: `com.drape.app`
- Privacy URL: `https://drapeon.co/privacy`
- Support URL: `https://drapeon.co/help`

## Metadata Still Needed

- App subtitle / short description
- Full app description
- Keywords
- Screenshot set:
  - customer browse
  - custom brief
  - order tracking
  - messaging
  - tailor dashboard
  - tailor order flow
- App preview video:
  - optional for first pass

## Reviewer Access

Before submission, confirm one of these is ready:

- self-serve reviewer test sign-up path
- or dedicated customer and tailor test credentials

Also prepare:

- short note explaining the two-sided marketplace model
- short note explaining where deletion and privacy controls live
- short note explaining any feature that depends on test env or seeded data

## Permissions Review

Reviewer notes should be ready for:

- camera
- photo library
- microphone
- biometrics

Each one should point to a visible in-app feature and avoid vague claims.

## In-App Routes Reviewers Should Be Able To Reach

### Customer

- sign in / sign up
- setup
- tailor profile
- order / messages
- privacy
- delete account

### Tailor

- setup
- trust & access
- earnings / payout readiness
- privacy
- delete account
- active order

## Submission Warnings To Avoid

- claiming features are live when they are still placeholders
- implying full legal escrow if the product only provides payout protection/holds
- overpromising instant total deletion
- hiding permission reasons behind generic copy

## Final Packaging Check

- icon and splash are final
- notification icon is final
- support inbox ownership is clear
- privacy answers match runtime behavior
- reviewer note doc is current
- QA runbook has been executed on the build being submitted
