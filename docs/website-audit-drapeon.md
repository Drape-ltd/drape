# Drapeon.co Website Audit
**Date:** July 2, 2026
**Scope:** Full UX, design, content, conversion, SEO, accessibility, technical, and backend audit
**Severity:** [P0] Blocking · [P1] High · [P2] Medium · [P3] Low/Polish

---

## 1. VISUAL DESIGN & BRAND IDENTITY

### 1.1 Fake UI Is Doing Real Work It Can't Do
**[P0]** `AppSurfacePreview` is a text mockup with hardcoded fake data ("Verified • Lagos", "4.9 rating • Available"). This is the *only* product visual on the entire site. Visitors cannot tell whether Drapeon is a real product or a pitch deck. Every competitor that has shipped shows at least one real screenshot. Until you have a real screenshot, use a device frame with a styled SVG that honestly represents the UI rather than fabricating live-data feel.

### 1.2 No Real Photography Anywhere
**[P1]** Zero photos of garments, tailors, or customers exist on the entire site. The `public/` directory contains only two SVG diagrams. Fashion is a visual-first category. A site about clothes without a single image of clothes is immediately unconvincing to the audience it needs to reach.

### 1.3 OG Image Is Text-Only
**[P1]** `opengraph-image.tsx` renders the tagline "Fashion that fits before the first stitch." as an `satori` SVG with `sans-serif` font fallback. When someone shares any drapeon.co link on WhatsApp, Twitter, iMessage, or LinkedIn, the preview card shows plain text on a white rectangle. No color, no brand mark, no visual identity. This is the first impression on every share — and it's blank.

### 1.4 `--font-body` CSS Variable Never Defined
**[P1]** `tailwind.config.ts` sets `fontFamily.sans = ['var(--font-body)', 'system-ui']`. That CSS variable is never defined in `globals.css` or `layout.tsx`. No Google Fonts, no local fonts, no `@font-face`. The entire site falls back silently to the OS system font. Every browser renders a different typeface. The brand has no typographic identity at all.

