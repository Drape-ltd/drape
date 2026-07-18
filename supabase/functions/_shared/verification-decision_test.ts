import {
  INVALID_PROFILE_IMAGE_REJECTION_CODE,
  PROFILE_IMAGE_REJECTION_REASON,
  performVerificationDecision,
  VERIFICATION_REJECTION_REASON_REQUIRED,
  type VerificationEmailMessage,
} from './verification-decision.ts'

type Call = {
  type: string
  table?: string
  fn?: string
  payload?: Record<string, unknown>
  args?: Record<string, unknown>
}

function expect(condition: boolean, message: string) {
  if (!condition) throw new Error(message)
}

function expectEquals(actual: unknown, expected: unknown, message: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}\nExpected: ${JSON.stringify(expected)}\nActual: ${JSON.stringify(actual)}`)
  }
}

function createFakeSupabase(options?: {
  profileStatus?: string
  userEmail?: string | null
  profileReady?: boolean
}) {
  const calls: Call[] = []
  const profileReady = options?.profileReady !== false
  const profile = {
    id: 'profile-1',
    user_id: 'tailor-1',
    display_name: 'Amara Atelier',
    id_verification_status: options?.profileStatus ?? 'PENDING',
    id_selfie_document_url: profileReady ? 'id-verification/tailor-1/selfie_123.jpg' : null,
    avatar_url: profileReady ? 'avatars/tailor-1/avatar.jpg' : null,
    specialty_tags: profileReady ? ['Agbada'] : [],
    portfolio_photo_urls: profileReady ? ['portfolio/tailor-1/look.jpg'] : [],
    portfolio_video_urls: [],
    payout_account_verified: profileReady,
    payout_reverification_required: false,
    paystack_recipient_code: profileReady ? 'RCP_test' : null,
    stripe_connect_account_id: null,
  }
  const user = {
    email: options?.userEmail === undefined ? 'amara@example.com' : options.userEmail,
    display_name: 'Amara',
    phone: profileReady ? '+2348012345678' : null,
  }
  const issue = {
    id: 'issue-1',
    status: 'OPEN',
    assigned_to: null,
    resolved_at: null,
  }
  const portfolioItems = [
    { image_url: 'portfolio/tailor-1/look-a.jpg' },
    { image_url: 'portfolio/tailor-1/look-b.jpg' },
  ]

  function builder(table: string) {
    const chain = {
      select(_columns: string) {
        return chain
      },
      eq(_column: string, _value: unknown) {
        return chain
      },
      order(_column: string, _options?: Record<string, unknown>) {
        return chain
      },
      limit(_count: number) {
        return chain
      },
      update(payload: Record<string, unknown>) {
        calls.push({ type: 'update', table, payload })
        return chain
      },
      async maybeSingle() {
        if (table === 'tailor_profiles') return { data: profile, error: null }
        if (table === 'users') return { data: user, error: null }
        if (table === 'ops_issues') return { data: issue, error: null }
        return { data: null, error: null }
      },
      async insert(payload: Record<string, unknown>) {
        calls.push({ type: 'insert', table, payload })
        return { data: null, error: null }
      },
      then(resolve: (value: { data: unknown; error: null }) => unknown, reject: (reason?: unknown) => unknown) {
        const data = table === 'portfolio_items' ? portfolioItems : null
        return Promise.resolve({ data, error: null }).then(resolve, reject)
      },
    }
    return chain
  }

  return {
    calls,
    client: {
      from: (table: string) => builder(table),
      async rpc(fn: string, args: Record<string, unknown>) {
        calls.push({ type: 'rpc', fn, args })
        return {
          data: [{
            profile_id: profile.id,
            status: args.p_decision === 'APPROVE' ? 'VERIFIED' : 'REJECTED',
          }],
          error: null,
        }
      },
    },
  }
}

Deno.test('performVerificationDecision approves a pending tailor, resolves ops issue, audits, and sends email', async () => {
  const fake = createFakeSupabase()
  const messages: VerificationEmailMessage[] = []
  const pushes: Array<{ userId: string; title: string; body: string }> = []

  const result = await performVerificationDecision(
    fake.client,
    {
      tailorUserId: 'tailor-1',
      decision: 'APPROVE',
      performedBy: 'trust@drapeon.co',
      performedRole: 'TRUST',
      source: 'ops_dashboard',
    },
    {
      appUrl: 'https://drape.test',
      sendEmail: async (message) => {
        messages.push(message)
      },
      sendPush: async (userId, message) => {
        pushes.push({ userId, title: message.title, body: message.body })
        return { status: 'SENT' }
      },
      now: () => new Date('2026-05-01T12:00:00.000Z'),
    },
  )

  expect(result.ok, 'approval should succeed')
  expectEquals(
    fake.calls.find((call) => call.type === 'rpc'),
    {
      type: 'rpc',
      fn: 'ops_decide_verification',
      args: { p_tailor_user_id: 'tailor-1', p_decision: 'APPROVE', p_reason: null },
    },
    'approval should call the canonical verification RPC',
  )
  expect(
    fake.calls.some((call) => call.type === 'update' && call.table === 'ops_issues' && call.payload?.status === 'RESOLVED'),
    'approval should resolve the verification ops issue',
  )
  expect(
    fake.calls.some((call) => (
      call.type === 'update'
      && call.table === 'tailor_profiles'
      && JSON.stringify(call.payload?.portfolio_photo_urls) === JSON.stringify(['portfolio/tailor-1/look-a.jpg', 'portfolio/tailor-1/look-b.jpg'])
    )),
    'approval should resync public portfolio photo URLs from portfolio items',
  )
  expect(
    fake.calls.some((call) => call.type === 'insert' && call.table === 'audit_logs' && call.payload?.event === 'ops.verification_decision_logged'),
    'approval should write the audit trail',
  )
  expectEquals(messages.length, 1, 'approval should send one tailor email')
  expect(messages[0]!.subject.includes('verified'), 'approval email should confirm verification')
  expectEquals(pushes.length, 1, 'approval should send one tailor push notification')
  expectEquals(pushes[0]?.userId, 'tailor-1', 'approval push should target the tailor')
  expect(pushes[0]!.title.includes('live'), 'approval push should tell the tailor they are live')
})

Deno.test('performVerificationDecision uses auth email fallback and records push status', async () => {
  const fake = createFakeSupabase({ userEmail: null })
  const messages: VerificationEmailMessage[] = []
  const pushes: Array<{ userId: string; title: string; body: string }> = []

  const result = await performVerificationDecision(
    fake.client,
    {
      tailorUserId: 'tailor-1',
      decision: 'APPROVE',
      performedBy: 'trust@drapeon.co',
      performedRole: 'TRUST',
      source: 'ops_dashboard',
    },
    {
      appUrl: 'https://drape.test',
      lookupUserEmail: async (userId) => userId === 'tailor-1' ? 'auth-tailor@example.com' : null,
      sendEmail: async (message) => {
        messages.push(message)
      },
      sendPush: async (userId, message) => {
        pushes.push({ userId, title: message.title, body: message.body })
        return { status: 'SENT' }
      },
      now: () => new Date('2026-05-01T12:00:00.000Z'),
    },
  )

  expect(result.ok, 'approval should succeed')
  expectEquals(messages[0]?.to, 'auth-tailor@example.com', 'approval email should fall back to auth user email')
  expectEquals(pushes.length, 1, 'approval should send push when email uses fallback')
  expect(
    fake.calls.some((call) => (
      call.type === 'insert'
      && call.table === 'audit_logs'
      && call.payload?.event === 'ops.verification_decision_logged'
      && (call.payload.payload as Record<string, unknown>)?.push_status === 'SENT'
    )),
    'audit log should include push status',
  )
})

Deno.test('performVerificationDecision rejects with a reason, resolves ops issue, audits, and sends reason email', async () => {
  const fake = createFakeSupabase()
  const messages: VerificationEmailMessage[] = []
  const reason = 'The uploaded ID image is cropped and the name is not visible.'

  const result = await performVerificationDecision(
    fake.client,
    {
      tailorUserId: 'tailor-1',
      decision: 'REJECT',
      reason,
      performedBy: 'trust@drapeon.co',
      performedRole: 'TRUST',
      source: 'ops_dashboard',
    },
    {
      appUrl: 'https://drape.test',
      sendEmail: async (message) => {
        messages.push(message)
      },
      now: () => new Date('2026-05-01T12:00:00.000Z'),
    },
  )

  expect(result.ok, 'rejection should succeed')
  expectEquals(
    fake.calls.find((call) => call.type === 'rpc'),
    {
      type: 'rpc',
      fn: 'ops_decide_verification',
      args: { p_tailor_user_id: 'tailor-1', p_decision: 'REJECT', p_reason: reason },
    },
    'rejection should call the canonical verification RPC',
  )
  expect(
    fake.calls.some((call) => call.type === 'insert' && call.table === 'ops_audit_logs' && call.payload?.reason === reason),
    'rejection should write the reason to issue audit history',
  )
  expectEquals(messages.length, 1, 'rejection should send one tailor email')
  expect(messages[0]!.html.includes(reason), 'rejection email should include the ops reason')
})

Deno.test('performVerificationDecision stores structured invalid profile image rejection code with standard copy', async () => {
  const fake = createFakeSupabase()
  const messages: VerificationEmailMessage[] = []

  const result = await performVerificationDecision(
    fake.client,
    {
      tailorUserId: 'tailor-1',
      decision: 'REJECT',
      rejectionCode: INVALID_PROFILE_IMAGE_REJECTION_CODE,
      performedBy: 'trust@drapeon.co',
      performedRole: 'TRUST',
      source: 'ops_dashboard',
    },
    {
      appUrl: 'https://drape.test',
      sendEmail: async (message) => {
        messages.push(message)
      },
      now: () => new Date('2026-05-01T12:00:00.000Z'),
    },
  )

  expect(result.ok, 'profile-image rejection should succeed with standard copy')
  expectEquals(
    fake.calls.find((call) => call.type === 'rpc'),
    {
      type: 'rpc',
      fn: 'ops_decide_verification',
      args: {
        p_tailor_user_id: 'tailor-1',
        p_decision: 'REJECT',
        p_reason: PROFILE_IMAGE_REJECTION_REASON,
        p_rejection_code: INVALID_PROFILE_IMAGE_REJECTION_CODE,
      },
    },
    'profile-image rejection should call RPC with structured code',
  )
  expect(
    fake.calls.some((call) =>
      call.type === 'insert' &&
      call.table === 'ops_audit_logs' &&
      call.payload?.reason === PROFILE_IMAGE_REJECTION_REASON
    ),
    'profile-image rejection should write standard reason to issue audit history',
  )
  expectEquals(messages.length, 1, 'profile-image rejection should send one tailor email')
  expect(messages[0]!.html.includes(PROFILE_IMAGE_REJECTION_REASON), 'email should include profile-image recovery copy')
})

Deno.test('performVerificationDecision refuses rejection without a reason before mutating anything', async () => {
  const fake = createFakeSupabase()
  const messages: VerificationEmailMessage[] = []

  const result = await performVerificationDecision(
    fake.client,
    {
      tailorUserId: 'tailor-1',
      decision: 'REJECT',
      performedBy: 'trust@drapeon.co',
      performedRole: 'TRUST',
      source: 'ops_dashboard',
    },
    {
      sendEmail: async (message) => {
        messages.push(message)
      },
    },
  )

  expect(!result.ok, 'rejection without a reason should fail')
  if (!result.ok) {
    expectEquals(result.code, VERIFICATION_REJECTION_REASON_REQUIRED, 'failure should be explicit')
  }
  expect(!fake.calls.some((call) => call.type === 'rpc'), 'missing reason should not update verification')
  expectEquals(messages.length, 0, 'missing reason should not send email')
})

Deno.test('performVerificationDecision blocks approval when go-live readiness is incomplete', async () => {
  const fake = createFakeSupabase({ profileReady: false })
  const messages: VerificationEmailMessage[] = []

  const result = await performVerificationDecision(
    fake.client,
    {
      tailorUserId: 'tailor-1',
      decision: 'APPROVE',
      performedBy: 'trust@drapeon.co',
      performedRole: 'TRUST',
      source: 'ops_dashboard',
    },
    {
      sendEmail: async (message) => {
        messages.push(message)
      },
    },
  )

  expect(!result.ok, 'approval should fail until seller readiness is complete')
  if (!result.ok) {
    expectEquals(result.code, 'TAILOR_GO_LIVE_PREFLIGHT_FAILED', 'failure should explain readiness gate')
  }
  expect(!fake.calls.some((call) => call.type === 'rpc'), 'readiness failure should not call the go-live RPC')
  expectEquals(messages.length, 0, 'readiness failure should not send approval email')
})
