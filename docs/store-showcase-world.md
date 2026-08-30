# Drapeon Store Showcase World

Status: Production-safe content brief for App Store, Google Play, and launch marketing

## Positioning

Drapeon is a global marketplace for personal tailoring, alterations, custom clothing, and independent fashion studios. African fashion is represented authentically as one part of the marketplace; it is not the default visual language for every profile.

The showcase must feel like a real, edited marketplace. It must never contain placeholder names, copied portfolios, duplicate images, invented customer claims presented as organic reviews, or payment activity that could be mistaken for live commerce.

## Featured Cast

The first production showcase contains eight studios. Locations are merchandising context, not claims that Drapeon has launched local payments in every market.

| Priority | Studio | Location | Focus | Visual direction |
| --- | --- | --- | --- | --- |
| 1 | Alder & Rue | London, UK | Contemporary womenswear, alterations | Architectural neutrals, precise drape, daylight atelier |
| 2 | Maison Elara | Paris, France | Bridal and occasion wear | Ivory silk, hand finishing, quiet editorial luxury |
| 3 | Northline Bespoke | Toronto, Canada | Suits and formal tailoring | Modern suiting, deep navy and tobacco, restrained workshop |
| 4 | Sora Studio | Tokyo, Japan | Minimal separates and repair | Indigo, natural fibers, visible mending, calm composition |
| 5 | Iya Dara Atelier | Lagos, Nigeria | Bridal aso oke and celebration wear | Rich woven texture, considered color, ceremonial craft |
| 6 | Noor Form | Dubai, UAE | Modest fashion and eveningwear | Fluid silhouettes, tonal palettes, refined embellishment |
| 7 | Studio Maré | São Paulo, Brazil | Resort tailoring and expressive dresses | Sunlit color, movement, lightweight natural fabrics |
| 8 | Common Thread Works | New York, USA | Adaptive clothing and upcycling | Functional closures, inclusive styling, tactile reconstruction |

## Profile Standard

Every featured studio needs:

- one owned or commissioned portrait/atelier avatar;
- six distinct owned portfolio images with coherent authorship;
- a specific biography without unsupported superlatives;
- two to four specialties, languages, service modes, price range, and turnaround context;
- an intentional availability state;
- at least one ready-made or service example only when the flow is actually reviewable;
- transparent `SHOWCASE` provenance in Auth metadata and seeded records;
- deterministic IDs and a cleanup inventory.

Ratings, review counts, order counts, and written reviews must not masquerade as real customer history. Until an explicit showcase-label contract exists in the UI, use truthful zero counts or clearly identified editorial examples outside customer-review surfaces.

## Reviewer Accounts

Reviewer identities are separate from featured studios:

- one Apple customer reviewer;
- one Google customer reviewer;
- one spare customer reviewer for account-deletion proof;
- one tailor reviewer only if the tailor workspace is included in review instructions.

They use reusable credentials, no external OTP dependency, no Ops role, no live payment capability, and remain active through approval.

## Screenshot Narrative

1. Discover independent craftsmanship worldwide.
2. Explore a studio's work and specialties.
3. Share a clothing idea and references.
4. Capture or add measurements with control.
5. Collaborate in a contextual conversation.
6. Follow a garment's progress.
7. Receive useful, deep-linked updates.
8. Manage the relationship and privacy confidently.

## Media Rules

- Use only Drapeon-owned, commissioned, licensed, or purpose-generated media.
- Keep faces, garments, studios, and lighting internally consistent per profile.
- Do not reuse one garment across different studios.
- Do not include third-party logos, visible labels, watermarks, or imitation designer signatures.
- Preserve natural skin and textile texture; avoid over-smoothed synthetic imagery.
- Capture product UI from real seeded state. Do not composite fake app controls.
- Maintain a media ledger containing source, rights basis, studio key, and approved usage.

## Production Safety

- Seed with an explicit production flag and a manifest checksum.
- Upsert only deterministic showcase IDs; never delete or alter unrelated accounts.
- Keep payment and tax-dependent actions unavailable while Paystack and ZIPTax are intentionally deferred.
- Exclude showcase activity from operational alerts and business analytics where supported.
- Validate Explore, profile, portfolio, brief, messages, notifications, re-entry, and deep links before capture.
