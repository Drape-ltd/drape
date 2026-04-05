# Research Notes: Tailor Response Time, Remedy Offers, And Concern Resolution

Date: April 2, 2026

## Why This Exists

Once a customer raises a concern, Drape still needs a fair answer to:

- how fast the tailor must respond
- what counts as a real response
- when a remedy offer is good enough
- when silence starts favoring the customer

This note is the research layer for that policy.

## High-Signal Takeaways

- Mature marketplaces usually give the seller a short response window before the platform or buyer gains more control.
- A real response is not just “looking into it.” It should move the issue toward resolution.
- Tailor-made businesses often prefer alteration or remake before refund, but they still use clear time windows and intake requirements.
- When the seller goes quiet, trust falls quickly and customers begin assuming bad faith.
- For Drape, the right V1 posture is probably:
  - fast acknowledgment
  - short deadline for a concrete remedy or evidence-backed disagreement
  - customer-favoring escalation if the tailor stalls

## 1. What Drape Does Today

Current Drape behavior after a customer concern opens:

- the order moves to `IN_DISPUTE`
- payout stays blocked
- the tailor is notified
- ops can later resolve to refund or release

Current gap:

- there is no explicit tailor response SLA
- there is no structured remedy-offer model yet
- there is no clear rule for when silence starts hurting the tailor’s position

Important Drape inference:

Without a response policy, “keep talking in messages” can easily become drift.

## 2. Marketplace Pattern: Sellers Usually Get A Short First Response Window

Etsy’s current help-request docs say:

- sellers have `48 hours` to respond and resolve a buyer help request before the buyer can open a case
- sellers should use Messages to work with the buyer
- if Etsy asks for more information on a case, the seller must respond

Fiverr’s current Resolution Center docs say:

- freelancers have up to `48 hours` to accept or decline dispute requests
- if a freelancer is late, the buyer can cancel without approval after `24 hours`

Important Drape takeaway:

- `48 hours` is a common external benchmark for response or decision
- but seller silence during a live issue usually leads to stronger buyer control very quickly

## 3. Marketplace Pattern: A Useful Response Is More Than Acknowledgment

Etsy’s current guidance for sellers in a case says:

- acknowledge the customer’s concern so they feel heard
- focus on doing what you can to make it right

Fiverr’s resolution tools similarly push the parties toward a concrete action:

- update
- cancellation
- partial refund

Important Drape takeaway:

- a real response usually contains:
  - acknowledgment
  - explanation or evidence
  - a specific next step

## 4. Marketplace Pattern: Silent Delay Changes The Outcome

Fiverr’s current docs say:

- when a delivery is late and no mutual extension exists, the buyer can cancel after `24 hours`

That is a strong example of the platform not letting seller silence trap the buyer forever.

Important Drape takeaway:

- if a tailor does not answer a concern quickly, Drape should not stay neutral forever
- time itself becomes evidence about responsiveness and reliability

## 5. Custom Clothing Pattern: Remedy Often Comes Before Refund

Proper Cloth’s current fit policy shows a strong remedy-first model:

- minor fit issues may be better handled by local tailoring
- stronger fit issues may justify a remake

INDOCHINO’s current help center also uses a remedy-first posture:

- fit-related concerns must be raised quickly
- alterations are the main answer
- refunds are much narrower

Important Drape takeaway:

- for fit and craftsmanship issues, the tailor should often be allowed to propose:
  - alteration
  - remake
before full refund becomes the default

But that only works if:

- the offer is credible
- the offer is timely
- the customer is not being pressured to close the concern first

## 6. Payment-Provider Pattern: Early Resolution Is Valuable

Stripe’s Klarna dispute docs show:

- inquiry disputes exist so the business can contact the customer early
- the goal is to find a mutual resolution before escalation
- if the business ignores the issue, it escalates and funds are withheld

Important Drape takeaway:

- early response matters not just for support quality, but for platform risk
- “let’s wait and see” is a weak posture once money is blocked

## 7. Social Pain Point Signal

Directional community signal shows a few repeating frustrations:

- customers hate being ghosted while their money is tied up
- emotional pressure to close a case makes trust worse
- vague promises like “I’ll sort it out soon” without dates or actions feel manipulative

Important Drape inference:

- a polite but empty response should not count the same as a real remedy offer

## 8. What Should Count As A Real Tailor Response In Drape

A real V1 response should contain at least one of these:

- evidence-backed disagreement
- concrete update with verifiable next step
- structured remedy offer
- justified request for one missing piece of information

Examples:

### Good response

- “Tracking `XYZ` shows delivery is due tomorrow. If it does not arrive, I will refund or replace.”
- “The sleeve balance issue looks minor from your note. I can cover a local alteration up to `X` amount if you confirm that works for you.”
- “The garment needs a remake because the shoulder is structurally off. I can start the remake by Friday and deliver by the revised date.”

