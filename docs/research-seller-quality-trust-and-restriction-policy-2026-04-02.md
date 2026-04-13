# Research Notes: Seller Quality Trust, Abuse Signals, And Restriction Policy

Date: April 2, 2026

## Why This Exists

Drape now has much stronger core order plumbing, but a marketplace does not become trustworthy just because the happy path works.

We still need a practical answer to:

- when a tailor just needs coaching
- when a tailor should be down-ranked or limited
- when a tailor should be blocked from higher-risk work
- when a tailor should be suspended entirely

This note is the research layer for that decision.

## High-Signal Takeaways

- Seller quality problems and seller trust breaches are not the same thing.
- Repeated lateness, weak communication, and avoidable fulfillment mistakes should usually trigger friction before suspension.
- Off-platform pressure, fake identity, fake portfolio work, review manipulation, and harassment are much more serious and should escalate faster.
- OCR or automated portfolio flags are useful, but they should usually start a review workflow, not act as a blind auto-ban by themselves.
- Mature marketplaces tie reliability to visibility, restrictions, or reserves before they jump to full removal.
- Sellers hate opaque restrictions. Even when platforms are justified, unexplained holds and vague enforcement create a lot of anger and distrust.

## 1. What Drape Models Today

Current tailor trust and quality signals already include:

- `avg_rating`
- `total_reviews`
- `total_orders`
- `avg_response_hours`
- `is_live`
- `id_verification_status`
- `bypass_attempts`
- `portfolio_photo_urls`
- `ocr_flagged`
- `ocr_reviewed_at`
- payout history and payout provider ids
- audit breadcrumbs and an internal ops dashboard

Current launch blockers already acknowledge this gap too:

- bans / abuse response
- review moderation
- contact bypass review
- OCR / image moderation plan

## Current gaps

Drape still does not model a first-class:

- seller quality watch state
- account restriction state
- restriction reason
- restriction scope
- appeal / review status
- portfolio authenticity review outcome
- repeat lateness counter
- repeat off-platform or review-manipulation counter

That means Drape can observe risk without yet expressing it cleanly.

## 2. Current Marketplace Signal

## A. Honest representation matters

Etsy’s seller policy explicitly requires shops, items, and shop content to be honestly and accurately represented. It also requires sellers to use their own photographs or videos, provide accurate information, and accurately represent listings and materials.

Important Drape takeaway:

- portfolio work should be treated as trust evidence, not just gallery decoration
- if Drape later discovers that a tailor is using stolen or misleading images, that should be treated as a trust breach, not just a content-quality problem

## B. Off-platform pressure is treated as a high-severity violation

Etsy explicitly says protections like payments and case handling do not apply off-platform, and it prohibits taking communications and transactions off-platform.

Upwork’s current help center says:

- asking to move payments off-platform is a violation even if not completed
- sharing contact info before a contract starts is circumvention
- violations can lead to account suspension or permanent account loss

Fiverr’s current help center also treats off-platform activity as a restriction-level violation and includes directing users to external platforms or suggesting alternative payment systems in that category.

Important Drape takeaway:

- contact bypass is not just a product annoyance
- it is one of the clearest signals that trust, payments, dispute evidence, and marketplace integrity are at risk

## C. Review manipulation and extortion are also high-severity

Etsy prohibits sellers from offering compensation in exchange for positive reviews.

Fiverr’s current integrity policy goes further and prohibits:

- manipulating reviews
- pressuring clients to remove or improve feedback
- withholding delivery to gain favorable reviews

Fiverr says attempts to manipulate reviews can lead to permanent suspension.

Important Drape takeaway:

- reviews are trust infrastructure
- fake reviews, review pressure, or “I’ll fix this only if you change your review” behavior should escalate faster than ordinary customer-service disputes

## D. Reliability failures usually trigger friction before full removal

Etsy’s seller standards require sellers to:

- honor shipping and processing times
- respond to messages in a timely manner
- honor commitments made in shop policies

Etsy also says payment reserves can be triggered by factors like:

- sudden order spikes
- missing tracking
- late shipment
- rising refunds

Fiverr now has a restriction category for accounts “not in line with quality standards,” and its manipulation policy also calls out excessive cancellations.

Important Drape takeaway:

