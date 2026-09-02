import { redirect } from 'next/navigation'

export default async function AccountTailorDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<React.JSX.Element> {
  const { id } = await params
  redirect(`/tailors/${encodeURIComponent(id)}`)
}
