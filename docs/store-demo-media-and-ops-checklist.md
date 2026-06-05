# Store Demo Media And Ops Checklist

Last updated: 2026-05-25

## Demo Media Standard

Use real, licensed tailoring imagery for store screenshots and reviewer/demo accounts. Do not use stolen Instagram/Pinterest tailor work, customer private order photos, or unlicensed screenshots from other designers.

Acceptable sources:

- Drape-owned photos from Dolapo or approved tailors.
- Licensed stock/editorial images with marketplace usage rights.
- Generated visuals only for abstract brand surfaces, not as a fake tailor portfolio.

## Media Coverage Needed

Prepare at least:

- 3 tailor avatar/profile photos.
- 12 portfolio photos across menswear, womenswear, formal/occasion wear, and traditional garments.
- 6 ready-made product photos with clear product framing.
- 3 production-stage photos showing cutting/sewing/finishing.
- 2 proof-of-handoff or packaging photos for order timeline screenshots.

For app-store screenshots, prefer vertical or 4:5 fashion images. Drape now renders Explore and tailor-profile portfolio cards with portrait-friendly heights, but images should still have the garment centered with breathing room around the head, hem, sleeves, and embellishment.

## Image QA

Before screenshot capture:

- Open Explore and confirm no card shows a blank placeholder.
- Open every featured tailor profile and tap the hero/gallery images.
- Confirm full-screen image preview works and does not crop important garment details.
- Confirm portfolio grid, shop item list, ready-made detail, messages, and order timeline images all load.
- Confirm dark theme does not make image overlays, badges, or gallery controls unreadable.
- Confirm screenshots do not show private names, random test uploads, broken media, or unflattering crops.

## Demo Profiles For Submission

Create or seed:

- `reviewer.customer@drapeon.co`: clean customer with measurements, active order, completed order, payment history, and messages.
- `reviewer.tailor@drapeon.co`: verified tailor with portfolio, shop item, active paid order, earnings history, and messages.
- 3 public demo tailors with different specialties and locations so Explore does not feel thin.

Each public demo tailor needs:

- Real avatar or intentional initials fallback.
- 4+ portfolio photos.
- At least one ready-made listing where relevant.
- Clear specialty tags, city/country, price range, availability, and fulfillment options.
- Reviews that match completed orders, not free-floating fake reviews.

Use the non-destructive seed once approved media URLs are ready:

```bash
pnpm seed:store-demo -- --media path/to/approved-store-demo-media.json
```

Start from `docs/store-demo-media.example.json`, replace every `example.com` URL with approved public media, then run only against dev/staging until the screenshot build is final.

## Ops Checks On Founder Side

- Paystack: finish CAC/business verification so live NGN payouts are not blocked as starter-business third-party payouts.
- Stripe: confirm test webhook endpoint is active and successful after the next device payment pass.
- Sentry: set Edge `SENTRY_DSN` before production so function failures land in Sentry, not only Supabase logs.
- Twilio/SMS: add dev/prod secrets before claiming SMS coverage in store notes.
- Daily/calls: confirm API key and fallback behavior before presenting calls as available in reviewer notes.
- Store reviewer notes: prepare the exact customer/tailor demo credentials and explain Android Vision is manual fallback while iOS Vision is the supported scan surface for launch.
