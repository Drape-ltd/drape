# Launch Security Ops Checklist

This checklist covers security controls that require hosted infrastructure or
DNS changes outside the repository.

## DNS: Drapeon Mail Authentication

Publish these records before public testing with transactional email.

```text
drapeon.co TXT "v=spf1 include:zohomail.com include:_spf.resend.com -all"
_dmarc.drapeon.co TXT "v=DMARC1; p=quarantine; rua=mailto:dmarc-reports@drapeon.co; pct=100; adkim=r; aspf=r"
```

Keep the existing Resend DKIM record in place. After at least one week of clean
DMARC aggregate reports, move DMARC from `p=quarantine` to `p=reject`.

Verify after DNS propagation:

```sh
dig TXT drapeon.co
dig TXT _dmarc.drapeon.co
dig TXT resend._domainkey.drapeon.co
```

## Ops Control Plane

Production `/ops` must be protected by Cloudflare Access before the Next.js app
receives the request.

Required Cloudflare Access policy:

- Application path or hostname covering `/ops*`
- Identity provider: Drapeon workforce identity
- Allowed domain: `drapeon.co`
- Optional explicit email allowlist for founder/staff bootstrap accounts
- Session duration no longer than one workday

Required web runtime variables:

```text
CF_ACCESS_TEAM_DOMAIN=<team>.cloudflareaccess.com
CF_ACCESS_AUD=<cloudflare-access-audience>
OPS_ALLOWED_EMAIL_DOMAIN=drapeon.co
OPS_ADMIN_EMAILS=<comma-separated admin emails>
```

The app also fails closed in production when `/ops` is reached without
Cloudflare Access configuration, unless `OPS_ALLOW_BOOTSTRAP_IN_PRODUCTION=1`
is set for a documented emergency window.

## CSP Readiness

The web app uses per-request CSP script nonces from `apps/web/middleware.ts`.
Do not re-add `unsafe-inline` or `unsafe-eval` to `script-src`.

Quick smoke check:

```sh
curl -I https://drapeon.co
```

Confirm:

- `Content-Security-Policy` is present.
- `script-src` includes a `nonce-...` value.
- `script-src` does not include `unsafe-inline` or `unsafe-eval`.
- `Strict-Transport-Security` includes `preload`.

## Account Deletion Finalizer

The `finalize-account-deletions` Edge Function must be deployed and the
scheduled job must be present. The job is created by
`20260702000002_schedule_account_deletion_finalizer.sql`.

Protected readiness should report the job in service health:

```sh
curl -H "Authorization: Bearer $DRAPE_HEALTHCHECK_SECRET" \
  "https://<project-ref>.supabase.co/functions/v1/service-health?check=ready"
```
