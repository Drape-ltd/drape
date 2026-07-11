# Drapeon.co — World-Class Web Suggestions
**200 specific improvements across design, UX, content, performance, conversion, and brand**

---

## A. TYPOGRAPHY & VISUAL FOUNDATION

1. **Load a real web font.** Pick one strong sans-serif — Inter, Geist, or a more distinctive choice like Neue Haas Grotesk — and define `--font-body` in `globals.css`. Every render is currently different per device.
2. **Add a display/editorial font.** Use a serif (e.g., Playfair Display, Cormorant) for hero headlines only. Serif contrast against a geometric sans is the typographic signature of premium fashion brands.
3. **Scale headlines down on mobile.** `text-7xl` at 375px is 72px — too large for mobile. Implement `text-4xl md:text-6xl lg:text-7xl` everywhere `SectionTitle` is used.
4. **Set a line-height baseline.** Body text should use `leading-7` or `leading-relaxed` globally. Currently inconsistent between sections.
5. **Add proper letter-spacing to headings.** Large headings at `text-7xl` need slight negative tracking: `tracking-tight` or `-0.02em`.
6. **Separate display text from UI text with font-weight.** Use `font-light` (300) for editorial hero text and `font-medium` (500) for UI labels. Right now almost everything is the same weight.
7. **Add a numeric font-variant.** Where prices, order numbers, or dates are shown, enable `font-variant-numeric: tabular-nums` so numbers align cleanly.
8. **Create a text scale as a design token.** Document the 6-step type scale in `tailwind.config.ts` as named sizes: `display`, `heading`, `subheading`, `body`, `caption`, `label`. Stop using raw size classes directly.
9. **Add `text-balance` to headings.** CSS `text-wrap: balance` prevents awkward one-word-per-line orphans in headlines. One line in `globals.css`.
10. **Distinguish `text-ink/68` from `text-ink/50`.** Body text and helper text currently look identical. Lower the opacity of helper text further or use a size difference to create a clear visual hierarchy.

---

## B. COLOR & VISUAL IDENTITY

11. **Use `needle` as a section accent color, not just a pill background.** Apply a `border-l-4 border-needle` or a `bg-needle/8` wash on feature sections to create brand-colored anchors in the layout.
12. **Add `rust` as an action/emphasis color.** Currently rust is barely used. Make it the color for primary CTA buttons sitewide — it is warm, distinctive, and contrasts well on bone backgrounds.
13. **Create a CSS variable for each palette color.** `--color-needle`, `--color-rust`, `--color-bone`, `--color-ink`. This lets you theme or adjust the entire site from one place.
14. **Add a dark section background color.** The homepage has one dark section. Give it a proper `needle`-tinted dark background (e.g., `#0d2018`) instead of generic black/gray.
15. **Design a proper gradient system.** Replace the random radial gradient with a named set: `gradient-hero` (bone → white), `gradient-dark` (needle-dark → ink), `gradient-accent` (needle/10 → transparent).
16. **Give the logo a color version and a white version.** For use on both light and dark backgrounds — currently the same mark is used on all backgrounds.
17. **Create an icon set.** Use a single consistent icon library (e.g., Lucide, Heroicons, or a custom set). Right now different sections may use different icon styles.
18. **Add a pattern/texture element.** A subtle fabric texture (SVG noise, linen pattern) behind certain sections would reinforce the tailoring brand story.
19. **Design a proper illustration style.** Commit to either flat geometric illustrations or line-art with fabric/garment motifs. The two SVG diagrams (`customer-brief.svg`, `tailor-pipeline.svg`) should follow the same style.
20. **Add brand motion guidelines.** Decide on easing curves: ease-out for entrances, ease-in-out for hover transitions. Use `transition-all duration-200 ease-out` consistently rather than ad-hoc durations.

---

## C. HOMEPAGE