### Weak response

- “I’m checking.”
- “Please be patient.”
- “Close the concern and I’ll handle it.”

Important Drape takeaway:

- a response should move the matter closer to resolution

## 9. What Should Count As A Real Remedy Offer

For Drape, a remedy offer should not just name a category.

It should say:

- what is being offered
- who is responsible for the next action
- timeline
- whether any return / handoff / measurement step is needed
- whether the customer must send anything back
- whether Drape / ops must approve the cash side

Important Drape takeaway:

- “I’ll remake it” without a date is not enough
- “I can do a partial refund” without amount or basis is not enough

## 10. Which Remedies Feel Right For Which Problems

### A. `TAILOR_UNRESPONSIVE` or missed deadline

Best response posture:

- explanation only if credible
- concrete update or cancellation / refund path quickly

Weak seller silence should start favoring the customer fast here.

### B. `NOT_RECEIVED`

Best response posture:

- valid tracking or handoff proof
- revised timeline if supported by evidence
- refund / replacement path if the order is effectively lost

### C. `NOT_AS_DESCRIBED`, `WRONG_ITEM`, `DAMAGED`

Best response posture:

- acknowledge issue
- say whether:
  - fix
  - remake
  - partial refund
  - full refund
is being proposed

### D. `FIT_OR_MEASUREMENT_ISSUE`

Best response posture:

- clarify whether the issue is minor and alterable or structural
- propose alteration first if realistically fixable
- propose remake if alteration will not credibly solve it

### E. `OFF_PLATFORM_OR_TRUST_ISSUE`

Best response posture:

- this should go to ops immediately
- ordinary tailor persuasion should not control the outcome

## 11. Main Product Question

How quickly should Drape expect the tailor to act?

### Option A: One simple `48-hour` response rule

Pros:

- easy to explain
- matches Etsy/Fiverr external patterns

Cons:

- too slow for live production issues in some cases
- does not distinguish acknowledgment from meaningful action

### Option B: Two-step rule

- acknowledge quickly
- provide concrete path shortly after

Pros:

- better fit for custom-work issues
- prevents placeholder replies from gaming the SLA

Cons:

- slightly more policy complexity

Important Drape inference:

Option B feels better for V1.

## 12. Working Recommendation

The cleanest V1 response policy is:

- tailor should acknowledge within `24 hours`
- tailor should provide a substantive response within `48 hours`
- if no substantive response arrives, ops can move the case forward with a more customer-favoring posture
- if the issue is trust/safety or obvious ghosting, Drape should escalate faster

And the cleanest V1 remedy posture is:

- remedy offers stay inside Drape
- remedy offers must be concrete
- alteration or remake can be preferred before refund for fixable seller-fault issues
- cash adjustments should stay ops-mediated until self-serve flows are more mature

## Sources

Official sources:

- [Etsy: How to Answer a Help Request from a Buyer](https://help.etsy.com/hc/en-us/articles/13241489600919-How-to-Answer-a-Help-Request-from-a-Buyer)
- [Etsy: How to Resolve a Case from a Buyer](https://help.etsy.com/hc/en-us/articles/360016126873-How-to-Resolve-a-Case-from-a-Buyer)
- [Etsy: How to Get Help with an Order](https://help.etsy.com/hc/en-us/articles/4402660818583-How-to-Get-Help-with-An-Order)
- [Etsy: How to Open a Case](https://help.etsy.com/hc/en-us/articles/5745586898199-How-to-Open-a-Case)
- [Fiverr: Cancel an order with the Resolution Center](https://help.fiverr.com/hc/en-us/articles/4417622226833-Cancel-an-order-with-the-Resolution-Center)
- [Fiverr: Using the Resolution Center](https://help.fiverr.com/hc/en-us/articles/37552897293329-How-to-use-the-Resolution-Center)
- [Fiverr: Partial refunds](https://help.fiverr.com/hc/en-us/articles/15770574712977-Partial-refunds)
- [Stripe: Klarna disputes](https://docs.stripe.com/payments/klarna/disputes)
- [Proper Cloth Perfect Fit Guarantee](https://propercloth.com/perfect-fit-guarantee)
- [Proper Cloth: How to Request a Tailored Clothing Remake](https://propercloth.com/reference/how-to-request-tailored-clothing-remake/)
- [INDOCHINO: My suit doesn't fit, what options do I have?](https://support.indochino.com/hc/en-us/articles/360034773473-My-suit-doesn-t-fit-what-options-do-I-have)
- [INDOCHINO: What is the Return Policy?](https://support.indochino.com/hc/en-us/articles/360034710293-What-is-the-Return-Policy)
