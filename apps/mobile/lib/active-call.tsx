import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { DailyCall, DailyEvent, DailyParticipant } from '@daily-co/react-native-daily-js'
import { useAuth } from '@/lib/auth'
import {
  disposeDailyCall,
  readDailyCallSnapshot,
  removeDailyCallListener,
} from '@/lib/daily-call-lifecycle'

export type ActiveCallRouteContext = {
  orderId: string
  callKind: 'consultation' | 'ready-made'
  callType: 'audio' | 'video'
  historyChain?: string
}

export type ActiveCallSession = {
  call: DailyCall
  ownerUserId: string | null
  context: ActiveCallRouteContext
  meetingState: ReturnType<typeof readDailyCallSnapshot>['meetingState']
  audioOnly: boolean
  videoTrack: DailyParticipant['tracks']['video']['persistentTrack'] | null
  videoMirror: boolean
  videoLabel: string
}

type ActiveCallContextValue = {
  session: ActiveCallSession | null
  registerCall: (call: DailyCall, context: ActiveCallRouteContext) => void
  endCall: (call?: DailyCall | null, options?: { leave?: boolean }) => Promise<void>
}

const ActiveCallContext = createContext<ActiveCallContextValue | null>(null)

function readCallVideo(call: DailyCall) {
  try {
    const people = Object.values(call.participants())
    const remoteWithVideo = people.find((participant) =>
      !participant.local && !!participant.tracks.video.persistentTrack)
    const localWithVideo = people.find((participant) =>
      participant.local && !!participant.tracks.video.persistentTrack)
    const visibleParticipant = remoteWithVideo ?? localWithVideo ?? null
    return {
      videoTrack: visibleParticipant?.tracks.video.persistentTrack ?? null,
      videoMirror: visibleParticipant?.local === true,
      videoLabel: visibleParticipant?.local
        ? 'You'
        : visibleParticipant?.user_name?.trim() || 'Order partner',
    }
  } catch {
    return { videoTrack: null, videoMirror: false, videoLabel: 'Order partner' }
  }
}

export function ActiveCallProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const userId = user?.id ?? null
  const [session, setSession] = useState<ActiveCallSession | null>(null)
  const sessionRef = useRef<ActiveCallSession | null>(null)
  sessionRef.current = session

  const registerCall = useCallback((call: DailyCall, context: ActiveCallRouteContext) => {
    const snapshot = readDailyCallSnapshot(call)
    if (snapshot.destroyed) return
    const video = readCallVideo(call)
    setSession({
      call,
      ownerUserId: userId,
      context,
      meetingState: snapshot.meetingState,
      audioOnly: snapshot.audioOnly,
      ...video,
    })
  }, [userId])

  const endCall = useCallback(async (
    requestedCall?: DailyCall | null,
    options?: { leave?: boolean },
  ) => {
    const target = requestedCall ?? sessionRef.current?.call ?? null
    if (!target) return
    await disposeDailyCall(target, options)
    setSession((current) => current?.call === target ? null : current)
  }, [])

  useEffect(() => {
    if (!session) return undefined
    const { call } = session

    const sync = () => {
      const snapshot = readDailyCallSnapshot(call)
      if (snapshot.destroyed) {
        setSession((current) => current?.call === call ? null : current)
        return
      }
      const video = readCallVideo(call)
      setSession((current) => current?.call === call
        ? {
            ...current,
            meetingState: snapshot.meetingState,
            audioOnly: snapshot.audioOnly,
            ...video,
          }
        : current)
    }
    const ended = () => {
      setSession((current) => current?.call === call
        ? { ...current, meetingState: 'left-meeting' }
        : current)
      void disposeDailyCall(call, { leave: false }).finally(() => {
        setSession((current) => current?.call === call ? null : current)
      })
    }
    const destroyed = () => {
      setSession((current) => current?.call === call ? null : current)
    }

    const syncEvents: DailyEvent[] = [
      'joined-meeting',
      'participant-joined',
      'participant-updated',
      'participant-left',
      'network-connection',
    ]
    syncEvents.forEach((event) => call.on(event, sync))
    call.on('left-meeting', ended)
    call.on('call-instance-destroyed', destroyed)
    sync()

    return () => {
      syncEvents.forEach((event) => removeDailyCallListener(call, event, sync))
      removeDailyCallListener(call, 'left-meeting', ended)
      removeDailyCallListener(call, 'call-instance-destroyed', destroyed)
    }
  }, [session?.call])

  useEffect(() => {
    if (!session) return
    if (session.ownerUserId === userId) return
    void endCall(session.call)
  }, [endCall, session, userId])

  const value = useMemo<ActiveCallContextValue>(() => ({
    session,
    registerCall,
    endCall,
  }), [endCall, registerCall, session])

  return <ActiveCallContext.Provider value={value}>{children}</ActiveCallContext.Provider>
}

export function useActiveCall() {
  const value = useContext(ActiveCallContext)
  if (!value) throw new Error('useActiveCall must be used inside ActiveCallProvider')
  return value
}
