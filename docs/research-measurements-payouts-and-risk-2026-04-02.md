# Research Notes: Measurements, Payouts, Fabric Risk, And Trust

Date: April 2, 2026

## Why This Exists

We need decision support for a few product questions before we keep building deeper:

- How should customers get accurate measurements?
- How should seller payouts work for `shop now`, especially if materials need to be funded?
- What should happen when a customer wants custom work but the supplied fabric is poor quality?
- What trust, auth, and negative-path expectations should we assume going into launch?

This document mixes:

- official platform/vendor documentation
- social pain points from Reddit and similar public discussion
- product recommendations inferred from those sources

## High-Signal Takeaways

- Self-measurement alone is not trustworthy enough for high-stakes fit-sensitive garments.
- In-person measurement is a real advantage, but it should be treated as a flexible `measurement source`, not a hard-coded Nordstrom dependency.
- Stripe and Paystack can help with payout timing, but neither should be treated as simple escrow.
- `Ready-made`, `made-to-order`, and `custom with customer-supplied fabric` need different payment-release and dispute rules.
- Tailors need a structured `material issue` flow, not just a generic decline path.
- Password complexity theater is not the main trust win. Consistent recovery, rate limiting, verified identities, and generic auth messaging matter more.

## 1. Measurement Research

## What people complain about

Common pain points from public discussion:

- Customers do not trust online size charts because brands are inconsistent.
- Customers are often unsure where to measure and how tight the tape should be.
- Self-measured custom orders regularly arrive too big or too small.
- Customers often expect a perfect fit from one remote measurement pass, but tailors and fitters expect alterations or follow-up fitting.

Social signal:

- Reddit comments in `r/Tailors` repeatedly describe self-measurement as error-prone, especially when people measure themselves instead of being measured by someone experienced.
- Reddit discussions in `r/femalefashionadvice` and `r/Tailors` repeatedly point to inconsistent sizing, confusing charts, and high return/alteration expectations for online apparel.

## What the market seems to do

- Nordstrom officially offers alterations and tailoring appointments, including work on items from the customer's closet.
- Indochino explicitly markets a hybrid model: online or in-person showroom measurement for made-to-measure clothing.

Inference:

- The practical market pattern is not "trust self-measurement only."
- The practical pattern is "capture measurements somehow, then still expect fit review, alterations, or a fitter touchpoint."

## What this means for Drape

Recommendation:

- Build a `measurement source` model instead of a single measurement flow.

Suggested measurement sources:

- `SELF_GUIDED`
- `HELPER_GUIDED`
- `TAILOR_CAPTURED`
- `PARTNER_CAPTURED`
- `IMPORTED`

Suggested metadata:

- who captured it
- when it was captured
- unit system
- garment context
- confidence or verification state
- notes / photos / tape instructions used

Recommended MVP path:

1. Guided self-measure with visuals, validation, and helper prompts.
2. Optional "measured by a pro" path that lets the customer upload or record measurements from a local tailor, Nordstrom alteration desk, bridal tailor, or any trusted fitter.
3. Tailor-side flag: `measurements_need_confirmation`.

Recommendation on Nordstrom:

- Do not build a Nordstrom-specific integration right now.
- Do support a generic nearby-measurement concept later:
  - trusted local tailor
  - department-store fitter
  - bridal or formalwear alterations shop
  - Drape-approved partner

Reason:

- Official Nordstrom pages support alterations/tailoring appointments, but they do not read like a formal measurement network API or guaranteed standalone measurement program.
- Social discussion suggests some people do go to Nordstrom to get measured, but quality varies by location.

## 2. Payout And Escrow Research

## Stripe

Official Stripe Connect docs show:

- Stripe does not provide escrow services.
- Manual payouts can delay release to connected accounts, but payouts must still happen within the country-specific time window.
- Marketplace refunds and disputes can debit the platform balance depending on charge model.

Implication:

- Stripe can help us delay seller payout.
- Stripe should not be treated as legal escrow.
- If we hold funds too aggressively, that becomes an ops and compliance design problem, not just an engineering setting.

## Paystack

Official Paystack docs show:

- Paystack supports split payments and multi-split payments.
- Paystack subaccounts can have settlement schedules including `auto`, `weekly`, `monthly`, and `manual`.
- Paystack also documents manual payouts into a Paystack balance for supported registered businesses.

Implication:

- Paystack can support marketplace-style settlement logic.
- Paystack docs describe settlement splitting and manual payout options, but this still does not equal a full trustless milestone escrow product.
- If we use Paystack for staged release, we should assume extra ops handling and dashboard/process complexity.

