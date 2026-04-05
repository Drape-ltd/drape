# Research Notes: Referrals, Credits, Promotions, And Abuse Risk

Date: April 2, 2026

## Why This Exists

Drape already has invite and referral-style sharing utilities in the mobile app.

What is still ambiguous is:

- whether Drape should reward referrals in V1
- what counts as a valid referral
- how promo or discount codes should be limited
- how to avoid referral, credit, and promo abuse

This note is the research layer for that ambiguity.

## High-Signal Takeaways

- Sharing links is easy; rewarding them safely is much harder.
- Mature platforms put hard limits around who qualifies, how often codes can be redeemed, and how sharing is allowed.
- Referral programs are not just growth tools; they are fraud surfaces.
- Drape already has referral-style copy, but no real wallet, credit ledger, or anti-abuse layer behind it.
- That means Drape should be conservative before promising any customer or tailor discount for sharing.

## 1. What Drape Already Does Today

The current app already supports:

- customer share links
- customer referral-style links
- tailor share links
- tailor-to-tailor invite links
- passport invite links

Important current gap:

- `apps/mobile/lib/invite.ts` already uses copy like “let's both get a discount on our next order”
- but the repo does not currently show:
  - a reward ledger
  - a referral qualification model
  - promo code objects
  - discount redemption rules
  - abuse controls
  - reversal rules for fraudulent rewards

Important Drape takeaway:

- Drape already has the growth surface
- it does not yet have the economic control layer

## 2. Stripe Pattern: Promotions Need Hard Restrictions

Stripe’s current discount and promotion-code docs are useful because they are operationally specific.

Current Stripe tools allow restrictions like:

- eligible customer only
- first-time order only
- minimum order value
- expiration date
- max redemptions
- active/inactive state

Important Drape takeaway:

- codes should not be free-floating
- every discount or promo should have:
  - audience rules
  - time rules
  - value rules
  - redemption limits

## 3. Uber Pattern: Referral Programs Are Treated As Abuse-Sensitive

Uber’s current referral rules are even more revealing.

The current official rules say:

- the referrer must be in good standing
- users cannot have more than one account per product or service
- invitees must be new or otherwise specifically eligible
- invitees can only be referred once
- referral sharing must stay personal and non-commercial
- no coupon sites, paid ads, bots, spam, duplicate accounts, or misleading claims
- rewards can be forfeited or retracted and accounts can be deactivated for abuse or suspected fraud

Important Drape takeaway:

- referral programs are not “free growth”
- they need abuse policy from day one
- reward retraction must be part of the design, not a last-minute panic response

## 4. DoorDash Pattern: Qualification Should Depend On Real Downstream Behavior

DoorDash’s merchant referral program adds another useful pattern:

- referrals only qualify when the referred business is actually eligible
- the referred business must be new to the platform
- same ownership or franchise-network referrals do not qualify
- the referrer must be in good standing
- payout only happens after downstream activity is completed
- referral counts are capped

Important Drape takeaway:

- a Drape referral should not “earn” at signup alone
- it should qualify only after a real downstream milestone such as a first paid, non-refunded order

## 5. The Biggest Drape Risk Is Premature Promise Copy

This is the most immediate Drape-specific issue.

Right now the app copy implies:

- both parties may get a discount

But the system does not yet define:

- who counts as a new customer
- whether self-referral is blocked
- whether one household or one device can create multiple “new” users
- when a reward matures
- what happens if the first order is canceled, refunded, disputed, or abusive

Important Drape takeaway:

- until the rules exist, incentive copy should be treated as aspirational rather than product truth

## 6. African-Market Reality Makes Incentive Abuse More Sensitive

This is partly inference from the earlier infrastructure and trust work.

The relevant Drape-specific risk factors likely include:

- shared devices
- unstable identity signals
- account churn
- pressure to cash out or extract value quickly
- off-platform coordination that can make fake referral chains harder to spot

Important note:

- this is an inference from Drape’s target operating context and the known abuse patterns in incentive systems, not a direct quote from one source

Important Drape takeaway:

- incentives in Drape should be designed more like controlled liabilities than casual marketing copy

## 7. Strong V1 Direction

The cleanest current direction is:

- sharing is fine
- referral rewards are deferred
- promo codes, if introduced, should be tightly bounded
- no wallet or open-ended credit system until governance exists

## 8. What This Means For Drape

The best practical shape is:

- keep invite/share links
- do not launch economic referral rewards until qualification, expiry, reversal, and abuse policy are explicit
- if discounts arrive before full referral rewards, start with narrow one-time promo rules rather than broad bilateral “invite friends and both earn” promises

## Sources

- [Stripe: Coupons and promotion codes](https://docs.stripe.com/billing/subscriptions/coupons)
- [Stripe: Add discounts for Checkout](https://docs.stripe.com/payments/checkout/discounts)
- [Uber: Referral Program Rules](https://www.uber.com/legal/en/document/?name=referral-program-rules)
- [Uber Help: Refer-a-friend Program](https://help.uber.com/en/riders/article/refer-a-friend-program?nodeId=4d918571-17ab-4d8f-8967-2be24bea8800)
- [DoorDash Merchant Referral Program](https://merchants.doordash.com/en-us/about/merchant-referral-program)
