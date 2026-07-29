export type DrapeExceptionBucketId =
  | 'participants'
  | 'scope'
  | 'evidence'
  | 'money'
  | 'time'
  | 'safety'

export type DrapeOpsOwner =
  | 'OPS'
  | 'CUSTOMER_SUCCESS'
  | 'TRUST'
  | 'FINANCE'
  | 'ENGINEERING'
  | 'ADMIN'

export type DrapeExceptionSeverity = 'Critical' | 'High' | 'Medium' | 'Standard'

export type DrapeExceptionBucket = {
  id: DrapeExceptionBucketId
  title: string
  principle: string
  launchRule: string
}

export type DrapeExceptionRunbookEntry = {
  title: string
  owner: DrapeOpsOwner
  severity: DrapeExceptionSeverity
  bucket: DrapeExceptionBucketId
  keywords: string[]
  useWhen: string
  firstMove: string
  customerCopy: string
  tailorCopy: string
  opsActions: string[]
}

export type DrapeGuideTopic = {
  icon: string
  title: string
  body: string
}

export type DrapeGuideFaq = {
  question: string
  answer: string
}

export type DrapeTrustSection = {
  title: string
  body: string
  bullets: string[]
}

export const DRAPE_EXCEPTION_BUCKETS: DrapeExceptionBucket[] = [
  {
    id: 'participants',
    title: 'People and roles',
    principle: 'Every order needs the right buyer, wearer, recipient, tailor, and ops owner named.',
    launchRule: 'If the person wearing, receiving, paying, or making the garment is different, the order must say so before money moves.',
  },
  {
    id: 'scope',
    title: 'Scope and approvals',
    principle: 'Style interpretation, fabric decisions, fit preference, and scope changes need explicit approval.',
    launchRule: 'Anything that changes price, deadline, garment details, or cut readiness belongs in a formal order decision, not loose chat.',
  },
  {
    id: 'evidence',
    title: 'Evidence and handoff',
    principle: 'Photos, videos, receipts, tracking, and delivery proof make remote tailoring trustworthy.',
    launchRule: 'The app should capture proof before changing irreversible state: cutting, dispatch, delivery, completion, refund, or payout.',
  },
  {
    id: 'money',
    title: 'Money and settlement',
    principle: 'Customers need reassurance when payment is slow; tailors need clarity about locked payout value.',
    launchRule: 'Never ask someone to pay twice, never release payout without the release checks, and never hide why money is blocked.',
  },
  {
    id: 'time',
    title: 'Time and capacity',
    principle: 'Deadlines collide with real life: holidays, rush season, sickness, no-shows, customs, and courier delays.',
    launchRule: 'Warn before a deadline becomes unrealistic, and route late-but-trusted tailors differently from silent or risky ones.',
  },
  {
    id: 'safety',
    title: 'Safety and ops',
    principle: 'Drapeon protects the transaction by keeping communication, evidence, and decisions inside the platform.',
    launchRule: 'Off-platform contact, unsafe content, fake reviews, stolen photos, and unclear ops decisions need reviewable records.',
  },
]

export const DRAPE_EXCEPTION_LAUNCH_RAILS = [
  'Every live exception must name the owner: customer, tailor, Drapeon ops, finance, trust, or engineering.',
  'Every irreversible move needs evidence: photos, videos, receipt, tracking, acknowledgement, or a written order decision.',
  'Every money state must be explainable in one sentence: processing, held, refundable, pending release, blocked, released, or refunded.',
  'Every scope change must show impact before approval: price, deadline, fit, material, or refund effect.',
  'Every fallback must keep the order alive: if push, SMS, Daily, courier, or provider callbacks fail, the order thread remains source of truth.',
]

