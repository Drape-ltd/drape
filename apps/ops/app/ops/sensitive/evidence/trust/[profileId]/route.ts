// Keep private trust evidence under the dedicated Cloudflare Access sensitive
// application so every request carries its MFA-enforced audience token.
export { POST } from '../../../../../../../web/app/ops/identity-document/[profileId]/route'
