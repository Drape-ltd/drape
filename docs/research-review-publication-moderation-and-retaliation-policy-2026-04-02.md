# Research Notes: Review Publication, Moderation, And Retaliation Policy

Date: April 2, 2026

## Why This Exists

Reviews are one of Drape’s most visible trust systems.

What is still ambiguous is:

- when a review should be allowed
- when it should become public
- when it should be edited, responded to, or reported
- what kind of review should be removed
- how retaliation or manipulation should be handled
- whether tailor reviews of customers should be public at all

This note is the research layer for that ambiguity.

## High-Signal Takeaways

- Mature marketplaces do not remove a review just because it is negative.
- They do remove reviews when the system is being manipulated or when the content violates policy.
- Time-bounded review windows improve honesty and reduce endless reputation fights.
- Public seller responses are useful when they are factual, bounded, and non-editable.
- Two-sided review systems need extra care because retaliation risk rises quickly.
- In Drape’s market, moderation must work under mobile-first and low-bandwidth conditions, not just rich web tooling.

## 1. What Drape Already Does Today

Drape already has the bones of a review system:

- one `Review` per order
- customer reviews of tailors
- tailor reviews of customers in a separate table
- `tailor_response`
- `published_at`
- `flagged`

Current behavior and gaps appear to be:

- `review-action` allows customer review submission after `DELIVERED`, `COLLECTED`, or `COMPLETE`
- `review-action` allows tailor review of customers after `DELIVERED`, `COLLECTED`, or `COMPLETE`
- blocked contact details are already filtered from review text
- public tailor queries currently read reviews without clearly enforcing `published_at` or `flagged` as a publication gate
- Drape has no dedicated ops review-moderation queue for reviews yet
- there is no explicit rule for edit window, response window, report flow, or retaliation handling

Important Drape takeaway:

- the submission plumbing exists
- the publication and moderation policy is still underdefined

## 2. Current Marketplace Signal

## A. Airbnb uses short review windows, double-blind publication, and anti-manipulation rules

Airbnb’s current review system shows several useful patterns:

- both sides typically have `14 days` to review after a stay ends
- home reviews are published after both sides submit, or after the `14-day` window closes
- reviews can be edited only during that unpublished window
- the reviews policy prohibits coercion, intimidation, extortion, incentives, and manipulation aimed at influencing review outcomes

Important Drape takeaway:

- short windows reduce long-tail reputation fights
- two-sided systems benefit from delayed publication or other anti-retaliation controls

## B. Upwork treats most feedback as opinion, but allows reporting for abuse and manipulation

Upwork’s current feedback system adds several strong patterns:

- feedback is double-blind for the `14-day` review window after contract end
- most feedback is treated as opinion and is not removed just because someone disagrees
- feedback can be reported for manipulation, abuse, irrelevance, or insider/conflicted feedback
- public responses are allowed, but bounded:
  - one response
  - non-editable
  - response window of `28 days`
- reporting is time-bounded and a specific feedback item generally can only be reported once

Important Drape takeaway:

- Drape should not become a truth-policing machine for every harsh opinion
- Drape should be strict when the review system itself is being abused

## C. Etsy allows negative reviews to stand unless they violate policy

Etsy’s current review guidance is useful because it is very explicit:

- negative reviews that follow policy usually stay up
- reviews can be reported if they include:
  - private information
  - obscene, racist, or harassing content
  - spam
  - threats or extortion
  - false inflation or shilling
  - content only about matters outside seller control, such as a named carrier or Etsy itself
- the buyer can edit a review within `100 days` of estimated delivery if the seller has not yet responded

Important Drape takeaway:

- Drape should not remove harsh but relevant reviews just because they hurt
- response timing and edit timing should interact clearly

## D. Fiverr reinforces review authenticity and anti-retaliation

Fiverr’s current policy signal is straightforward:

- fake reviews are prohibited
- manipulating or deceiving through inauthentic reviews is prohibited
- review pressure and integrity violations can lead to severe enforcement

Important Drape takeaway:

- review authenticity is not a cosmetic issue
- it is a trust and enforcement issue

