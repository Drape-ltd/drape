# Supabase Migration Status

Generated: 2026-05-06

Production audit source: `supabase migration list` against production project `wkfsrunetmgjdtcurmoj`.

Preview project note: on 2026-05-07 the linked mobile preview project
`pqptfuqogvrajozfsqzi` was verified with `supabase migration list` after
app logs showed 404s for `wishlist_collections`. The preview project now has
`20260506000001_tailor_profile_private_column_grants.sql` and
`20260507000001_wishlist_collections.sql` applied. A REST probe against
`/rest/v1/wishlist_collections` returned `401` instead of `404`, confirming
PostgREST can see the table and anonymous access is simply unauthorized.

Status meanings:

- `APPLIED_PROD`: present in production migration history.
- `PENDING_PROD`: not yet applied to production; reviewed as launch-relevant, but must still be approved immediately before push with a rollback plan.
- `HOLD_FEATURE`: intentionally held because the feature is not shipping at launch.
- `HOLD_REVIEW`: needs more review before any production apply.

Important guardrail: never run `supabase db push` directly against production. Review pending migrations one by one, then apply only approved launch-critical migrations.

## Applied In Production

| Migration | Status | Notes |
| --- | --- | --- |
| `20260313000000_drop_all.sql` | APPLIED_PROD | Existing prod baseline history. |
| `20260313000001_initial_schema.sql` | APPLIED_PROD | Existing prod baseline history. |
| `20260315000000_add_tracking_number.sql` | APPLIED_PROD | Existing prod history. |
| `20260315000001_add_video_call_url.sql` | APPLIED_PROD | Existing prod history. |
| `20260315000002_schema_fixes.sql` | APPLIED_PROD | Existing prod history. |
| `20260316000000_add_delivery_address.sql` | APPLIED_PROD | Existing prod history. |
| `20260316000001_add_quoted_currency.sql` | APPLIED_PROD | Existing prod history. |
| `20260316000002_rls_hardening.sql` | APPLIED_PROD | Existing prod history. |
| `20260316000003_rate_limiting.sql` | APPLIED_PROD | Existing prod history. |
| `20260316000004_tailor_stats_triggers.sql` | APPLIED_PROD | Existing prod history. |
| `20260316000005_storage_rls.sql` | APPLIED_PROD | Existing prod history. |
| `20260316000006_audit_logs.sql` | APPLIED_PROD | Existing prod history. |
| `20260316000007_security_fixes.sql` | APPLIED_PROD | Existing prod history. |
| `20260316000008_customer_avatar.sql` | APPLIED_PROD | Existing prod history. |
| `20260316000009_security_hardening.sql` | APPLIED_PROD | Existing prod history. |
| `20260316000010_fix_signup_bugs.sql` | APPLIED_PROD | Existing prod history. |
| `20260316000011_submission_fixes.sql` | APPLIED_PROD | Existing prod history. |
| `20260316000012_tailor_insert_policy.sql` | APPLIED_PROD | Existing prod history. |
| `20260316000013_grant_update_user_id.sql` | APPLIED_PROD | Existing prod history. |
| `20260316000014_tailor_avatar.sql` | APPLIED_PROD | Existing prod history. |
| `20260316000015_tailor_avatar_select.sql` | APPLIED_PROD | Existing prod history. |
| `20260316000016_diary_entries.sql` | APPLIED_PROD | Existing prod history. |
| `20260317000001_profile_completed.sql` | APPLIED_PROD | Existing prod history. |
| `20260317000002_portfolio_items.sql` | APPLIED_PROD | Existing prod history. |
| `20260317000003_diary_gender_fix.sql` | APPLIED_PROD | Existing prod history. |
| `20260318000001_passport_claim.sql` | APPLIED_PROD | Existing prod history. |
| `20260318000002_profile_completed_trigger.sql` | APPLIED_PROD | Existing prod history. |
| `20260318000003_profile_completed_insert_trigger.sql` | APPLIED_PROD | Existing prod history. |
| `20260318000004_message_body_constraint.sql` | APPLIED_PROD | Existing prod history. |
| `20260318000005_tailor_ranking_score.sql` | APPLIED_PROD | Existing prod history. |
| `20260318000006_fix_profile_completed_verified.sql` | APPLIED_PROD | Existing prod history. |
| `20260318000007_ranking_score_avg_rating.sql` | APPLIED_PROD | Existing prod history. |
| `20260318000008_review_published_at.sql` | APPLIED_PROD | Existing prod history. |
| `20260318000009_reference_unique.sql` | APPLIED_PROD | Existing prod history. |
| `20260318000010_grant_ranking_score.sql` | APPLIED_PROD | Existing prod history. |
| `20260319000001_service_role_grants.sql` | APPLIED_PROD | Existing prod history. |
| `20260319000002_sync_portfolio_photo_urls.sql` | APPLIED_PROD | Existing prod history. |
| `20260320000003_web_leads.sql` | APPLIED_PROD | Existing prod history. |
| `20260322000004_orders_insert_hardening.sql` | APPLIED_PROD | Existing prod history. |
| `20260322000005_prod_security_linter_fixes.sql` | APPLIED_PROD | Existing prod history. |
| `20260323000006_account_deletion_requests.sql` | APPLIED_PROD | Existing prod history. |
| `20260323000007_customer_profiles_phone.sql` | APPLIED_PROD | Existing prod history. |
| `20260323000008_customer_profile_compat.sql` | APPLIED_PROD | Existing prod history. |
| `20260323000009_storage_buckets_setup.sql` | APPLIED_PROD | Existing prod history. |
| `20260323000010_tailor_profile_access_compat.sql` | APPLIED_PROD | Existing prod history. |
| `20260323000011_reviews_access_compat.sql` | APPLIED_PROD | Existing prod history. |
| `20260323000012_trigger_privilege_compat.sql` | APPLIED_PROD | Existing prod history. |
| `20260323000013_customer_reviews.sql` | APPLIED_PROD | Existing prod history. |
| `20260324000014_seller_capabilities_and_items.sql` | APPLIED_PROD | Existing prod history. |
| `20260324000015_seller_item_media_storage.sql` | APPLIED_PROD | Existing prod history. |
| `20260324000016_order_kind_checkout_foundation.sql` | APPLIED_PROD | Existing prod history. |
| `20260324000017_ready_made_order_insert_policy.sql` | APPLIED_PROD | Existing prod history. |
| `20260325092153_tailor_profile_seller_fields_access.sql` | APPLIED_PROD | Existing prod history. |
| `20260325093500_ready_made_inquiry_policy.sql` | APPLIED_PROD | Existing prod history. |
| `20260401000002_add_payment_checkout_url.sql` | APPLIED_PROD | Existing prod history. |
| `20260401000003_schedule_background_jobs.sql` | APPLIED_PROD | Existing prod history. |
| `20260401000004_add_fulfillment_fee_fields.sql` | APPLIED_PROD | Existing prod history. |
| `20260402000005_ops_workflows.sql` | APPLIED_PROD | Existing prod history. |
| `20260414000001_collection_code_reset_window.sql` | APPLIED_PROD | Existing prod history. |
| `20260414000002_measurement_scans.sql` | APPLIED_PROD | Already present in prod; do not add more Drape Vision migrations until launch scope changes. |
| `20260422000001_tailor_profile_fulfillment_access.sql` | APPLIED_PROD | Existing prod history. |
| `20260422000002_ready_made_inventory.sql` | APPLIED_PROD | Existing prod history. |
| `20260422000003_tailor_pickup_details.sql` | APPLIED_PROD | Existing prod history. |
| `20260422000004_ready_made_size_inventory.sql` | APPLIED_PROD | Existing prod history. |
| `20260423000001_handoff_and_payout_support.sql` | APPLIED_PROD | Existing prod history. |
| `20260423000002_schedule_handoff_issue_escalation.sql` | APPLIED_PROD | Existing prod history. |
| `20260423000003_delivery_handoff_model.sql` | APPLIED_PROD | Existing prod history. |
| `20260423000004_tailor_client_notes_defaults.sql` | APPLIED_PROD | Existing prod history. |
| `20260424000001_fulfillment_payment_flow.sql` | APPLIED_PROD | Existing prod history. |
| `20260424000002_drape_managed_dispatch.sql` | APPLIED_PROD | Existing prod history. |
| `20260425000001_add_cad_currency.sql` | APPLIED_PROD | Existing prod history. |
| `20260425000005_ready_made_size_guides.sql` | APPLIED_PROD | Existing prod history. |
| `20260428000001_contact_bypass_auth_user_fk.sql` | APPLIED_PROD | Existing prod history. |
| `20260506000001_tailor_profile_private_column_grants.sql` | APPLIED_PROD | Prod hotfix applied and repaired into migration history. |