## Social and seller pain points

Marketplace seller pain points from public discussion:

- late cancellation after work has started
- buyer's remorse framed as "accidental order"
- pressure for refund without return
- custom or made-to-order items becoming non-resellable inventory
- platform disputes that feel detached from the actual production facts

## What this means for Drape

Recommendation:

- Do not use one payout policy for all order types.

Suggested order classes:

- `READY_MADE`
- `MADE_TO_ORDER_FROM_CATALOG`
- `CUSTOM_WITH_PLATFORM_OR_TAILOR_SOURCED_FABRIC`
- `CUSTOM_WITH_CUSTOMER_SUPPLIED_FABRIC`

Suggested payout logic:

- `READY_MADE`
  - no early fabric release
  - standard seller payout after shipment / pickup / delivery confirmation window
- `MADE_TO_ORDER_FROM_CATALOG`
  - optional capped materials advance
  - remaining payout on production milestone or shipment
- `CUSTOM_WITH_TAILOR_SOURCED_FABRIC`
  - clearer case for a materials advance
  - rest released after later milestone
- `CUSTOM_WITH_CUSTOMER_SUPPLIED_FABRIC`
  - probably no fabric advance
  - labor advance only if product policy later supports it

Safer Drape recommendation for V1:

- avoid automatic partial payout until dispute and material-issue flows are clearer
- hold customer funds in platform flow
- release seller payout only after the right production or handoff event
- if early release exists, make it:
  - explicit
  - small
  - tied to order class
  - visible in ops

## 3. Customer-Supplied Fabric Research

## What the market says

Several tailoring and custom-work sources describe why customer-supplied fabric is risky:

- fabric may be flawed, unstable, or unsuitable for the design
- fabric may not have been pre-treated or stabilized
- customer may bring insufficient yardage
- tailor may not want to absorb blame for defects in provided material

Public tailor discussion shows:

- some shops refuse customer-supplied fabric entirely
- others accept it but only with expectations, disclaimers, and extra caution

## What this means for Drape

Recommendation:

- Tailors should have both:
  - a pre-acceptance decline path
  - a post-acceptance material-issue flow

Suggested states or decision paths:

- `DECLINED_MATERIAL_ISSUE`
  - before payment or before work starts
- `MATERIAL_ISSUE_REVIEW`
  - after acceptance, before cutting

Suggested reasons:

- poor quality
- wrong fabric type for design
- insufficient yardage
- damaged fabric
- unstable / difficult fabric
- color or weight mismatch

Suggested customer choices when a material issue is raised:

- replace fabric
- ask tailor to source better fabric and revise quote
- change design to fit material reality
- cancel

Important product rule:

- once cutting starts, the dispute/refund logic should be different
- before cutting, we can treat fabric issues more like pre-production review

## 4. Trust And Auth Research

## Official guidance

NIST and OWASP both push the same broad direction:

- length matters more than arbitrary composition rules
- very short passwords are weak
- block common and breached passwords
- rate limit login attempts
- use generic auth and reset messaging to avoid account enumeration
- keep password reset policy consistent with sign-up and change-password policy
- do not auto-log users in after password reset
- verify identity again for sensitive changes like password or email updates

## What this means for Drape

Current product fit:

- Good:
  - we already rate limit important edge-function paths
  - password reset does not auto-login
  - in-app password change requires re-auth
  - server-side auth derives user identity from bearer token
- Still worth noting:
  - biometric lock is local convenience, not MFA
  - ops auth is token-gated, not full admin identity
  - sensitive operational actions still need careful review before launch

Recommendation:

- treat auth trust as:
  - good enough for launch if we stay disciplined
  - not "done forever"

Best next trust checks:

- account recovery UX from signed-out state
- auth error message consistency
- role and ownership checks on all privileged edge functions
- audit logging for suspicious auth and payout failures

## 5. Social Pain Points Worth Designing Around

## Customer-side pain points

- "I measured myself and the fit is way off."
- "The size chart said one thing, real life said another."
- "I can’t tell whether I should size for bust, waist, hips, shoulder, or stretch."
- "I don’t want to pay for a custom item and then learn it still needs tailoring."
- "I ordered something custom and now regret it."

## Tailor-side pain points

- client-supplied fabric turns out to be bad
- client-supplied yardage is not enough
- buyer changes mind after work has started
- custom work becomes non-resellable loss
- expectations are unclear about what "custom" guarantees