21. **One hero CTA.** Remove "Explore Drape Vision" and "Account access" from the hero. One button: "Get early access." Full stop.
22. **Add a concrete value proposition line in the hero.** Below the headline, add: *"Find a verified tailor → submit your brief → track every stage → collect your garment."* Concrete steps beat abstract language every time.
23. **Replace `AppSurfacePreview` with a device mockup.** Use a Figma-exported iPhone frame SVG with a screenshot of the actual app (or a high-fidelity mockup). Put it in the hero.
24. **Add a social proof bar below the hero.** A single row: "847 customers · 212 verified tailors · 14 countries" — or whatever the real numbers are. Even rough numbers beat zero.
25. **Add a "How it works" summary inline on the homepage.** A horizontal 4-step strip (icons + labels) lets visitors understand the product without clicking away.
26. **Add a testimonial carousel.** At least 3 rotating quotes from real beta users. If none exist, get them before launch — this is non-negotiable for a marketplace.
27. **Replace the dark "Trust layer" section with specific trust signals.** Instead of vague copy, show: "Payments held in escrow until delivery confirmed" + "Verified ID for every tailor" + "14-day automatic dispute window." Each with a small icon.
28. **Add an FAQ accordion to the homepage.** 4 key questions (What is Drapeon? How does payment work? Can I pick up in person? Is it free to join?) with short answers — reduces support volume and increases conversion.
29. **Add a "Featured tailors" preview section.** 3 tailor cards with name, specialty, and location. Even if anonymous ("Lagos · Menswear · Verified") it demonstrates a real product.
30. **Add a "Press & mentions" logo bar.** Even one logo (a blog that wrote about you, a newsletter that mentioned Drapeon) gives social proof. If nothing, skip this until you have something.
31. **Add a sticky "Join the waitlist" banner that appears on scroll.** Appears after the user scrolls 300px. Dismissable. Captures intent from users who read the whole page.
32. **Show a waitlist counter.** Dynamic number of signups displayed on the homepage CTA. Implement as a server-side render from Supabase count query.
33. **Add a video embed section.** A 60-second screen recording of the app (Loom, YouTube unlisted, or native `<video>` tag) embedded below the hero with a play button overlay.
34. **Differentiate the two audiences on the homepage.** Split the mid-section into two clear lanes: "For customers" and "For tailors" with separate feature highlights and separate CTAs.
35. **Add a map or "Where we operate" section.** Even a stylized SVG world map with dots on Lagos, London, Accra, Toronto signals geographic ambition and specificity.

---

## D. NAVIGATION

36. **Add a hamburger menu for mobile.** A Radix UI Dialog or a simple CSS drawer that opens on tap. The entire site breaks on iPhone without this.
37. **Add active states to nav links.** `usePathname()` from Next.js. Current page gets `text-needle font-semibold`.
38. **Make the header sticky.** `position: sticky; top: 0; z-index: 50` with a backdrop blur on scroll: `backdrop-blur-md bg-bone/90`.
39. **Add a scroll progress indicator to the header.** A 2px `needle`-colored line that fills left-to-right as the user scrolls. Especially valuable on long pages (Privacy, Terms, Trust).
40. **Differentiate "Sign in" from "Create account" visually.** "Create account" = filled rust button. "Sign in" = ghost link. Standard conversion hierarchy.
41. **Add a "For tailors" dropdown or mega-menu item.** `/tailors`, `/apply`, `/verify`, `/payouts` grouped under one nav item — makes the tailor acquisition funnel discoverable.
42. **Add a keyboard shortcut for search.** `Cmd+K` opens a command palette that searches pages and help content. Linear and Vercel have trained users to expect this.
43. **Remove `/account/**` from the sitemap.** Authenticated routes must not be indexed.
44. **Add `Disallow: /account/` to robots.txt.** And `Disallow: /api/`.
45. **Add a "Back to top" floating button.** Appears after 600px scroll on long pages. A small circular button bottom-right, uses `window.scrollTo({ top: 0, behavior: 'smooth' })`.
46. **Add breadcrumbs to all secondary pages.** `Home / Tailors / Apply` — improves both orientation and SEO.
47. **Add social links to the footer.** At minimum Instagram and Twitter/X. These are also signals of real business presence.
48. **Restructure the footer into 4 clear columns.** Product · For Tailors · Company · Legal. Currently the link groupings are arbitrary.
49. **Make footer contact emails copyable instead of mailto.** Show the address + a "Copy" button (clipboard API). Reduces accidental mail client launches on mobile.
50. **Add "O4 Group LLC · Registered in Wyoming" to the footer bottom bar.** Legal entity visibility is required in many markets and expected by sophisticated users.

