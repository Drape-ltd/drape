// The isolated Ops application and the legacy read-only surface intentionally
// share one audited, no-store evidence proxy during parallel run. Keeping one
// handler prevents policy, rate-limit, and access-log drift while the monolith
// is retired.
export { POST } from '../../../../../../web/app/ops/identity-document/[profileId]/route'
