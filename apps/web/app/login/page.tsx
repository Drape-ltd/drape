import { redirect } from 'next/navigation'

type LoginPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

export default async function LoginPage({ searchParams }: LoginPageProps): Promise<never> {
  const params = await searchParams
  const nextParams = new URLSearchParams()
  const reason = firstParam(params.reason)
  const role = firstParam(params.role)

  if (reason) nextParams.set('reason', reason)
  if (role) nextParams.set('role', role)

  const query = nextParams.toString()
  redirect(query ? `/sign-in?${query}` : '/sign-in')
}
