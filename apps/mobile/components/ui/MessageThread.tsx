/**
 * Shared messaging thread component.
 * Used by both customer and tailor — pass senderId and the orderId.
 * Supports text, photo, and voice note messages.
 * Contact filter applied inline before send.
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  TextInput, Image, Alert, ActivityIndicator, Keyboard,
} from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import { Audio } from 'expo-av'
import { supabase } from '@/lib/supabase'
import { stripExif } from '@/lib/stripExif'
import { filterContactInfo } from '@drape/shared/contact-filter'
import { Colors, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'

type MessageType = 'TEXT' | 'PHOTO' | 'VOICE'

type Message = {
  id: string
  order_id: string
  sender_id: string
  sender_role: 'CUSTOMER' | 'TAILOR'
  sender_name: string
  type: MessageType
  body: string | null
  photo_url: string | null
  voice_url: string | null
  created_at: string
  read_at: string | null
}

interface Props {
  orderId: string
  currentUserId: string
  currentUserRole: 'CUSTOMER' | 'TAILOR'
  tailorName: string
  customerName: string
  locked?: boolean
}

// Rate limit: max 8 sends in 30 seconds
const RATE_LIMIT_COUNT = 8
const RATE_LIMIT_WINDOW_MS = 30_000

export function MessageThread({ orderId, currentUserId, currentUserRole, tailorName, customerName, locked = false }: Props) {
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)
  const [text, setText] = useState('')
  const [textError, setTextError] = useState('')
  const [sending, setSending] = useState(false)
  const [rateLimited, setRateLimited] = useState(false)
  const [recording, setRecording] = useState<Audio.Recording | null>(null)
  const [isRecording, setIsRecording] = useState(false)
  const flatListRef = useRef<FlatList>(null)
  const sendTimestamps = useRef<number[]>([])

  async function fetchMessages() {
    const { data } = await supabase
      .from('messages')
      .select('*')
      .eq('order_id', orderId)
      .order('created_at', { ascending: true })

    if (data) setMessages(data as Message[])
    setLoading(false)
  }

  useEffect(() => {
    fetchMessages()

    // Realtime subscription
    const channel = supabase
      .channel(`messages:${orderId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `order_id=eq.${orderId}` },
        (payload) => {
          setMessages((prev) => {
            if (prev.find((m) => m.id === payload.new.id)) return prev
            return [...prev, payload.new as Message]
          })
          setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100)
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [orderId])

  // Mark incoming messages as read
  useEffect(() => {
    if (messages.length === 0) return
    const unread = messages
      .filter((m) => m.sender_id !== currentUserId && !m.read_at)
      .map((m) => m.id)
    if (unread.length > 0) {
      supabase
        .from('messages')
        .update({ read_at: new Date().toISOString() })
        .in('id', unread)
    }
  }, [messages])

  function checkRateLimit(): boolean {
    const now = Date.now()
    sendTimestamps.current = sendTimestamps.current.filter((ts) => now - ts < RATE_LIMIT_WINDOW_MS)
    if (sendTimestamps.current.length >= RATE_LIMIT_COUNT) {
      setRateLimited(true)
      setTimeout(() => setRateLimited(false), RATE_LIMIT_WINDOW_MS)
      return false
    }
    sendTimestamps.current.push(now)
    return true
  }

  function validateText(t: string): boolean {
    const res = filterContactInfo(t)
    if (res.blocked) {
      setTextError("Contact details can't be shared on Drape.")
      return false
    }
    setTextError('')
    return true
  }

  async function sendText() {
    if (!text.trim() || !validateText(text)) return
    if (!checkRateLimit()) return
    setSending(true)
    const { error } = await supabase.from('messages').insert({
      order_id: orderId,
      sender_id: currentUserId,
      sender_role: currentUserRole,
      sender_name: currentUserRole === 'CUSTOMER' ? customerName : tailorName,
      type: 'TEXT',
      body: text.trim(),
    })
    if (error) console.error('[MessageThread] insert error:', JSON.stringify(error))
    if (!error) {
      setText('')
      // Refetch as fallback in case realtime delivery is delayed
      await fetchMessages()
    }
    setSending(false)
    Keyboard.dismiss()
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100)
  }

  async function sendPhoto() {
    if (!checkRateLimit()) return
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
    })
    if (result.canceled || !result.assets[0]) return

    setSending(true)
    const cleanUri = await stripExif(result.assets[0].uri)
    const ext = 'jpg' // stripExif always outputs JPEG
    const filename = `messages/${orderId}/${Date.now()}.${ext}`

    try {
      const response = await fetch(cleanUri)
      const blob = await response.blob()
      if (blob.size > 10 * 1024 * 1024) {
        setSending(false)
        Alert.alert('File too large', 'Photos must be under 10 MB.')
        return
      }
      await supabase.storage.from('message-media').upload(filename, blob, { contentType: `image/${ext}` })
      const { data: urlData } = supabase.storage.from('message-media').getPublicUrl(filename)

      await supabase.from('messages').insert({
        order_id: orderId,
        sender_id: currentUserId,
        sender_role: currentUserRole,
        sender_name: currentUserRole === 'CUSTOMER' ? customerName : tailorName,
        type: 'PHOTO',
        photo_url: urlData.publicUrl,
      })
    } catch {
      Alert.alert('Error', 'Could not send photo. Please try again.')
    }
    setSending(false)
  }

  async function startRecording() {
    try {
      await Audio.requestPermissionsAsync()
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true })
      const { recording: rec } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY)
      setRecording(rec)
      setIsRecording(true)
    } catch {
      Alert.alert('Error', 'Could not access microphone.')
    }
  }

  async function stopRecording() {
    if (!recording) return
    setIsRecording(false)
    await recording.stopAndUnloadAsync()
    await Audio.setAudioModeAsync({ allowsRecordingIOS: false })
    const uri = recording.getURI()
    setRecording(null)

    if (!uri) return

    setSending(true)
    const filename = `messages/${orderId}/${Date.now()}.m4a`
    try {
      const response = await fetch(uri)
      const blob = await response.blob()
      if (blob.size > 25 * 1024 * 1024) {
        setSending(false)
        Alert.alert('Recording too large', 'Voice notes must be under 25 MB.')
        return
      }
      await supabase.storage.from('message-media').upload(filename, blob, { contentType: 'audio/m4a' })
      const { data: urlData } = supabase.storage.from('message-media').getPublicUrl(filename)

      await supabase.from('messages').insert({
        order_id: orderId,
        sender_id: currentUserId,
        sender_role: currentUserRole,
        sender_name: currentUserRole === 'CUSTOMER' ? customerName : tailorName,
        type: 'VOICE',
        voice_url: urlData.publicUrl,
      })
    } catch {
      Alert.alert('Error', 'Could not send voice note.')
    }
    setSending(false)
  }

  const otherName = currentUserRole === 'CUSTOMER' ? tailorName : customerName

  if (loading) return <ActivityIndicator style={{ flex: 1 }} color={Colors.needleGreen} size="large" />

  return (
    <View style={styles.container}>
      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(m) => m.id}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>Start the conversation with {otherName}.</Text>
            <View style={styles.preMessageCard}>
              <Text style={styles.preMessageTitle}>Keep all communication on Drape</Text>
              <Text style={styles.preMessageBody}>
                Sharing phone numbers, email addresses, or social handles isn't allowed and may result in account suspension. This protects both parties.
              </Text>
            </View>
          </View>
        }
        renderItem={({ item }) => (
          <MessageBubble message={item} isOwn={item.sender_id === currentUserId} />
        )}
      />

      {/* Locked banner — shown when order is terminal */}
      {locked ? (
        <View style={styles.lockedBar}>
          <Text style={styles.lockedText}>This conversation is closed. You can still read previous messages.</Text>
        </View>
      ) : (
        <>
          {/* Contact filter warning */}
          {textError ? (
            <View style={styles.filterWarning}>
              <Text style={styles.filterWarningText}>{textError}</Text>
            </View>
          ) : null}

          {/* Rate limit warning */}
          {rateLimited ? (
            <View style={styles.filterWarning}>
              <Text style={styles.filterWarningText}>You're sending messages too quickly. Please wait a moment.</Text>
            </View>
          ) : null}

          {/* Recording indicator */}
          {isRecording && (
            <View style={styles.recordingBar}>
              <View style={styles.recordingDot} />
              <Text style={styles.recordingText}>Recording… release to send</Text>
            </View>
          )}

          {/* Input bar */}
          <View style={styles.inputBar}>
            <TouchableOpacity style={styles.iconBtn} onPress={sendPhoto} disabled={sending || rateLimited}>
              <Text style={styles.iconBtnText}>📎</Text>
            </TouchableOpacity>

            <TextInput
              style={styles.textInput}
              placeholder="Message…"
              placeholderTextColor={Colors.midGrey}
              value={text}
              onChangeText={(v) => {
                setText(v)
                if (textError) validateText(v)
              }}
              multiline
              maxLength={1000}
              returnKeyType="default"
              testID="message-input"
            />

            {text.trim() ? (
              <TouchableOpacity style={styles.sendBtn} onPress={sendText} disabled={sending || !!textError || rateLimited}>
                {sending
                  ? <ActivityIndicator color={Colors.white} size="small" />
                  : <Text style={styles.sendBtnText}>→</Text>
                }
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[styles.voiceBtn, isRecording && styles.voiceBtnActive]}
                onPressIn={startRecording}
                onPressOut={stopRecording}
                disabled={sending}
              >
                <Text style={styles.iconBtnText}>🎤</Text>
              </TouchableOpacity>
            )}
          </View>
        </>
      )}
    </View>
  )
}