## Pending Or Held

| Migration | Status | Review decision |
| --- | --- | --- |
| `20260428000002_order_terminal_hardening.sql` | PENDING_PROD | Launch-critical order immutability hardening. Requires rollback plan because it replaces order update policies and adds a terminal guard trigger. |
| `20260429000001_payment_currency_foundation.sql` | PENDING_PROD | Launch-critical payment/currency foundation. Contains large backfills and ledger setup; review row counts and rollback before applying. |
| `20260429000002_tax_and_payout_hardening.sql` | APPLIED_PROD | Verified in linked production migration history on 2026-07-12; production still needs `ZIPTAX_API_KEY` for live US/Canada lookup instead of fallback tax. |
| `20260429000003_payout_execution_hardening.sql` | PENDING_PROD | Launch-critical payout execution hardening. Review payout status backfills before applying. |
| `20260429000004_order_handoff_and_payout_gate.sql` | PENDING_PROD | Launch-critical payout gate fields and indexes. Review updates on existing orders before applying. |
| `20260429000005_schedule_payout_release.sql` | PENDING_PROD | Launch-critical scheduled payout release job. Apply only with function deployment plan. |
| `20260429000006_payment_failed_state.sql` | PENDING_PROD | Launch-critical payment failure state support. Review enum/status compatibility before applying. |
| `20260429000007_payment_webhook_idempotency_key.sql` | PENDING_PROD | Launch-critical webhook idempotency index. Should apply with webhook idempotency code. |
| `20260429000008_signup_trigger_hardening.sql` | PENDING_PROD | Launch-critical auth resilience. Review existing auth trigger body before applying. |
| `20260430000001_ops_issue_ledger.sql` | PENDING_PROD | Launch-critical for rate-limit/webhook/security alerting. Creates ops issue/audit tables with RLS. |
| `20260430000002_order_payout_snapshots.sql` | PENDING_PROD | Launch-critical payout snapshot data. Review existing order backfill before applying. |
| `20260430000003_partial_refunds.sql` | PENDING_PROD | Launch-critical refund accounting. Review payment rows before applying. |
| `20260430000004_partial_refund_terminal_exceptions.sql` | PENDING_PROD | Launch-critical refund/order terminal exception logic. Apply with `20260430000003`. |
| `20260502000001_manual_bank_entries.sql` | PENDING_PROD | Launch-critical if manual payout fallback remains enabled. Review private bank-detail grants before applying. |
| `20260502000002_custom_order_staged_flow.sql` | PENDING_PROD | Launch-critical only if current mobile order flow depends on staged custom-order details. Review feature readiness before applying. |
| `20260509000001_payout_account_change_guards.sql` | PENDING_PROD | Launch-critical financial safety guard. Adds payout destination cooldown and release-hold columns; apply before deploying payout guard functions. |
| `20260509000002_tailor_profile_completed_status_compat.sql` | PENDING_PROD | Launch-critical navigation stability guard. Keeps legacy APPROVED verification rows from being recomputed as incomplete during payout/profile updates. |
| `20260509000003_sync_public_user_email_after_auth_change.sql` | PENDING_PROD | Launch-critical account settings guard. Syncs `public.users.email` only after confirmed Supabase Auth email changes. |
| `20260509000004_schedule_production_stall_escalation.sql` | PENDING_PROD | Launch-critical fulfillment safety guard. Schedules `escalate-production-stalls` hourly once the function is deployed and Vault cron secrets exist. |
| `20260509000008_service_health_rpc.sql` | PENDING_PROD | Service observability helper. Lets protected readiness checks inspect required cron jobs without exposing cron schema. |
| `20260702000001_testflight_feedback_and_cascade_hardening.sql` | APPLIED_PROD | TestFlight security hardening applied on 2026-07-02. Adds product feedback RLS, bounded JSON/profile fields, safer deletion FKs, measurement scan audit logging, invite expiry, and atomic collection-code attempts. |
| `20260702000002_schedule_account_deletion_finalizer.sql` | APPLIED_PROD | Account deletion finalizer schedule applied on 2026-07-02. Requires Vault cron secrets to invoke `finalize-account-deletions`. |
| `20260702000003_public_media_review_gate.sql` | APPLIED_PROD | Applied on 2026-07-02. Re-queued public media now resets to pending moderation so same-path overwrites cannot inherit previous approval. |
| `20260712172913_fix_signup_phone_trigger_casts.sql` | APPLIED_PROD | Applied on 2026-07-12. Fixes signup-trigger failures from mixed uuid/text phone uniqueness comparisons; dev was also repaired and verified with customer/tailor signup QA. |
| `20260502000003_drape_vision_measurement_scan_methods.sql` | APPLIED_PROD | Existing Drape Vision capture-method support is present in production. |
| `20260503000001_drape_vision_scan_logs.sql` | APPLIED_PROD | Existing Drape Vision scan-log support is present in production. |
| `20260503000002_drape_vision_ground_truth.sql` | APPLIED_PROD | Existing Drape Vision ground-truth support is present in production. |
| `20260627000001_drape_vision_scorecard_rows.sql` | APPLIED_PROD | Applied on 2026-07-02 with the TestFlight security push. Adds RLS-protected Vision QA scorecard rows. |
| `20260701000001_drape_vision_specialist_scan_method.sql` | APPLIED_PROD | Applied on 2026-07-02 with the TestFlight security push. Adds specialist scan capture method support. |
