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
export DRAPE_TEST_CUSTOMER_EMAIL=e2e-customer@drape.test
export DRAPE_TEST_TAILOR_EMAIL=e2e-tailor@drape.test
export DRAPE_TEST_PASSWORD=Drape2025!
export E2E_SUPABASE_URL=https://your-project-ref.supabase.co
export E2E_SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

## Test accounts

Seed the two test accounts and fixture orders before running the stateful flows:

```bash
pnpm --filter @drape/db seed:e2e
```

That script:
1. creates the customer and tailor auth users
2. creates a live tailor profile
3. seeds measurements for the customer
4. creates fixture orders for the later flows

## Running

```bash
# Run all flows (against iOS Simulator)
source .maestro/env.sh && maestro test .maestro/flows/

# Run a seeded flow directly
source .maestro/env.sh && maestro test .maestro/flows/04-brief-to-quote.yaml

# Run a sign-up flow directly
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
| `04-brief-to-quote.yaml` | Full flow: brief → quote v1 → customer revision → quote v2 → customer accepts |
| `05-production-stages.yaml` | Tailor advances CONFIRMED → CUTTING → SEWING → FINISHING → SHIPPED |
| `06-dispute-flow.yaml` | Customer opens dispute from SHIPPED order |
| `07-sign-in-and-sign-out.yaml` | Session persistence after background, sign out |
| `08-brief-fit-notes-return.yaml` | Customer opens fit notes from a brief and returns to the same measurements step |
| `09-message-media.yaml` | Three-item message mosaic → exact-item viewer paging → per-item reply |
| `10-drape-vision-ui.yaml` | Vision hub → height confidence → scan picker → contextual measurements exit |

Flow `04` also verifies the formal negotiation contract: a customer revision request consumes one round, the tailor's revised quote supersedes the first version, and the customer can only accept the active quote.

## Notes

- Flows `03–07` require the seeded test accounts and fixture orders (see above).
- Flows run sequentially in the order listed; `04` must complete before `05` or `06` have the right order state.
- For CI: use `maestro cloud` with your Maestro Cloud API key, or run on a hosted iOS simulator.
