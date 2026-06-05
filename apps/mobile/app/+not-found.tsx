import { useEffect } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, usePathname, useRouter } from 'expo-router'
import { Feather } from '@expo/vector-icons'

import { Button } from '@/components/ui'
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme'

function firstParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? ''
  return value ?? ''
}

export default function NotFoundScreen() {
  const router = useRouter()
  const pathname = usePathname()
  const params = useLocalSearchParams<{ reference?: string | string[]; trxref?: string | string[]; status?: string | string[] }>()
  const reference = firstParam(params.reference) || firstParam(params.trxref)
  const status = firstParam(params.status)

  useEffect(() => {
    if (!reference) return
    if (!pathname.toLowerCase().includes('paystack-redirect')) return
    router.replace({
      pathname: '/paystack-redirect',
      params: { reference, trxref: reference, ...(status ? { status } : {}) },
    } as never)
  }, [pathname, reference, router, status])

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.card}>
        <View style={styles.iconWrap}>
          <Feather name="compass" size={28} color={Colors.needleGreen} />
        </View>
        <Text style={styles.title}>This screen is not available</Text>
        <Text style={styles.copy}>
          The link may be old or incomplete. Head back to Drapeon and open the latest order or message from there.
        </Text>
        <Button label="Open Drapeon" onPress={() => router.replace('/')} />
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
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    borderRadius: Radius.xl,
    padding: Spacing.xl,
    alignItems: 'center',
    gap: Spacing.md,
  },
  iconWrap: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: Colors.bone,
    alignItems: 'center',
    justifyContent: 'center',
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
})
