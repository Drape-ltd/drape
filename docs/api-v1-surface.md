# Drape V1 API Surface

This document tracks the current Supabase Edge Function API surface exposed through:

`https://<project-ref>.supabase.co/functions/v1/<function-name>`

Mobile callers generally use `supabase.functions.invoke('<function-name>')`, which routes through the same hosted `/functions/v1` gateway. Direct server callers should keep using explicit `/functions/v1/...` URLs.

## Conventions

- Authenticated user endpoints require `Authorization: Bearer <user JWT>`.
- Service endpoints require `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>` or the shared cron/webhook secret documented beside the function.
- Webhooks must verify signatures against the raw request body before JSON parsing.
- Normal JSON success shape is `{ ok: true, ... }` unless the function streams provider-specific payloads.
- Normal JSON error shape should be `{ error: string, ... }`. Some legacy functions still return plain text errors and are tracked as production hardening work.

## Endpoints

| Endpoint | Method | Auth | Request shape | Response shape |
| --- | --- | --- | --- | --- |
| `/claim-passport` | POST | User JWT | `{ action: 'preview' \| 'claim', passportId }` | Passport preview or claim result |
| `/conversation-access` | POST | User JWT | `{ action: 'get-status' \| 'mark-read', orderId }` | Conversation access/read state |
| `/conversation-safety-report` | POST | User JWT | `{ orderId, reason, details? }` | Safety report result |
| `/create-consultation-room` | POST | User JWT | `{ orderId }` | Daily room URL/token payload |
| `/create-order-call-room` | POST | User JWT | `{ orderId }` | Order call room payload |
| `/currency-context` | POST | Public | `{ locale? }` | `{ currency, source, regionCode, usedFallback }` |
| `/custom-order-action` | POST | User JWT | Custom order brief payload | `{ ok: true, orderId, reference? }` |
| `/customer-order-action` | POST | User JWT | `{ action, orderId, ... }` for customer order transitions | `{ ok: true, ... }` |
| `/diary-entry-action` | POST | User JWT | `{ action: 'create' \| 'update' \| 'delete' \| 'mark-invite-sent', ... }` | Diary entry result |
| `/handoff-support-action` | POST | User JWT | `{ action: 'report-issue' \| 'resolve-issue', orderId, ... }` | Handoff issue result |
| `/message-action` | POST | User JWT | `{ orderId, body?, media? }` | Message send result |
| `/notify-ops-verification` | POST | User JWT | Verification notification payload | Ops notification result |
| `/payment-action` | POST | User JWT | `{ action: 'prepare-payment' \| 'confirm-payment', orderId, phase? }` | Provider payment intent/checkout result |
| `/payout-account-action` | POST | User JWT | `{ action: 'get-status' \| 'list-paystack-banks' \| 'verify-paystack-account' \| 'confirm-paystack-account' \| 'submit-manual-bank-entry' \| 'start-stripe-connect' \| 'refresh-stripe-connect-status', ... }` | Payout setup/status result |
| `/payout-setup-request` | POST | User JWT | `{ provider?, country?, note? }` | Payout setup request result |
| `/portfolio-item-action` | POST | User JWT | `{ action: 'seed-from-setup' \| 'create-item' \| 'update-item' \| 'delete-item', ... }` | Portfolio item result |
| `/ready-made-order-action` | POST | User JWT | `{ action: 'start-inquiry' \| 'preview-checkout' \| 'create-checkout', ... }` | Ready-made inquiry/checkout result |
| `/reauth-proof-action` | POST | User JWT | `{ action: "issue-proof", purpose, password }` | 5-minute signed reauth proof for sensitive actions |
| `/request-account-deletion` | POST | User JWT + reauth proof | `{ reason?, confirmationText: "DELETE", reauthProof }` | Deletion request result |
| `/request-data-access` | POST | User JWT | `{ requestType?, note? }` | Data access request result |
| `/review-action` | POST | User JWT | `{ action: 'submit-tailor-review' \| 'submit-customer-review', orderId, rating, body? }` | Review submission result |
| `/saved-tailor-action` | POST | User JWT | `{ action: 'save' \| 'unsave-by-profile' \| 'unsave-by-id', tailorProfileId? savedId? }` | Saved tailor result |
| `/seller-access-review-request` | POST | User JWT | Seller access review payload | Review request result |
| `/seller-item-action` | POST | User JWT | `{ action: 'create-item' \| 'update-item' \| 'publish-item' \| 'hide-item' \| 'mark-sold' \| 'relist-item' \| 'delete-item', ... }` | Seller item result |
| `/service-health` | GET/POST | Public for `check=live`; `DRAPE_HEALTHCHECK_SECRET` for `check=ready` | Query `?check=live \| ready`; readiness accepts `tier=launch \| beta` and defaults to strict `launch` | Liveness/readiness JSON |
| `/tailor-order-action` | POST | User JWT | `{ action, orderId, ... }` for tailor order transitions | `{ ok: true, ... }` |
| `/tailor-profile-action` | POST | User JWT | `{ action: 'update-avatar' \| 'upsert-setup' \| 'update-profile', ... }` | Tailor profile result |
| `/auto-release` | POST | Service role | Optional batch controls | Auto-release batch summary |
| `/escalate-handoff-issues` | POST | Service role | Optional batch controls | Handoff escalation summary |
| `/expire-pending-payments` | POST | Service role | Optional batch controls | Payment expiry summary |
| `/expire-quotes` | POST | Service role | Optional batch controls | Quote expiry summary |
| `/refund-order-payments` | POST | Service role | `{ orderId, reason?, amount? }` | Refund result |
| `/release-order-payouts` | POST | Service role | `{ orderId? }` | Payout release summary |
| `/handle-verification-decision` | POST | Service role or signed verification token | Verification decision payload | Decision result |
| `/on-message-created` | POST | Webhook secret | Supabase database webhook payload | Push notification result |
| `/stripe-webhook` | POST | Stripe signature | Raw Stripe webhook body | Webhook processing result |
| `/paystack-webhook` | POST | Paystack signature | Raw Paystack webhook body | Webhook processing result |
| `/delivery-webhook` | POST | Delivery provider HMAC | Raw delivery webhook body | Delivery processing result |

Webhook endpoints are not health-check endpoints. Uptime monitors should use `/service-health`; unsigned webhook probes should be expected to return `401`.

## Known V1 Hardening Gaps

- Rate-limit responses must be normalized to JSON with `Retry-After`.
- Payment and webhook endpoints should use Sentry for provider failures and signature failures.
- Payment idempotency keys need to be standardized to stable `DRAPE-{orderId}-{action}` keys before launch.
- Legacy text error responses should move to clean JSON errors.