---

## E. PHOTOGRAPHY & MEDIA

51. **Commission a brand photography shoot.** 20–30 images: tailors at work, garments, measuring tape, fabric, a completed piece. This alone transforms the site.
52. **Build an art direction system.** Define shot styles: "warm light on dark fabric," "hands at work," "customer receiving garment." Consistency across images makes the brand feel intentional.
53. **Add a hero background image or half-split image layout.** Right side = photography, left side = headline and CTA. Classic magazine editorial layout.
54. **Use `next/image` for all images.** Automatic WebP/AVIF conversion, lazy loading, intrinsic size hints. Required before adding any photography.
55. **Add a Cloudflare Images transform pipeline.** For user-uploaded portfolio photos and tailor profile images, run through Cloudflare Images for resizing and optimization.
56. **Create page-specific hero imagery.** Vision page → a hand holding a phone with a measurement overlay. Tailors page → a tailor at a sewing machine. About page → the founding team.
57. **Add a short brand video (15–30 seconds) as the site header background.** Looping, muted, with a overlay. A tailor pinning fabric, a customer picking up a garment. No dialogue needed.
58. **Add animated illustrations for the how-it-works steps.** CSS or Lottie animations: step 1 shows a form being filled, step 2 shows a quote arriving, etc.
59. **Add a garment gallery section.** 6 image tiles showing garments made through Drapeon (with tailor permission). Pinterest-style masonry grid.
60. **Add before/after or "in progress" imagery.** Fabric → construction → finished piece. The production story is what differentiates Drapeon from buying ready-made clothes.

---

## F. CONTENT & COPY

61. **Write concrete benefit statements instead of feature labels.** Not "Order tracking" — "Know where your garment is every day, without chasing anyone on WhatsApp."
62. **Name the target customer explicitly on the homepage.** "For anyone who has ever been let down by ready-to-wear, or frustrated trying to coordinate with a tailor over DMs."
63. **Write a genuine founder note.** 3–4 paragraphs on /about: why this problem, what was broken in the existing workflow, what Drapeon is trying to fix. Signed by the founder, with a photo.
64. **Rewrite all FAQ answers with actual specifics.** Length of verification, documents required, supported currencies, collection code mechanics, dispute timeline.
65. **Add a "What makes Drapeon different" section.** Explicit comparison to the status quo: "Before Drapeon: WhatsApp threads, lost measurements, payment via bank transfer. With Drapeon: ___."
66. **Resolve "Drapeon" vs "Drape" naming publicly.** Add a one-line footnote or an FAQ entry: "The app is called Drape. The platform and brand are Drapeon."
67. **Rewrite the Vision page to lead with capability, not process.** Lead: "Drapeon measures your body with your phone camera — no tape measure, no estimating." Then explain how.
68. **Quantify Drape Vision accuracy on the vision page.** Even "within 1–2cm on most measurements under good lighting" is honest and reassuring.
69. **Write a "Tailor's guide to Drapeon" as a standalone page.** Step-by-step from application to first order received to payout. This is the most important piece of content for tailor acquisition.
70. **Write a "Customer's guide to your first order" as a standalone page.** What to put in a brief, how to give references, what happens if the garment needs alterations.
71. **Add a glossary page.** Define: brief, collection code, production stage, handoff, auto-release, escrow, verified tailor. Link to it from /help and /faq.
72. **Replace "Join the queue" CTA everywhere with "Get early access."** More active. Less passive. Same action, better energy.
73. **Replace "Choose your side" on /join with "How are you joining Drapeon?"** Customer / Tailor — simple, clean, not combative.
74. **Add microcopy to all form fields.** Under the email field: "We'll only email you about your waitlist spot — no marketing spam." Under name: "How should we address you when your spot opens?"
75. **Add a "What happens next" section after waitlist signup.** Step 1: You're in. Step 2: We review your region's availability. Step 3: You receive an invite with setup instructions.
76. **Remove "Exception OS" from all public pages.** Replace with "Dispute resolution" or "How we handle concerns."
77. **Remove "App Parity" section title from the homepage.** Replace with "One product, two sides — customer and tailor."
78. **Remove "When Signal Is Weak" heading from /help.** Replace with "Connectivity and camera troubleshooting."
79. **Add country-specific landing pages.** `/ng` for Nigeria, `/uk` for UK. Different hero copy, local currency references, local tailor names. Big SEO and conversion lift.
80. **Add a "Common objections" section on the /tailors page.** "I already have enough customers." / "I don't trust online platforms." Acknowledge and address the real objections explicitly.