export const DRAPE_EXCEPTION_RUNBOOK_ENTRIES: DrapeExceptionRunbookEntry[] = [
  {
    title: 'Payment succeeded but the app still says pending',
    owner: 'ENGINEERING',
    severity: 'Critical',
    bucket: 'money',
    keywords: ['payment pending', 'paid', 'webhook', 'stripe', 'paystack', 'double charge', 'processing'],
    useWhen: 'A customer says money left their account but the order still looks unpaid or pending.',
    firstMove: 'Tell the customer not to pay again, check provider event status, then reconcile the order payment before creating any duplicate payment attempt.',
    customerCopy: 'Your payment is processing. This usually clears shortly, so please do not pay again while Drapeon checks the confirmation.',
    tailorCopy: 'The customer payment is being reconciled. Do not start paid work until Drapeon confirms the order is active.',
    opsActions: [
      'Check order_payments, payment_webhook_events, provider dashboard, and idempotency key.',
      'If provider succeeded, mark the payment confirmed through the normal reconciliation path.',
      'If provider is delayed, keep the order pending and send a reassurance update with a support owner.',
    ],
  },
  {
    title: 'Style reference mismatch before cutting',
    owner: 'CUSTOMER_SUCCESS',
    severity: 'High',
    bucket: 'scope',
    keywords: ['style mismatch', 'reference photo', 'neckline', 'embroidery', 'silhouette', 'pre-cutting', 'interpretation'],
    useWhen: 'The customer expects one interpretation and the tailor understood the reference differently.',
    firstMove: 'Pause cutting and get a written style interpretation inside the order: what can be matched, what will differ, and what changes price or deadline.',
    customerCopy: 'Before cutting starts, confirm the style interpretation in Drapeon so there is no confusion about the look you approved.',
    tailorCopy: 'Explain what you can match from the reference and what will differ before cutting. Keep that approval inside the order.',
    opsActions: [
      'Check reference photos, brief text, consultation notes, and any proposed sketch or description.',
      'Require customer approval before cutting if style meaning is unclear.',
      'If the scope changes, route it through a priced scope change instead of informal upsell.',
    ],
  },
  {
    title: 'Measurement amendment or stale measurements',
    owner: 'CUSTOMER_SUCCESS',
    severity: 'High',
    bucket: 'participants',
    keywords: ['measurement', 'old measurements', 'wrong measurements', 'amendment', 'pregnant', 'weight change', 'fit profile'],
    useWhen: 'The customer used stale measurements, selected the wrong person, or needs to correct measurements after order submission.',
    firstMove: 'Check whether cutting has started. If not, record the amendment; if cutting has started, explain cost, fit, and timeline implications before any change.',
    customerCopy: 'Bodies and plans change. We will check whether cutting has started before changing measurements on this order.',
    tailorCopy: 'Do not cut with disputed measurements. Confirm whether the amendment affects pattern, fabric, price, or deadline.',
    opsActions: [
      'Confirm measurement profile owner and measurement age.',
      'If measurements are older than six months, recommend a refresh before the next order.',
      'If cutting already started, document whether alteration, pause, or rework is needed.',
    ],
  },
  {
    title: 'Gift, group, or linked-event participant confusion',
    owner: 'CUSTOMER_SUCCESS',
    severity: 'Medium',
    bucket: 'participants',
    keywords: ['gift', 'group order', 'recipient', 'family', 'linked orders', 'event', 'measurement profile'],
    useWhen: 'The buyer, wearer, recipient, or event owner is not the same person, or multiple orders depend on one event date.',
    firstMove: 'Name the buyer, wearer, recipient, and shared event deadline before confirming the order.',
    customerCopy: 'Tell us who the garment is for and who will receive it so the right measurements and handoff details travel with the order.',
    tailorCopy: 'Check the wearer and recipient before quoting. The buyer may not be the person whose measurements you should use.',
    opsActions: [
      'Confirm the selected measurement profile belongs to the actual wearer.',
      'For linked events, watch deadline dependencies across all related orders.',
      'If recipient handoff is separate, keep delivery proof tied to the recipient, not just the buyer.',
    ],
  },
  {
    title: 'Fabric sourcing, dropoff, quantity, or authenticity issue',
    owner: 'OPS',
    severity: 'High',
    bucket: 'scope',
    keywords: ['fabric', 'sourcing', 'dropoff', 'quantity', 'shortfall', 'aso-oke', 'lace', 'colour', 'color', 'material'],
    useWhen: 'Fabric is missing, misrepresented, too short, different from photos, or not approved before cutting.',
    firstMove: 'Pause at pre-cutting, collect fabric proof, and make the next owner explicit before production moves forward.',
    customerCopy: 'Before cutting starts, fabric details need to be confirmed in Drapeon so the order stays protected.',
    tailorCopy: 'Do not cut until the fabric path is approved. Upload proof and explain what is missing, different, or risky.',
    opsActions: [
      'Ask for fabric photos with a white reference sheet, receipt, measured quantity, or dropoff proof.',
      'If fabric was customer supplied, confirm type and quality on receipt before cutting.',
      'If more fabric or money is needed, route it through a formal scope change.',
    ],
  },
  {
    title: 'Fabric bought but the order is being cancelled',
    owner: 'FINANCE',
    severity: 'High',
    bucket: 'money',
    keywords: ['fabric purchased', 'cancel', 'refund', 'material cost', 'receipt', 'customer changed mind'],
    useWhen: 'The tailor already purchased order-specific fabric and the customer wants to cancel or pause.',
    firstMove: 'Verify whether the customer acknowledged the fabric purchase before it happened, then apply cancellation policy with the material cost visible.',
    customerCopy: 'We are checking whether fabric was already purchased for this order before deciding the refund path.',
    tailorCopy: 'Upload the fabric receipt and purchase proof. Drapeon needs a record before applying any material-cost decision.',
    opsActions: [
      'Confirm purchase date, cost, receipt, and customer acknowledgement.',
      'Separate garment labour refund from material cost treatment.',
      'If no acknowledgement exists, escalate for customer-success review before charging the customer.',
    ],
  },
  {
    title: 'Delivery, shipping, customs, or wrong recipient issue',
    owner: 'OPS',
    severity: 'High',
    bucket: 'evidence',
    keywords: ['delivery', 'shipping', 'customs', 'tracking', 'recipient', 'flatmate', 'neighbour', 'wrong address', 'delivered'],
    useWhen: 'Carrier tracking, pickup, customs, duties, or recipient confirmation does not prove the actual customer received the garment.',
    firstMove: 'Separate carrier status from customer handoff. Ask for delivery proof and customer receipt confirmation before closing the order.',
    customerCopy: 'Courier status is not the same as your Drapeon handoff. Confirm receipt in the app when you actually have the garment.',
    tailorCopy: 'Keep dispatch proof, tracking, and handoff evidence in Drapeon so delivery questions can be traced.',
    opsActions: [
      'For international orders, explain customs duties and delays before they become complaints.',
      'If courier says delivered but customer denies receipt, keep payout paused and open a dispatch review.',
      'For pickup, require collection proof before the 72-hour window starts.',
    ],
  },
  {
    title: 'Fit or finish issue after handoff',
    owner: 'CUSTOMER_SUCCESS',
    severity: 'High',
    bucket: 'evidence',
    keywords: ['fit', 'alteration', 'aftercare', 'does not fit', 'quality', 'damaged', 'rework'],
    useWhen: 'A customer says the garment arrived but the fit, finish, or workmanship is wrong.',
    firstMove: 'Open an aftercare case, collect photos, confirm delivery date, and keep the order out of automated payout review while ops assesses the remedy.',
    customerCopy: 'Thanks for flagging this. Upload clear photos and keep the details in this order so Drapeon can review the best next step.',
    tailorCopy: 'The customer opened an aftercare review. Please keep all remedy discussion inside Drapeon and wait for ops guidance before offering refunds off-platform.',
    opsActions: [
      'Confirm the order is within the 14-day aftercare window.',
      'Check stage photos, measurements, consultation notes, and final handoff proof.',
      'Choose alteration, partial refund, remake review, or no-action with a written reason.',
    ],
  },
  {
    title: 'Order pause, rework, restart, or scope addition',
    owner: 'CUSTOMER_SUCCESS',
    severity: 'High',
    bucket: 'scope',
    keywords: ['pause', 'hold', 'restart', 'rework', 'scope change', 'upsell', 'forgot to add', 'event cancelled'],
    useWhen: 'Real life changes the order after acceptance: event postponed, customer forgot details, tailor proposes additions, or work needs restarting.',
    firstMove: 'Keep the order live, state the proposed change, and capture customer approval for price, deadline, and responsibility before work continues.',
    customerCopy: 'We can review the change, but price, deadline, and responsibility need to be clear before the tailor continues.',
    tailorCopy: 'Do not treat add-ons or rework as informal chat. Propose the change in Drapeon with price and deadline impact.',
    opsActions: [
      'Use a grace period for immediate note-only changes before tailor review where possible.',
      'If work already started, record whether this is customer-caused, tailor-caused, or shared ambiguity.',
      'Keep dispute and payout release paused while rework responsibility is unresolved.',
    ],
  },
  {
    title: 'Tailor has not updated production',
    owner: 'CUSTOMER_SUCCESS',
    severity: 'High',
    bucket: 'time',
    keywords: ['stale', 'inactive', 'no update', 'production stall', 'deadline', 'slow tailor'],
    useWhen: 'An active custom order has not received a meaningful stage update close to the expected cadence.',
    firstMove: 'Check the last stage update, tailor track record, deadline pressure, and customer anxiety before escalating.',
    customerCopy: 'Your order has not been updated recently. We are following up with the tailor and will keep the next step in this timeline.',
    tailorCopy: 'Please update this order with the current stage and proof media. Customers need visible progress to trust the process.',
    opsActions: [
      'At 5 days without update, send reminder and log ops follow-up.',
      'At 10 days without update, escalate to dispute review if the tailor is unreachable.',
      'Use trust score context: a proven slow tailor is handled differently from a silent new tailor.',
    ],
  },
  {
    title: 'Tailor emergency, relocation, or offboarding',
    owner: 'OPS',
    severity: 'High',
    bucket: 'time',
    keywords: ['sick', 'malaria', 'emergency', 'relocation', 'closing', 'offboarding', 'transfer order'],
    useWhen: 'A tailor cannot continue because of illness, relocation, closure, or a genuine personal emergency.',
    firstMove: 'Freeze new intake, notify affected customers, and offer wait, transfer, or cancellation paths per order.',
    customerCopy: 'The tailor has reported an interruption. Drapeon will give you clear options to wait, transfer, or cancel safely.',
    tailorCopy: 'Thank you for telling us early. Pause new work, update each active order, and let Drapeon help protect customers and your reputation.',
    opsActions: [
      'Switch the tailor to unavailable for new orders.',
      'List active orders by deadline and payment state.',
      'Offer transfer only when another verified tailor can meet the brief and timeline.',
    ],
  },
  {
    title: 'Consultation no-show, degraded call, or scheduling issue',
    owner: 'CUSTOMER_SUCCESS',
    severity: 'Medium',
    bucket: 'time',
    keywords: ['consultation', 'call', 'daily', 'no show', 'audio', 'video', 'reminder', 'timezone'],
    useWhen: 'A scheduled audio or video call fails, either party misses it, or time zones caused confusion.',
    firstMove: 'Keep the order thread as source of truth, offer reschedule, and capture consultation notes so the brief does not depend on memory.',
    customerCopy: 'If the call did not work, keep the key notes in this order and reschedule from Drapeon so the brief stays protected.',
    tailorCopy: 'If you missed the call or Daily was unavailable, propose a new time and summarize anything already agreed in the thread.',
    opsActions: [
      'Check reminder delivery, call room status, no-show history, and local time zones.',
      'If Daily is down, keep messaging and SMS reminders active rather than shutting consultations down.',
      'Do not allow pre-order calls to become paid side consultations outside Drapeon.',
    ],
  },
  {
    title: 'Ready-made inventory, stock, or stale listing issue',
    owner: 'OPS',
    severity: 'Medium',
    bucket: 'evidence',
    keywords: ['ready-made', 'stock', 'listing', 'sold out', 'inventory', 'stale', 'seasonal'],
    useWhen: 'A ready-made item is sold, stale, missing proof, or no longer available from the tailor.',
    firstMove: 'Hide or pause the item before more customers can buy it, then ask the tailor to confirm stock with fresh listing proof.',
    customerCopy: 'This item needs availability confirmation before we can keep selling it.',
    tailorCopy: 'Confirm the item is still available and update photos, sizes, stock, and fulfillment details before it stays live.',
    opsActions: [
      'Pause stale listings after confirmation prompts are ignored.',
      'Require at least one clear product photo, size, stock, price, and fulfillment path before restoring.',
      'Use low-stock messaging honestly when one item remains.',
    ],
  },
  {
    title: 'Ready-made wrong item, damage, or return review',
    owner: 'CUSTOMER_SUCCESS',
    severity: 'High',
    bucket: 'evidence',
    keywords: ['wrong item', 'damaged', 'ready-made return', 'exchange', 'missing item', 'unboxing'],
    useWhen: 'A buyer receives a ready-made item that is damaged, wrong, missing, or materially different from the listing.',
    firstMove: 'Collect unboxing or item photos, compare listing media and dispatch proof, then choose refund, exchange, or no-action with reason.',
    customerCopy: 'Upload photos of what arrived before closing the order so Drapeon can review the right remedy.',
    tailorCopy: 'Keep listing, packing, and dispatch proof in Drapeon. Do not settle this outside the platform.',
    opsActions: [
      'Check item listing photos, size guide, stock record, dispatch proof, and customer photos.',
      'If wrong or damaged, hold payout and route refund or exchange review.',
      'If change-of-mind, apply the stated policy rather than automatic refund.',
    ],
  },
  {
    title: 'Cancellation or partial refund request',
    owner: 'FINANCE',
    severity: 'High',
    bucket: 'money',
    keywords: ['cancel', 'refund', 'partial refund', 'payment blocked', 'chargeback'],
    useWhen: 'A customer or tailor wants to cancel, continue with a remedy, or refund part of an order.',
    firstMove: 'Determine current stage first. Refund amount follows the cancellation policy and original provider payment.',
    customerCopy: 'We are reviewing the order stage and refund policy before changing the order. You will see the decision in this timeline.',
    tailorCopy: 'Do not settle this outside Drapeon. Refund and continuation decisions must stay tied to the original payment.',
    opsActions: [
      'Before acceptance or before cutting: full refund can apply.',
      'After cutting begins: assess partial refund, aftercare remedy, or rework responsibility.',
      'Never mark an order cancelled unless the provider refund has confirmed.',
    ],
  },
  {
    title: 'Payout blocked or delayed',
    owner: 'FINANCE',
    severity: 'High',
    bucket: 'money',
    keywords: ['payout', 'release', '72 hour', 'escrow', 'recipient', 'paystack', 'stripe'],
    useWhen: 'A payout did not release after handoff, dispute window, or provider transfer checks.',
    firstMove: 'Verify handoff confirmed, 72 hours elapsed, no dispute is open, payout account is verified, and no payout already exists.',
    customerCopy: 'Your payment remains protected while Drapeon checks the order status.',
    tailorCopy: 'Your payout is being reviewed. We will update you once the release checks are clean or explain the blocker.',
    opsActions: [
      'Check payout table status and blocked reason.',
      'Retry only after the blocker is resolved.',
      'Create a workflow issue for provider errors, missing recipient codes, or duplicate-release risk.',
    ],
  },
  {
    title: 'Off-platform contact or unsafe message',
    owner: 'TRUST',
    severity: 'Medium',
    bucket: 'safety',
    keywords: ['phone', 'email', 'whatsapp', 'instagram', 'unsafe', 'message', 'bypass', 'sexual'],
    useWhen: 'A message tries to move the order off Drapeon or includes prohibited content.',
    firstMove: 'Keep the message blocked, review context, and decide whether the conversation needs a warning or temporary pause.',
    customerCopy: 'This message could not be sent. Please keep all order communication inside Drapeon so your payment and support trail stay protected.',
    tailorCopy: 'This message could not be sent. Keep communication inside Drapeon until the order is safely completed.',
    opsActions: [
      'Review bypass logs for repeat attempts.',
      'Escalate after repeated attempts from the same account.',
      'Pause messaging if the conversation becomes unsafe or exploitative.',
    ],
  },
  {
    title: 'Review is really a complaint or looks manipulated',
    owner: 'TRUST',
    severity: 'Medium',
    bucket: 'safety',
    keywords: ['review', 'complaint', 'fake review', 'one star', 'abusive', 'manipulation', 'rating'],
    useWhen: 'A review contains dispute language, safety concerns, non-delivery claims, or signs of review manipulation.',
    firstMove: 'Hold the review, route the issue to ops if it needs resolution, and only publish once the right channel has handled it.',
    customerCopy: 'Your review may describe an issue Drapeon should help resolve first. We are routing it to the right team before publishing.',
    tailorCopy: 'This review is under Drapeon review. We will check order history and publish or hold it with context.',
    opsActions: [
      'Confirm the reviewer had a completed paid order with this tailor.',
      'Look for complaint terms that should become a dispute or support case.',
      'Flag shared device, shared IP, or suspicious pattern for trust review.',
    ],
  },
  {
    title: 'Portfolio or listing photo authenticity concern',
    owner: 'TRUST',
    severity: 'High',
    bucket: 'safety',
    keywords: ['portfolio', 'stolen photo', 'fake work', 'reverse image', 'photo theft', 'not their work'],
    useWhen: 'A tailor may have uploaded photos that are not their own work or copied another tailor listing.',
    firstMove: 'Hide the questionable media from discovery if risk is high, then review source, similarity, and tailor proof before restoring.',
    customerCopy: 'Drapeon is reviewing a portfolio authenticity concern before relying on that media.',
    tailorCopy: 'Only upload work you made or can prove is yours. Drapeon may ask for source proof before keeping photos live.',
    opsActions: [
      'Compare against existing Drapeon media and public sources.',
      'Ask for process photos, client references, or original files where needed.',
      'Suspend repeated or intentional misrepresentation.',
    ],
  },
  {
    title: 'Public holiday, cultural calendar, or capacity deadline trap',
    owner: 'OPS',
    severity: 'Medium',
    bucket: 'time',
    keywords: ['eid', 'christmas', 'owambe', 'holiday', 'rush', 'capacity', 'deadline', 'public holiday'],
    useWhen: 'A selected deadline lands near a known cultural surge, courier holiday, or tailor capacity overload.',
    firstMove: 'Warn before accepting unrealistic timing and ask the tailor to pause new orders if deadline density is too high.',
    customerCopy: 'This date sits in a busy or limited-delivery period. A slightly earlier or later deadline may protect the order.',
    tailorCopy: 'You have multiple deadlines close together. Consider pausing new orders before quality or communication slips.',
    opsActions: [
      'Check due-date density by tailor and event period.',
      'Watch late-but-responsive tailors differently from silent tailors.',
      'Escalate rush orders only to tailors who opted into rush capacity.',
    ],
  },
  {
    title: 'Account deletion with active money or orders',
    owner: 'TRUST',
    severity: 'Critical',
    bucket: 'safety',
    keywords: ['delete', 'privacy', 'account deletion', 'active order', 'pending payout', 'data export'],
    useWhen: 'A customer or tailor requests deletion while orders, disputes, refunds, payouts, or data-export obligations are still unresolved.',
    firstMove: 'Block immediate deletion, explain the open dependency, and resolve the financial or order obligation first.',
    customerCopy: 'We cannot delete the account while active orders, disputes, or refunds are still open. We will help close those first.',
    tailorCopy: 'We cannot delete the account while active orders, pending payouts, or disputes are open. Drapeon will resolve those first.',
    opsActions: [
      'Check active orders, disputes, pending refunds, and pending payouts.',
      'For tailors, offer data export before final deletion where applicable.',
      'Anonymize only after obligations are closed and compliance retention is logged.',
    ],
  },
  {
    title: 'Pickup order left uncollected',
    owner: 'OPS',
    severity: 'Medium',
    bucket: 'evidence',
    keywords: ['pickup', 'collection', 'uncollected', 'storage', 'collection code', 'ready for collection'],
    useWhen: 'A local pickup order has been ready for collection for 7+ days and the customer has not completed handoff.',
    firstMove: 'Confirm the tailor still has the garment, message the customer in Drapeon, and agree a collection window before payout release.',
    customerCopy: 'Your order is ready and still waiting for pickup. Please collect it or tell Drapeon if the plan needs to change.',
    tailorCopy: 'Keep the garment safe and keep pickup coordination inside Drapeon. Ops will help if collection keeps slipping.',
    opsActions: [
      'At 7 days: remind both parties.',
      'At 14 days: open an ops follow-up with a specific collection plan.',
      'At 30 days: treat it as a storage risk and decide the next policy step before payout release.',
    ],
  },
  {
    title: 'Event-sensitive emergency',
    owner: 'OPS',
    severity: 'Critical',
    bucket: 'time',
    keywords: ['emergency', 'event tomorrow', 'wedding tomorrow', 'cannot wear', 'urgent', 'after hours', 'on call'],
    useWhen: 'A wear date is within 24 hours, the garment cannot be worn, or delivery/pickup broke down close to the event.',
    firstMove: 'Acknowledge immediately, confirm the event time, collect photos, and decide whether the path is wait, transfer, alteration, partial refund, or full refund review.',
    customerCopy: 'Drapeon has opened urgent support for this event-sensitive issue. Keep photos and updates here so we can act quickly.',
    tailorCopy: 'An urgent event issue is under Drapeon review. Keep all updates inside the order and do not move the transaction off-platform.',
    opsActions: [
      'Confirm whether the event is within 24 hours.',
      'Check proof photos, calls, messages, stage updates, and handoff state.',
      'Escalate to on-call ops if the issue blocks wearability or delivery before an event.',
    ],
  },
  {
    title: 'Group member or named wearer confusion',
    owner: 'CUSTOMER_SUCCESS',
    severity: 'High',
    bucket: 'participants',
    keywords: ['group order', 'aso ebi', 'wrong measurement', 'gift', 'wearer', 'member invite', 'measurement profile'],
    useWhen: 'The buyer, wearer, recipient, or group member is not the same person, or the wrong measurement profile was attached.',
    firstMove: 'Pause irreversible work, identify the exact wearer for each garment, then attach or request the right measurement profile before quote acceptance or cutting.',
    customerCopy: 'Tell Drapeon who each garment is for so the right measurements travel with the order.',
    tailorCopy: 'Do not reuse the buyer measurements for another wearer. Check the named wearer and member rows before quoting or cutting.',
    opsActions: [
      'Check order_group_members and customer_measurement_profiles.',
      'Invite missing members to claim or provide measurements inside Drapeon.',
      'Use a formal scope or measurement amendment if the order has already started.',
    ],
  },
  {
    title: 'Referral trust transfer',
    owner: 'CUSTOMER_SUCCESS',
    severity: 'Standard',
    bucket: 'participants',
    keywords: ['referral', 'referred by', 'trust transfer', 'new customer', 'cold start'],
    useWhen: 'A new customer is referred by someone with strong Drapeon history and a tailor needs context before accepting.',
    firstMove: 'Confirm the referral record, show the trust context without exposing private order details, and let the new customer earn their own history.',
    customerCopy: 'Your referral gives tailors helpful context, but your own order history builds from completed Drapeon orders.',
    tailorCopy: 'This customer was referred through Drapeon. Review the brief normally; referral context is a trust signal, not a guarantee.',
    opsActions: [
      'Check referrals.status and trust_context.',
      'Do not expose the referrer’s private measurements, payment, or dispute details.',
      'Flag suspicious referral loops for trust review.',
    ],
  },
  {
    title: 'Tailor data export and portability',
    owner: 'ADMIN',
    severity: 'Medium',
    bucket: 'safety',
    keywords: ['data export', 'portability', 'tailor data', 'download', 'client list', 'privacy request'],
    useWhen: 'A tailor asks for their Drapeon data or wants reassurance they can access their history.',
    firstMove: 'Create the export request, verify identity, include only customer contact or measurement data customers opted into sharing, and document delivery.',
    customerCopy: 'Drapeon only shares your personal order or measurement data according to privacy and order rules.',
    tailorCopy: 'You can request your Drapeon history. Customer personal data is included only where privacy rules allow it.',
    opsActions: [
      'Review tailor_data_exports and linked ops issue.',
      'Include profile, portfolio, own order history, reviews, payout summary, and permitted client data.',
      'Set expiration and delivery timestamp when the export is ready.',
    ],
  },
  {
    title: 'Provider outage or degraded service during a live order',
    owner: 'ENGINEERING',
    severity: 'Critical',
    bucket: 'safety',
    keywords: ['outage', 'provider down', 'daily down', 'stripe down', 'paystack down', 'supabase', 'queue', 'status'],
    useWhen: 'Payments, calls, pushes, queues, storage, or data services are degraded while customers and tailors are waiting.',
    firstMove: 'Declare the degraded path, keep the order timeline source of truth, and tell users what is safe and what to avoid.',
    customerCopy: 'Drapeon is experiencing a service interruption. Your order and payment record are safe; please avoid duplicate actions until we update you.',
    tailorCopy: 'Drapeon is experiencing a service interruption. Keep production safe and wait for the order timeline to update before changing state.',
    opsActions: [
      'Post status guidance and log the incident.',
      'Pause duplicate payment attempts and payout retries while provider state is unclear.',
      'Backfill missed notifications or timeline events after recovery.',
    ],
  },
]