function MessageBubble({ message, isOwn }: { message: Message; isOwn: boolean }) {
  const [sound, setSound] = useState<Audio.Sound | null>(null)
  const [playing, setPlaying] = useState(false)

  async function toggleVoice() {
    if (!message.voice_url) return
    if (playing && sound) {
      await sound.pauseAsync()
      setPlaying(false)
      return
    }
    if (sound) {
      await sound.playAsync()
      setPlaying(true)
      return
    }
    const { sound: s } = await Audio.Sound.createAsync({ uri: message.voice_url! })
    setSound(s)
    setPlaying(true)
    await s.playAsync()
    s.setOnPlaybackStatusUpdate((status) => {
      if (status.isLoaded && status.didJustFinish) {
        setPlaying(false)
        s.unloadAsync()
        setSound(null)
      }
    })
  }

  const time = new Date(message.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

  return (
    <View style={[styles.bubbleRow, isOwn && styles.bubbleRowOwn]}>
      <View style={[styles.bubble, isOwn ? styles.bubbleOwn : styles.bubbleOther]}>
        {!isOwn && <Text style={styles.senderName}>{message.sender_name}</Text>}

        {message.type === 'TEXT' && (
          <Text style={[styles.bubbleText, isOwn && styles.bubbleTextOwn]}>{message.body}</Text>
        )}

        {message.type === 'PHOTO' && message.photo_url && (
          <Image source={{ uri: message.photo_url }} style={styles.bubblePhoto} resizeMode="cover" />
        )}

        {message.type === 'VOICE' && (
          <TouchableOpacity style={styles.voiceNote} onPress={toggleVoice}>
            <Text style={styles.voiceNoteIcon}>{playing ? '⏸' : '▶'}</Text>
            <View style={styles.voiceWave}>
              {[...Array(12)].map((_, i) => (
                <View key={i} style={[styles.voiceBar, { height: 6 + Math.sin(i) * 6 + Math.random() * 4 }]} />
              ))}
            </View>
            <Text style={styles.voiceNoteLabel}>Voice note</Text>
          </TouchableOpacity>
        )}

        <View style={styles.bubbleMeta}>
          <Text style={[styles.bubbleTime, isOwn && styles.bubbleTimeOwn]}>{time}</Text>
          {isOwn && message.read_at && <Text style={styles.readReceipt}>✓✓</Text>}
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { padding: Spacing.lg, gap: Spacing.sm, paddingBottom: Spacing.md },

  empty: { paddingTop: 60, alignItems: 'center', gap: Spacing.lg, paddingHorizontal: Spacing.xl },
  emptyText: { fontSize: FontSize.md, color: Colors.inkLight },

  preMessageCard: {
    backgroundColor: Colors.boneDeep, borderRadius: Radius.md,
    padding: Spacing.lg, gap: Spacing.sm,
    borderLeftWidth: 3, borderLeftColor: Colors.needleGreen,
    alignSelf: 'stretch',
  },
  preMessageTitle: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink },
  preMessageBody: { fontSize: FontSize.xs, color: Colors.inkLight, lineHeight: 18 },

  lockedBar: {
    backgroundColor: Colors.lightGrey, paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md, borderTopWidth: 1, borderTopColor: Colors.lightGrey,
    alignItems: 'center',
  },
  lockedText: { fontSize: FontSize.sm, color: Colors.midGrey, textAlign: 'center' as const, lineHeight: 20 },

  filterWarning: {
    backgroundColor: Colors.kanteRustLight, paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.kanteRust + '30',
  },
  filterWarningText: { fontSize: FontSize.xs, color: Colors.kanteRust, lineHeight: 18 },

  recordingBar: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.needleGreenLight, paddingHorizontal: Spacing.xl, paddingVertical: Spacing.md,
  },
  recordingDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.error },
  recordingText: { fontSize: FontSize.sm, color: Colors.needleGreen },

  inputBar: {
    flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.sm,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    backgroundColor: Colors.white, borderTopWidth: 1, borderTopColor: Colors.lightGrey,
  },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  iconBtnText: { fontSize: 20 },
  textInput: {
    flex: 1, backgroundColor: Colors.bone, borderRadius: Radius.xl,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm,
    fontSize: FontSize.md, color: Colors.ink, maxHeight: 120,
  },
  sendBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: Colors.needleGreen, alignItems: 'center', justifyContent: 'center',
  },
  sendBtnText: { color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold },
  voiceBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20 },
  voiceBtnActive: { backgroundColor: Colors.needleGreenLight },

  bubbleRow: { flexDirection: 'row', justifyContent: 'flex-start' },
  bubbleRowOwn: { justifyContent: 'flex-end' },
  bubble: {
    maxWidth: '78%', borderRadius: Radius.lg, padding: Spacing.md,
    gap: Spacing.xs,
  },
  bubbleOther: {
    backgroundColor: Colors.white, borderBottomLeftRadius: 4,
    ...Shadow.sm,
  },
  bubbleOwn: { backgroundColor: Colors.needleGreen, borderBottomRightRadius: 4 },
  senderName: { fontSize: FontSize.xs, fontWeight: FontWeight.semibold, color: Colors.needleGreen },
  bubbleText: { fontSize: FontSize.md, color: Colors.ink, lineHeight: 22 },
  bubbleTextOwn: { color: Colors.white },
  bubblePhoto: { width: 200, height: 200, borderRadius: Radius.md },
  voiceNote: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: 2 },
  voiceNoteIcon: { fontSize: 18 },
  voiceWave: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 2 },
  voiceBar: { width: 3, backgroundColor: Colors.needleGreen, borderRadius: 2 },
  voiceNoteLabel: { fontSize: FontSize.xs, color: Colors.inkLight },
  bubbleMeta: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, justifyContent: 'flex-end' },
  bubbleTime: { fontSize: 10, color: Colors.midGrey },
  bubbleTimeOwn: { color: 'rgba(255,255,255,0.7)' },
  readReceipt: { fontSize: 10, color: 'rgba(255,255,255,0.7)' },
})
