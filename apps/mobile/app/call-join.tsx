import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { Feather } from '@expo/vector-icons'
import { type Href, useLocalSearchParams, useNavigation, useRouter } from 'expo-router'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import Daily, {
  DailyMediaView,
  type DailyCall,
  type DailyEventObjectNetworkConnectionEvent,
  type DailyParticipant,
  type DailyParticipantsObject,
} from '@daily-co/react-native-daily-js'
import { useAuth, useUserRole } from '@/lib/auth'
import { createConsultationRoom } from '@/lib/consultation'
import { createOrderCallRoom } from '@/lib/order-call'
import { useActiveCall } from '@/lib/active-call'
import {
  disposeDailyCall,
  readDailyCallSnapshot,
  removeDailyCallListener,
} from '@/lib/daily-call-lifecycle'
import { supabase } from '@/lib/supabase'
import { useContextualBackHandler } from '@/lib/use-contextual-back'
import { goBackOrReturnTo } from '@/lib/navigation'
import { ContextualSwipeBack } from '@/components/ui/ContextualSwipeBack'
import { Colors, Fonts, FontSize, FontWeight, Radius, Shadow, Spacing } from '@/constants/theme'
import { formatStatusLabel } from '@drape/shared/status-display'

type CallKind = 'consultation' | 'ready-made'
type CallType = 'audio' | 'video'
type CallPhase = 'ready' | 'preparing' | 'lobby' | 'joining' | 'joined' | 'reconnecting' | 'error'
type OrderCallContext = {
  reference: string | null
  stage: string
  order_kind: string | null
  garment_type: string | null
  item_title: string | null
  item_size: string | null
  fulfillment_option: string | null
}

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function isUuid(value: string | null | undefined): value is string {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}

function readCallKind(value: string | null | undefined): CallKind {
  return value === 'consultation' ? 'consultation' : 'ready-made'
}

function readCallType(value: string | null | undefined): CallType {
  return value === 'audio' ? 'audio' : 'video'
}

function messagesPath(role: string | null | undefined, orderId: string | null) {
  const base = role === 'TAILOR' ? '/(tailor)' : '/(customer)'
  return orderId ? `${base}/messages/${orderId}` : base
}

function participantTrack(
  participant: DailyParticipant | null,
  kind: 'audio' | 'video',
) {
  return participant?.tracks[kind]?.persistentTrack ?? null
}

function participantList(participants: DailyParticipantsObject | null) {
  return participants ? Object.values(participants) : []
}