export const DRAPE_CUSTOMER_GUIDE_TOPICS: DrapeGuideTopic[] = [
  {
    icon: 'search',
    title: 'Finding the right tailor',
    body: 'Use portfolio work, reviews, location, availability, price context, and fulfillment to choose with confidence.',
  },
  {
    icon: 'user-check',
    title: 'Who the garment is for',
    body: 'If you are ordering for someone else, select or create the right measurement profile before the order starts.',
  },
  {
    icon: 'edit-3',
    title: 'Fit, style, and fabric approvals',
    body: 'Measurements, fit preference, reference photos, and fabric decisions should be confirmed before cutting begins.',
  },
  {
    icon: 'credit-card',
    title: 'Protected payments',
    body: 'If payment is processing, do not pay twice. Drapeon reconciles provider confirmations and keeps the order timeline updated.',
  },
  {
    icon: 'package',
    title: 'Pickup, delivery, and shipping',
    body: 'Carrier status is not the same as Drapeon handoff. Confirm receipt only when you actually have the garment.',
  },
  {
    icon: 'alert-triangle',
    title: 'When something changes',
    body: 'Use the order thread for amendments, rework, pauses, or concerns so Drapeon can protect the record.',
  },
]

export const DRAPE_TAILOR_GUIDE_TOPICS: DrapeGuideTopic[] = [
  {
    icon: 'inbox',
    title: 'Quote only after reviewing the whole brief',
    body: 'Check garment, wearer, measurements, deadline, fulfillment, fit preference, and reference photos before quoting.',
  },
  {
    icon: 'scissors',
    title: 'Do not cut through uncertainty',
    body: 'Pause when fabric, style interpretation, measurement owner, or customer approval is unclear.',
  },
  {
    icon: 'camera',
    title: 'Proof builds trust',
    body: 'Use fresh photos or videos for production, sourcing, dispatch, and handoff so the customer can see progress.',
  },
  {
    icon: 'message-square',
    title: 'Keep decisions inside Drapeon',
    body: 'Calls are for clarity, but price, deadline, fabric, and scope changes must be written in the order.',
  },
  {
    icon: 'credit-card',
    title: 'Payout clarity',
    body: 'Check the locked payout value and keep payout setup verified before accepting paid work.',
  },
  {
    icon: 'calendar',
    title: 'Capacity is part of trust',
    body: 'Pause new orders when deadlines, holidays, or emergencies would make communication or quality slip.',
  },
]

