# Research Notes: Contact Integrity, Phone Normalization, Circumvention, And Abuse Language

Date: April 2, 2026

## Why This Exists

Drape already has anti-contact-leakage and abuse controls in several places.

What is still ambiguous is:

- how phone numbers should be stored
- how anti-off-platform rules should work beyond simple regex checks
- how abusive or offensive language should be handled
- how all of that should fit Drape’s African-market reality

This note is the research layer for that ambiguity.

## High-Signal Takeaways

- Canonical phone storage is not optional if Drape ever wants reliable OTP, SMS, account recovery, deduping, or safe contact handling.
- Phone normalization should happen at input, not during lookup.
- E.164 is the safest canonical storage format for phone numbers across systems.
- Anti-off-platform enforcement should be evasion-aware, not just literal-pattern aware.
- Message safety needs at least three severity levels: contact leakage, targeted abuse, and credible threat / hate / coercion.
- A platform can be strict on circumvention without auto-blocking every rude sentence.

## 1. What Drape Already Does Today

Drape already has meaningful contact-safety building blocks:

- shared client-side contact filtering in `packages/shared/src/contact-filter.ts`
- server-side contact-bypass blocking and logging in `supabase/functions/_shared/contact-bypass.ts`
- bypass review visibility in `/ops`
- contact filtering in message, brief, review, and profile-adjacent surfaces

Drape also already stores phone numbers in several places:

- customer profile phone
- tailor auth metadata phone
- tailor private offline-client phone

Important current local gap:

- profile flows currently save phone numbers mostly as trimmed input, not canonicalized values
- the server-side bypass regex is much simpler than the shared filter
- the shared filter currently catches explicit threats, but not the broader range of harassment, slurs, sexual coercion, doxxing, or obfuscated payment/circumvention tactics Drape should care about

Important Drape takeaway:

- the direction is right
- the system is still fragmented

## 2. Canonical Phone Storage Is A Reliability Requirement

## A. E.164 is the most useful canonical storage format

ITU-T Recommendation E.164 defines the international public telecommunication numbering plan.

Twilio’s current docs also repeatedly anchor phone-number handling to E.164:

- E.164 provides a globally unique phone number format
- Twilio APIs consistently use E.164
- Twilio Proxy and related APIs require E.164-formatted numbers

Zendesk’s current docs add the practical operational lesson:

- if numbers are stored in different visual formats, matching and profile association can fail
- `+1 (415)-555-1212` and `+14155551212` are treated as different values unless normalized

Important Drape takeaway:

- canonical storage should not be a display format
- it should be a unique lookup format

## B. libphonenumber is the right parsing posture

Google’s `libphonenumber` exists precisely because phone numbers are hard.

Its current documented capabilities include:

- parsing
- formatting
- validating
- matching whether two numbers may be the same
- formatting to E.164
- as-you-type formatting

Important Drape takeaway:

- Drape should not rely on homegrown “digits only and pray” logic for global parsing
- use a proper phone-number library to parse by country, validate, and format canonically

## C. Nigeria-specific normalization is a real product issue

Twilio’s current Nigeria messaging guidelines identify Nigeria’s dialing code as `+234`.

That means a Drape product inference is justified:

- once the country is known to be Nigeria, local forms like `080...`, raw national forms like `801...`, and international forms like `234...` or `+234...` should resolve to one canonical E.164 value

For example, these should resolve to the same canonical number when country context is Nigeria:

- `08012345678`
- `8012345678`
- `2348012345678`
- `+2348012345678`
- `080 1234 5678`

Important note:

- this exact normalization behavior is an inference from E.164, Nigeria’s `+234` dialing code, and standard country-aware parsing behavior in tools like libphonenumber

Important Drape takeaway:

- the user’s warning is exactly right
- storing raw variants will eventually break matching, lookup, or messaging flows

## 3. Off-Platform Prevention Needs To Be Broader Than Literal Regex

Earlier Drape work already established that:

- pre-commitment contact sharing is high-risk
- commercial communication should stay in Drape
- operational contact should be scoped and time-gated

What this layer adds is:

- anti-circumvention should not depend only on someone typing a literal phone number or `whatsapp`

Current marketplace signal is consistent:

- Upwork prohibits contact sharing before a contract and explicitly includes phone, email, addresses, and social handles
- Upwork frames off-platform payment and unsolicited contact as safety and fraud risks
- Airbnb’s scam and abuse policy prohibits communicating, sharing personal contact details, paying, or requesting payment outside Airbnb’s platform
- Fiverr treats outside-platform solicitation and account-integrity violations as serious policy issues

Important Drape takeaway:

- “they can’t go offline” is not just a message-thread rule
- it is a system rule covering:
  - names and bios
  - messages
  - reviews
  - notes
  - style references
  - support surfaces
  - any later phone-based workflow

## 4. Drape Needs A Better Contact-Integrity Model

The clearest V1 contact-integrity model is:

- canonical identity/contact fields
- milestone-based contact release
- evasion-aware detection
- severity-aware moderation
- trust logging for repeat behavior

