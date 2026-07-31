import {
  buildOrderAppointmentIcs,
  buildGoogleCalendarEventUrl,
  deriveOrderAppointmentActions,
  normalizeOrderAppointmentSlots,
  validateOrderAppointmentProposal,
  type OrderAppointment,
} from '../src/order-appointments'

const baseAppointment: OrderAppointment = {
  id: 'appointment-1',
  orderId: 'order-1',
  replacesAppointmentId: null,
  kind: 'CONSULTATION',
  status: 'PROPOSED',
  proposerRole: 'CUSTOMER',
  callType: 'AUDIO',
  reasonCode: 'BRIEF_CLARIFICATION',
  note: null,
  timezone: 'America/Chicago',
  durationMinutes: 30,
  version: 1,
  slots: [],
  selectedSlotId: null,
  scheduledStartAt: null,
  scheduledEndAt: null,
  confirmedAt: null,
  cancelledAt: null,
  completedAt: null,
  createdAt: '2026-07-28T12:00:00.000Z',
  updatedAt: '2026-07-28T12:00:00.000Z',
}

describe('order appointments', () => {
  it('normalizes, sorts, and limits candidate slots', () => {
    const slots = normalizeOrderAppointmentSlots(
      [
        '2026-07-29T14:00:00.000Z',
        '2026-07-29T13:00:00.000Z',
        '2026-07-29T13:00:00.000Z',
        '2026-07-29T16:00:00.000Z',
        '2026-07-29T17:00:00.000Z',
      ],
      30,
    )

    expect(slots).toHaveLength(3)
    expect(slots[0]).toMatchObject({
      startsAt: '2026-07-29T13:00:00.000Z',
      endsAt: '2026-07-29T13:30:00.000Z',
      rank: 1,
    })
  })

  it('requires a supported duration and enough notice', () => {
    expect(
      validateOrderAppointmentProposal({
        startsAtValues: ['2026-07-28T12:10:00.000Z'],
        durationMinutes: 30,
        nowMs: new Date('2026-07-28T12:00:00.000Z').getTime(),
      }).ok,
    ).toBe(false)
    expect(
      validateOrderAppointmentProposal({
        startsAtValues: ['2026-07-28T13:00:00.000Z'],
        durationMinutes: 20,
        nowMs: new Date('2026-07-28T12:00:00.000Z').getTime(),
      }).ok,
    ).toBe(false)
  })

  it('lets only the recipient accept a proposed slot', () => {
    const customer = deriveOrderAppointmentActions({
      appointment: baseAppointment,
      actorRole: 'CUSTOMER',
    })
    const tailor = deriveOrderAppointmentActions({
      appointment: baseAppointment,
      actorRole: 'TAILOR',
    })

    expect(customer.primary?.kind).toBe('EDIT_PROPOSAL')
    expect(tailor.primary?.kind).toBe('ACCEPT_SLOT')
  })

  it('offers join only inside the confirmed call window', () => {
    const appointment: OrderAppointment = {
      ...baseAppointment,
      status: 'CONFIRMED',
      selectedSlotId: 'slot-1',
      scheduledStartAt: '2026-07-28T13:00:00.000Z',
      scheduledEndAt: '2026-07-28T13:30:00.000Z',
      confirmedAt: '2026-07-28T12:00:00.000Z',
    }
    const before = deriveOrderAppointmentActions({
      appointment,
      actorRole: 'CUSTOMER',
      nowMs: new Date('2026-07-28T12:30:00.000Z').getTime(),
    })
    const active = deriveOrderAppointmentActions({
      appointment,
      actorRole: 'CUSTOMER',
      nowMs: new Date('2026-07-28T12:58:00.000Z').getTime(),
    })

    expect(before.primary?.kind).toBe('ADD_TO_CALENDAR')
    expect(active.primary?.kind).toBe('JOIN')
  })

  it('builds a portable calendar event for confirmed appointments', () => {
    const appointment: OrderAppointment = {
      ...baseAppointment,
      status: 'CONFIRMED',
      scheduledStartAt: '2026-07-28T13:00:00.000Z',
      scheduledEndAt: '2026-07-28T13:30:00.000Z',
      confirmedAt: '2026-07-28T12:00:00.000Z',
    }
    const ics = buildOrderAppointmentIcs({
      appointment,
      deepLink: 'drapeon://orders/order-1?view=messages',
      now: '2026-07-28T12:00:00.000Z',
    })

    expect(ics).toContain('BEGIN:VEVENT')
    expect(ics).toContain('DTSTART:20260728T130000Z')
    expect(ics).toContain('drapeon://orders/order-1?view=messages')
  })

  it('builds a Google Calendar URL for legacy scheduled calls', () => {
    const url = buildGoogleCalendarEventUrl({
      startsAt: '2026-07-28T13:00:00.000Z',
      durationMinutes: 30,
      title: 'Drapeon — Scheduled order call',
      description: 'Item condition',
    })

    expect(url).toContain('calendar.google.com/calendar/render?')
    expect(url).toContain('dates=20260728T130000Z%2F20260728T133000Z')
    expect(url).toContain('Item%20condition')
  })
})
