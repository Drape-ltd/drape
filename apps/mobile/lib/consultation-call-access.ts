import { supabase } from '@/lib/supabase'

type ConsultationCallAccess = {
  bookingId: string | null
  rescheduleRequired: boolean
}

export async function getConsultationCallAccess(orderId: string): Promise<ConsultationCallAccess> {
  const { data: booking, error: bookingError } = await supabase
    .from('consultation_bookings')
    .select('id')
    .eq('order_id', orderId)
    .in('status', ['CONFIRMED', 'COMPLETED', 'NO_SHOW'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (bookingError) throw bookingError
  if (!booking?.id) return { bookingId: null, rescheduleRequired: false }

  return {
    bookingId: booking.id,
    rescheduleRequired: false,
  }
}
