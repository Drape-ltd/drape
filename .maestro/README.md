# Drape — E2E Tests (Maestro)

## Setup

```bash
# Install Maestro CLI (macOS)
curl -Ls "https://get.maestro.mobile.dev" | bash

# Verify
maestro --version
```

## Environment variables

Set these before running flows (or export them in CI):

```bash
export DRAPE_TEST_CUSTOMER_EMAIL=testcustomer@drape.test
export DRAPE_TEST_TAILOR_EMAIL=testtailor@drape.test
export DRAPE_TEST_PASSWORD=Drape2025!
```

## Test accounts

Create the two test accounts in Supabase before running flows 03–07:
1. Sign up manually as customer (`DRAPE_TEST_CUSTOMER_EMAIL`) in the app
2. Sign up manually as tailor (`DRAPE_TEST_TAILOR_EMAIL`), complete profile setup
3. In Supabase Dashboard → Table Editor → `tailor_profiles`, set `is_live = true` for the test tailor

## Running

```bash
# Run all flows (against iOS Simulator)
maestro test .maestro/flows/

# Run a single flow
maestro test .maestro/flows/01-customer-signup.yaml

# Run with a specific device
maestro test --device <UDID> .maestro/flows/
```

## Flows

| File | What it tests |
|------|--------------|
| `01-customer-signup.yaml` | Customer email sign-up → lands on home |
| `02-tailor-signup.yaml` | Tailor sign-up → profile setup → home |
| `03-contact-filter.yaml` | Contact filter blocks phone/social in messages |
| `04-brief-to-quote.yaml` | Full flow: brief → tailor quotes → customer accepts |
| `05-production-stages.yaml` | Tailor advances CONFIRMED → CUTTING → SEWING → FINISHING → SHIPPED |
| `06-dispute-flow.yaml` | Customer opens dispute from SHIPPED order |
| `07-sign-in-and-sign-out.yaml` | Session persistence after background, sign out |

## Notes

- Flows `03–07` require pre-seeded test accounts (see above).
- Flows run sequentially in the order listed; `04` must complete before `05` or `06` have the right order state.
- For CI: use `maestro cloud` with your Maestro Cloud API key, or run on a hosted iOS simulator.