---

## G. CONVERSION & GROWTH

81. **Add Plausible Analytics.** Privacy-friendly, GDPR-compliant, no cookie banner needed. 1 script tag in layout.
82. **Add PostHog for funnel analysis.** Track: homepage → waitlist form view → form submit → confirmation. Identify where drop-off occurs.
83. **Add a referral program to the waitlist.** "Skip the queue: invite 3 people." Use a simple token-based system. Viral loop from day one.
84. **Show a live waitlist count on /join.** Computed from Supabase. "Joined alongside 1,204 others." Updates on page load.
85. **Add a confirmation/thank-you page after waitlist signup.** Not a form reset — a dedicated `/joined` page with: your spot number, a shareable referral link, what to expect next.
86. **Send a waitlist confirmation email.** Triggered immediately after signup. "You're on the Drapeon list — here's what happens next." Builds the email channel.
87. **Add a 7-day email drip sequence for new waitlist signups.** Day 1: Welcome + what Drapeon is. Day 3: Feature highlight (Drape Vision). Day 5: Tailor spotlight. Day 7: Invite a friend.
88. **Add a "Stay updated" email capture to the footer.** Separate from the full waitlist form — just an email field for people who want updates without committing to joining.
89. **Add UTM tracking to all external links and social bios.** Know which channels drive the most signups.
90. **A/B test the primary CTA copy.** "Get early access" vs. "Join Drapeon" vs. "Claim your spot." Plausible or PostHog can run this.
91. **Add a countdown or "cohort closing" mechanism.** "First cohort opens in X days." Creates urgency without being dishonest.
92. **Add a "Tailor spotlight" series.** Monthly blog post or page featuring a verified tailor. SEO value + social sharing + tailor retention.
93. **Link Instagram/TikTok content to the site.** If you post garment photos on social, embed or link them on the homepage. Cross-pollinates audiences.
94. **Add an affiliate or ambassador program page.** Fashion influencers who recommend Drapeon to their audience get a referral credit or commission. Acquisition channel.
95. **Add a "Powered by Drapeon" badge for tailors.** Tailors can add a badge to their Instagram bio or personal site linking to their Drapeon profile. Inbound marketing.

---

## H. UX PATTERNS