export default function CallJoinScreen() {
  const router = useRouter()
  const navigation = useNavigation()
  const role = useUserRole()
  const { user } = useAuth()
  const { session: activeCallSession, registerCall, endCall } = useActiveCall()
  const insets = useSafeAreaInsets()
  const params = useLocalSearchParams<{
    orderId?: string | string[]
    callKind?: string | string[]
    callType?: string | string[]
    historyChain?: string | string[]
  }>()
  const orderId = firstParam(params.orderId)
  const validOrderId = isUuid(orderId) ? orderId : null
  const callKind = readCallKind(firstParam(params.callKind))
  const callType = readCallType(firstParam(params.callType))
  const historyChain = firstParam(params.historyChain)
  const roleAudience = role === 'TAILOR' ? 'tailor' : role === 'CUSTOMER' ? 'customer' : 'generic'
  const displayName = String(user?.user_metadata?.display_name ?? '').trim() ||
    (role === 'TAILOR' ? 'Tailor' : 'Customer')
  const activeRouteContext = useMemo(() => validOrderId ? ({
    orderId: validOrderId,
    callKind,
    callType,
    ...(historyChain ? { historyChain } : {}),
  }) : null, [callKind, callType, historyChain, validOrderId])

  const [phase, setPhase] = useState<CallPhase>('ready')
  const [call, setCall] = useState<DailyCall | null>(null)
  const [participants, setParticipants] = useState<DailyParticipantsObject | null>(null)
  const [microphoneOn, setMicrophoneOn] = useState(true)
  const [cameraOn, setCameraOn] = useState(callType === 'video')
  const [speakerOn, setSpeakerOn] = useState(callType === 'video')
  const [roomAccess, setRoomAccess] = useState<{ url: string; token: string } | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [orderContext, setOrderContext] = useState<OrderCallContext | null>(null)
  const [orderContextOpen, setOrderContextOpen] = useState(false)
  const exitInFlightRef = useRef(false)
  const autoPreparedOrderIdRef = useRef<string | null>(null)

  const people = useMemo(() => participantList(participants), [participants])
  const localParticipant = people.find((participant) => participant.local) ?? null
  const remoteParticipant = people.find((participant) => !participant.local) ?? null
  const counterpartName = remoteParticipant?.user_name?.trim() || 'Your order partner'
  const remoteVideo = participantTrack(remoteParticipant, 'video')
  const remoteAudio = participantTrack(remoteParticipant, 'audio')
  const localVideo = participantTrack(localParticipant, 'video')

  useEffect(() => {
    if (!validOrderId) return
    let active = true
    void supabase
      .from('orders')
      .select('reference, stage, order_kind, garment_type, item_title, item_size, fulfillment_option')
      .eq('id', validOrderId)
      .maybeSingle()
      .then(({ data }) => {
        if (active && data) setOrderContext(data as OrderCallContext)
      })
    return () => {
      active = false
    }
  }, [validOrderId])

  const openMessages = useCallback(() => {
    goBackOrReturnTo(
      router,
      navigation,
      historyChain,
      messagesPath(role ?? null, validOrderId) as Href,
      { fromPath: '/call-join', dismissToTarget: true },
    )
  }, [historyChain, navigation, role, router, validOrderId])

  useEffect(() => {
    if (!call) return undefined

    const syncParticipants = () => {
      if (!readDailyCallSnapshot(call).destroyed) {
        try {
          setParticipants({ ...call.participants() })
        } catch {
          // The root call owner will clear a concurrently destroyed instance.
        }
      }
    }
    const joined = () => {
      syncParticipants()
      setPhase('joined')
    }
    const left = () => {
      void endCall(call, { leave: false })
        .finally(() => setCall((current) => current === call ? null : current))
      if (!exitInFlightRef.current) {
        exitInFlightRef.current = true
        openMessages()
      }
    }
    const networkChanged = (event: DailyEventObjectNetworkConnectionEvent) => {
      syncParticipants()
      if (readDailyCallSnapshot(call).meetingState !== 'joined-meeting') return
      setPhase(event.event === 'interrupted' ? 'reconnecting' : 'joined')
    }
    const failed = () => {
      setErrorMessage('The call connection was interrupted. You can retry or continue in the browser.')
      setPhase('error')
    }

    call.on('participant-joined', syncParticipants)
    call.on('participant-updated', syncParticipants)
    call.on('participant-left', syncParticipants)
    call.on('joined-meeting', joined)
    call.on('left-meeting', left)
    call.on('network-connection', networkChanged)
    call.on('error', failed)

    return () => {
      removeDailyCallListener(call, 'participant-joined', syncParticipants)
      removeDailyCallListener(call, 'participant-updated', syncParticipants)
      removeDailyCallListener(call, 'participant-left', syncParticipants)
      removeDailyCallListener(call, 'joined-meeting', joined)
      removeDailyCallListener(call, 'left-meeting', left)
      removeDailyCallListener(call, 'network-connection', networkChanged)
      removeDailyCallListener(call, 'error', failed)
    }
  }, [call, endCall, openMessages])

  async function prepareLobby() {
    if (!validOrderId || phase === 'preparing') return
    setPhase('preparing')
    setErrorMessage(null)

    const registeredCall = activeCallSession?.context.orderId === validOrderId
      ? activeCallSession.call
      : null
    const existingCall = registeredCall ?? call ?? Daily.getCallInstance()
    if (existingCall) {
      const snapshot = readDailyCallSnapshot(existingCall)
      if (!snapshot.destroyed && snapshot.meetingState === 'joined-meeting' && activeRouteContext) {
        registerCall(existingCall, activeRouteContext)
        setCall(existingCall)
        try {
          setParticipants({ ...existingCall.participants() })
          setMicrophoneOn(existingCall.localAudio())
          setCameraOn(existingCall.localVideo())
        } catch {
          // A concurrent meeting-ended event will be reflected by the root owner.
        }
        setPhase('joined')
        return
      }
      await disposeDailyCall(existingCall)
      setCall(null)
      setParticipants(null)
    }

    const room = callKind === 'consultation'
      ? await createConsultationRoom(validOrderId, callType, { notifyCounterpart: false })
      : await createOrderCallRoom(validOrderId, callType, roleAudience, { notifyCounterpart: false })

    if (!room?.url || !room.token) {
      setErrorMessage(room?.message ?? 'The protected call room is unavailable. Continue inside Messages or retry.')
      setPhase('error')
      return
    }

    const nextCall = Daily.createCallObject({
      url: room.url,
      token: room.token,
      userName: displayName,
      startVideoOff: callType === 'audio',
      startAudioOff: false,
    })
    nextCall.setNativeInCallAudioMode(callType === 'audio' ? 'voice' : 'video')
    setSpeakerOn(callType === 'video')
    setRoomAccess({ url: room.url, token: room.token })
    setCall(nextCall)
    if (activeRouteContext) registerCall(nextCall, activeRouteContext)

    try {
      await nextCall.startCamera({
        url: room.url,
        token: room.token,
        userName: displayName,
        startVideoOff: callType === 'audio',
        startAudioOff: false,
      })
      setParticipants({ ...nextCall.participants() })
      setMicrophoneOn(nextCall.localAudio())
      setCameraOn(nextCall.localVideo())
      setPhase('lobby')
    } catch {
      await endCall(nextCall)
      setCall(null)
      setErrorMessage('Drapeon could not access the camera or microphone. Check device permissions and try again.')
      setPhase('error')
    }
  }

  useEffect(() => {
    if (!validOrderId || autoPreparedOrderIdRef.current === validOrderId) return
    autoPreparedOrderIdRef.current = validOrderId
    void prepareLobby()
  }, [validOrderId])

  async function joinCall() {
    if (!call || !roomAccess || phase === 'joining') return
    setPhase('joining')
    setErrorMessage(null)
    try {
      await call.join({
        url: roomAccess.url,
        token: roomAccess.token,
        userName: displayName,
        startVideoOff: !cameraOn,
        startAudioOff: !microphoneOn,
      })
      setParticipants({ ...call.participants() })
      setPhase('joined')
    } catch {
      setErrorMessage('Drapeon could not connect this call. Check your connection, retry, or continue in the browser.')
      setPhase('error')
    }
  }

  async function toggleMicrophone() {
    if (!call) return
    const next = !microphoneOn
    call.setLocalAudio(next)
    setMicrophoneOn(next)
  }

  async function toggleCamera() {
    if (!call || callType === 'audio') return
    const next = !cameraOn
    call.setLocalVideo(next)
    setCameraOn(next)
  }

  async function flipCamera() {
    if (!call || !cameraOn) return
    await call.cycleCamera().catch(() => {
      Alert.alert('Camera unavailable', 'Drapeon could not switch cameras on this device.')
    })
  }

  async function toggleSpeaker() {
    if (!call || callType !== 'audio') return
    const next = !speakerOn
    call.setNativeInCallAudioMode(next ? 'video' : 'voice')
    setSpeakerOn(next)
  }

  const leaveAndReturn = useCallback(async () => {
    if (exitInFlightRef.current) return
    exitInFlightRef.current = true
    await endCall(call)
    setCall(null)
    openMessages()
  }, [call, endCall, openMessages])

  const requestExit = useCallback(() => {
    if (phase === 'joined' || phase === 'reconnecting' || phase === 'joining') {
      Alert.alert('Leave this call?', 'You will return to the protected order conversation.', [
        { text: 'Stay', style: 'cancel' },
        { text: 'Leave', style: 'destructive', onPress: () => { void leaveAndReturn() } },
      ])
      return
    }
    void leaveAndReturn()
  }, [leaveAndReturn, phase])

  useContextualBackHandler(requestExit)

  const minimizeToOrder = useCallback(() => {
    if (!validOrderId) return
    setOrderContextOpen(false)
    router.push({
      pathname: role === 'TAILOR'
        ? '/(tailor)/orders/[id]'
        : '/(customer)/orders/[id]',
      params: { id: validOrderId },
    })
  }, [role, router, validOrderId])

  async function openBrowserFallback() {
    if (!roomAccess) {
      await prepareLobby()
      return
    }
    const separator = roomAccess.url.includes('?') ? '&' : '?'
    await Linking.openURL(`${roomAccess.url}${separator}t=${encodeURIComponent(roomAccess.token)}`)
  }

  if (phase === 'joined' || phase === 'reconnecting') {
    return (
      <ContextualSwipeBack onBack={requestExit}>
        <View style={styles.callCanvas}>
        {remoteVideo ? (
          <DailyMediaView
            videoTrack={remoteVideo}
            audioTrack={remoteAudio}
            objectFit="cover"
            style={styles.remoteVideo}
          />
        ) : (
          <View style={styles.remoteFallback}>
            <View style={styles.remoteAvatar}>
              <Text style={styles.remoteInitial}>{counterpartName.charAt(0).toUpperCase()}</Text>
            </View>
            <Text style={styles.remoteName}>{counterpartName}</Text>
            <Text style={styles.connectionCopy}>
              {phase === 'reconnecting' ? 'Reconnecting…' : remoteParticipant ? 'Camera is off' : 'Waiting for them to join'}
            </Text>
          </View>
        )}

        <SafeAreaView style={styles.callOverlay} pointerEvents="box-none">
          <View style={styles.callTopBar}>
            <View>
              <Text style={styles.callEyebrow}>Drapeon call</Text>
              <Text style={styles.callOrder}>{callKind === 'consultation' ? 'Order consultation' : 'Order conversation'}</Text>
            </View>
            <View style={styles.callTopActions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Open order details without leaving the call"
                onPress={() => setOrderContextOpen(true)}
                style={styles.orderContextButton}
              >
                <Feather name="file-text" size={13} color={Colors.textInverse} />
                <Text style={styles.securePillText}>View order</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Minimize call and open the order"
                onPress={minimizeToOrder}
                style={styles.orderContextButton}
              >
                <Feather name="minimize-2" size={13} color={Colors.textInverse} />
                <Text style={styles.securePillText}>Minimize</Text>
              </Pressable>
            </View>
          </View>

          {localVideo && cameraOn ? (
            <View style={styles.localVideoWrap}>
              <DailyMediaView
                videoTrack={localVideo}
                audioTrack={null}
                mirror
                zOrder={1}
                objectFit="cover"
                style={styles.localVideo}
              />
              <Text style={styles.youLabel}>You</Text>
            </View>
          ) : null}

          <View style={[styles.controlsDock, { marginBottom: Math.max(insets.bottom, Spacing.md) }]}>
            <CallControl
              icon={microphoneOn ? 'mic' : 'mic-off'}
              label={microphoneOn ? 'Mute' : 'Unmute'}
              active={!microphoneOn}
              onPress={() => { void toggleMicrophone() }}
            />
            {callType === 'video' ? (
              <CallControl
                icon={cameraOn ? 'video' : 'video-off'}
                label={cameraOn ? 'Camera' : 'Start video'}
                active={!cameraOn}
                onPress={() => { void toggleCamera() }}
              />
            ) : null}
            {callType === 'video' ? (
              <CallControl
                icon="refresh-cw"
                label="Flip"
                disabled={!cameraOn}
                onPress={() => { void flipCamera() }}
              />
            ) : null}
            {callType === 'audio' ? (
              <CallControl
                icon={speakerOn ? 'volume-2' : 'volume-1'}
                label={speakerOn ? 'Speaker' : 'Earpiece'}
                active={speakerOn}
                onPress={() => { void toggleSpeaker() }}
              />
            ) : null}
            <CallControl
              icon="phone-off"
              label="Leave"
              destructive
              onPress={requestExit}
            />
          </View>
        </SafeAreaView>
        <Modal
          visible={orderContextOpen}
          transparent
          animationType="slide"
          onRequestClose={() => setOrderContextOpen(false)}
        >
          <Pressable style={styles.orderSheetBackdrop} onPress={() => setOrderContextOpen(false)}>
            <Pressable style={[styles.orderSheet, { paddingBottom: Math.max(insets.bottom, Spacing.lg) }]} onPress={() => undefined}>
              <View style={styles.orderSheetHandle} />
              <View style={styles.orderSheetHeader}>
                <View style={styles.orderSheetTitleWrap}>
                  <Text style={styles.orderSheetEyebrow}>Live order reference</Text>
                  <Text style={styles.orderSheetTitle}>
                    {orderContext?.item_title?.trim() || orderContext?.garment_type?.trim() || 'Order details'}
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Close order details"
                  onPress={() => setOrderContextOpen(false)}
                  style={styles.orderSheetClose}
                >
                  <Feather name="x" size={21} color={Colors.ink} />
                </Pressable>
              </View>
              <Text style={styles.orderSheetConnection}>Your call stays connected while this panel is open.</Text>
              {orderContext ? (
                <View style={styles.orderSheetFacts}>
                  <OrderContextRow label="Reference" value={orderContext.reference || validOrderId?.slice(0, 8).toUpperCase() || '—'} />
                  <OrderContextRow label="Stage" value={formatStatusLabel(orderContext.stage, { domain: 'order' })} />
                  <OrderContextRow label="Type" value={formatStatusLabel(orderContext.order_kind, { fallback: 'Order' })} />
                  {orderContext.item_size ? <OrderContextRow label="Size" value={orderContext.item_size} /> : null}
                  {orderContext.fulfillment_option ? (
                    <OrderContextRow
                      label="Fulfillment"
                      value={formatStatusLabel(orderContext.fulfillment_option, { domain: 'generic' })}
                    />
                  ) : null}
                </View>
              ) : (
                <View style={styles.orderSheetLoading}>
                  <ActivityIndicator color={Colors.needleGreen} />
                  <Text style={styles.orderSheetLoadingText}>Loading protected order details…</Text>
                </View>
              )}
            </Pressable>
          </Pressable>
        </Modal>
        </View>
      </ContextualSwipeBack>
    )
  }

  const isPreparing = phase === 'ready' || phase === 'preparing'
  const isBusy = isPreparing || phase === 'joining'
  const inLobby = phase === 'lobby' || phase === 'joining'

  return (
    <ContextualSwipeBack onBack={requestExit}>
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel="Close call" onPress={requestExit} style={styles.iconButton}>
            <Feather name="x" size={22} color={Colors.ink} />
          </Pressable>
        </View>

        <View style={styles.content}>
        {inLobby ? (
          <View style={styles.preview}>
            {localVideo && cameraOn ? (
              <DailyMediaView videoTrack={localVideo} audioTrack={null} mirror objectFit="cover" style={styles.previewVideo} />
            ) : (
              <View style={styles.previewFallback}>
                <Feather name={callType === 'audio' ? 'phone-call' : 'video-off'} size={34} color={Colors.needleGreen} />
                <Text style={styles.previewFallbackText}>
                  {callType === 'audio' ? 'Joining with audio' : 'Your camera is off'}
                </Text>
              </View>
            )}
            <View style={styles.previewControls}>
              <CallControl
                icon={microphoneOn ? 'mic' : 'mic-off'}
                label={microphoneOn ? 'Mute' : 'Unmute'}
                active={!microphoneOn}
                onPress={() => { void toggleMicrophone() }}
              />
              {callType === 'video' ? (
                <CallControl
                  icon={cameraOn ? 'video' : 'video-off'}
                  label={cameraOn ? 'Camera' : 'Start video'}
                  active={!cameraOn}
                  onPress={() => { void toggleCamera() }}
                />
              ) : null}
              {callType === 'video' ? (
                <CallControl icon="refresh-cw" label="Flip" disabled={!cameraOn} onPress={() => { void flipCamera() }} />
              ) : null}
              {callType === 'audio' ? (
                <CallControl
                  icon={speakerOn ? 'volume-2' : 'volume-1'}
                  label={speakerOn ? 'Speaker' : 'Earpiece'}
                  active={speakerOn}
                  onPress={() => { void toggleSpeaker() }}
                />
              ) : null}
            </View>
          </View>
        ) : isPreparing ? (
          <View style={styles.preparingBadge}>
            <ActivityIndicator size="large" color={Colors.needleGreen} />
          </View>
        ) : (
          <View style={styles.badge}>
            <Feather name={callType === 'audio' ? 'phone-call' : 'video'} size={30} color={Colors.needleGreen} />
          </View>
        )}

        <Text style={styles.eyebrow}>Drapeon call</Text>
        <Text style={styles.title}>
          {isPreparing
            ? 'Preparing your call…'
            : inLobby
              ? 'Ready to join?'
              : callKind === 'consultation' ? 'Consultation call' : 'Order call'}
        </Text>
        <Text style={styles.body}>
          {isPreparing
            ? 'Opening a protected camera and microphone preview.'
            : inLobby
            ? 'Check your camera and microphone before entering the protected order room.'
            : callType === 'audio'
              ? 'Talk without leaving Drapeon. Final decisions still belong in the order thread.'
              : 'Meet face to face without leaving Drapeon. Final decisions still belong in the order thread.'}
        </Text>

        {!validOrderId ? (
          <Text style={styles.warning}>This link is missing its order context. Open Messages to find the active thread.</Text>
        ) : null}
        {errorMessage ? <Text style={styles.warning}>{errorMessage}</Text> : null}

        {!isPreparing ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => { void (inLobby ? joinCall() : prepareLobby()) }}
            disabled={!validOrderId || isBusy}
            style={({ pressed }) => [
              styles.primaryButton,
              (!validOrderId || isBusy) && styles.primaryButtonDisabled,
              pressed && !isBusy ? styles.pressed : null,
            ]}
          >
            {isBusy ? <ActivityIndicator color={Colors.textInverse} /> : (
              <>
                <Feather name={inLobby ? 'arrow-right' : callType === 'audio' ? 'phone-call' : 'video'} size={18} color={Colors.textInverse} />
                <Text style={styles.primaryText}>{inLobby ? 'Join call' : 'Try again'}</Text>
              </>
            )}
          </Pressable>
        ) : null}

        {roomAccess && phase === 'error' ? (
          <Pressable accessibilityRole="button" onPress={() => { void openBrowserFallback() }} style={styles.secondaryButton}>
            <Text style={styles.secondaryText}>Continue in browser</Text>
          </Pressable>
        ) : null}
        <Pressable accessibilityRole="button" onPress={openMessages} style={styles.secondaryButton}>
          <Text style={styles.secondaryText}>Open Messages instead</Text>
        </Pressable>
        </View>
      </SafeAreaView>
    </ContextualSwipeBack>
  )
}

function OrderContextRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.orderContextRow}>
      <Text style={styles.orderContextLabel}>{label}</Text>
      <Text style={styles.orderContextValue}>{value}</Text>
    </View>
  )
}

function CallControl({
  icon,
  label,
  onPress,
  active = false,
  destructive = false,
  disabled = false,
}: {
  icon: keyof typeof Feather.glyphMap
  label: string
  onPress: () => void
  active?: boolean
  destructive?: boolean
  disabled?: boolean
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.control,
        active && styles.controlActive,
        destructive && styles.controlDestructive,
        disabled && styles.controlDisabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      <Feather name={icon} size={21} color={Colors.textInverse} />
      <Text style={styles.controlLabel}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bone },
  header: { alignItems: 'flex-end', paddingHorizontal: Spacing.xl, paddingTop: Spacing.md },
  iconButton: {
    alignItems: 'center', backgroundColor: Colors.white, borderColor: Colors.lightGrey,
    borderRadius: Radius.full, borderWidth: 1, height: 44, justifyContent: 'center', width: 44, ...Shadow.sm,
  },
  content: { flex: 1, justifyContent: 'center', padding: Spacing.xl },
  badge: {
    alignItems: 'center', alignSelf: 'center', backgroundColor: Colors.needleGreenLight,
    borderRadius: Radius.full, height: 86, justifyContent: 'center', marginBottom: Spacing.xl, width: 86,
  },
  preparingBadge: {
    alignItems: 'center', alignSelf: 'center', height: 86, justifyContent: 'center',
    marginBottom: Spacing.xl, width: 86,
  },
  eyebrow: {
    color: Colors.needleGreen, fontFamily: Fonts.bodySemiBold, fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold, marginBottom: Spacing.sm, textAlign: 'center', textTransform: 'uppercase',
  },
  title: {
    color: Colors.ink, fontFamily: Fonts.display, fontSize: FontSize.xxxl,
    fontWeight: FontWeight.bold, lineHeight: 40, textAlign: 'center',
  },
  body: {
    color: Colors.inkLight, fontFamily: Fonts.body, fontSize: FontSize.lg,
    lineHeight: 26, marginTop: Spacing.md, textAlign: 'center',
  },
  warning: {
    color: Colors.error, fontFamily: Fonts.bodySemiBold, fontSize: FontSize.sm,
    lineHeight: 20, marginTop: Spacing.lg, textAlign: 'center',
  },
  primaryButton: {
    alignItems: 'center', backgroundColor: Colors.needleGreen, borderRadius: Radius.full,
    flexDirection: 'row', gap: Spacing.sm, justifyContent: 'center', marginTop: Spacing.xxxl,
    minHeight: 58, paddingHorizontal: Spacing.xl,
  },
  primaryButtonDisabled: { backgroundColor: Colors.disabledFill },
  pressed: { opacity: 0.82 },
  primaryText: {
    color: Colors.textInverse, fontFamily: Fonts.bodyBold, fontSize: FontSize.lg, fontWeight: FontWeight.bold,
  },
  secondaryButton: { alignItems: 'center', justifyContent: 'center', minHeight: 48, marginTop: Spacing.sm },
  secondaryText: {
    color: Colors.needleGreen, fontFamily: Fonts.bodySemiBold, fontSize: FontSize.md, fontWeight: FontWeight.semibold,
  },
  preview: {
    alignSelf: 'center', backgroundColor: Colors.ink, borderRadius: 28, height: 300,
    marginBottom: Spacing.xl, maxWidth: 420, overflow: 'hidden', width: '100%',
  },
  previewVideo: { flex: 1 },
  previewFallback: { alignItems: 'center', flex: 1, gap: Spacing.md, justifyContent: 'center', backgroundColor: Colors.boneDeep },
  previewFallbackText: { color: Colors.ink, fontFamily: Fonts.bodySemiBold, fontSize: FontSize.md },
  previewControls: {
    alignItems: 'center', bottom: Spacing.md, flexDirection: 'row', gap: Spacing.sm,
    justifyContent: 'center', left: 0, position: 'absolute', right: 0,
  },
  callCanvas: { flex: 1, backgroundColor: Colors.ink },
  remoteVideo: { ...StyleSheet.absoluteFillObject },
  remoteFallback: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.ink },
  remoteAvatar: {
    alignItems: 'center', backgroundColor: Colors.needleGreen, borderRadius: 54,
    height: 108, justifyContent: 'center', width: 108,
  },
  remoteInitial: { color: Colors.textInverse, fontFamily: Fonts.display, fontSize: 46, fontWeight: FontWeight.bold },
  remoteName: { color: Colors.textInverse, fontFamily: Fonts.display, fontSize: 26, marginTop: Spacing.xl },
  connectionCopy: { color: 'rgba(255,255,255,0.64)', fontFamily: Fonts.body, fontSize: FontSize.sm, marginTop: Spacing.sm },
  callOverlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'space-between' },
  callTopBar: {
    alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between',
    paddingHorizontal: Spacing.xl, paddingTop: Spacing.sm,
  },
  callEyebrow: { color: Colors.textInverse, fontFamily: Fonts.bodySemiBold, fontSize: FontSize.sm },
  callOrder: { color: 'rgba(255,255,255,0.68)', fontFamily: Fonts.body, fontSize: FontSize.xs, marginTop: 2 },
  securePill: {
    alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.34)', borderRadius: Radius.full,
    flexDirection: 'row', gap: 5, paddingHorizontal: Spacing.sm, paddingVertical: 7,
  },
  callTopActions: { alignItems: 'center', flexDirection: 'row', gap: Spacing.sm },
  orderContextButton: {
    alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.34)', borderRadius: Radius.full,
    flexDirection: 'row', gap: 5, minHeight: 34, paddingHorizontal: Spacing.sm,
  },
  securePillText: { color: Colors.textInverse, fontFamily: Fonts.bodySemiBold, fontSize: FontSize.xs },
  localVideoWrap: {
    backgroundColor: Colors.ink, borderColor: 'rgba(255,255,255,0.28)', borderRadius: 18,
    borderWidth: 1, height: 164, overflow: 'hidden', position: 'absolute', right: Spacing.lg,
    top: 94, width: 112, ...Shadow.lg,
  },
  localVideo: { flex: 1 },
  youLabel: {
    backgroundColor: 'rgba(0,0,0,0.42)', borderRadius: Radius.full, bottom: 7,
    color: Colors.textInverse, fontFamily: Fonts.bodySemiBold, fontSize: 10, left: 7,
    overflow: 'hidden', paddingHorizontal: 7, paddingVertical: 3, position: 'absolute',
  },
  controlsDock: {
    alignSelf: 'center', backgroundColor: 'rgba(20,24,22,0.82)', borderRadius: 30,
    flexDirection: 'row', gap: Spacing.sm, marginHorizontal: Spacing.md, padding: Spacing.sm,
  },
  control: {
    alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 22,
    height: 58, justifyContent: 'center', minWidth: 58, paddingHorizontal: 8,
  },
  controlActive: { backgroundColor: 'rgba(255,255,255,0.30)' },
  controlDestructive: { backgroundColor: Colors.error },
  controlDisabled: { opacity: 0.38 },
  controlLabel: { color: Colors.textInverse, fontFamily: Fonts.bodySemiBold, fontSize: 9, marginTop: 3 },
  orderSheetBackdrop: {
    backgroundColor: 'rgba(0,0,0,0.48)', flex: 1, justifyContent: 'flex-end',
  },
  orderSheet: {
    backgroundColor: Colors.white, borderTopLeftRadius: 28, borderTopRightRadius: 28,
    gap: Spacing.md, paddingHorizontal: Spacing.xl, paddingTop: Spacing.sm,
  },
  orderSheetHandle: {
    alignSelf: 'center', backgroundColor: Colors.lightGrey, borderRadius: Radius.full,
    height: 4, marginBottom: Spacing.sm, width: 42,
  },
  orderSheetHeader: { alignItems: 'center', flexDirection: 'row', gap: Spacing.md, justifyContent: 'space-between' },
  orderSheetTitleWrap: { flex: 1 },
  orderSheetEyebrow: {
    color: Colors.needleGreen, fontFamily: Fonts.bodySemiBold, fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold, letterSpacing: 0.6, textTransform: 'uppercase',
  },
  orderSheetTitle: {
    color: Colors.ink, fontFamily: Fonts.display, fontSize: FontSize.xxl,
    fontWeight: FontWeight.bold, marginTop: 3,
  },
  orderSheetClose: {
    alignItems: 'center', backgroundColor: Colors.bone, borderRadius: Radius.full,
    height: 42, justifyContent: 'center', width: 42,
  },
  orderSheetConnection: { color: Colors.inkLight, fontFamily: Fonts.body, fontSize: FontSize.sm, lineHeight: 20 },
  orderSheetFacts: {
    borderColor: Colors.lightGrey, borderRadius: Radius.lg, borderWidth: 1, overflow: 'hidden',
  },
  orderContextRow: {
    alignItems: 'center', borderBottomColor: Colors.lightGrey, borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row', gap: Spacing.lg, justifyContent: 'space-between',
    minHeight: 52, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
  },
  orderContextLabel: { color: Colors.midGrey, fontFamily: Fonts.bodySemiBold, fontSize: FontSize.sm },
  orderContextValue: {
    color: Colors.ink, flex: 1, fontFamily: Fonts.bodySemiBold, fontSize: FontSize.sm,
    textAlign: 'right',
  },
  orderSheetLoading: {
    alignItems: 'center', flexDirection: 'row', gap: Spacing.sm, minHeight: 72, justifyContent: 'center',
  },
  orderSheetLoadingText: { color: Colors.inkLight, fontFamily: Fonts.body, fontSize: FontSize.sm },
})
