import { NextResponse } from 'next/server'

function getWebPushPublicKey() {
  return (
    process.env.WEB_PUSH_VAPID_PUBLIC_KEY ??
    process.env.NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY ??
    ''
  ).trim()
}

export async function GET() {
  const publicKey = getWebPushPublicKey()

  return NextResponse.json(
    {
      enabled: publicKey.length > 0,
      publicKey: publicKey || null,
    },
    {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    },
  )
}
