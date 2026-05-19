const CONSULTATION_DURATION_MINUTES = 30;

type SupabaseLike = {
  from: (table: string) => any;
};

type BookingResult =
  | { ok: true; scheduledEndAt: string; reservationState?: "created" | "existing" }
  | { ok: false; status: number; code: string; error: string };

function isConstraintConflict(error: { code?: string | null; message?: string | null } | null | undefined) {
  if (!error) return false;
  return error.code === "23P01" ||
    error.code === "23505" ||
    (error.message ?? "").includes("consultation_bookings_no_tailor_overlap") ||
    (error.message ?? "").includes("consultation_bookings_one_active_order_idx");
}

export function consultationScheduledEndAt(scheduledStartAt: string, minutes = CONSULTATION_DURATION_MINUTES) {
  return new Date(new Date(scheduledStartAt).getTime() + minutes * 60 * 1000).toISOString();
}

export async function assertConsultationSlotAvailable(
  supabase: SupabaseLike,
  input: {
    orderId: string;
    tailorId: string;
    scheduledStartAt: string;
    scheduledEndAt?: string | null;
  },
): Promise<BookingResult> {
  const scheduledEndAt = input.scheduledEndAt ?? consultationScheduledEndAt(input.scheduledStartAt);
  const { data, error } = await supabase
    .from("consultation_bookings")
    .select("id, order_id, scheduled_start_at, scheduled_end_at")
    .eq("tailor_id", input.tailorId)
    .eq("status", "CONFIRMED")
    .neq("order_id", input.orderId)
    .lt("scheduled_start_at", scheduledEndAt)
    .gt("scheduled_end_at", input.scheduledStartAt)
    .limit(1);

  if (error) {
    return {
      ok: false,
      status: 500,
      code: "CONSULTATION_AVAILABILITY_CHECK_FAILED",
      error: "Could not check that consultation time right now. Try again in a moment.",
    };
  }

  if (Array.isArray(data) && data.length > 0) {
    return {
      ok: false,
      status: 409,
      code: "CONSULTATION_SLOT_UNAVAILABLE",
      error: "That consultation time is no longer available. Choose another time before continuing.",
    };
  }

  return { ok: true, scheduledEndAt };
}

export async function reserveConsultationSlot(
  supabase: SupabaseLike,
  input: {
    orderId: string;
    tailorId: string;
    customerId: string;
    scheduledStartAt: string;
    scheduledEndAt?: string | null;
  },
): Promise<BookingResult> {
  const scheduledEndAt = input.scheduledEndAt ?? consultationScheduledEndAt(input.scheduledStartAt);
  const { data: existing, error: lookupError } = await supabase
    .from("consultation_bookings")
    .select("id, scheduled_start_at, scheduled_end_at")
    .eq("order_id", input.orderId)
    .eq("status", "CONFIRMED")
    .maybeSingle();

  if (lookupError) {
    return {
      ok: false,
      status: 500,
      code: "CONSULTATION_SLOT_LOOKUP_FAILED",
      error: "Could not check the existing consultation slot. Try again in a moment.",
    };
  }

  if (existing?.id) {
    const existingStart = new Date(existing.scheduled_start_at).getTime();
    const requestedStart = new Date(input.scheduledStartAt).getTime();
    const existingEnd = new Date(existing.scheduled_end_at).getTime();
    const requestedEnd = new Date(scheduledEndAt).getTime();

    if (existingStart === requestedStart && existingEnd === requestedEnd) {
      return { ok: true, scheduledEndAt: existing.scheduled_end_at, reservationState: "existing" };
    }

    return {
      ok: false,
      status: 409,
      code: "CONSULTATION_ALREADY_BOOKED",
      error: "This consultation already has a reserved time. Refresh the order before changing it.",
    };
  }

  const payload = {
    order_id: input.orderId,
    tailor_id: input.tailorId,
    customer_id: input.customerId,
    scheduled_start_at: input.scheduledStartAt,
    scheduled_end_at: scheduledEndAt,
    status: "CONFIRMED",
    source: "ORDER_CONSULTATION",
  };

  const result = await supabase
    .from("consultation_bookings")
    .insert(payload)
    .select("id")
    .single();

  if (result.error) {
    if (isConstraintConflict(result.error)) {
      return {
        ok: false,
        status: 409,
        code: "CONSULTATION_SLOT_UNAVAILABLE",
        error: "That consultation time was just taken. Choose another time before continuing.",
      };
    }

    return {
      ok: false,
      status: 500,
      code: "CONSULTATION_SLOT_RESERVATION_FAILED",
      error: "Could not reserve that consultation time right now. Try again in a moment.",
    };
  }

  return { ok: true, scheduledEndAt, reservationState: "created" };
}

export async function releaseConsultationSlot(
  supabase: SupabaseLike,
  orderId: string,
  status: "CANCELLED" | "COMPLETED" = "CANCELLED",
) {
  await supabase
    .from("consultation_bookings")
    .update({ status })
    .eq("order_id", orderId)
    .eq("status", "CONFIRMED");
}