- marketplaces often treat repeat reliability issues as a reason for controlled friction:
  - ranking loss
  - extra review
  - payout delay
  - capability restriction
- they do not always jump straight to suspension

## E. Opaque enforcement causes major seller pain

Etsy’s reserve help article says support cannot tell a seller the specific reason a reserve was placed.

Directional seller discussion on Reddit shows the emotional failure mode:

- people feel blindsided
- they do not know what to fix
- they assume the platform is acting arbitrarily

That social signal does not prove the platform was wrong. It does show that black-box enforcement creates a trust cost of its own.

Important Drape takeaway:

- if Drape restricts a tailor, the reason should be legible
- the seller should know whether the problem is:
  - quality drift
  - off-platform risk
  - authenticity review
  - payout/provider readiness
  - active customer-safety issue

## 3. Social And Community Pain Points

This section is directional rather than authoritative.

The strongest recurring community pain points were:

- sellers hate unexplained reserves and unexplained visibility loss
- off-platform requests are widely treated as a red flag because platform protections disappear
- clients often remember deadline misses more than almost any other service issue
- fake or misleading portfolio work is especially toxic because customers feel tricked before production even begins

Important Drape inference:

- missed deadlines and communication failure can corrode trust slowly
- deception and off-platform pressure can destroy it quickly

## 4. Drape Should Separate Two Kinds Of Risk

## A. Quality drift

Examples:

- repeated lateness
- slow response
- preventable fulfillment mistakes
- weak but not fraudulent reviews
- repeated customer complaints about reliability
- unusually high cancellation or refund rates without deception

These usually mean:

- the tailor may still be real
- the work may still be salvageable
- the right response is often friction, coaching, or narrower permissions first

## B. Trust breach

Examples:

- fake identity
- fake or stolen portfolio work
- off-platform pressure
- review extortion or review manipulation
- harassment, threats, or abusive conduct
- repeated bypass attempts
- deliberate misrepresentation of item status or capabilities

These usually mean:

- customer trust is directly at risk
- evidence trails get weaker fast
- stronger restrictions are justified earlier

## 5. Recommended Drape Response Ladder

The clearest V1 ladder is:

1. `CLEAR`
2. `WATCHED`
3. `REVIEW_REQUIRED`
4. `RESTRICTED_HIGH_RISK`
5. `RESTRICTED_ALL_NEW_ORDERS`
6. `SUSPENDED`

## What these should mean

### `CLEAR`

- normal ranking
- normal order acceptance
- normal trust posture

### `WATCHED`

Use for early reliability drift, such as:

- one meaningful missed deadline
- repeated slow response
- rising concerns without proof of deception
- first portfolio OCR flag awaiting review

Possible consequences:

- internal watch only
- no public accusation
- maybe softer ranking later

### `REVIEW_REQUIRED`

Use when a human decision is needed before confidence returns, such as:

- multiple reliability complaints in a short window
- repeated material issues caused by the tailor
- suspicious portfolio flag
- repeated contact-bypass flags not yet fully confirmed

Possible consequences:

- ops review queue
- hold on higher-risk workflows
- seller can still see reason and next step

### `RESTRICTED_HIGH_RISK`

Use when the tailor may still be acceptable for simpler work, but not for higher-risk flows.

Examples:

- repeat lateness
- poor fulfillment execution
- unstable communication
- unresolved trust concerns that do not yet justify a full suspension

Possible consequences:

- no new tailor-sourced custom jobs
- no international shipping
- maybe lower discovery visibility

### `RESTRICTED_ALL_NEW_ORDERS`

Use when Drape should stop new orders while review continues.

Examples:

- likely off-platform abuse
- likely fake portfolio work
- serious complaint cluster
- repeated review manipulation signals

Possible consequences:

- no new paid orders
- maybe discovery hidden
- payout may also be held where necessary

### `SUSPENDED`

Use for confirmed or severe violations.

Examples:

- fake identity
- clearly stolen or deceptive portfolio work
- confirmed review manipulation or extortion
- confirmed off-platform payment solicitation
- harassment, threats, or severe safety risk

Possible consequences:

- account not discoverable
- no new orders
- likely ops-managed payout or evidence hold

## 6. Drape Should Prefer Scoped Restrictions Over One Giant Ban