96. **Add an accordion component to the FAQ pages.** Single open at a time. Smooth height transition with CSS `grid-template-rows` animation.
97. **Add skeleton loading states to all data-fetching components.** Animated shimmer on waitlist form, any counters, and any dynamically loaded content.
98. **Add form field validation inline (not just on submit).** Email format, name length, etc. validated on blur. Green checkmark on valid, red border + message on invalid.
99. **Add a loading spinner to form submit buttons.** Disable on click, show spinner, re-enable on response. Prevents double-submit.
100. **Add form auto-save to the tailor application.** The `/apply` form is long. Auto-save to `localStorage` so applicants don't lose progress if they close the tab.
101. **Add a "copy to clipboard" button on all email addresses.** Small clipboard icon next to every email address on /contact and in the footer.
102. **Add a "Share this page" button on /trust, /how-it-works, and /vision.** Native Web Share API on mobile. Fallback to copy-link on desktop.
103. **Add hover cards on tailor name references.** If any tailor is mentioned by name anywhere on the site, a hover card showing their specialty and location adds richness.
104. **Add smooth page transitions.** Next.js App Router + `framer-motion` `<AnimatePresence>` for route transitions. Fade in/out. Makes the site feel like a product, not a document.
105. **Add a "progress saved" toast for long forms.** When auto-save triggers, show a 2-second toast: "Progress saved."
106. **Replace all plain `<a>` mailto links with a contact modal.** A modal with a short form (name, email, message, topic selector) that submits to a Supabase table and sends an email. No more raw mailto.
107. **Add keyboard shortcuts to the site.** `G H` = go home. `G J` = go to join. `G T` = go to tailors. Cmd+K command palette. Sophisticated users love this.
108. **Add a "Send to phone" feature on the app download CTA.** User enters their phone number, gets an SMS with a TestFlight or App Store link. Converts mobile-intent on desktop.
109. **Add a "Compare customer vs tailor" toggle on the homepage.** Switches the feature section between the two perspectives with an animated transition.
110. **Add micro-animations to the step indicators on /how-it-works.** Numbers that fill on scroll-into-view. Signals progress and holds attention.

---

## I. PERFORMANCE

111. **Set `export const runtime = 'edge'` on all marketing route files.** Ensures Cloudflare edge routing, not a cold Node.js start.
112. **Add `<link rel="preconnect">` for Supabase URL.** Reduces DNS lookup time for any client-side Supabase calls on auth pages.
113. **Enable Cloudflare's Brotli compression.** Reduces HTML/CSS/JS transfer size by ~25% over gzip.
114. **Add a Lighthouse CI check to the GitHub Actions workflow.** Fail the build if Performance score drops below 85. Keeps the site fast as it grows.
115. **Add `@next/bundle-analyzer`.** Run it quarterly. Identify and remove unused packages.
116. **Lazy-load images below the fold.** Use `loading="lazy"` on all `<img>` tags outside the hero viewport.
117. **Add `fetchpriority="high"` to the hero image.** The above-the-fold hero image should load with priority. This is a one-attribute LCP improvement.
118. **Move JSON-LD schemas to Next.js `metadata` where possible.** Reduces inline `<script>` block in the `<body>`.
119. **Add resource hints for critical CSS.** `<link rel="preload" as="style">` for the main stylesheet if it's not already inlined.
120. **Cache the public environment script.** `api/public-env.js` should return `Cache-Control: public, max-age=3600` since the Supabase URL and anon key rarely change.
121. **Enable HTTP/2 push for critical assets on Cloudflare.** The HTML, main CSS, and main JS bundle pushed together eliminate two round-trips.
122. **Reduce the number of distinct Tailwind class variants.** JIT purges unused classes, but complex arbitrary values (`bg-white/82`, `text-ink/68`) generate unique CSS that can't be shared. Standardize on a reduced set.
123. **Add a Service Worker for caching static marketing pages.** The marketing pages (homepage, how-it-works, faq) rarely change. Cache them and serve from SW on repeat visits.
124. **Add `<link rel="dns-prefetch">` for third-party scripts.** Any analytics, video embeds, or font CDNs should be prefetched at DNS level.
125. **Profile and eliminate layout shifts.** Run Lighthouse and fix any CLS > 0.1. Common causes: images without `width`/`height`, fonts loading late.

---

## J. SEO

