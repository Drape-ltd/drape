import { redirect } from 'next/navigation'

type ApplyPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

export default async function ApplyPage({ searchParams }: ApplyPageProps): Promise<never> {
  const params = await searchParams
  const destination = new URLSearchParams({ role: 'TAILOR' })
  const source = first(params?.source)

  if (source) destination.set('source', source)

  redirect(`/sign-up?${destination.toString()}`)
}