The cleanest marketplace behavior is not:

- either fully live or fully dead

It is:

- limit the risky part first

Examples of useful scopes later:

- discovery down-rank
- no new `CUSTOM`
- no new tailor-sourced jobs
- no international shipping
- no new orders at all
- payout hold only
- full suspension

This matters because:

- reliability issues are not the same as fraud
- Drape should avoid over-punishing recoverable problems

## 7. Seller Visibility Matters

For any non-trivial restriction, the seller should be able to see:

- current status
- reason category
- what is currently blocked
- what action clears it
- whether ops or a provider is involved
- when a re-review is expected, if known

This is one of the strongest lessons from other marketplaces.

## 8. Customer Visibility Should Be Careful

Drape should avoid showing customers raw internal accusations.

Safer public behavior is:

- remove or down-rank the seller from discovery when needed
- pause higher-risk work behind the scenes
- keep the customer-facing explanation simple if an order is already affected

Do not surface labels like “suspected fraud” publicly before review is complete.

## 9. Current Drape Copy Is Slightly Too Simple

Current help copy says every tailor submits ID and a portfolio before going live, which is directionally good but still incomplete as a full trust story.

What is still true:

- ID plus portfolio review is a meaningful trust baseline

What is also true:

- Drape will still need ongoing reliability and abuse enforcement after go-live

Important Drape inference:

- public trust copy should not imply that one-time review solves all seller risk forever

## 10. Likely V1 Data Model Additions Later

When implementation begins, useful fields or concepts may include:

- `seller_quality_state`
- `seller_quality_reason`
- `restriction_status`
- `restriction_scope`
- `restriction_reason`
- `portfolio_review_status`
- `portfolio_review_reason`
- `off_platform_violation_count`
- `deadline_miss_count`
- `active_ops_hold`
- `appeal_status`

I would avoid collapsing this into one opaque “risk score.”

## Working Recommendation

The best V1 posture is:

- separate quality drift from trust breach
- treat off-platform pressure, fake portfolio work, and review manipulation as high-severity
- treat repeat lateness and weak fulfillment as restriction-worthy before they become account-deletion-level events
- use scoped restrictions before full bans where possible
- always tell the seller what happened and what clears it

## Sources

Official sources:

- [Etsy Seller Policy](https://www.etsy.com/legal/sellers/)
- [Etsy Off-Platform Transactions](https://www.etsy.com/legal/policy/off-platform-transactions/1254654515806)
- [Etsy Extortion Policy](https://www.etsy.com/legal/policy/extortion/239966959186)
- [Etsy Payment Account Reserve](https://help.etsy.com/hc/en-us/articles/360058722214-What-is-a-Payment-Account-Reserve?segment=selling)
- [Upwork: Our most important policies](https://support.upwork.com/hc/en-us/articles/1500007569061-Our-most-important-policies-on-Upwork)
- [Upwork: Circumvention, and why it’s against the rules](https://support.upwork.com/hc/en-us/articles/360052511133-Circumvention-and-why-it-s-against-the-rules)
- [Upwork: Get to know each other before a contract](https://support.upwork.com/hc/en-us/articles/17995658941843--Get-to-know-each-other-before-a-contract)
- [Upwork: What to do if someone contacts you outside Upwork](https://support.upwork.com/hc/en-us/articles/17995705476627--What-to-do-if-someone-contacts-you-outside-Upwork)
- [Fiverr Community Standards: Integrity and Authenticity](https://help.fiverr.com/hc/en-us/articles/37554436102289-Community-Standards-Integrity-and-Authenticity)
- [Fiverr Account Restrictions](https://help.fiverr.com/hc/en-us/articles/34551010553489-Account-Restrictions)

Directional community signal:

- [Reddit: Etsy reserve frustration](https://www.reddit.com/r/EtsySellers/comments/z8vecj/shop_on_payment_reserve_but_support_not_allowed/)
- [Reddit: Etsy reserve thread](https://www.reddit.com/r/Etsy/comments/146jx7t/etsy_reserve/)
- [Reddit: Upwork off-platform asks](https://www.reddit.com/r/Upwork/comments/c2j8ul/how_often_are_you_asked_to_work_offplatform/)