126. **Rewrite all page meta descriptions to include search keywords.** Target: "custom tailoring Nigeria," "find a tailor online," "bespoke clothing app," "Drape Vision body measurement."
127. **Rewrite all page `<title>` tags to be descriptive.** "How Custom Tailoring Works Online | Drapeon" beats "How It Works | Drapeon."
128. **Add `BreadcrumbList` schema to all secondary pages.**
129. **Add `HowTo` schema to /how-it-works.**
130. **Add `Service` schema to /tailors and /customers.**
131. **Add `Product` schema to /vision.**
132. **Create page-specific OG images.** Each page gets a unique image with the page title and brand colors. Use `satori` with a page-specific template.
133. **Add `lastmod` dates to sitemap entries.** Use `git log` or a build-time timestamp to populate accurate modification dates.
134. **Add canonical tags to /discover and /customers.** Prevent Google from penalizing near-duplicate content.
135. **Start a blog at `/blog`.** Even 4 posts: "How to brief a tailor," "What is Drape Vision," "Why custom tailoring is worth it," "How tailors can earn more with Drapeon." Target long-tail keywords.
136. **Submit to Google Search Console and Bing Webmaster Tools.** Add verification meta tags and submit the sitemap immediately.
137. **Build topical authority around "custom tailoring" keywords.** Every blog post, guide, and FAQ answer should use consistent keyword clusters.
138. **Add internal links between related pages.** Trust page → How it works. Vision page → Join. FAQ → Payouts. Each internal link distributes authority and improves crawl.
139. **Add a Nigeria-specific landing page.** `/ng` targeting "tailor in Lagos," "bespoke fashion Nigeria," "Aso-oke tailor online." Local SEO is the fastest path to organic traffic.
140. **Add structured review/rating data once real reviews exist.** `AggregateRating` on tailor profile pages will generate rich snippets in Google Search.

---

## K. ACCESSIBILITY

141. **Add a "Skip to main content" link at the very top of the DOM.** `<a href="#main" class="sr-only focus:not-sr-only">`. One line. WCAG 2.1 AA requirement.
142. **Audit and restore focus rings.** Add `focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-needle` to all interactive elements globally.
143. **Fix heading level hierarchy.** Every page must have exactly one `<h1>`. Section titles should be `<h2>`. Card titles `<h3>`. Never skip levels.
144. **Add `aria-label` to all icon-only buttons.** Any button that contains only an SVG icon needs `aria-label="Close"` or equivalent.
145. **Add `role="img" aria-label="..."` to `AppSurfacePreview`.** Screen readers should understand this is a decorative UI illustration.
146. **Add alt text strategy for all SVG diagrams.** Descriptive alt text on `customer-brief.svg` and `tailor-pipeline.svg` that explains what the diagram shows.
147. **Verify color contrast on all alpha-tinted text.** `text-ink/68` on `bg-white/82` is borderline — run axe DevTools before launch.
148. **Add `aria-expanded` to accordion FAQ items.** Screen readers need to know when a disclosure is open or closed.
149. **Add a visible "reduced motion" mode.** Respect `prefers-reduced-motion`. Disable all CSS transitions and Framer Motion animations when the user has this set.
150. **Test the entire site with VoiceOver on iOS.** Navigate every form, every nav item, every CTA using screen reader only. Fix anything that is confusing or unannounced.

---

## L. MOBILE EXPERIENCE

