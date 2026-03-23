import { redirect } from 'next/navigation'

export default async function TailorDetailPage(): Promise<never> {
  redirect('/join')
}
