import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme'
import { readFunctionErrorMessage } from '@/lib/function-errors'
import { invokeFunction, supabase } from '@/lib/supabase'

export type CommercialBenefitReservation = { id: string; total_benefit_amount: number; customer_due_amount: number; currency: string; expires_at: string }
type Grant = { id: string; reason: string; remaining_amount: number | null; currency: string | null }

type Props = {
  orderId: string
  currency: string | null
  variant?: 'card' | 'checkout'
  initialCode?: string
  initialError?: string | null
  onChanged?: (reservation: CommercialBenefitReservation | null) => void | Promise<void>
}

export function CommercialBenefitsCard({ orderId, currency, variant = 'card', initialCode = '', initialError = null, onChanged }: Props) {
  const [code, setCode] = useState(initialCode)
  const [reservation, setReservation] = useState<CommercialBenefitReservation | null>(null)
  const [grants, setGrants] = useState<Grant[]>([])
  const [busy, setBusy] = useState(false)
  const [inlineError, setInlineError] = useState('')
  const mutationInFlightRef = useRef(false)
  const onChangedRef = useRef(onChanged)
  useEffect(() => {
    onChangedRef.current = onChanged
  }, [onChanged])
  useEffect(() => {
    if (initialCode.trim()) setCode(initialCode.trim().toUpperCase())
  }, [initialCode])
  useEffect(() => {
    if (initialError) setInlineError(initialError)
  }, [initialError])
  const refresh = useCallback(async () => {
    const { data } = await supabase.from('commercial_benefit_reservations').select('id, total_benefit_amount, customer_due_amount, currency, expires_at').eq('order_id', orderId).eq('status', 'RESERVED').gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false }).limit(1).maybeSingle()
    const nextReservation = (data ?? null) as CommercialBenefitReservation | null
    setReservation(nextReservation)
    await onChangedRef.current?.(nextReservation)
    return nextReservation
  }, [orderId])
  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    const interval = setInterval(() => { void refresh() }, 15_000)
    return () => clearInterval(interval)
  }, [refresh])
  useEffect(() => {
    void invokeFunction<{ grants?: Grant[] }>('commercial-benefit-action', { body: { action: 'list' } })
      .then(({ data, error }) => setGrants(error ? [] : data?.grants ?? []))
      .catch(() => setGrants([]))
  }, [])
  const reserve = async (source: { code?: string; grantId?: string }) => {
    if (mutationInFlightRef.current) return
    mutationInFlightRef.current = true
    setBusy(true)
    setInlineError('')
    try {
      const identity = source.code ?? source.grantId ?? 'benefit'
      const { error } = await invokeFunction('commercial-benefit-action', { body: { action: 'reserve', orderId, ...source, idempotencyKey: `benefit:${orderId}:${identity}:${Date.now()}` } })
      if (error) {
        const message = await readFunctionErrorMessage(error, 'This benefit could not be applied.')
        setInlineError(message)
        if (variant === 'card') Alert.alert('Benefit unavailable', message)
        return
      }
      setCode('')
      await refresh()
    } finally {
      mutationInFlightRef.current = false
      setBusy(false)
    }
  }
  const apply = async () => {
    if (code.trim().length < 3) return Alert.alert('Enter a promotion code', 'Codes are at least three characters.')
    await reserve({ code: code.trim().toUpperCase() })
  }
  const remove = async () => {
    if (!reservation || mutationInFlightRef.current) return
    mutationInFlightRef.current = true
    setBusy(true)
    setInlineError('')
    try {
      const { error } = await invokeFunction('commercial-benefit-action', { body: { action: 'release', reservationId: reservation.id } })
      if (error) {
        const message = await readFunctionErrorMessage(error, 'Try again in a moment.')
        setInlineError(message)
        if (variant === 'card') Alert.alert('Benefit not removed', message)
        return
      }
      await refresh()
    } finally {
      mutationInFlightRef.current = false
      setBusy(false)
    }
  }
  return <View style={[styles.card, variant === 'checkout' && styles.checkoutCard]}>
    <View style={styles.header}>{variant === 'card' ? <View style={styles.icon}><Feather name="gift" size={17} color={Colors.needleGreen}/></View> : null}<View style={styles.flex}><Text style={styles.eyebrow}>{variant === 'checkout' ? 'Promotion or Drapeon credit' : 'Drapeon benefit'}</Text><Text style={styles.title}>{reservation ? 'Applied to this checkout' : 'Add a code before you pay'}</Text></View></View>
    {inlineError ? <Text accessibilityRole="alert" style={styles.errorText}>{inlineError}</Text> : null}
    {reservation ? <><Text style={styles.amount}>{reservation.currency} {(reservation.total_benefit_amount/100).toLocaleString(undefined,{minimumFractionDigits:2})} covered</Text><Text style={styles.muted}>{reservation.customer_due_amount === 0 ? 'No card payment is needed for this order.' : `You now pay ${reservation.currency} ${(reservation.customer_due_amount/100).toLocaleString(undefined,{minimumFractionDigits:2})}.`} The tailor still receives the full protected seller amount.</Text><TouchableOpacity accessibilityRole="button" style={styles.secondary} disabled={busy} onPress={remove}><Text style={styles.secondaryText}>{busy?'Updating…':'Remove discount or credit'}</Text></TouchableOpacity></> : <><View style={styles.row}><TextInput accessibilityLabel="Promotion code" autoCapitalize="characters" value={code} onChangeText={setCode} placeholder="Promotion code" placeholderTextColor={Colors.midGrey} style={styles.input}/><TouchableOpacity accessibilityRole="button" style={styles.primary} disabled={busy} onPress={apply}><Text style={styles.primaryText}>{busy?'…':'Apply'}</Text></TouchableOpacity></View>{grants.map(grant=><TouchableOpacity accessibilityRole="button" key={grant.id} disabled={busy} onPress={()=>{void reserve({grantId:grant.id})}} style={styles.grant}><View style={styles.flex}><Text style={styles.grantTitle}>{grant.reason}</Text><Text style={styles.muted}>Available to this account</Text></View><Text style={styles.grantAmount}>{grant.remaining_amount != null&&grant.currency?`${grant.currency} ${(grant.remaining_amount/100).toLocaleString(undefined,{minimumFractionDigits:2})}`:'Use credit'}</Text></TouchableOpacity>)}<Text style={styles.muted}>One discount or credit can be used per order.</Text></>}
  </View>
}