## 3. The Most Useful Drape Distinctions

The strongest distinctions for Drape are:

- honest negative review
- policy-violating review
- unresolved dispute review
- retaliatory or coercive review behavior

## A. Honest negative review

Examples:

- “The fit was not what I expected”
- “Delivery was late and communication was weak”
- “The finish was good, but the timeline slipped”

These should usually stay if:

- they reflect the actual order experience
- they avoid private information and abuse
- they are not manipulative

## B. Policy-violating review

Examples:

- posting contact info
- threats, slurs, or harassment
- asking readers to pay or contact off-platform
- obvious spam
- fake or insider review
- extortion or quid-pro-quo language

These should be reportable and removable.

## C. Unresolved-dispute review

This is where Drape needs its own judgment.

For Drape, a review submitted while a concern or dispute is still open can easily turn into:

- pressure during an unresolved support process
- public one-sided storytelling before facts settle
- retaliatory spirals between customer and tailor

Important Drape inference:

- Drape should not necessarily block submission during an open concern
- but public publication should be more cautious while the case is still unresolved

## D. Retaliatory or coercive review behavior

Examples:

- “Change your review and I’ll finish fixing this”
- “Leave five stars and I’ll refund you”
- “If you post that review, I’ll stop helping”
- “I’ll ruin your account if you review me badly”

This should be treated as a trust-breach issue, not just a review content issue.

## 4. Customer Reviews Of Tailors And Tailor Reviews Of Customers Should Not Work The Same

This is one of the most important Drape-specific questions.

The strongest current direction is:

- customer reviews of tailors can be public
- tailor reviews of customers should be much more limited in V1

Why:

- public tailor reputation is core buyer trust infrastructure
- public customer reputation is much more likely to create retaliation, embarrassment, or off-platform conflict in this category
- Drape is not a pure anonymous gig marketplace

Important Drape inference:

- tailor reviews of customers should likely stay seller-side and ops-visible in V1, not become a public customer scorecard

## 5. African-Market Reality Makes Review Moderation More Sensitive

In Drape’s target context:

- business can move quickly through WhatsApp pressure if boundaries weaken
- weak connectivity can create partial, delayed, or emotionally charged conflict records
- moderation cannot depend on perfect web dashboards

Important Drape takeaway:

- report flows must be light enough for mobile
- moderation needs clear policy categories
- seller response rights matter, but public retaliation risk must stay tightly controlled

## 6. What This Means For V1

The strongest V1 direction is:

- use a time-bounded review window
- allow customer reviews of tailors to become public only once moderation risk is acceptable
- keep tailor reviews of customers non-public in V1
- allow one factual tailor response
- treat negative but relevant reviews as protected opinion
- remove reviews only for policy violations or system abuse
- treat review coercion and retaliation as separate trust violations
- hold or delay publication when a dispute is still open

## Sources

- [Airbnb's Reviews Policy](https://www.airbnb.com/help/article/3048)
- [Airbnb: How long you have to write a review](https://www.airbnb.com/help/article/995)
- [Airbnb: Editing a review](https://www.airbnb.com/help/article/367)
- [Upwork: How to give feedback to your clients](https://support.upwork.com/hc/en-us/articles/211068438-How-to-give-feedback-to-your-clients)
- [Upwork: Respond to or report feedback](https://support.upwork.com/hc/en-us/articles/17975121967891)
- [Upwork: When can Upwork remove feedback I've received?](https://support.upwork.com/hc/en-us/articles/219801228-When-can-Upwork-remove-feedback-I-ve-received)
- [Upwork: How to respond to feedback from your client](https://support.upwork.com/hc/en-us/articles/211068448-How-to-respond-to-feedback-from-your-client)
- [Etsy: What to Do if You Receive a Negative Review](https://help.etsy.com/hc/en-us/articles/115015808588-What-to-Do-if-You-Receive-a-Negative-Review)
- [Etsy Harassment Policy](https://www.etsy.com/legal/policy/harassment/1395642333448)
- [Fiverr: Fake Reviews in Gig Violations](https://help.fiverr.com/hc/en-us/articles/37333366372881-Gig-violations)
