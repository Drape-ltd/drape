import { useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Feather } from '@expo/vector-icons'

import { Button } from '@/components/ui'
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme'
import { confirmOrderPayment } from '@/lib/payments'
import { qk } from '@/lib/queries'
import { queryClient } from '@/lib/queryClient'
import { resetTo } from '@/lib/navigation'
import { Sentry } from '@/lib/sentry'

type ConfirmState = 'checking' | 'confirmed' | 'pending' | 'failed' | 'invalid'

const ORDER_ID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

function firstParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? ''
  return value ?? ''
}

function extractOrderId(reference: string) {
  return reference.match(ORDER_ID_PATTERN)?.[0] ?? null
}

function isProcessingMessage(message: string) {
  const normalized = message.toLowerCase()
  return normalized.includes('still processing') || normalized.includes('pull to refresh')
}

export default function PaystackRedirectScreen() {
  const router = useRouter()
  const params = useLocalSearchParams<{ reference?: string | string[]; trxref?: string | string[]; status?: string | string[] }>()
  const reference = useMemo(() => {
    return firstParam(params.reference) || firstParam(params.trxref)
  }, [params.reference, params.trxref])
  const status = firstParam(params.status)
  const orderId = useMemo(() => (reference ? extractOrderId(reference) : null), [reference])
  const [state, setState] = useState<ConfirmState>('checking')
  const [message, setMessage] = useState('Confirming your payment with Paystack.')
  const [attempt, setAttempt] = useState(0)
  const hasRun = useRef(false)

  useEffect(() => {
    if (hasRun.current) return
    hasRun.current = true

    async function confirmReturn() {
      if (!reference || !orderId) {
        Sentry.captureMessage('Paystack return missing order reference', {
          level: 'warning',
          extra: { reference, status },
        })
        setState('invalid')
        setMessage('We could not match this Paystack return to an order. Open your orders and pull to refresh.')
        return
      }

      Sentry.addBreadcrumb({
        category: 'payment',
        level: 'info',
        message: 'Paystack redirect confirmation started',
        data: { orderId, reference, status },
      })

      const result = await confirmOrderPayment(orderId, reference)
      if (result.ok) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: qk.customerOrder(result.orderId) }),
          queryClient.invalidateQueries({ queryKey: ['customer-orders'] }),
        ])
        setState('confirmed')
        setMessage('Payment confirmed. Opening your order now.')
        setTimeout(() => {
          resetTo(router, {
            pathname: '/(customer)/orders/[id]',
            params: { id: result.orderId, paymentReturn: '1' },
          } as never)
        }, 650)
        return
      }

      Sentry.captureMessage('Paystack redirect confirmation did not complete', {
        level: isProcessingMessage(result.message) ? 'info' : 'warning',
        extra: { orderId, reference, status, reason: result.reason, stage: result.stage, message: result.message },
      })
      setState(isProcessingMessage(result.message) ? 'pending' : 'failed')
      setMessage(result.message)
    }

    void confirmReturn()
  }, [attempt, orderId, reference, router, status])

  const iconName = state === 'confirmed' ? 'check-circle' : state === 'checking' ? 'credit-card' : 'alert-circle'
  const iconColor = state === 'confirmed' ? Colors.success : state === 'checking' ? Colors.needleGreen : Colors.warning
  const title =
    state === 'checking'
      ? 'Confirming payment'
      : state === 'confirmed'
        ? 'Payment confirmed'
        : state === 'pending'
          ? 'Payment is processing'
          : 'Payment needs a refresh'

  function openOrder() {
    if (orderId) {
      resetTo(router, {
        pathname: '/(customer)/orders/[id]',
        params: { id: orderId, paymentReturn: '1' },
      } as never)
    } else {
      resetTo(router, '/(customer)/orders')
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.card}>
        <View style={[styles.iconWrap, { borderColor: iconColor }]}>
          {state === 'checking' ? (
            <ActivityIndicator color={Colors.needleGreen} />
          ) : (
            <Feather name={iconName} size={28} color={iconColor} />
          )}
        </View>
        <Text style={styles.eyebrow}>Paystack checkout</Text>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.copy}>{message}</Text>
        {reference ? <Text style={styles.reference}>Reference: {reference}</Text> : null}

        {state !== 'checking' && state !== 'confirmed' ? (
          <View style={styles.actions}>
            <Button label={orderId ? 'Open order' : 'Open orders'} onPress={openOrder} />
            <Button
              label="Try confirmation again"
              variant="secondary"
              onPress={() => {
                hasRun.current = false
                setState('checking')
                setMessage('Confirming your payment with Paystack.')
                setAttempt((current) => current + 1)
              }}
            />
          </View>
        ) : null}
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: Colors.bone,
    padding: Spacing.xl,
    justifyContent: 'center',
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    padding: Spacing.xl,
    alignItems: 'center',
    gap: Spacing.md,
  },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.bone,
  },
  eyebrow: {
    color: Colors.needleGreen,
    fontSize: FontSize.xs,
    fontWeight: FontWeight.bold,
    textTransform: 'uppercase',
  },
  title: {
    color: Colors.ink,
    fontSize: FontSize.xxl,
    fontWeight: FontWeight.bold,
    textAlign: 'center',
  },
  copy: {
    color: Colors.inkLight,
    fontSize: FontSize.md,
    lineHeight: 22,
    textAlign: 'center',
  },
  reference: {
    color: Colors.midGrey,
    fontSize: FontSize.xs,
    textAlign: 'center',
  },
  actions: {
    width: '100%',
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },
})
