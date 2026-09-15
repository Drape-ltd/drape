import { redirect } from 'next/navigation'

type JoinPageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> }

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

export default async function JoinPage({ searchParams }: JoinPageProps): Promise<never> {
  const params = await searchParams
  const referral = firstParam(params.ref)
  redirect(referral ? `/sign-up?ref=${encodeURIComponent(referral)}` : '/sign-up')
}