## Platform-side pain points

- deciding when a seller has earned payout
- handling disputes without full milestone evidence
- dealing with "accidental order" or buyer-remorse style claims
- keeping measurement blame clear:
  - customer measured badly
  - tailor interpreted badly
  - platform flow misled both sides

## 6. Recommended Product Decisions

## Measurement

- ship guided self-measure first
- support external professional measurement as a generic source
- do not rely on a single retail chain partnership
- let tailors request measurement confirmation before quoting or cutting

## Payouts

- keep initial payout policy conservative
- do not auto-release partial materials payout for all `shop now` orders
- only introduce early release for specific order classes with clear ops support

## Customer-Supplied Fabric

- add a `material issue` flow
- allow tailor decline before commitment
- allow structured remediation before cutting begins

## Trust

- keep auth boring and strict
- prioritize enumeration-safe recovery, rate limits, ownership checks, and good audit trails over flashy password rules

## 7. Open Questions

- Should Drape support partner measurement locations as a directory, a verified network, or just a freeform upload?
- Should `shop now` include both true ready-made and made-to-order catalog items, or should those be split in the product model?
- For customer-supplied fabric, when does labor become non-refundable?
- Do we want one unified dispute policy, or separate rules for:
  - ready-made
  - made-to-order
  - custom
  - custom with customer-supplied fabric

## Sources

Official / primary:

- NIST SP 800-63B password guidance:
  - https://pages.nist.gov/800-63-4/sp800-63b/passwords/
- OWASP Authentication Cheat Sheet:
  - https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html
- OWASP Forgot Password Cheat Sheet:
  - https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html
- Stripe Connect payouts:
  - https://docs.stripe.com/connect/marketplace/tasks/payout
- Stripe manual payouts:
  - https://docs.stripe.com/connect/manual-payouts
- Stripe refunds and disputes for marketplaces:
  - https://docs.stripe.com/connect/marketplace/tasks/refunds-disputes
- Stripe multi-currency settlement:
  - https://docs.stripe.com/connect/alternative-currency-payouts
- Paystack split payments:
  - https://paystack.com/docs/payments/split-payments
- Paystack multi-split payments:
  - https://paystack.com/docs/payments/multi-split-payments/
- Paystack Transaction Split API:
  - https://paystack.com/docs/api/split/
- Paystack Subaccount API:
  - https://paystack.com/docs/api/subaccount/
- Paystack Settlements API:
  - https://paystack.com/docs/api/settlement/
- Paystack manual payouts:
  - https://support.paystack.com/en/articles/2131074
- Nordstrom men's tailoring / alterations:
  - https://www.nordstrom.com/browse/services/alterations/mens-tailoring
- Indochino about / showroom model:
  - https://www.indochino.com/about

Social / public pain points:

- Reddit `r/Tailors`: online custom tailor disappointment
  - https://www.reddit.com/r/Tailors/comments/179i55j
- Reddit `r/Tailors`: measured at home and ordered a suit
  - https://www.reddit.com/r/Tailors/comments/10q6idj
- Reddit `r/Tailors`: measurement confusion
  - https://www.reddit.com/r/Tailors/comments/1f1vfps
- Reddit `r/femalefashionadvice`: online sizing frustration
  - https://www.reddit.com/r/femalefashionadvice/comments/1mgrry5/how_do_you_actually_figure_out_your_sizing_when/
- Reddit `r/femalefashionadvice`: technological tailoring / online shopping frustration
  - https://www.reddit.com/r/femalefashionadvice/comments/dju7bz
- Reddit `r/Tailors`: bring my own material
  - https://www.reddit.com/r/Tailors/comments/13bzeqk
- Reddit `r/Tailors`: customer horror stories
  - https://www.reddit.com/r/Tailors/comments/1f49qqk
- Reddit `r/EtsySellers`: custom order refund / accidental order pain points
  - https://www.reddit.com/r/EtsySellers/comments/1gegh37
  - https://www.reddit.com/r/EtsySellers/comments/18w5a2p
  - https://www.reddit.com/r/EtsySellers/comments/1ieh5xj
  - https://www.reddit.com/r/EtsySellers/comments/1bd8k59

Additional context:

- Cutting Room Bespoke on why they generally do not accept client-supplied fabric:
  - https://cuttingroombespoke.com/custom-bespoke-suits-tailor/2025/11/1/can-i-bring-my-own-fabric-to-my-custom-tailor
- Winters Sewing on customer-owned materials expectations:
  - https://www.winterssewing.com/node/155
