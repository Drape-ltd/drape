import type { DailyCall, DailyEvent, DailyMeetingState } from '@daily-co/react-native-daily-js'

const disposalTasks = new WeakMap<DailyCall, Promise<void>>()

export type DailyCallSnapshot = {
  destroyed: boolean
  meetingState: DailyMeetingState | null
  audioOnly: boolean
}

export function readDailyCallSnapshot(call: DailyCall | null | undefined): DailyCallSnapshot {
  if (!call) return { destroyed: true, meetingState: null, audioOnly: true }

  try {
    if (call.isDestroyed()) return { destroyed: true, meetingState: null, audioOnly: true }
    return {
      destroyed: false,
      meetingState: call.meetingState(),
      audioOnly: !call.localVideo(),
    }
  } catch {
    return { destroyed: true, meetingState: null, audioOnly: true }
  }
}

export function removeDailyCallListener(
  call: DailyCall,
  event: DailyEvent,
  listener: unknown,
) {
  try {
    if (!call.isDestroyed()) {
      const removeListener = call.off.bind(call) as (eventName: DailyEvent, handler: unknown) => DailyCall
      removeListener(event, listener)
    }
  } catch {
    // Daily strict mode rejects all instance access after destroy.
  }
}

export function disposeDailyCall(
  call: DailyCall | null | undefined,
  options?: { leave?: boolean },
): Promise<void> {
  if (!call) return Promise.resolve()
  const existing = disposalTasks.get(call)
  if (existing) return existing

  const task = (async () => {
    const initial = readDailyCallSnapshot(call)
    if (initial.destroyed) return

    if (options?.leave !== false && initial.meetingState !== 'left-meeting' && initial.meetingState !== 'new') {
      try {
        await call.leave()
      } catch {
        // The room may have ended or another lifecycle owner may be leaving it.
      }
    }

    try {
      if (!call.isDestroyed()) await call.destroy()
    } catch {
      // Destruction is idempotent at the Drapeon lifecycle boundary.
    }
  })()

  disposalTasks.set(call, task)
  void task.finally(() => {
    if (disposalTasks.get(call) === task) disposalTasks.delete(call)
  })
  return task
}