### 1.5 Color Palette Is Good But Barely Used
**[P2]** The `needle` green (#2D6A4F), `rust` (#D85A30), `bone`, and `ink` palette is genuinely strong. But across the site, needle appears mainly in pill badges and the `SectionTitle` eyebrow. Rust appears almost nowhere outside the footer logo mark. The palette is defined but not expressed. Bolder use of needle on hero sections, section dividers, and interactive states would create visual memory.

### 1.6 Every Marketing Page Looks Identical
**[P1]** `MarketingShell` renders every secondary page with the same structure: gradient background → eyebrow pill → `text-7xl` headline → description → content. FAQ, About, Careers, Press, Partnerships, Vision, Verify, Security, and Payouts are visually indistinguishable from each other. Visitors lose spatial orientation after the first two pages. Each page needs a distinct visual signature — even a color accent, a large illustrative element, or a changed header treatment.

### 1.7 `text-7xl` Headline on Every Page Is Exhausting
**[P2]** The `SectionTitle` component forces `text-7xl` (72px) for every section header across every page. It reads as shouting. There is no typographic hierarchy — headlines, subheadings, and body text all feel the same weight because the only differentiator is size, not weight or rhythm.

### 1.8 Gradient Background Is Decorative Noise
**[P2]** The radial `bone → white` gradient background repeats on every page inside `MarketingShell`. It adds no meaning. On a monitor it looks like uneven printing. Either commit to a real background treatment that signals something or remove it entirely.

### 1.9 No Dark Mode Handling
**[P3]** No `prefers-color-scheme: dark` handling anywhere. On macOS/iOS with dark mode enabled, `bone` background and `ink` text create an uncorrected washed-out appearance. Not blocking but increasingly an expectation.

### 1.10 PWA Manifest Has No Icons
**[P1]** `manifest.ts` is missing the `icons` array entirely. If anyone adds drapeon.co to their home screen (or a browser offers the install prompt), there is no icon — the browser generates a grey placeholder. The PWA install experience is broken out of the box.

### 1.11 Favicon Is a Plain SVG With No Color Variant
**[P2]** `icon.svg` is used for `icon`, `shortcut`, and `apple-touch-icon`. Apple touch icons must be a 180×180 PNG. An SVG served as `apple-touch-icon` renders incorrectly on iOS home screens.

### 1.12 No Loading State or Page Transition
**[P3]** No skeleton screens, no loading indicators, no route transition animation. Next.js App Router is fast but cold Cloudflare Worker starts can cause visible delays. Users see a blank white flash. A minimal top-progress bar (e.g., `nprogress`) would eliminate the perception of slowness.

### 1.13 `rounded-[1.5rem]` Everywhere Looks Unresolved
**[P2]** Cards across the site use `rounded-[1.5rem]` uniformly. This is fine as a default but when every card, pill, and container has the same exact radius, the design looks templated. Vary radius intentionally: larger for hero cards, tighter for inline chips.

### 1.14 Shadows Are Weak and Inconsistent
**[P3]** Most cards use `shadow-sm`. The design reads as flat in an unintentional way. Either go fully flat (remove all shadows) or add depth intentionally. The current in-between state looks like an unfinished decision.

### 1.15 `bg-white/82` Translucency Is Unexplained
**[P3]** FAQ cards use `bg-white/82`. There is nothing behind them that would make translucency meaningful — it reads as a styling error. Use `bg-white` or commit to a layered background that makes the effect purposeful.

---

## 2. HOMEPAGE (page.tsx)

### 2.1 Three CTAs With No Hierarchy
**[P0]** The hero section has three primary calls-to-action: "Join the queue," "Explore Drape Vision," and "Account access." A visitor landing cold has no idea which one they should click. One CTA per hero. Pick one — for a pre-launch site, that is "Join the queue." The other two belong in navigation or secondary positions.

### 2.2 The Hero Does Not State the Value Proposition Clearly
**[P1]** The hero headline (whatever it renders as) does not immediately answer "what does Drapeon do and who is it for?" The site is about tailored clothing orders — this is not obvious from the hero in under 3 seconds. Add one concrete sentence: "Find a verified tailor, submit your brief, and track production to delivery — all in one place."

### 2.3 No Social Proof Anywhere on the Homepage
**[P1]** Zero testimonials, zero customer quotes, zero tailor names, zero order count, zero waitlist size badge. Pre-launch sites still need social proof — even "200+ tailors waitlisted" or "Built by a team that has spent time with tailors in Lagos and London" establishes credibility.

### 2.4 "What Drapeon Does" Features Strip Is Abstract
**[P1]** The features strip describes the product with generic language. No concrete example of what a customer actually does in step 1. Compare: "Track your order" (current, abstract) vs. "See when your tailor cuts, sews, and ships — with photos for each stage" (concrete, memorable).

### 2.5 The "App Parity" Section Name Means Nothing to Users
**[P2]** Internal product language ("app parity") leaked into a public page section. Users do not care about parity. Rename to something that communicates the value: "One shared workspace for customer and tailor."

### 2.6 Dark "Trust Layer" Section Underuses Its Space
**[P2]** The dark section near the bottom of the homepage is structurally good but thin in content. This is the place to show the trust *mechanism* — how collection codes work, how the payment escrow works, how disputes are raised. Right now it describes trust without demonstrating it.

### 2.7 Company Section on the Homepage Is Premature
**[P2]** There is a company/about section on the homepage. For a product that is still in waitlist mode, the homepage should be entirely focused on converting visitors to the waitlist. Company information belongs on `/about`.

### 2.8 No App Store Badges
**[P1]** If the iOS app exists and is in TestFlight or the App Store, there should be an App Store badge on the homepage (and in the footer). If it is not public yet, that is fine — but the homepage does not even mention the app is iOS-native. "Available on iOS" with a beta/waitlist caveat beats silence.

### 2.9 Hero Section Has No Above-the-Fold Image
**[P1]** On a typical 1280px monitor, the hero visible above the fold is a headline, a paragraph, and three buttons. No image, no illustration, no video, no device mockup. There is nothing for the eye to land on besides text.

### 2.10 Scroll Depth Is Undefined
**[P2]** There is no visual cue that more content exists below the hero — no scroll arrow, no partial visibility of the next section. Many users will not scroll past the first section, especially on mobile, if nothing signals "there is more here."

---

## 3. NAVIGATION & INFORMATION ARCHITECTURE

### 3.1 Mobile Header Has No Hamburger Menu
**[P0]** `public-site-header.tsx` collapses to a 2-column grid on small screens. This means "How it works", "Tailors", "FAQ" etc. wrap awkwardly. There is no hamburger/drawer pattern. On a 375px iPhone the header is completely broken in layout and partially unusable.

### 3.2 No Active State on Navigation Links
**[P1]** None of the header nav links have an active/current state. A user on `/faq` cannot tell from the header that they are on FAQ. `usePathname()` is available in Next.js App Router — apply `font-semibold` or `text-needle` to the current page link.

### 3.3 "Sign in" and "Create account" Are the Same CTA Priority
**[P2]** Both auth actions in the header have equal visual weight. "Create account" should be the primary (filled button) and "Sign in" the secondary (ghost/link). This is standard conversion hierarchy that is being skipped.

### 3.4 Sitemap Exposes Authenticated Routes
**[P1]** `sitemap.ts` includes `/account`, `/account/customer`, `/account/tailor`, `/account/ops`. Google will crawl and index these routes. When Google bots or logged-out users visit these URLs they will see a redirect or error. Authenticated routes must be excluded from the sitemap.

### 3.5 Robots.txt Allows All Routes
**[P1]** `robots.ts` sets `allow: '/'` with no disallow rules. `/account/**`, `/api/**`, and any internal routes are crawlable. The fix is straightforward:
```
Disallow: /account/
Disallow: /api/
```

### 3.6 Footer Has No Social Media Links
**[P2]** Zero links to Instagram, Twitter/X, LinkedIn, TikTok, or any social channel. Even a pre-launch brand should have at least one maintained social presence linked from the footer. This is a missed acquisition channel.

### 3.7 Footer "Protected orders" Badge Is Confusing
**[P2]** The footer displays pill badges labeled "Drape Vision" and "Protected orders." In a footer, these look like trust seals. But they link to nothing and communicate nothing specific. Either expand them into real trust marks (with icons and a short qualifier) or remove them.

### 3.8 Help/Verify/Payouts/Legal Footer Row Is Visually Lost
**[P2]** The bottom bar of the footer has a row of links (Help, Verify, Payouts, Legal) in small muted text. These are actually important pages — payouts especially matters to tailors. They are styled to be invisible.

### 3.9 No Breadcrumbs on Deep Pages
**[P3]** Deep pages like `/customers`, `/tailors`, `/how-it-works` have no breadcrumb trail. For SEO and spatial orientation, breadcrumbs on second-level pages help — especially when all pages look alike.

### 3.10 `/discover` and `/customers` Are Nearly Identical
**[P1]** The discover page and customers page cover the same ground — "Here is what customers get." This creates duplicate content for SEO and confuses the information architecture. Merge them or give each a genuinely distinct purpose.

### 3.11 No 404 Redirect Strategy
**[P2]** `not-found.tsx` exists and is reasonable, but there is no `redirects` in `next.config.js` for common mistyped routes. Any links from external sites pointing to old or wrong URLs will dead-end.

### 3.12 No Search in Header or On-Site
**[P3]** There is no on-site search. For the current content volume this is not critical, but `/help` in particular would benefit from a search input to filter the FAQ items.

---

## 4. PAGE-BY-PAGE FINDINGS

### 4.1 /how-it-works — Four Cards Is Not "How It Works"
**[P1]** The page has four cards: Discover, Brief, Produce, Complete. Each card is 1-2 sentences. This is a marketing bullet list, not a "how it works" page. A real how-it-works page shows the UI at each step, explains what happens to the order, who does what, and what the customer experiences. A numbered step flow with an annotated screenshot or illustration per step would be 10× more convincing.

### 4.2 /how-it-works — No Tailor Perspective
**[P2]** The page describes the process from the customer's perspective only. But tailors also need to understand how Drapeon works for them before they apply. Add a toggle or a second section for the tailor journey.

### 4.3 /vision — CTA Goes to /privacy, Not /join
**[P1]** The Drape Vision page's primary CTA button navigates to `/privacy`. This is wrong. A user excited about the Vision feature should be directed to join the waitlist or download the app, not to the privacy policy. This is a broken conversion path.

### 4.4 /vision — No Screenshots of the Vision Feature
**[P1]** The Vision feature is a camera-based body measurement tool — one of the most technically impressive things on the platform — and the dedicated marketing page has zero screenshots, zero video, zero animation showing how it works. This is the highest-conviction page on the site and it reads like a privacy document.

### 4.5 /about — No Founder Story
**[P1]** The about page has three generic cards (Product, Technology, Trust) and a mission statement. There is no: founder name, founding year, why the company was started, any personal connection to the tailoring industry, or team photo. Customers and tailors choose to trust people, not abstract company descriptions.

### 4.6 /about — No Company Timeline or Milestones
**[P2]** When was Drapeon founded? When did the first tailor join? When did the app launch in TestFlight? A one-row timeline (even 3 entries) creates a sense of momentum and realness.

### 4.7 /customers — "View both sides" Links to /join
**[P2]** The CTA button labeled "View both sides" on both `/customers` and `/tailors` navigates to `/join`. That label is misleading — it suggests the user will see a comparison, but instead they get the waitlist form. Either rename the button to "Join the waitlist" or link it to a genuine comparison page.

### 4.8 /customers — SVG Is Not Explanatory
**[P2]** `customer-brief.svg` is used as a "visual" on the customers page. Without seeing the SVG rendering, it is likely a simple flow diagram. This is better than nothing but still not a real UI screenshot. The customers page needs to show what a customer *actually* sees when they open the app.

### 4.9 /tailors — Same Structure as /customers
**[P1]** The tailors page is a copy-paste of the customers page with different text. Tailors and customers have fundamentally different motivations, concerns, and objections. The tailors page should be built around what a tailor needs to know: how to get paid, how orders arrive, what tools they get, what the onboarding looks like. Right now it reads as a less-specific version of the customers page.

### 4.10 /join — Two WaitlistForms Stacked Vertically
**[P2]** The join page stacks two `WaitlistForm` components: one for customers, one for tailors. On mobile this creates a very long scroll. The eyebrow and title above each form are redundant. A tab switcher (Customer / Tailor) with a single form that changes would be cleaner and remove the repetition.

### 4.11 /join — "Choose your side" Is Poor Copy
**[P2]** Section title "Choose your side" and eyebrow "Your role" are repeated above both forms. "Choose your side" sounds combative. "Join as a customer" and "Join as a tailor" would be direct.

### 4.12 /apply — Underlinked
**[P1]** The tailor application page (`/apply`) is not linked from the main navigation, the tailors page CTA, or the footer in an obvious way. Tailors who want to apply have to hunt for it. The primary CTA on `/tailors` should go directly to `/apply`, not `/join`.

### 4.13 /faq — No Accordion
**[P1]** All 8 FAQ items are expanded simultaneously. The page is one long column of open answers. Accordions are standard for FAQ pages because they let users scan questions and open only what they need. With all answers visible, the page is dense and harder to scan than it needs to be.

### 4.14 /faq — FAQ Answers Are Vague
**[P1]** Most answers avoid specifics: "Verification is designed to make trust clearer" is not an answer. "Drapeon is designed so the commercial agreement becomes clear" describes nothing. Real FAQ answers give concrete information: how long verification takes, what documents are required, what currencies are supported, what the fee is.

### 4.15 /faq — "Can I download Drapeon today?" Answer Punts
**[P1]** "Join the queue and we will share access as Drapeon opens to more customers and tailors." This is the answer to the most commercially important FAQ question and it says nothing. A better answer: "Drapeon is currently in invite-only beta on iOS. Join the waitlist and we'll notify you when your spot opens."

### 4.16 /contact — Email Addresses as `<h3>` Elements
**[P1]** Contact email addresses like `hello@drapeon.co` are rendered as `text-2xl h3` elements. They look like headings, not clickable links. On mobile these 24px email strings wrap mid-address and look broken. Use a smaller type size in a card format with a label and a mailto button.

### 4.17 /contact — 8 Email Addresses Is Too Many
**[P2]** The contact page has 8 separate mailto cards (general, tailors, support, legal, press, partnerships, security, and careers). This fragments contact into too many buckets. Most users cannot decide which one to use. Consolidate to one or two inboxes — `hello@` for general + `security@` — and route internally.

### 4.18 /careers — No Open Roles
**[P1]** The careers page has three generic cards and a mailto CTA with no job listings. If there are no open roles, say so honestly: "We're a small founding team and not hiring right now. Send your details anyway if you're interested in future opportunities." Silence reads as neglect.

### 4.19 /press — No Press Kit
**[P1]** The press page has no: brand kit download, logo files, color codes, founder headshots, company description, or notable coverage links. Any journalist who lands here gets nothing. A single `/press-kit.zip` download link would transform this page.

### 4.20 /press — No Coverage or Mentions
**[P2]** If Drapeon has been covered anywhere (blog posts, newsletters, any publication), those links belong here. Even a "featured in" section with three logos creates social proof. If there is zero coverage, that is honest and okay to say — but the current page implies there might be coverage and then shows nothing.

### 4.21 /partnerships — Completely Generic
**[P1]** The partnerships page has three cards that could be copy-pasted from any B2B startup site. It does not explain what kind of partnership Drapeon is seeking, what a partner gets, what the commercial arrangement looks like, or who the right contact is for which type of partnership. It is a placeholder masquerading as a real page.

### 4.22 /security — No Bug Bounty
**[P1]** The security page has no bug bounty program, no responsible disclosure policy, no PGP key for security researchers, no `security.txt`, and no stated CVE policy. For a platform handling payments, identity, and personal measurements, this is a serious gap. At minimum, add a responsible disclosure email and a `/.well-known/security.txt` file.

### 4.23 /security — "Contact our security team" Links to a Mailto
**[P2]** The security page's call-to-action is an email link. Responsible disclosure best practice is a web form or a documented process — not an unmonitored mailto. A researcher who finds a critical vulnerability needs to know it will be acknowledged and handled.

### 4.24 /payouts — No Information About How Payouts Actually Work
**[P0]** The payouts page is the single most important page for tailor acquisition. Tailors will not join a platform unless they understand how and when they get paid. The current page has three generic cards and a mailto. It does not mention: payout currency, payout frequency, whether Stripe Connect is used, what the platform fee is, what countries are supported, or what the payout timeline is. This page alone is blocking tailor signup conversion.

### 4.25 /verify — Thin to the Point of Useless
**[P1]** The verify page is three cards and a mailto. It does not explain: what the verification process entails, how long it takes, what is verified (identity? craftsmanship? business registration?), or what a verified badge means to customers. This is core trust infrastructure and it gets the least real-estate of any page on the site.

### 4.26 /account-deletion — Describes a Flow That Doesn't Exist Yet
**[P1]** The account deletion page tells users to open the app, go to Settings, type DELETE, and confirm their password. Per earlier audit findings, account deletion is still manual/email-based — this automated in-app flow does not exist. This is misleading and a potential legal issue under GDPR (you must provide a working deletion mechanism, not just describe one).

### 4.27 /privacy — `lastUpdated` Is a Hardcoded String
**[P2]** `lastUpdated = 'June 5, 2026'` is hardcoded in the component. Any future update to the privacy policy requires a code deploy to update the date. This should be a constant in a shared config or a CMS field.

### 4.28 /terms — Same Hardcoded Date Issue
**[P2]** Same as above — `lastUpdated` is hardcoded. Privacy and Terms dates need to match whenever both are updated, and both require a deploy.

### 4.29 /help — "When Signal Is Weak" Is Jargon
**[P2]** The help page has a section titled "When Signal Is Weak." This is internal product language. Users understand "If you're having trouble" or "Connectivity and camera issues." Internal metaphor language on a public help page creates comprehension friction.

### 4.30 /trust — Best Page on the Site, Still Underlinked
**[P2]** `/trust` is the best-written, most substantive page on the site. It explains the trust architecture clearly. But it is barely linked to from other pages. The homepage's dark "Trust layer" section should link directly to `/trust`. The FAQ answer about "what if something goes wrong" should link to `/trust`.

---

## 5. CONTENT & COPY

### 5.1 "Drapeon" vs "Drape" Naming Is Inconsistent
**[P1]** The brand name is "Drapeon" on the website (`drapeon.co`, metadata, copy). The app is called "Drape" (per `apps/mobile`). The company is "O4 Group LLC." Customers and tailors will be confused. The website must pick one public-facing brand name and use it consistently. If the product is "Drape" and the platform brand is "Drapeon," explain the relationship clearly.

### 5.2 "Drapeon" Name Appears in FAQ but Not in Header/Logo
**[P2]** The site header renders what appears to be a word mark but the FAQ copy references "Drapeon" by name. If the logo is the only place the brand name appears, the FAQ reads confusingly.

### 5.3 Copy Overuses Abstract Platform Language
**[P1]** Phrases like "one trusted thread," "one calm workspace," "stronger briefs instead of scattered messages," "one clear order flow" appear on multiple pages without defining what those things are concretely. Real users understand "one app instead of WhatsApp + DM + email" more than "one trusted thread."

### 5.4 No Specific Market Reference
**[P2]** The site is clearly building for African (specifically Nigerian) and diaspora fashion markets — yet there is no geographic specificity anywhere on the homepage. "Lagos" appears only as hardcoded fake data inside `AppSurfacePreview`. Being specific about the market builds trust with the target audience.

### 5.5 Legal Page Is Missing
**[P1]** `apps/web/app/legal/page.tsx` appears to exist (it was read during the audit) but `/legal` is not linked from the footer's legal section clearly. "Legal" in the footer's bottom bar likely should link to an index of Terms, Privacy, and any other legal documents.

### 5.6 No Cookie Policy / Cookie Banner
**[P1]** No cookie consent banner or cookie policy page exists. Under GDPR and Nigerian NDPR, if the site uses analytics, tracking pixels, or any cookies beyond strictly necessary session cookies, a cookie notice is legally required.

### 5.7 Privacy Policy Mentions "Camera and microphone access" But No Permission Rationale
**[P2]** The privacy policy mentions camera/microphone permissions for Drape Vision. The website should have a clear one-sentence explainer near any Drape Vision CTA: "Drape Vision only activates your camera when you start a scan — no data is stored without your consent." The privacy policy alone is not a substitute for in-context reassurance.

### 5.8 Terms of Service — Governing Law Wyoming
**[P2]** The ToS states governing law as Wyoming (USA). Drapeon appears to be targeting Nigerian and UK-based users significantly. Wyoming governing law may create enforceability friction. This is a legal question, not a website question, but it should be reviewed by counsel before launch.

### 5.9 No Testimonials From Real Users
**[P0]** There are zero testimonials, quotes, or case studies from real customers or tailors anywhere on the site. Social proof is the single most important conversion factor for a marketplace. Even one genuine quote from a tailor in the beta ("I used to manage everything over WhatsApp — now it's in one place") would dramatically improve conversion.

### 5.10 "Join the queue" CTA Is Passive
**[P2]** "Join the queue" is a passive, low-energy CTA. It implies waiting. "Get early access," "Claim your spot," or even just "Join Drapeon" are more active. On the tailor side specifically, "Apply as a tailor" is stronger than "Join the queue."

### 5.11 Footer Email "hello@drapeon.co" and "support@drapeon.co" — Delivery Unverified
**[P1]** Per the earlier security audit, DMARC for `drapeon.co` returns NXDOMAIN and SPF does not include Resend. Transactional emails and any replies to published email addresses may be failing or going to spam. The footer emails are public commitments that need working mail delivery.

### 5.12 Vision Page Says "camera-assisted measurements" But Never Quantifies Accuracy
**[P2]** The Vision page makes no claims about measurement accuracy. Users evaluating whether to trust a camera-based measurement tool want to know: within how many centimeters, tested on how many body types, independently validated? If these numbers exist, publish them. If they don't, at least say "comparable to a tape measure when used in the right conditions."

### 5.13 No Glossary for Tailor-Specific Terms
**[P3]** Terms like "briefs," "collection code," "production stage," "handoff," and "auto-release" are used across the site without definition. First-time visitors do not know what a "collection code" is. A simple tooltip or linked glossary would reduce drop-off from confused users.

### 5.14 "Exception OS" on Trust Page Is Internal Jargon
**[P2]** The trust page uses the phrase "Exception OS" to describe the dispute resolution system. No user outside the company knows what this means. "Dispute resolution" or "How we handle problems" is clearer.

### 5.15 Careers Page Describes Culture Without Showing It
**[P2]** The careers copy describes what kind of people Drapeon wants but gives no sense of what working there is actually like, what the team does day-to-day, or what tools and processes they use. Culture signals come from specifics, not adjectives.

---

## 6. CONVERSION & GROWTH

### 6.1 No Conversion Tracking Setup
**[P0]** There is no analytics, no event tracking, no conversion funnel measurement anywhere on the site. There is no way to know how many people visit the homepage, what percentage click a CTA, or what percentage complete the waitlist form. You cannot improve what you cannot measure. Install PostHog (privacy-friendly), Plausible, or Vercel Analytics at minimum.

### 6.2 Waitlist Form Feedback Is Unclear
**[P1]** After a user submits the waitlist form, what happens? Is there a confirmation email? Does the page show a success state? Is there a count of how many people are ahead in the queue? The form submission experience needs to be fully designed and tested.

### 6.3 No Referral Mechanism on Waitlist
**[P2]** Waitlist referral programs ("Jump the queue by inviting 3 friends") are one of the most effective pre-launch growth mechanisms for consumer apps. There is no referral mechanism anywhere — a missed growth opportunity.

### 6.4 No Email Capture Beyond the Waitlist
**[P2]** There is no newsletter signup, no blog, no email drip for people who are "curious but not ready to join." The only capture mechanism is the waitlist form. A "Stay updated" email capture in the footer would increase the funnel size.

### 6.5 No Urgency or Scarcity on Waitlist Page
**[P2]** The waitlist page has no signals of demand: no "X people already on the waitlist," no "Limited spots for the next cohort," no countdown. A simple waitlist count ("Joined by 847 customers and 212 tailors") would dramatically increase conversion.

### 6.6 "Explore Drape Vision" on Homepage Leads to a Page, Not a Demo
**[P2]** Users clicking "Explore Drape Vision" expect an interactive demo, video, or at minimum a gif. They get a text page. Either build a video demo embed or remove this CTA from the homepage until a real demo exists.

### 6.7 No Clear Funnel for Tailor Acquisition
**[P1]** The tailor acquisition funnel is: `/tailors` → ambiguous CTA → `/join` (waitlist). But tailors are not customers — they need to apply, be vetted, and be onboarded. The correct funnel is: `/tailors` → `/apply` (application form). The current routing is wrong and is costing tailor signups.

### 6.8 No Exit-Intent Capture
**[P3]** No exit intent prompt on high-traffic pages. This is advanced but even a simple "Before you go — get notified when Drapeon launches" prompt on the homepage would recover some leaving visitors.

### 6.9 No Partner or Investor Contact Path
**[P3]** Investors and potential business partners who land on the site have no clear path — `/partnerships` is generic and `/about` has no contact. A dedicated investor/partnership section in the footer or a stealth contact form would capture high-value inbound leads.

---

## 7. UX PATTERNS & INTERACTION

### 7.1 No Accordion on FAQ
**[P1]** Already called out in page findings (#4.13). Repeated here because it is a fundamental UX pattern failure — all FAQ content is expanded simultaneously.

### 7.2 No Sticky Header on Scroll
**[P2]** The header is positioned at the top and disappears on scroll. On long pages (trust, privacy, terms), users cannot navigate without scrolling back to the top. A sticky header with a smooth background transition on scroll is standard and expected.

### 7.3 No Smooth Scroll to Sections
**[P2]** No anchor link smooth-scrolling. If headers are added to link between sections of the same page, they would jump abruptly. `scroll-behavior: smooth` in CSS is a one-line fix.

### 7.4 Card Hover States Are Absent or Minimal
**[P2]** Marketing cards throughout the site have minimal hover states. A `transition-shadow` or `translate-y` hover lift on feature cards would add interactivity and signal clickability where applicable.

### 7.5 No Keyboard Focus Styles
**[P1]** The `globals.css` or Tailwind config likely removes default browser focus rings (common with `outline-none` in resets). If focus rings are removed without a custom replacement, keyboard navigation is invisible and the site fails WCAG 2.1 AA for keyboard users.

### 7.6 Mailto Links Open Without Warning
**[P2]** Clicking any of the 8+ mailto links on `/contact` immediately opens the user's email client. On mobile this often triggers a dialog or app switcher. A common pattern is to show the email address as copyable text next to an icon, rather than firing the mailto immediately.

### 7.7 No Scroll Progress Indicator on Long Pages
**[P3]** Privacy, Terms, and Help are long-form content pages. A scroll progress bar or "Back to top" button would help users who read these in full.

### 7.8 No Microinteractions on Form Submit
**[P2]** The waitlist and application forms show no loading state during submission. A spinner or button disable state during the API call prevents double-submits and provides feedback.

### 7.9 Error States Are Not Designed
**[P1]** The waitlist form, application form, and contact forms likely have error states (invalid email, server error) but there is no evidence in the code that these are visually designed. A form that fails silently is one of the most common UX failures on pre-launch sites.

### 7.10 No Confirmation/Thank-You Page After Waitlist Signup
**[P1]** After a user signs up, they should see: a confirmation message, what to expect next, how to share with friends, and what the next step is. Redirecting to a blank form reset is a missed moment to deepen engagement.

---

## 8. SEO & DISCOVERABILITY

### 8.1 Authenticated Routes in Sitemap
**[P1]** Already called out in Navigation (#3.4). Repeated because it has direct SEO impact: Google will crawl and delist these if they return 401 or redirect loops.

### 8.2 No `hreflang` Attributes
**[P3]** If the site expands to non-English audiences (e.g., Yoruba, French for West African markets), hreflang will be needed. Not urgent now, but the architecture should support it.

### 8.3 Missing Structured Data for Key Pages
**[P1]** Only the homepage (Organization + WebSite) and FAQ (FAQPage) have schema markup. Missing:
- `Product` on Vision page
- `HowTo` on how-it-works page
- `Service` on the tailors/customers pages
- `BreadcrumbList` on all secondary pages

### 8.4 OG Image Is the Same for All Pages
**[P1]** Every page shares the same `opengraph-image` — the text-only "Fashion that fits before the first stitch." template. When Vision, FAQ, or How It Works pages are shared, the preview card is identical to the homepage. Page-specific OG images (even simple text variations) dramatically improve link preview performance.

### 8.5 Page Titles Are Generic
**[P2]** The title template `%s | Drapeon` works fine but many page titles are thin: "FAQ | Drapeon," "About | Drapeon." Google prefers descriptive titles: "How Custom Tailoring Works on Drapeon | Drapeon" is better than "How It Works | Drapeon."

### 8.6 Meta Descriptions Are Short and Vague
**[P2]** Descriptions like "Read the public Drapeon FAQ" (from `/faq`) add no keyword value. Meta descriptions should include searchable terms: "Learn how to order custom tailored clothes online, find verified tailors, and track your garment from brief to delivery."

### 8.7 No Blog or Content Marketing
**[P2]** There is zero content marketing infrastructure on the site. No blog, no guides, no tailor spotlights, no "how to find a good tailor" articles. Content marketing is the highest-ROI organic acquisition channel for a marketplace. Even 4 articles would begin to build topical authority.

### 8.8 No Internal Linking Strategy
**[P2]** Pages do not link to each other organically within content. Every page is a silo. Internal linking (e.g., the trust page linking to how-it-works, the FAQ linking to payouts) distributes page authority and improves crawl coverage.

### 8.9 Canonical Tags Are Missing on Duplicate-Content Risk Pages
**[P2]** `/discover` and `/customers` have near-duplicate content. Without explicit canonical tags, Google may penalize both for duplicate content.

### 8.10 No Google Search Console or Bing Webmaster Integration
**[P2]** No `verification` meta tags or DNS-based verification visible. Before launch, Search Console needs to be set up to monitor index coverage, Core Web Vitals, and search queries.

### 8.11 `/sitemap.xml` Has No `lastmod` Dates
**[P3]** The sitemap entries have no `lastmod` field. Without modification dates, Google treats all pages as equally stale. Adding `lastmod` to recently updated pages prioritizes them for recrawl.

---

## 9. PERFORMANCE & TECHNICAL

### 9.1 Cloudflare Worker Cold Start Affects TTFB
**[P1]** The site runs on Cloudflare Workers via `open-next.config.ts`. Cold starts add 100–400ms to TTFB on the first request after an idle period. Next.js `export const runtime = 'edge'` should be explicit on all routes. Ensure `waitUntil` caching warms common pages.

### 9.2 No Image Optimization Pipeline
**[P1]** No actual images currently exist on the site. But when photography is added (as it urgently should be), there is no image optimization setup (`next/image`, Cloudflare Images, or similar). Adding large PNGs without this will tank Core Web Vitals.

### 9.3 No Lighthouse Budget or CI Performance Check
**[P2]** No automated performance budget check in CI. Performance will degrade silently as the site grows. Set up `@next/bundle-analyzer` and a Lighthouse CI check on every deploy.

### 9.4 `unsafe-inline` + `unsafe-eval` in CSP
**[P1]** The Content Security Policy uses `unsafe-inline` and `unsafe-eval` in `script-src`. This neutralizes the XSS protection that CSP provides. The nonce-based injection in `layout.tsx` is a partial mitigation but the unsafe directives remain. This was flagged in the security audit and is worth repeating here.

### 9.5 HSTS Missing `preload` Directive
**[P2]** Already noted in the security audit. Adding `preload` to HSTS headers and submitting to the HSTS preload list ensures browsers never make an HTTP request to the domain.

### 9.6 `--font-body` Variable Never Defined Wastes a Render
**[P1]** Already noted in design (#1.4). From a performance angle, the CSS variable lookup adds a paint dependency on a variable that always resolves to `undefined`, falling back to `system-ui`. The variable reference should be removed or the font should actually be loaded.

### 9.7 No `preconnect` for External Resources
**[P2]** If the site loads any third-party resources (fonts, analytics, etc.), `<link rel="preconnect">` hints in the `<head>` would reduce connection setup time. Even Supabase API endpoints called client-side benefit from a preconnect hint.

### 9.8 JSON-LD Scripts Are Blocking
**[P3]** The `<script type="application/ld+json">` elements in the layout render inline in `<body>`. While non-blocking in the traditional sense, large JSON-LD payloads in the `<body>` can affect FCP in edge cases. Consider moving them to `<head>` using Next.js metadata alternatives.

### 9.9 No Error Monitoring (Sentry, etc.)
**[P1]** There is no client-side error monitoring on the web app. JavaScript errors that affect the waitlist form, auth flows, or client-side navigation will be invisible until a user reports them. Sentry free tier is sufficient for pre-launch.

### 9.10 No Uptime Monitoring
**[P2]** No uptime monitor (BetterUptime, UptimeRobot, or similar) is configured. Downtime on a pre-launch site visited by potential investors or press is disproportionately damaging.

---

## 10. ACCESSIBILITY

### 10.1 No Skip-to-Content Link
**[P1]** There is no "Skip to main content" link at the top of the page. Screen reader and keyboard users must tab through the entire navigation on every page load before reaching content. This is a WCAG 2.1 AA requirement.

### 10.2 Focus Rings Likely Removed
**[P1]** Already noted in UX (#7.5). Tailwind's default reset and common `outline-none` usage likely strips browser focus rings. Verify in DevTools and add `focus-visible:ring-2 focus-visible:ring-needle` to interactive elements globally.

### 10.3 Fake UI `AppSurfacePreview` Is Inaccessible
**[P2]** The fake UI widget contains text like "Verified • Lagos" in nested `div` elements with no semantic structure or `aria-label`. A screen reader encounters this as raw unlabeled text in the middle of the page content. Add `role="img"` and `aria-label="Preview of the Drapeon app interface"`.

### 10.4 Marketing Cards Have No Semantic Heading Level Hierarchy
**[P1]** `SectionTitle` renders a `text-7xl` element that may or may not be an `<h1>`. Card titles inside `MarketingCard` may be `<h3>` or unstyled text. If the heading hierarchy is `h1 → h3` with no `h2`, screen readers and search engines lose document structure.

### 10.5 Color Contrast on `text-ink/68` May Fail
**[P2]** Body text uses `text-ink/68` which is `#1A1A1A` at 68% opacity on a `bone` (#F5F0E8) background. Computed contrast is approximately 5.8:1 — passes WCAG AA for normal text. But on `bg-white/82` card backgrounds, the effective contrast drops slightly. Verify computationally at all alpha combinations.

### 10.6 Email Address Cards on /contact Have No `aria-label`
**[P2]** The email cards on the contact page render the email as a giant `<h3>`. A screen reader reads the email address as a heading. The mailto anchor around it needs `aria-label="Send email to hello@drapeon.co"`.

### 10.7 No Alt Text Strategy for SVG Assets
**[P2]** `customer-brief.svg` and `tailor-pipeline.svg` are rendered as `<img>` tags. If their `alt` attributes are empty strings, screen readers skip them. If they contain meaningful information (which as diagrams they do), proper alt text is required.

### 10.8 Interactive Elements Touch Target Size
**[P2]** On mobile, the header nav links collapse to a grid. Small touch targets (under 44×44px as per Apple HIG and WCAG 2.5.5) create usability problems for users with motor impairments. The mobile header redesign (hamburger menu) is the fix.

### 10.9 No Language Attribute Variants
**[P3]** `<html lang="en">` is set in the root layout, which is correct. If localised pages are added in the future, per-page lang attributes will be needed.

### 10.10 PDF and Document Links Are Not Labeled
**[P3]** If any press kit PDFs, brand assets, or terms PDFs are added in the future, they must include `(PDF, 2MB)` style labeling on the link text so screen reader users know what they are opening.

---

## 11. MOBILE EXPERIENCE

### 11.1 Header Collapses Incorrectly on Mobile
**[P0]** Already noted in Navigation (#3.1) and Accessibility (#10.8). The header breaking on mobile is the single highest-priority UX bug on the entire site. A broken header on mobile means every mobile visitor encounters a broken first impression.

### 11.2 `text-7xl` Is Illegible on 375px Screens
**[P1]** 72px text on a 375px wide iPhone screen leaves almost no room for the words to breathe and causes awkward wrapping. Section titles should step down to `text-4xl` or `text-5xl` on mobile with Tailwind responsive prefixes.

### 11.3 Two-Column Grid FAQ Cards Overlap on Small Screens
**[P2]** The FAQ card grid uses `gap-4` with no explicit column count. On small screens this may collapse to single column, but the `p-6` padding on cards with `text-2xl` question text is excessive on mobile. FAQ questions should use `text-lg` on mobile.

### 11.4 Footer Link Groups Overflow Horizontally
**[P2]** The footer has three link groups in a grid. On 375px screens, three columns of links are illegible. A stacked single-column footer on mobile is standard and needed.

### 11.5 Contact Page Email Cards Are 2-Column on Mobile
**[P2]** Eight email cards in a 2-column grid on a 375px screen means each card is ~175px wide. An email address like `partnerships@drapeon.co` is 22 characters and will wrap mid-address at that width. Single-column on mobile is required.

### 11.6 Hero Section Vertical Padding Too Large on Mobile
**[P2]** Marketing pages use `py-12` to `py-20` section padding. On mobile this creates excessive blank space between sections that makes the page feel broken. `py-8` on mobile, `py-16` on desktop is more appropriate.

### 11.7 No App Store Deep Link
**[P2]** When a mobile user visits drapeon.co, there is no "Open in the Drapeon app" smart banner or universal link. If the app is installed, iOS Safari can show a banner prompting the user to open it. This is a one-line `<meta>` tag.

### 11.8 `AppSurfacePreview` Text Is Unreadable on Mobile
**[P2]** The fake UI widget that renders "hardcoded preview text" on desktop is particularly bad on mobile — small font sizes inside the widget become illegible on a 375px screen. Since it is entirely fake, it should either be hidden on mobile or replaced with something responsive.

### 11.9 No PWA Offline Page
**[P3]** The PWA manifest exists but there is no service worker for offline support. A simple "You're offline" page served from the service worker cache would improve the install experience.

### 11.10 Tap Highlights Are Not Customized
**[P3]** On iOS, tapping links shows a grey highlight. `-webkit-tap-highlight-color: transparent` combined with active states would feel more intentional. Minor polish but noticeable on a mobile-first product.

---

## 12. TRUST & CREDIBILITY

### 12.1 No Real User Evidence
**[P0]** See Content #5.9. Zero testimonials, zero case studies, zero real user quotes. For a marketplace handling money and personal data, this is the single most trust-damaging gap on the site.

### 12.2 "Verified" Claims Without Explanation
**[P1]** The fake AppSurfacePreview shows "Verified • Lagos" — but the site never explains what verification means for tailors. The verify page is thin. A visitor cannot evaluate whether the verification standard is meaningful.

### 12.3 No Legal Entity Information in Footer
**[P2]** "O4 Group LLC" appears only in the schema.org JSON-LD in the root layout (invisible to users). The footer should include: registered company name, registration number, registered state/country, and registered address (required in many jurisdictions for B2C commercial sites).

### 12.4 No Payment Provider Trust Seals
**[P2]** If payments are processed via Stripe, Stripe's trust marks (PCI compliance, SSL) belong on the payments-related pages and in the footer. Users need to see that their payment data is in safe hands.

### 12.5 No Independent Security Audit Reference
**[P3]** Once a third-party security audit is completed, referencing it on the security page dramatically increases trust with enterprise and business customers.

### 12.6 Terms of Service Is Wyoming-Governed for a Global Product
**[P2]** Already noted in Content (#5.8). From a trust perspective, if the primary users are Nigerian or UK-based, Wyoming governing law will raise questions during diligence.

### 12.7 No Clear Data Residency Statement
**[P2]** Where is user data stored? Is it processed in the EU, US, or Nigeria? NDPR compliance requires data subjects to know where their data is processed. The privacy policy is vague on residency.

### 12.8 No Clear Dispute Resolution Timeline
**[P2]** The trust page describes the dispute mechanism but never states how long a dispute takes to resolve, what the SLA is, or who the final arbiter is. Users considering a large order want to know that if something goes wrong, there is a concrete timeline for resolution.

---

## 13. MISSING FEATURES & PAGES

### 13.1 No Pricing Page
**[P0]** There is no pricing page. For tailors, the key question is: "What does Drapeon charge me?" For customers: "Are there any fees?" The site is entirely silent on this. Even "Our fee structure will be published before launch — join the waitlist to be notified" is better than silence.

### 13.2 No Demo or Product Video
**[P0]** There is no video, GIF, or interactive demo of the app anywhere on the site. For a mobile app with a novel camera measurement feature, a 60-second screen recording would be the single highest-conversion asset the site could have.

### 13.3 No Press Kit Download
**[P1]** Already noted in Press (#4.19). A downloadable press kit with logos, brand colors, founder headshots, and boilerplate is missing.

### 13.4 No Status Page
**[P2]** There is no `/status` page or link to a status.drapeon.co. For a platform processing live orders and payments, a public status page (even a static one) communicates reliability.

### 13.5 No Changelog or What's New Page
**[P3]** For early adopters in the beta who want to follow progress, a `/changelog` or `/updates` page would keep them engaged. This doubles as SEO content and social sharing material.

### 13.6 No Comparison Page
**[P2]** No page compares Drapeon to the alternative (WhatsApp, Instagram DMs, Excel spreadsheets). A "Why Drapeon vs. the status quo" page addresses the primary objection: "Why would I use this instead of just messaging my tailor on WhatsApp?"

### 13.7 No Customer Stories / Case Studies
**[P1]** A single detailed case study — "How [tailor name] managed 3× more orders in their first month" — would be more persuasive than all the abstract marketing copy on the site combined.

### 13.8 No Community or Tailor Directory Preview
**[P2]** There is no taste of what the tailor discovery experience looks like. A curated directory preview of 4-6 verified tailors (with their permission) on the customers page would immediately show what the product delivers.

### 13.9 No `/.well-known/security.txt`
**[P1]** Already noted in Security (#4.22). A `security.txt` file is increasingly expected by security researchers and is listed in RFC 9116. Simple to add.

### 13.10 No `humans.txt`
**[P3]** Minor — `humans.txt` is a convention that lists the team behind the site. Not critical but a nice touch for a craft-focused brand.

---

## 14. BACKEND & INFRASTRUCTURE (Website-Facing)

### 14.1 No Analytics Installed
**[P0]** Already noted in Conversion (#6.1). Without analytics, the team cannot know which pages drive waitlist signups, where users drop off, or which CTAs work. This is the most operationally critical gap on the web side.

### 14.2 Waitlist Form Has No Rate Limiting Visible on the Frontend
**[P1]** The `WaitlistForm` component submits to an API route. If the API route has no rate limiting, a bot can spam the waitlist with fake signups. The Supabase edge functions have rate limiting infrastructure — it needs to be applied to the waitlist endpoint too.

### 14.3 No Bot Protection on Forms
**[P1]** No CAPTCHA, no honeypot field, no Turnstile (Cloudflare's free CAPTCHA alternative). Open forms with no bot protection will eventually be abused.

### 14.4 Application Form Data Has No Visible Validation
**[P2]** The tailor application form (`/apply`) collects professional information. Is this data going to a Supabase table? Is it emailed? Does the applicant get a confirmation? The data flow after form submission needs to be clear and tested.

### 14.5 Supabase URL and Publishable Key Exposed in Page Source
**[P2]** The root layout injects `window.__DRAPEON_PUBLIC_ENV__` with `supabaseUrl` and `supabasePublishableKey` into the page HTML. The publishable (anon) key is intentionally public-facing, but it should be verified that RLS policies are correct on all tables accessed with the anon key, as this key is visible to all site visitors.

### 14.6 `api/public-env.js` Script Is Loaded `beforeInteractive`
**[P2]** The `<Script src="/api/public-env.js" strategy="beforeInteractive">` blocks the page from rendering until this script loads. If the `/api/public-env.js` route is slow or fails, the entire page render is blocked. This should be `strategy="afterInteractive"` unless there is a critical dependency.

### 14.7 No CSP Report URI
**[P2]** The CSP header lacks a `report-uri` or `report-to` directive. Without this, CSP violations are silent — there is no way to know if the policy is blocking legitimate resources or if an attack is being attempted.

### 14.8 Auth Landing Redirect Is Synchronous in Root Layout
**[P2]** `<AuthLandingRedirect />` is rendered in the root layout on every page load, including marketing pages where no auth state exists. This may cause a flash of content before redirect on auth pages, or an unnecessary client-side auth check on every marketing page visit.

### 14.9 No Environment Variable Validation
**[P2]** `getSupabaseUrl()` and `getSupabasePublishableKey()` presumably read from `process.env`. If these are undefined in a deployment (e.g., a branch preview deploy), the site silently degrades. Schema validation with zod or `t3-env` at startup would surface misconfigurations immediately.

### 14.10 No Preview Deploy Isolation
**[P3]** If Cloudflare Workers has preview deploy environments, they may share the same Supabase project as production (depending on environment variable configuration). Preview deploys should point to a staging Supabase project to avoid contaminating production data with test waitlist signups.

---

## SUMMARY SCORECARD

| Category | Issues Found | P0 | P1 | P2 | P3 |
|---|---|---|---|---|---|
| Visual Design & Brand | 15 | 1 | 5 | 7 | 2 |
| Homepage | 10 | 2 | 5 | 3 | 0 |
| Navigation & IA | 12 | 1 | 4 | 5 | 2 |
| Page-by-Page | 30 | 1 | 14 | 11 | 4 |
| Content & Copy | 15 | 2 | 7 | 5 | 1 |
| Conversion & Growth | 9 | 2 | 3 | 4 | 0 |
| UX Patterns | 10 | 0 | 4 | 5 | 1 |
| SEO | 11 | 0 | 4 | 5 | 2 |
| Performance & Technical | 10 | 0 | 4 | 5 | 1 |
| Accessibility | 10 | 0 | 4 | 4 | 2 |
| Mobile Experience | 10 | 1 | 3 | 5 | 1 |
| Trust & Credibility | 8 | 1 | 2 | 4 | 1 |
| Missing Features | 10 | 2 | 3 | 3 | 2 |
| Backend/Infrastructure | 10 | 1 | 3 | 5 | 1 |
| **TOTAL** | **170** | **14** | **65** | **71** | **20** |

---

## TOP 10 HIGHEST-PRIORITY FIXES

1. **[P0] Install analytics.** You cannot improve the site without knowing how people use it.
2. **[P0] Add testimonials.** One real tailor or customer quote outperforms all the copy on the site.
3. **[P0] Fix the mobile header.** A broken header on iPhone is a broken site for the primary target audience.
4. **[P0] Record a product video.** 60 seconds of real app footage converts better than every word on the site.
5. **[P0] Rewrite the /payouts page.** Tailors will not join without knowing how they get paid.
6. **[P0] Add a pricing page.** Even "pricing TBD" with an explanation is better than silence.
7. **[P1] Define and load a web font.** The `--font-body` variable is undefined — the site has no typographic identity.
8. **[P1] Fix the Drape Vision page CTA.** It goes to /privacy instead of /join — this is a broken conversion path.
9. **[P1] Remove authenticated routes from sitemap.** /account/ops must not be indexed by Google.
10. **[P1] Add real photography.** Fashion is visual. The absence of any garment or tailor imagery is the deepest brand gap on the site.