151. **Build a proper mobile hamburger menu.** Full-screen overlay drawer. Logo at top, all nav links, Sign in / Create account buttons at the bottom. Opens/closes with `X`.
152. **Add iOS Smart App Banner.** `<meta name="apple-itunes-app" content="app-id=XXXXX">` — appears at the top of Safari on iOS. Free install prompt.
153. **Add an Android app install prompt.** PWA `beforeinstallprompt` event handler. Show a custom "Add to home screen" banner rather than the browser default.
154. **Fix all `text-7xl` to be responsive.** Apply `text-4xl sm:text-5xl lg:text-7xl` everywhere.
155. **Make the footer single-column on mobile.** Three-column footer on 375px is illegible. Stack into accordion sections on mobile.
156. **Make the contact email cards single-column on mobile.** With `text-base` email display, not `text-2xl`.
157. **Test all forms on iOS Safari.** Check: autofill, keyboard type (email field should trigger email keyboard), safe area insets on notched devices.
158. **Add `env(safe-area-inset-bottom)` padding to fixed elements.** Any sticky banners or floating buttons need safe-area padding on iPhone X and later.
159. **Ensure the waitlist form submits correctly with iOS keyboard open.** Input focus + keyboard = viewport resize. Forms sometimes shift behind the keyboard on older iOS. Test explicitly.
160. **Add haptic feedback cues in the app.** For web, this is not applicable, but any future PWA should use `navigator.vibrate()` on form submission for tactile confirmation.

---

## M. TRUST & CREDIBILITY

161. **Get 3 real testimonials before launch.** Reach out to every tailor and customer in the beta personally. Even a WhatsApp screenshot (with permission) is usable.
162. **Add a founder photo and bio to /about.** First name, background in fashion or tech or both, why this matters to them personally.
163. **Add a "Built in Lagos" or geographic origin story.** Being specific about where the company was built is a differentiator, not a liability.
164. **Create a transparent verification standards page.** "To become verified on Drapeon, tailors must provide: ___." Specificity creates trust.
165. **Add Stripe trust marks to the payment-related pages.** "Payments processed securely by Stripe" with the Stripe logo.
166. **Publish a security.txt at `/.well-known/security.txt`.** Contact, encryption, disclosure policy. 20 lines of text, but signals seriousness to the security community.
167. **Create a public roadmap or "What we're building next" page.** Even a minimal one. Shows momentum and invites community feedback.
168. **Add a "Last updated" indicator to all policy pages.** Pull from git or from a config constant — but make it visible and accurate.
169. **Disclose the data processing region explicitly.** Add to the privacy policy: "Data is stored on Supabase (hosted on AWS region ___). We do not transfer your data to third countries without ___."
170. **Add an independent security audit badge once one is completed.** "Penetration tested by [firm] — [date]." Transformative for enterprise and high-value customer trust.

---

## N. MISSING PAGES & FEATURES

171. **Build a /pricing page.** Even if pricing is not finalized: "Drapeon charges a platform fee of X% per completed order. Tailors receive Y% of the agreed quote. Detailed fee schedule published at launch."
172. **Build a /demo page.** Embed a Loom video walkthrough. Walk through: creating a brief, receiving a quote, confirming delivery. 5 minutes. No narration needed — just the UI.
173. **Build a /compare page.** Headline: "You're already using WhatsApp to manage orders. Here's what you're missing." Side-by-side: WhatsApp vs Drapeon workflow.
174. **Build a /changelog.** Weekly updates during beta. "July 4 — Added Drape Vision calibration hardening." Shows momentum and builds habit in beta users.
175. **Build a /status page.** Even a manually-updated static page: "All systems operational" with a last-checked timestamp. Link from the footer.
176. **Build a /tailor-guide page.** Step-by-step for tailors: apply, get verified, receive your first order, deliver, get paid. The most important acquisition content on the site.
177. **Build a /customer-guide page.** How to write a great brief, how to give measurements, what to expect during production, how collection codes work.
178. **Build a /press-kit page.** Logo download (SVG + PNG), color codes, company description (25-word, 100-word, 500-word), founder headshot, high-res app screenshots.
179. **Build a /partners page with a real pitch.** "We partner with fabric suppliers, fashion schools, and tailoring associations. Here's what a Drapeon partnership looks like and what both sides get."
180. **Build a /ambassadors page.** For fashion creators and influencers. How the program works, what ambassadors get, how to apply.
181. **Build a /refer page.** Waitlist referral program landing page. Shows your referral count, your position in the queue, your shareable link.
182. **Build country landing pages.** `/ng`, `/uk`, `/gh` with localized copy, local tailor count, local currency references.
183. **Build a tailor directory preview.** Even 4 anonymized tailor cards on /customers showing specialty, location, and "Verified" badge. Previews the actual product experience.
184. **Add a `/sitemap` HTML page.** A human-readable sitemap listing all pages. Helps users and search crawlers find everything.
185. **Add a `/legal` index page.** Links to Terms, Privacy, Cookie Policy, NDPR compliance statement. The footer's "Legal" link should go here.