That means:

- normalize numbers before storage
- do not expose those numbers casually
- do not compare raw strings
- detect obfuscated contact-sharing attempts
- treat repeated bypass as trust risk, not just UX friction

## 5. Abuse And Offensive Language Should Use A Severity Ladder

The current shared filter already blocks a narrow class of explicit threats.

That is a good start, but not enough.

Current marketplace policy signal is stronger:

- Fiverr’s current standards treat violence, hate speech, discriminatory slurs, sexual coercion, and explicit user-safety violations as serious policy breaches
- Airbnb’s current policy prohibits discriminatory language, slurs, hateful speech, coercion, and extortion
- Upwork messaging guidance tells users to report threatening or abusive messages

Important Drape takeaway:

- message safety should not mean “ban all rude language”
- it should mean `classify severity correctly`

## Suggested severity ladder

### A. Contact leakage / circumvention

Examples:

- phone numbers
- WhatsApp / Telegram / Instagram handles
- off-platform payment requests
- bank-transfer instructions
- link-based diversion

Best V1 response:

- hard block
- log attempt
- feed trust review on repetition

### B. Offensive or targeted abuse without clear threat

Examples:

- direct insults
- degrading language
- harassment without explicit violence
- sexually inappropriate or humiliating messages

Best V1 response:

- allow reporting and moderation
- consider soft-send friction or rewrite prompts
- escalate on repetition

### C. Credible threat, hate, coercion, doxxing, or extortion

Examples:

- threats of harm
- hate speech or slurs targeting protected characteristics
- blackmail, sextortion, or review/payment coercion
- attempts to expose private data

Best V1 response:

- hard block or immediate hide
- incident log
- urgent ops review
- potential restriction or suspension

## 6. African-Market Reality Makes Canonical Contact Handling More Important

This is where the user’s Nigerian-number example is especially important.

In Drape’s target environment:

- phone is a primary trust and recovery channel
- users switch formatting casually
- many real business interactions happen on mobile-first patterns
- off-platform pressure is culturally and commercially common
- weak infrastructure makes manual fallback necessary, but also increases the temptation to route everything through raw phone exchange

Important Drape takeaway:

- if Drape is sloppy about phone normalization, it weakens both reliability and safety
- if Drape is sloppy about contact release, it weakens trust, payments, and evidence

## 7. What This Means For V1

The strongest V1 direction is:

- store canonical phone numbers, preferably in E.164
- normalize at input time, not query time
- require country context for normalization
- treat Nigerian and other local variants as one number once country is known
- do not auto-share stored phone numbers peer-to-peer
- broaden off-platform detection beyond literal formatting
- separate general rudeness from high-severity abuse
- treat threats, hate, coercion, and doxxing as urgent trust incidents

## Sources

- [ITU-T Recommendation E.164](https://www.itu.int/rec/t-rec-e.164/en)
- [Twilio: Normalize telephone numbers](https://www.twilio.com/docs/serverless/functions-assets/quickstart/normalize-telephone-numbers)
- [Twilio Proxy API: phone number in E.164 format](https://www.twilio.com/docs/proxy/api/phone-number)
- [Twilio Nigeria SMS Guidelines](https://www.twilio.com/en-us/guidelines/ng/sms)
- [Google libphonenumber](https://github.com/google/libphonenumber)
- [Zendesk: accepted phone number formats for Talk](https://support.zendesk.com/hc/en-us/articles/4408823756570-What-are-the-accepted-phone-number-formats-for-Talk)
- [Zendesk: format a phone number in Sell](https://support.zendesk.com/hc/en-us/articles/4408835497370-How-do-I-format-a-phone-number-in-Sell)
- [Upwork: Keeping your contact information safe](https://support.upwork.com/hc/en-us/articles/360051749534-Keeping-your-contact-information-safe)
- [Upwork: Why you shouldn’t get paid outside Upwork](https://support.upwork.com/hc/en-us/articles/360048105134-Why-you-shouldn-t-get-paid-outside-Upwork)
- [Upwork: How to use Upwork Messages for chats, updates, and meetings](https://support.upwork.com/hc/en-us/articles/43357128336147-How-to-use-Upwork-Messages-for-chats-updates-and-meetings)
- [Airbnb: Avoiding fraud, scams, and abuse](https://www.airbnb.com/help/article/3059)
- [Airbnb: Report suspicious messages](https://www.airbnb.com/help/article/3017)
- [Airbnb: Combating hate, harassment, and discrimination](https://www.airbnb.com/help/article/3058)
- [Fiverr: Objectionable content and user safety](https://help.fiverr.com/hc/en-us/articles/37554483360529-Community-Standards-Objectionable-content-and-user-safety)
- [Fiverr: Violence and unlawful behavior](https://help.fiverr.com/hc/en-us/articles/37554501373073-Community-Standards-Violence-and-Unlawful-Behavior)
- [Fiverr: How to report content or behavior on Fiverr](https://help.fiverr.com/hc/en-us/articles/37333217346833-How-to-report-content-or-behavior-on-Fiverr)
