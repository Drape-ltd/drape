import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react'
import {
  ActivityIndicator,
  BackHandler,
  InteractionManager,
  NativeModules,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router'
import { Feather } from '@expo/vector-icons'
import {
  VisionDockIconButton,
  VisionPrimaryButton,
  VisionShell,
} from '@/components/drapeVision/DrapeVisionPrimitives'
import {
  DRAPE_VISION_MODE_META,
  isDrapeVisionBodyScanMode,
  isDrapeVisionDeferredMode,
  isDrapeVisionMode,
  type DrapeVisionMode,
} from '@/constants/drapeVision'
import { Colors, Fonts, FontSize, FontWeight, Radius, Spacing, useDrapeTheme } from '@/constants/theme'
import { useFeatureFlags } from '@/lib/feature-flags'
import { goBackOrReturnToIfNeeded, pickSafeReturnTo } from '@/lib/navigation'
import { Sentry } from '@/lib/sentry'
import {
  clearPreservedVisionNavigationContext,
  loadPreservedVisionNavigationContext,
  mergeVisionNavigationContext,
  preserveVisionNavigationContext,
  readPreservedVisionNavigationContextSync,
} from '@/lib/vision-navigation-context'

type VisionParams = {
  mode?: string
  returnTo?: string
  historyChain?: string
  diaryId?: string
  orderId?: string
  itemId?: string
}

type NativeVisionScreenModule = {
  default: ComponentType
}

const VISION_ROUTE_EXIT_DELAY_MS = 100
const VISION_NATIVE_MOUNT_SETTLE_MS = 180

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

function isAndroidLiveScanPausedForLaunch(mode: DrapeVisionMode, androidVisionEnabled = false) {
  return Platform.OS === 'android' && isDrapeVisionBodyScanMode(mode) && !androidVisionEnabled
}

function loadNativeVisionScreen(mode: DrapeVisionMode, androidVisionEnabled = false) {
  if (isExpoGo()) return null
  if (isAndroidLiveScanPausedForLaunch(mode, androidVisionEnabled)) return null

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
  const safeReturnTo = pickSafeReturnTo(params.historyChain, params.returnTo)
  if (safeReturnTo) return safeReturnTo
  if (mode === 'customer_scan' && params.orderId?.trim()) return `/(customer)/orders/${params.orderId}`
  if (mode === 'garment_qc' && params.orderId?.trim()) return `/(tailor)/orders/${params.orderId}`
  if (mode === 'tailor_client_scan' && params.diaryId?.trim() && params.diaryId !== 'new') {
    return `/(tailor)/clients/diary/${params.diaryId}`
  }
  if (mode === 'size_guide_scan' && params.itemId?.trim()) {
    return `/(tailor)/shop/new?itemId=${params.itemId}`
  }
  return fallbackRouteForMode(mode)
}

function primaryFallbackTargetForParams(mode: DrapeVisionMode, params: VisionParams) {
  if (mode === 'customer_scan') {
    const returnTo = pickSafeReturnTo(params.historyChain, params.returnTo)
    const visionReturnTo = returnRouteForParams(mode, params)
    const targetParams = {
      fromVision: '1',
      visionReturnTo,
      ...(returnTo && returnTo !== '/(customer)/profile/measurements'
        ? { returnTo, historyChain: returnTo }
        : {}),
    }
    return {
      pathname: '/(customer)/profile/measurements',
      params: targetParams,
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
    const returnTo = pickSafeReturnTo(params.historyChain, params.returnTo)
    if (returnTo) return returnTo
    return '/(tailor)/orders'
  }

  return returnRouteForParams(mode, params)
}

function primaryFallbackLabelForParams(mode: DrapeVisionMode, params: VisionParams) {
  if (mode !== 'garment_qc') return DRAPE_VISION_MODE_META[mode].primaryLabel
  if (params.orderId?.trim()) return 'Return to order'
  if (pickSafeReturnTo(params.historyChain, params.returnTo)?.includes('(tailor)')) return 'Back to dashboard'
  return 'Open orders'
}

export default function DrapeVisionRoute() {
  const router = useRouter()
  const navigation = useNavigation()
  const { colors } = useDrapeTheme()
  const visionExitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const visionExitInProgressRef = useRef(false)
  const rawParams = useLocalSearchParams<VisionParams>()
  const routeParams = useMemo(() => ({
    mode: firstParam(rawParams.mode),
    returnTo: firstParam(rawParams.returnTo),
    historyChain: firstParam(rawParams.historyChain),
    diaryId: firstParam(rawParams.diaryId),
    orderId: firstParam(rawParams.orderId),
    itemId: firstParam(rawParams.itemId),
  }), [rawParams.diaryId, rawParams.historyChain, rawParams.itemId, rawParams.mode, rawParams.orderId, rawParams.returnTo])
  const [preservedParams, setPreservedParams] = useState(() => readPreservedVisionNavigationContextSync())
  const params = useMemo(
    () => mergeVisionNavigationContext(routeParams, preservedParams),
    [preservedParams, routeParams],
  )
  const mode: DrapeVisionMode = isDrapeVisionMode(params.mode) ? params.mode : 'customer_scan'
  const meta = DRAPE_VISION_MODE_META[mode]
  const deferred = isDrapeVisionDeferredMode(mode)
  const { data: featureFlags } = useFeatureFlags('ALL')
  const androidVisionEnabled = featureFlags?.android_drape_vision?.enabled === true
  const NativeVisionScreen = useMemo(
    () => deferred ? null : loadNativeVisionScreen(mode, androidVisionEnabled)?.default ?? null,
    [androidVisionEnabled, deferred, mode],
  )
  const returnRoute = useMemo(() => returnRouteForParams(mode, params), [mode, params])
  const primaryFallbackTarget = useMemo(() => primaryFallbackTargetForParams(mode, params), [mode, params])
  const primaryFallbackLabel = useMemo(() => primaryFallbackLabelForParams(mode, params), [mode, params])
  const androidPaused = isAndroidLiveScanPausedForLaunch(mode, androidVisionEnabled)
  const [visionExitPending, setVisionExitPending] = useState(false)
  const [nativeMountReady, setNativeMountReady] = useState(false)
  const resolveVisionExitReturnRoute = useCallback(() => {
    const cachedParams = readPreservedVisionNavigationContextSync()
    return pickSafeReturnTo(
      params.historyChain,
      preservedParams?.historyChain,
      cachedParams?.historyChain,
      params.returnTo,
      preservedParams?.returnTo,
      cachedParams?.returnTo,
      returnRoute,
    ) ?? returnRoute
  }, [
    params.historyChain,
    params.returnTo,
    preservedParams?.historyChain,
    preservedParams?.returnTo,
    returnRoute,
  ])

  useEffect(() => {
    preserveVisionNavigationContext(routeParams)
  }, [routeParams])

  useEffect(() => {
    if (preservedParams) return undefined

    let active = true
    void loadPreservedVisionNavigationContext().then((context) => {
      if (active && context) setPreservedParams(context)
    })

    return () => {
      active = false
    }
  }, [preservedParams])

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
      level: deferred ? 'info' : 'warning',
      message: deferred
        ? 'vision_mode_deferred_for_launch'
        : androidPaused
          ? 'android_live_scan_paused_for_launch'
          : 'native_module_unavailable',
      data: { mode, appOwnership: expoAppOwnership() ?? 'unknown', platform: Platform.OS },
    })
  }, [NativeVisionScreen, androidPaused, deferred, mode])

  useEffect(() => {
    if (!NativeVisionScreen) {
      setNativeMountReady(false)
      return undefined
    }

    let active = true
    let settleTimer: ReturnType<typeof setTimeout> | null = null
    const interactionTask = InteractionManager.runAfterInteractions(() => {
      settleTimer = setTimeout(() => {
        if (!active) return
        setNativeMountReady(true)
        Sentry.addBreadcrumb({
          category: 'drape_vision',
          level: 'info',
          message: 'vision_native_mount_ready',
          data: {
            mode,
            returnTo: params.returnTo ?? 'none',
            platform: Platform.OS,
          },
        })
      }, VISION_NATIVE_MOUNT_SETTLE_MS)
    })

    Sentry.addBreadcrumb({
      category: 'drape_vision',
      level: 'info',
      message: 'vision_native_mount_deferred',
      data: {
        mode,
        returnTo: params.returnTo ?? 'none',
        platform: Platform.OS,
      },
    })

    return () => {
      active = false
      interactionTask.cancel()
      if (settleTimer) clearTimeout(settleTimer)
    }
  }, [NativeVisionScreen, mode, params.returnTo])

  useEffect(() => (
    () => {
      if (visionExitTimerRef.current) clearTimeout(visionExitTimerRef.current)
    }
  ), [])

  const openPrimaryFallback = useCallback(() => {
    if (visionExitInProgressRef.current) return
    visionExitInProgressRef.current = true
    setVisionExitPending(true)

    if (visionExitTimerRef.current) clearTimeout(visionExitTimerRef.current)
    visionExitTimerRef.current = setTimeout(() => {
      router.navigate(primaryFallbackTarget as never)
      if (mode !== 'customer_scan') clearPreservedVisionNavigationContext()
      visionExitTimerRef.current = null
    }, VISION_ROUTE_EXIT_DELAY_MS)
  }, [mode, primaryFallbackTarget, router])

  const openReturnRoute = useCallback(() => {
    if (visionExitInProgressRef.current) return
    const exitReturnRoute = resolveVisionExitReturnRoute()
    visionExitInProgressRef.current = true
    setVisionExitPending(true)

    if (visionExitTimerRef.current) clearTimeout(visionExitTimerRef.current)
    visionExitTimerRef.current = setTimeout(() => {
      goBackOrReturnToIfNeeded(
        router,
        navigation,
        exitReturnRoute,
        fallbackRouteForMode(mode) as never,
        { fromPath: '/vision' },
      )
      clearPreservedVisionNavigationContext()
      visionExitTimerRef.current = null
    }, VISION_ROUTE_EXIT_DELAY_MS)
  }, [mode, navigation, resolveVisionExitReturnRoute, router])

  useEffect(() => {
    if (Platform.OS !== 'android') return undefined

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      openReturnRoute()
      return true
    })

    return () => {
      subscription.remove()
    }
  }, [openReturnRoute])

  if (NativeVisionScreen && nativeMountReady) return <NativeVisionScreen />

  if (NativeVisionScreen) {
    return (
      <View style={[styles.nativeMountLoading, { backgroundColor: colors.bone }]}>
        <ActivityIndicator color={colors.needleGreen} size="large" />
        <Text style={[styles.nativeMountLoadingText, { color: colors.inkLight }]}>Starting Drapeon Vision</Text>
      </View>
    )
  }

  const hasExplicitReturn = !!pickSafeReturnTo(params.historyChain, params.returnTo)

  return (
    <VisionShell
      testID="vision-fallback-screen"
      contentContainerStyle={styles.content}
      footer={(compact) => (
        <View style={styles.floatingActions}>
          {!compact && hasExplicitReturn ? (
            <VisionDockIconButton
              icon="arrow-left"
              label="Back to previous screen"
              onPress={openReturnRoute}
              disabled={visionExitPending}
            />
          ) : null}
          <VisionPrimaryButton
            label={primaryFallbackLabel}
            icon="arrow-right"
            onPress={openPrimaryFallback}
            disabled={visionExitPending}
            loading={visionExitPending}
            compact={compact}
            style={compact ? undefined : styles.floatingPrimaryAction}
          />
        </View>
      )}
    >
      <View style={styles.hero}>
        <View style={styles.heroIcon}>
          <Feather name="aperture" size={28} color={Colors.needleGreen} />
        </View>
        <Text style={styles.eyebrow}>{meta.eyebrow}</Text>
        <Text style={[styles.title, { color: colors.ink }]}>
          {deferred
            ? `${meta.eyebrow} is planned for a future release`
            : androidPaused
              ? 'Use manual measurements on Android'
              : 'Drapeon Vision is not available in this build'}
        </Text>
        <Text style={[styles.body, { color: colors.inkLight }]}>
          {deferred
            ? 'This workflow is not part of the launch build because it has not completed product and real-device validation. The existing manual workflow remains available.'
            : androidPaused
              ? 'The Android live scanner is paused for launch while we finish device validation. You can keep the order moving with manual measurements.'
              : "Live scanning needs Drapeon's camera-enabled build. You can keep going with the manual measurement path for now."}
        </Text>
      </View>

      <View style={[styles.noticeBand, { backgroundColor: colors.surface, borderColor: colors.lightGrey }]}>
        <Feather name="tool" size={18} color={colors.needleGreen} />
        <View style={styles.noticeCopy}>
          <Text style={[styles.noticeTitle, { color: colors.ink }]}>{deferred ? 'Use the established workflow' : 'Manual path is still available'}</Text>
          <Text style={[styles.noticeText, { color: colors.inkLight }]}>
            {deferred
              ? mode === 'tailor_client_scan'
                ? 'Record and review client measurements directly in Diary. Every value remains editable before a passport invite is sent.'
                : mode === 'size_guide_scan'
                  ? 'Build size ranges and buyer guidance directly in the listing editor. The manual fit guide remains available.'
                  : 'Use production stage updates and order evidence photos for the final quality and handoff record.'
              : androidPaused
                ? 'Manual measurements feed the same fit profile, tailor brief, ready-made fit check, and order flow without risking a camera crash.'
                : 'Add or review measurements manually, then return to Drapeon Vision when the camera build is installed.'}
          </Text>
        </View>
      </View>
    </VisionShell>
  )
}

const styles = StyleSheet.create({
  content: {
    paddingTop: Spacing.xl,
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
    fontWeight: FontWeight.bold,
    fontFamily: Fonts.display,
  },
  body: {
    fontSize: FontSize.md,
    lineHeight: 23,
  },
  noticeBand: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
    padding: Spacing.lg,
    borderRadius: Radius.md,
    borderWidth: 1,
  },
  noticeCopy: {
    flex: 1,
    gap: 4,
  },
  noticeTitle: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold,
  },
  noticeText: {
    fontSize: FontSize.sm,
    lineHeight: 20,
  },
  floatingActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  floatingPrimaryAction: {
    flex: 1,
  },
  nativeMountLoading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
  },
  nativeMountLoadingText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.medium,
  },
})
