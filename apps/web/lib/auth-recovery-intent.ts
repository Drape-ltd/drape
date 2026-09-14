export const RECOVERY_INTENT_KEY = 'drapeon.web.auth.recoveryIntent.v1'
// Set only while a fresh reset request is being handed from the normal auth
// callback to the recovery bridge. This lets the bridge recognize a PKCE
// session that the browser client consumed during callback boot without
// accepting an unrelated pre-existing session.
export const RECOVERY_HANDOFF_KEY = 'drapeon.web.auth.recoveryHandoff.v1'