export const DRAPE_HELP_FAQ: DrapeGuideFaq[] = [
  {
    question: 'What happens if payment works but the order still says pending?',
    answer: 'Do not pay again. Drapeon checks the provider confirmation and updates the order once the payment event is reconciled.',
  },
  {
    question: 'What if the garment does not fit or the style is wrong?',
    answer: 'Raise the concern from the order and upload photos. Drapeon reviews measurements, reference photos, stage updates, and handoff evidence before deciding the remedy.',
  },
  {
    question: 'Can I change measurements or details after ordering?',
    answer: 'Yes, but the impact depends on timing. Before cutting, amendments are usually simpler. After cutting starts, the tailor and Drapeon need to review cost, deadline, and fit implications.',
  },
  {
    question: 'How does Drapeon handle calls if video or audio fails?',
    answer: 'The order thread remains the source of truth. If a call fails, reschedule in Drapeon and write the important decisions back into the order.',
  },
  {
    question: 'Why keep messages inside Drapeon?',
    answer: 'It protects both sides. Payments, approvals, evidence, disputes, and support decisions work best when the record stays in one place.',
  },
]

export const DRAPE_PUBLIC_TRUST_SECTIONS: DrapeTrustSection[] = [
  {
    title: 'Payment is protected, not mysterious',
    body: 'Drapeon separates payment processing, held funds, refunds, and payout release so nobody has to guess where the money is.',
    bullets: [
      'Customers see reassurance if provider confirmation is delayed.',
      'Tailors see payout readiness and blocked reasons.',
      'Ops has runbooks for refunds, partial refunds, and payout release checks.',
    ],
  },
  {
    title: 'Cutting should not start in ambiguity',
    body: 'The risky moment in custom clothing is before scissors touch fabric. Drapeon keeps style, measurement, fabric, and scope approvals close to the order.',
    bullets: [
      'Reference photos need interpretation, not assumptions.',
      'Measurement owner and age matter, especially for gifts and group orders.',
      'Fabric sourcing, dropoff, and purchase decisions stay on record.',
    ],
  },
  {
    title: 'Handoff requires proof',
    body: 'Courier status, pickup, and delivery are treated as evidence states, not vibes.',
    bullets: [
      'Dispatch proof and tracking live with the order.',
      'Customer receipt confirmation starts the final review window.',
      'International shipping and customs are explained before they become surprises.',
    ],
  },
  {
    title: 'Real life has a path',
    body: 'Sickness, holidays, missed calls, stale listings, urgent events, and fit concerns are expected product states.',
    bullets: [
      'The order thread remains source of truth when live features degrade.',
      'Ops can search the next move before replying.',
      'Customers and tailors get clear options instead of silence.',
    ],
  },
]
