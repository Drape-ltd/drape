import { NextResponse } from 'next/server'
import { OPS_SESSION_COOKIE } from '../../../lib/ops-auth'

export async function POST(request: Request) {
  const url = new URL('/ops', request.url)
  url.searchParams.set('notice', 'ops-signed-out')

  const response = NextResponse.redirect(url)
  response.cookies.delete(OPS_SESSION_COOKIE)
  return response
}
