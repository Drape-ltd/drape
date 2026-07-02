import { useEffect, useMemo, type ComponentType } from 'react'
import {
  NativeModules,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import {
  DRAPE_VISION_COLORS,
  DRAPE_VISION_MODE_META,
  isDrapeVisionMode,
  type DrapeVisionMode,
} from '@/constants/drapeVision'
import { Colors, Fonts, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme'
import { useFeatureFlags } from '@/lib/feature-flags'
import { Sentry } from '@/lib/sentry'

type VisionParams = {
  mode?: string
  returnTo?: string
  diaryId?: string
  orderId?: string
  itemId?: string
}

type NativeVisionScreenModule = {
  default: ComponentType
}

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function expoAppOwnership() {
  const direct = NativeModules.ExponentConstants
  if (direct && typeof direct.appOwnership === 'string') return direct.appOwnership

  const proxy = NativeModules.NativeUnimoduleProxy
  const fromProxy = proxy?.modulesConstants?.ExponentConstants
  return typeof fromProxy?.appOwnership === 'string' ? fromProxy.appOwnership : null
}

function isExpoGo() {
  return expoAppOwnership() === 'expo'
}

function isAndroidLiveScanPausedForLaunch(androidVisionEnabled = false) {
  return Platform.OS === 'android' && !androidVisionEnabled
}

function loadNativeVisionScreen(androidVisionEnabled = false) {
  if (isExpoGo()) return null
  if (isAndroidLiveScanPausedForLaunch(androidVisionEnabled)) return null

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- native module must stay lazy so Expo Go and Android fallback do not crash.
    return require('@/components/drapeVision/NativeDrapeVisionScreen') as NativeVisionScreenModule
  } catch (error) {
    Sentry.addBreadcrumb({
      category: 'drape_vision',
      level: 'warning',
      message: 'native_module_unavailable',
      data: { error: error instanceof Error ? error.message : String(error) },
    })
    return null
  }
}

function fallbackRouteForMode(mode: DrapeVisionMode) {
  return DRAPE_VISION_MODE_META[mode].fallbackRoute
}

function returnRouteForParams(mode: DrapeVisionMode, params: VisionParams) {
  if (params.returnTo?.trim()) return params.returnTo
  if (mode === 'customer_scan' && params.orderId?.trim()) return `/(customer)/orders/${params.orderId}`
  if (mode === 'garment_qc' && params.orderId?.trim()) return `/(tailor)/orders/${params.orderId}`
  if (mode === 'tailor_client_scan' && params.diaryId?.trim() && params.diaryId !== 'new') {
    return `/(tailor)/clients/diary/${params.diaryId}`
  }
  return fallbackRouteForMode(mode)
}

function primaryFallbackTargetForParams(mode: DrapeVisionMode, params: VisionParams) {
  if (mode === 'customer_scan') {
    const returnTo = params.returnTo?.trim()
    return {
      pathname: '/(customer)/profile/measurements',
      params: returnTo && returnTo !== '/(customer)/profile/measurements' ? { returnTo } : {},
    }
  }

  if (mode === 'tailor_client_scan') {
    if (params.diaryId?.trim() && params.diaryId !== 'new') {
      return `/(tailor)/clients/diary/${params.diaryId}`
    }
    return '/(tailor)/clients/diary/new'
  }

  if (mode === 'garment_qc') {
    if (params.orderId?.trim()) return `/(tailor)/orders/${params.orderId}`
    if (params.returnTo?.trim()) return params.returnTo
    return '/(tailor)/orders'
  }

  return returnRouteForParams(mode, params)
}

function primaryFallbackLabelForParams(mode: DrapeVisionMode, params: VisionParams) {
  if (mode !== 'garment_qc') return DRAPE_VISION_MODE_META[mode].primaryLabel
  if (params.orderId?.trim()) return 'Return to order'
  if (params.returnTo?.includes('(tailor)')) return 'Back to dashboard'
  return 'Open orders'
}

export default function DrapeVisionRoute() {
  const router = useRouter()
  const rawParams = useLocalSearchParams<VisionParams>()
  const params = useMemo(() => ({
    mode: firstParam(rawParams.mode),
    returnTo: firstParam(rawParams.returnTo),
    diaryId: firstParam(rawParams.diaryId),
    orderId: firstParam(rawParams.orderId),
    itemId: firstParam(rawParams.itemId),
  }), [rawParams.diaryId, rawParams.itemId, rawParams.mode, rawParams.orderId, rawParams.returnTo])
  const mode: DrapeVisionMode = isDrapeVisionMode(params.mode) ? params.mode : 'customer_scan'
  const meta = DRAPE_VISION_MODE_META[mode]
  const { data: featureFlags } = useFeatureFlags('ALL')
  const androidVisionEnabled = featureFlags?.android_drape_vision?.enabled === true
  const NativeVisionScreen = useMemo(() => loadNativeVisionScreen(androidVisionEnabled)?.default ?? null, [androidVisionEnabled])
  const returnRoute = useMemo(() => returnRouteForParams(mode, params), [mode, params])
  const primaryFallbackTarget = useMemo(() => primaryFallbackTargetForParams(mode, params), [mode, params])
  const primaryFallbackLabel = useMemo(() => primaryFallbackLabelForParams(mode, params), [mode, params])
  const androidPaused = isAndroidLiveScanPausedForLaunch(androidVisionEnabled)

  useEffect(() => {
    const payload = {
      mode,
      nativeScreenLoaded: !!NativeVisionScreen,
      androidPaused,
      appOwnership: expoAppOwnership() ?? 'unknown',
      platform: Platform.OS,
    }
    if (__DEV__) console.log('[DrapeVision:route] mounted', payload)
    Sentry.addBreadcrumb({
      category: 'drape_vision',
      level: 'info',
      message: 'vision_route_mounted',
      data: payload,
    })
  }, [NativeVisionScreen, androidPaused, mode])

  useEffect(() => {
    if (NativeVisionScreen) return
    Sentry.addBreadcrumb({
      category: 'drape_vision',
      level: 'warning',
      message: androidPaused ? 'android_live_scan_paused_for_launch' : 'native_module_unavailable',
      data: { mode, appOwnership: expoAppOwnership() ?? 'unknown', platform: Platform.OS },
    })
  }, [NativeVisionScreen, androidPaused, mode])

  if (NativeVisionScreen) return <NativeVisionScreen />

  function openPrimaryFallback() {
    router.replace(primaryFallbackTarget as never)
  }

  function openReturnRoute() {
    router.replace(returnRoute as never)
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <View style={styles.heroIcon}>
            <Feather name="aperture" size={28} color={Colors.needleGreen} />
          </View>
          <Text style={styles.eyebrow}>{meta.eyebrow}</Text>
          <Text style={styles.title}>{androidPaused ? 'Use manual measurements on Android' : 'Drapeon Vision is not available in this build'}</Text>
          <Text style={styles.body}>
            {androidPaused
              ? 'The Android live scanner is paused for launch while we finish device validation. You can keep the order moving with manual measurements.'
              : "Live scanning needs Drapeon's camera-enabled build. You can keep going with the manual measurement path for now."}
          </Text>
        </View>

        <View style={styles.noticeBand}>
          <Feather name="tool" size={18} color={Colors.needleGreen} />
          <View style={styles.noticeCopy}>
            <Text style={styles.noticeTitle}>Manual path is still available</Text>
            <Text style={styles.noticeText}>
              {androidPaused
                ? 'Manual measurements feed the same fit profile, tailor brief, ready-made fit check, and order flow without risking a camera crash.'
                : 'Add or review measurements manually, then return to Drapeon Vision when the camera build is installed.'}
            </Text>
          </View>
        </View>
      </ScrollView>

      <View style={styles.ctaBar}>
        <TouchableOpacity accessibilityRole="button" onPress={openPrimaryFallback} style={styles.primaryButton}>
          <Text style={styles.primaryText}>{primaryFallbackLabel}</Text>
          <Feather name="arrow-right" size={18} color={Colors.textInverse} />
        </TouchableOpacity>
        {params.returnTo?.trim() ? (
          <TouchableOpacity accessibilityRole="button" onPress={openReturnRoute} style={styles.secondaryButton}>
            <Text style={styles.secondaryText}>Back to previous screen</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: DRAPE_VISION_COLORS.screen,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.xxxl,
    gap: Spacing.lg,
  },
  hero: {
    gap: Spacing.sm,
    paddingTop: Spacing.xl,
  },
  heroIcon: {
    width: 58,
    height: 58,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.needleGreenLight,
  },
  eyebrow: {
    marginTop: Spacing.sm,
    fontSize: FontSize.xs,
    color: Colors.needleGreen,
    fontWeight: FontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  title: {
    fontSize: FontSize.xxxl,
    lineHeight: 38,
    color: DRAPE_VISION_COLORS.text,
    fontWeight: FontWeight.bold,
    fontFamily: Fonts.display,
  },
  body: {
    fontSize: FontSize.md,
    lineHeight: 23,
    color: DRAPE_VISION_COLORS.textMuted,
  },
  noticeBand: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
    padding: Spacing.lg,
    borderRadius: Radius.md,
    backgroundColor: DRAPE_VISION_COLORS.panel,
    borderWidth: 1,
    borderColor: Colors.needleGreen + '55',
  },
  noticeCopy: {
    flex: 1,
    gap: 4,
  },
  noticeTitle: {
    fontSize: FontSize.md,
    color: DRAPE_VISION_COLORS.text,
    fontWeight: FontWeight.semibold,
  },
  noticeText: {
    fontSize: FontSize.sm,
    lineHeight: 20,
    color: DRAPE_VISION_COLORS.textMuted,
  },
  ctaBar: {
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: DRAPE_VISION_COLORS.line,
    backgroundColor: DRAPE_VISION_COLORS.screen,
  },
  primaryButton: {
    minHeight: 54,
    borderRadius: Radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.needleGreen,
  },
  primaryText: {
    color: Colors.textInverse,
    fontSize: FontSize.md,
    fontWeight: FontWeight.bold,
  },
  secondaryButton: {
    minHeight: 50,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: DRAPE_VISION_COLORS.line,
    backgroundColor: DRAPE_VISION_COLORS.panel,
  },
  secondaryText: {
    color: DRAPE_VISION_COLORS.text,
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold,
  },
})