const styles=StyleSheet.create({card:{backgroundColor:Colors.white,borderWidth:1,borderColor:Colors.lightGrey,borderRadius:Radius.lg,padding:Spacing.lg,gap:Spacing.sm},checkoutCard:{borderRadius:Radius.md,padding:Spacing.md,backgroundColor:Colors.bone},header:{flexDirection:'row',alignItems:'center',gap:Spacing.sm},icon:{width:38,height:38,borderRadius:Radius.full,backgroundColor:Colors.needleGreenLight,alignItems:'center',justifyContent:'center'},flex:{flex:1},eyebrow:{fontSize:FontSize.xs,fontWeight:FontWeight.semibold,color:Colors.needleGreen,textTransform:'uppercase',letterSpacing:.4},title:{fontSize:FontSize.md,fontWeight:FontWeight.bold,color:Colors.ink},amount:{fontSize:FontSize.lg,fontWeight:FontWeight.bold,color:Colors.ink},muted:{fontSize:FontSize.xs,lineHeight:18,color:Colors.inkLight},errorText:{fontSize:FontSize.xs,lineHeight:18,color:Colors.kanteRust},row:{flexDirection:'row',gap:Spacing.sm},grant:{minHeight:54,flexDirection:'row',alignItems:'center',gap:Spacing.sm,borderWidth:1,borderColor:Colors.lightGrey,borderRadius:Radius.md,backgroundColor:Colors.white,padding:Spacing.md},grantTitle:{fontSize:FontSize.sm,fontWeight:FontWeight.semibold,color:Colors.ink},grantAmount:{fontSize:FontSize.xs,fontWeight:FontWeight.bold,color:Colors.needleGreen},input:{flex:1,minHeight:46,borderWidth:1,borderColor:Colors.lightGrey,borderRadius:Radius.md,paddingHorizontal:Spacing.md,color:Colors.ink},primary:{minWidth:82,minHeight:46,borderRadius:Radius.full,backgroundColor:Colors.needleGreen,alignItems:'center',justifyContent:'center'},primaryText:{color:Colors.white,fontWeight:FontWeight.bold},secondary:{minHeight:44,borderRadius:Radius.full,borderWidth:1,borderColor:Colors.lightGrey,alignItems:'center',justifyContent:'center'},secondaryText:{color:Colors.ink,fontWeight:FontWeight.semibold}})