---

## O. BACKEND & INFRASTRUCTURE (Web-Facing)

186. **Add Cloudflare Turnstile to the waitlist form.** Free, privacy-preserving CAPTCHA alternative. No user friction, blocks bots. One line of JS.
187. **Add a honeypot field to the waitlist form.** A hidden input that bots fill in but humans don't. Filter these server-side. Zero user friction.
188. **Rate-limit the waitlist API endpoint.** Max 3 submissions per IP per hour. Use the same rate-limiting infrastructure already in the edge functions.
189. **Add a confirmation email on waitlist signup.** "You're on the list — here's your spot number and your referral link." Resend + an email template.
190. **Add `t3-env` or zod for environment variable validation.** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` validated at build time. Fail loudly if missing.
191. **Move `api/public-env.js` to `strategy="afterInteractive"`.** It is blocking the first render for data that is only needed client-side.
192. **Add Sentry to the web app.** Free tier. Catches JavaScript errors in the waitlist form, auth flows, and any client-side logic before users report them.
193. **Set up UptimeRobot or BetterUptime.** Free tier. Monitors drapeon.co every 5 minutes. Sends a Slack/email alert on downtime.
194. **Add `report-to` directive to the CSP header.** Send CSP violation reports to a Sentry endpoint or a logging endpoint. Currently violations are silent.
195. **Add a staging environment that points to a Supabase staging project.** Preview deploys on Cloudflare Workers should not write to production. Environment variable scoping in `wrangler.jsonc`.
196. **Add a cookie consent banner.** Even a minimal "We use essential cookies only — no tracking" banner satisfies GDPR and NDPR requirements. If you add analytics, upgrade to a full consent manager.
197. **Fix DMARC for drapeon.co.** `_dmarc.drapeon.co` currently returns NXDOMAIN. Add a TXT record: `v=DMARC1; p=quarantine; rua=mailto:dmarc@drapeon.co`. Required for email deliverability.
198. **Add Resend to the SPF record.** Currently SPF includes Zoho but not Resend. Transactional emails sent via Resend may be landing in spam.
199. **Add an Apple touch icon PNG.** `apple-touch-icon` must be a 180×180 PNG. The current SVG renders incorrectly on iOS.
200. **Add PWA icons array to `manifest.ts`.** Minimum: 192×192 and 512×512 PNG icons. Without these, the browser-install-prompt will not trigger and home screen icons will be blank.

---

## QUICK WINS (do these first — all under 2 hours each)

| # | Task | Time |
|---|---|---|
| 1 | Install Plausible Analytics | 30 min |
| 2 | Fix Vision page CTA → /join | 5 min |
| 3 | Remove /account/** from sitemap | 10 min |
| 4 | Add Disallow: /account/ /api/ to robots.ts | 5 min |
| 5 | Define `--font-body` with Inter or Geist | 20 min |
| 6 | Add mobile hamburger menu | 2 hr |
| 7 | Add active states to nav links | 30 min |
| 8 | Make "Create account" a filled rust button | 15 min |
| 9 | Add scroll-behavior: smooth to globals.css | 2 min |
| 10 | Add security.txt at /.well-known/security.txt | 15 min |
| 11 | Fix DMARC DNS record | 10 min |
| 12 | Add Resend to SPF DNS record | 10 min |
| 13 | Add apple-touch-icon PNG | 20 min |
| 14 | Add icons array to manifest.ts | 30 min |
| 15 | Move public-env.js to afterInteractive | 5 min |
